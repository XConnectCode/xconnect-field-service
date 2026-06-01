import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../lib/auth-context';
import { qcPalletApi, qcPalletFileApi } from '../lib/api';
import { extractPdfText } from '../lib/pdfText';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Plus, ClipboardCheck, Upload, ChevronDown, ChevronRight, FileText, X, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const STATUS_BADGE: Record<string, { variant: any; label: string }> = {
  open: { variant: 'secondary', label: 'Open' },
  in_progress: { variant: 'outline', label: 'In progress' },
  passed: { variant: 'default', label: 'Passed' },
  failed: { variant: 'destructive', label: 'Failed' },
};

// One dropped slip file and its parse/review state.
type SlipEntry = {
  id: string;                              // local unique key
  file: File;                              // the PDF
  status: 'parsing' | 'ok' | 'error';      // per-file parse status
  error?: string;                          // failure reason (when status === 'error')
  parsed?: any;                            // parser result + editable header fields
  chosen?: Record<string, boolean>;        // selected fulfillment IDs
  expanded?: boolean;                      // review row open/closed
};

let __slipSeq = 0;
const nextSlipId = () => `slip_${Date.now()}_${__slipSeq++}`;

export default function QcPallets() {
  const { accessToken, user } = useAuth();
  const navigate = useNavigate();
  const [pallets, setPallets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Slip upload / review — now multi-file.
  const [slipOpen, setSlipOpen] = useState(false);
  const [slips, setSlips] = useState<SlipEntry[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const loadData = async () => {
    try {
      const data = await qcPalletApi.getAll(accessToken || undefined);
      setPallets(Array.isArray(data) ? data : []);
    } catch (error: any) {
      console.error('Error loading QC pallets:', error);
      toast.error('Failed to load QC pallets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [accessToken]);

  // ── group pallets by Sales Order ────────────────────────────────────────────
  const groups = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const p of pallets) {
      const key = p.sales_order || 'Ungrouped';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    // Sort: real SOs first (desc), Ungrouped last.
    return [...map.entries()].sort((a, b) => {
      if (a[0] === 'Ungrouped') return 1;
      if (b[0] === 'Ungrouped') return -1;
      return b[0].localeCompare(a[0]);
    });
  }, [pallets]);

  // Derived flags for the multi-file flow. Must be declared before any early
  // return so hook order stays stable.
  const anyParsing = useMemo(() => slips.some((s) => s.status === 'parsing'), [slips]);
  const anyError = useMemo(() => slips.some((s) => s.status === 'error'), [slips]);
  const readySlips = useMemo(() => slips.filter((s) => s.status === 'ok'), [slips]);
  const totalChosen = useMemo(
    () => readySlips.reduce((n, s) => n + Object.values(s.chosen || {}).filter(Boolean).length, 0),
    [readySlips]
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    setCreating(true);
    try {
      const created = await qcPalletApi.create(
        {
          build_no: formData.get('build_no') || null,
          customer: formData.get('customer') || null,
          destination: formData.get('destination') || null,
          load_type: formData.get('load_type') || 'loaded',
          status: 'open',
          updated_by: user?.email,
        },
        accessToken || undefined
      );
      toast.success('Pallet created');
      setDialogOpen(false);
      if (created?.row_id) navigate(`/qc/${created.row_id}`);
      else loadData();
    } catch (error: any) {
      toast.error(error.message || 'Failed to create pallet');
    } finally {
      setCreating(false);
    }
  };

  // ── per-file parse: extract text → parse → store on the entry ───────────────
  const parseEntry = async (entry: SlipEntry) => {
    const patch = (next: Partial<SlipEntry>) =>
      setSlips((prev) => prev.map((s) => (s.id === entry.id ? { ...s, ...next } : s)));
    try {
      const text = await extractPdfText(entry.file);
      const res = await qcPalletApi.parseSlip(text, accessToken || undefined);
      if (!res || !Array.isArray(res.fulfillment_ids) || res.fulfillment_ids.length === 0) {
        patch({ status: 'error', error: 'No fulfillment IDs found in this slip.' });
        return;
      }
      const chosen: Record<string, boolean> = {};
      for (const id of res.fulfillment_ids) chosen[id] = true;
      patch({ status: 'ok', parsed: res, chosen, expanded: true, error: undefined });
    } catch (error: any) {
      console.error('Slip parse error:', error);
      patch({ status: 'error', error: 'Could not read this PDF.' });
    }
  };

  // Accept a dropped/selected FileList: keep PDFs, append, parse each.
  const addFiles = (fileList: FileList | File[] | null) => {
    if (!fileList) return;
    const incoming = Array.from(fileList);
    const pdfs = incoming.filter(
      (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
    );
    const rejected = incoming.length - pdfs.length;
    if (rejected > 0) toast.error(`Ignored ${rejected} non-PDF file${rejected === 1 ? '' : 's'}`);
    if (!pdfs.length) return;

    const entries: SlipEntry[] = pdfs.map((file) => ({
      id: nextSlipId(),
      file,
      status: 'parsing' as const,
    }));
    setSlips((prev) => [...prev, ...entries]);
    // Kick off parsing for each new entry.
    for (const e of entries) void parseEntry(e);
  };

  const removeSlip = (id: string) => setSlips((prev) => prev.filter((s) => s.id !== id));

  const retrySlip = (id: string) => {
    const entry = slips.find((s) => s.id === id);
    if (!entry) return;
    setSlips((prev) => prev.map((s) => (s.id === id ? { ...s, status: 'parsing', error: undefined } : s)));
    void parseEntry({ ...entry, status: 'parsing' });
  };

  const patchParsed = (id: string, field: string, value: any) =>
    setSlips((prev) =>
      prev.map((s) => (s.id === id ? { ...s, parsed: { ...s.parsed, [field]: value } } : s))
    );

  const toggleChosen = (id: string, fid: string, value: boolean) =>
    setSlips((prev) =>
      prev.map((s) => (s.id === id ? { ...s, chosen: { ...(s.chosen || {}), [fid]: value } } : s))
    );

  const toggleExpanded = (id: string) =>
    setSlips((prev) => prev.map((s) => (s.id === id ? { ...s, expanded: !s.expanded } : s)));

  const resetSlipDialog = () => {
    setSlips([]);
    setDragOver(false);
  };

  // ── create pallets from every ready slip ────────────────────────────────────
  const handleCreateAll = async () => {
    if (!slips.length) {
      toast.error('Drop at least one slip');
      return;
    }
    // Block-until-fixed: nothing is created while any file is still parsing or
    // failed to parse. The user must resolve/remove those first.
    if (anyParsing) {
      toast.error('Still reading some slips — wait for them to finish');
      return;
    }
    if (anyError) {
      toast.error('Fix or remove the slips that failed to read before creating');
      return;
    }
    if (totalChosen === 0) {
      toast.error('Select at least one fulfillment to create');
      return;
    }

    setCreating(true);
    let madeTotal = 0;
    let skippedTotal = 0;
    let savedPdfTotal = 0;
    let failedFiles = 0;

    try {
      for (const s of readySlips) {
        const parsed = s.parsed;
        const ids = Object.keys(s.chosen || {}).filter((k) => s.chosen![k]);
        if (!parsed || !ids.length) continue;
        try {
          // requires_qc / item_category come from slip detection: gun pallets get
          // QC, hardware / spare-parts pallets skip it. guns_in_pallet is only the
          // true per-pallet lot from a build slip (capped server-side); a packing
          // slip leaves it unset so the server defaults gun pallets to capacity.
          const requiresQc = parsed.requires_qc !== false && parsed.is_gun !== false;
          const res = await qcPalletApi.createFromSlip(
            {
              sales_order: parsed.sales_order || null,
              customer: parsed.customer || null,
              operator: parsed.operator || null,
              destination: parsed.destination || null,
              load_type: parsed.load_type || 'loaded',
              guns_in_pallet: requiresQc ? (parsed.gun_qty || null) : null,
              requires_qc: requiresQc,
              item_category: parsed.item_category || (requiresQc ? 'guns' : 'hardware'),
              fulfillment_ids: ids,
              updated_by: user?.email,
            },
            accessToken || undefined
          );
          madeTotal += res?.created?.length ?? 0;
          skippedTotal += res?.skipped?.length ?? 0;

          // Attach this file's PDF to each pallet it created so the inspector can
          // reference the exact build slip it came from.
          const createdPallets: any[] = Array.isArray(res?.created) ? res.created : [];
          for (const p of createdPallets) {
            if (!p?.row_id) continue;
            try {
              await qcPalletFileApi.upload(p.row_id, s.file, 'build_slip_pdf', accessToken || undefined);
              savedPdfTotal++;
            } catch (err) {
              console.error('Failed to attach slip PDF to pallet', p.row_id, err);
            }
          }
        } catch (err: any) {
          console.error('Failed to create from slip', s.file.name, err);
          failedFiles++;
        }
      }

      if (madeTotal > 0) {
        toast.success(
          `Created ${madeTotal} pallet(s)` +
            (skippedTotal ? `, skipped ${skippedTotal} existing` : '') +
            (savedPdfTotal ? ` · saved ${savedPdfTotal} slip PDF(s)` : '')
        );
      } else if (skippedTotal > 0) {
        toast.info(`No new pallets — ${skippedTotal} already existed`);
      }
      if (failedFiles > 0) toast.error(`${failedFiles} slip(s) failed to import`);

      // Only close if everything that should create did so.
      if (failedFiles === 0) {
        setSlipOpen(false);
        resetSlipDialog();
      }
      loadData();
    } catch (error: any) {
      toast.error(error.message || 'Failed to create pallets');
    } finally {
      setCreating(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const cfg = STATUS_BADGE[status] || { variant: 'outline', label: status || '-' };
    return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
  };

  const counts = {
    open: pallets.filter((p) => p.status === 'open' || p.status === 'in_progress').length,
    passed: pallets.filter((p) => p.status === 'passed').length,
    failed: pallets.filter((p) => p.status === 'failed').length,
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="max-w-7xl mx-auto text-center py-12">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">QC — Perforating Guns</h1>
            <p className="text-gray-600 dark:text-gray-300 mt-2">
              Inspect a sample of guns, then sign off the pallet. A pallet can only pass once every sampled gun passes.
            </p>
          </div>
          <div className="flex gap-2">
            {/* Upload Slip(s) */}
            <Dialog open={slipOpen} onOpenChange={(o) => { setSlipOpen(o); if (!o) resetSlipDialog(); }}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Slips
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Create pallets from slips</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  {/* Drag-and-drop zone (also click-to-browse). */}
                  <label
                    htmlFor="slip_files"
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(false);
                      addFiles(e.dataTransfer?.files || null);
                    }}
                    className={[
                      'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors',
                      dragOver
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                        : 'border-gray-300 dark:border-gray-700 hover:border-gray-400',
                    ].join(' ')}
                  >
                    <Upload className="w-6 h-6 text-gray-400" />
                    <div className="text-sm font-medium">
                      Drag &amp; drop one or more PDFs here
                    </div>
                    <div className="text-xs text-gray-500">
                      or click to browse — packing slips and pallet build slips, guns or hardware
                    </div>
                    <Input
                      id="slip_files"
                      type="file"
                      accept="application/pdf"
                      multiple
                      className="hidden"
                      onChange={(e) => { addFiles(e.target.files); e.currentTarget.value = ''; }}
                      disabled={creating}
                    />
                  </label>

                  {slips.length > 0 && (
                    <div className="space-y-2 max-h-[26rem] overflow-auto pr-1">
                      {slips.map((s) => {
                        const p = s.parsed;
                        const chosenCount = Object.values(s.chosen || {}).filter(Boolean).length;
                        return (
                          <div
                            key={s.id}
                            className="rounded-md border border-gray-200 dark:border-gray-700"
                          >
                            {/* Row header */}
                            <div className="flex items-center gap-2 px-3 py-2">
                              {s.status === 'ok' && (
                                <button
                                  type="button"
                                  className="text-gray-500"
                                  onClick={() => toggleExpanded(s.id)}
                                  aria-label={s.expanded ? 'Collapse' : 'Expand'}
                                >
                                  {s.expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                </button>
                              )}
                              {s.status === 'parsing' && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
                              {s.status === 'error' && <AlertTriangle className="w-4 h-4 text-red-500" />}
                              {s.status === 'ok' && <CheckCircle2 className="w-4 h-4 text-green-600" />}
                              <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                              <span className="text-sm truncate flex-1" title={s.file.name}>{s.file.name}</span>

                              {s.status === 'ok' && p && (
                                <>
                                  {p.sales_order && (
                                    <Badge variant="secondary" className="font-mono">{p.sales_order}</Badge>
                                  )}
                                  <Badge variant="outline">
                                    {p.doc_type === 'packing_slip' ? 'Packing slip' : 'Build slip'}
                                  </Badge>
                                  <Badge variant={p.is_gun === false ? 'outline' : 'default'}>
                                    {p.is_gun === false ? 'Hardware · no QC' : 'Guns'}
                                  </Badge>
                                  <span className="text-xs text-gray-500 whitespace-nowrap">
                                    {chosenCount}/{p.fulfillment_ids.length} sel.
                                  </span>
                                </>
                              )}
                              {s.status === 'error' && (
                                <Button variant="ghost" size="sm" onClick={() => retrySlip(s.id)}>Retry</Button>
                              )}
                              <button
                                type="button"
                                className="text-gray-400 hover:text-red-500"
                                onClick={() => removeSlip(s.id)}
                                aria-label="Remove"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>

                            {s.status === 'error' && (
                              <div className="px-3 pb-2 text-xs text-red-600">{s.error}</div>
                            )}

                            {/* Review body */}
                            {s.status === 'ok' && s.expanded && p && (
                              <div className="border-t px-3 py-3 space-y-3">
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <Label>Sales Order</Label>
                                    <Input value={p.sales_order || ''} onChange={(e) => patchParsed(s.id, 'sales_order', e.target.value)} />
                                  </div>
                                  <div>
                                    <Label>Customer</Label>
                                    <Input value={p.customer || ''} onChange={(e) => patchParsed(s.id, 'customer', e.target.value)} />
                                  </div>
                                  <div>
                                    <Label>Operator</Label>
                                    <Input value={p.operator || ''} onChange={(e) => patchParsed(s.id, 'operator', e.target.value)} />
                                  </div>
                                  <div>
                                    <Label>Destination</Label>
                                    <Input value={p.destination || ''} onChange={(e) => patchParsed(s.id, 'destination', e.target.value)} />
                                  </div>
                                </div>

                                {p.is_gun === false ? (
                                  <p className="text-xs text-amber-600">
                                    Hardware / spare parts detected — these pallets are <span className="font-medium">not QC'd</span>
                                    {' '}(no gun inspection). They can still be added to a driver load.
                                  </p>
                                ) : p.doc_type === 'packing_slip' ? (
                                  <p className="text-xs text-gray-600">
                                    Packing slip lists the whole-order total
                                    {p.order_qty ? <> (<span className="font-medium">{p.order_qty}</span> barrels across all fulfillments)</> : null}.
                                    {' '}Each pallet defaults to <span className="font-medium">100</span> guns (max per pallet); the build slip confirms the exact per-pallet count.
                                  </p>
                                ) : p.gun_qty ? (
                                  <p className="text-xs text-gray-600">
                                    Detected per-pallet lot: <span className="font-medium">{p.gun_qty}</span> guns
                                    {' '}(max 100; applied to each created pallet).
                                  </p>
                                ) : (
                                  <p className="text-xs text-gray-500">
                                    No per-pallet gun count on this slip — set the lot size (max 100) on each pallet later.
                                  </p>
                                )}

                                <div>
                                  <Label>Fulfillments to create</Label>
                                  <div className="mt-1 space-y-1 max-h-40 overflow-auto">
                                    {p.fulfillment_ids.map((id: string) => (
                                      <label key={id} className="flex items-center gap-2 text-sm">
                                        <input
                                          type="checkbox"
                                          checked={!!(s.chosen && s.chosen[id])}
                                          onChange={(e) => toggleChosen(s.id, id, e.target.checked)}
                                        />
                                        <span className="font-mono">{id}</span>
                                      </label>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {slips.length > 0 && (
                    <div className="space-y-2 border-t pt-3">
                      {anyError && (
                        <p className="text-xs text-red-600 flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Some slips failed to read. Retry or remove them before creating — nothing is created until every slip is clean.
                        </p>
                      )}
                      <Button
                        className="w-full"
                        onClick={handleCreateAll}
                        disabled={creating || anyParsing || anyError || totalChosen === 0}
                      >
                        {creating
                          ? 'Creating…'
                          : anyParsing
                          ? 'Reading slips…'
                          : `Create ${totalChosen} pallet${totalChosen === 1 ? '' : 's'} from ${readySlips.length} slip${readySlips.length === 1 ? '' : 's'}`}
                      </Button>
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>

            {/* New Pallet (manual) */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  New Pallet
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>New QC Pallet</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleCreate} className="space-y-4">
                  <div>
                    <Label htmlFor="build_no">Pallet Build # (NetSuite)</Label>
                    <Input id="build_no" name="build_no" placeholder="e.g. SO4698-IF37624" required />
                  </div>
                  <div>
                    <Label htmlFor="customer">Customer</Label>
                    <Input id="customer" name="customer" />
                  </div>
                  <div>
                    <Label htmlFor="destination">Destination</Label>
                    <Input id="destination" name="destination" />
                  </div>
                  <div>
                    <Label htmlFor="load_type">Load Type</Label>
                    <Select name="load_type" defaultValue="loaded">
                      <SelectTrigger>
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="loaded">Loaded (charges + det cord)</SelectItem>
                        <SelectItem value="unloaded">Unloaded (no charges / det cord)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="submit" className="w-full" disabled={creating}>
                    {creating ? 'Creating...' : 'Create & Open Inspection'}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-8">
          <Card><CardContent className="py-5"><div className="text-sm text-gray-500">Open / In progress</div><div className="text-3xl font-bold">{counts.open}</div></CardContent></Card>
          <Card><CardContent className="py-5"><div className="text-sm text-gray-500">Passed</div><div className="text-3xl font-bold text-green-600">{counts.passed}</div></CardContent></Card>
          <Card><CardContent className="py-5"><div className="text-sm text-gray-500">Failed</div><div className="text-3xl font-bold text-red-600">{counts.failed}</div></CardContent></Card>
        </div>

        {pallets.length === 0 ? (
          <Card>
            <CardContent>
              <div className="text-center py-12 text-gray-500">
                <ClipboardCheck className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p>No pallets yet. Upload a slip or create a pallet to start inspection.</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {groups.map(([so, items]) => {
              const isCollapsed = !!collapsed[so];
              const passed = items.filter((p) => p.status === 'passed').length;
              return (
                <Card key={so}>
                  <CardHeader
                    className="cursor-pointer select-none"
                    onClick={() => setCollapsed({ ...collapsed, [so]: !isCollapsed })}
                  >
                    <CardTitle className="flex items-center gap-2 text-lg">
                      {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      <span>{so === 'Ungrouped' ? 'Ungrouped' : `Sales Order ${so}`}</span>
                      <Badge variant="secondary">{items.length} pallet{items.length === 1 ? '' : 's'}</Badge>
                      {passed > 0 && <Badge variant="default">{passed} passed</Badge>}
                    </CardTitle>
                  </CardHeader>
                  {!isCollapsed && (
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Fulfillment</TableHead>
                            <TableHead>Build #</TableHead>
                            <TableHead>Customer</TableHead>
                            <TableHead>Operator</TableHead>
                            <TableHead>Destination</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Guns (passed/total)</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Signed off by</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {items.map((p) => (
                            <TableRow
                              key={p.row_id}
                              className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
                              onClick={() => navigate(`/qc/${p.row_id}`)}
                            >
                              <TableCell className="font-mono">{p.fulfillment_id || '-'}</TableCell>
                              <TableCell className="font-medium">{p.build_no || '-'}</TableCell>
                              <TableCell>{p.customer || '-'}</TableCell>
                              <TableCell>{p.operator || '-'}</TableCell>
                              <TableCell>{p.destination || '-'}</TableCell>
                              <TableCell className="capitalize">{p.load_type || '-'}</TableCell>
                              <TableCell>
                                {p.requires_qc === false ? (
                                  <span className="text-gray-400">— no QC</span>
                                ) : (
                                  <>
                                    {(p.guns_passed ?? 0)}/{(p.guns_total ?? p.guns_count ?? 0)}
                                    {p.guns_in_pallet ? <span className="text-gray-400"> · of {p.guns_in_pallet}</span> : null}
                                    {p.guns_failed ? <span className="text-red-600"> ({p.guns_failed} failed)</span> : null}
                                  </>
                                )}
                              </TableCell>
                              <TableCell>
                                {p.requires_qc === false
                                  ? <Badge variant="outline">Hardware · no QC</Badge>
                                  : getStatusBadge(p.status)}
                              </TableCell>
                              <TableCell>{p.signed_off_by || '-'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
