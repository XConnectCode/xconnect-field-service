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
import { Plus, ClipboardCheck, Upload, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

const STATUS_BADGE: Record<string, { variant: any; label: string }> = {
  open: { variant: 'secondary', label: 'Open' },
  in_progress: { variant: 'outline', label: 'In progress' },
  passed: { variant: 'default', label: 'Passed' },
  failed: { variant: 'destructive', label: 'Failed' },
};

export default function QcPallets() {
  const { accessToken, user } = useAuth();
  const navigate = useNavigate();
  const [pallets, setPallets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Slip upload / review
  const [slipOpen, setSlipOpen] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<any>(null);   // parsed slip + editable header
  const [chosenIds, setChosenIds] = useState<Record<string, boolean>>({});
  const [slipFile, setSlipFile] = useState<File | null>(null); // original PDF, saved to each created pallet

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

  // ── slip upload → extract text → parse → review ─────────────────────────────
  const handleSlipFile = async (file: File | null) => {
    if (!file) return;
    setParsing(true);
    setParsed(null);
    setSlipFile(file);
    try {
      const text = await extractPdfText(file);
      const res = await qcPalletApi.parseSlip(text, accessToken || undefined);
      if (!res || !Array.isArray(res.fulfillment_ids) || res.fulfillment_ids.length === 0) {
        toast.error('No fulfillment IDs found in this slip');
        setParsing(false);
        return;
      }
      setParsed(res);
      // Pre-select all detected fulfillment IDs.
      const sel: Record<string, boolean> = {};
      for (const id of res.fulfillment_ids) sel[id] = true;
      setChosenIds(sel);
      toast.success(`Found ${res.fulfillment_ids.length} fulfillment(s)`);
    } catch (error: any) {
      console.error('Slip parse error:', error);
      toast.error('Could not read this PDF');
    } finally {
      setParsing(false);
    }
  };

  const handleCreateFromSlip = async () => {
    if (!parsed) return;
    const ids = Object.keys(chosenIds).filter((k) => chosenIds[k]);
    if (!ids.length) {
      toast.error('Select at least one fulfillment');
      return;
    }
    setCreating(true);
    try {
      const res = await qcPalletApi.createFromSlip(
        {
          sales_order: parsed.sales_order || null,
          customer: parsed.customer || null,
          operator: parsed.operator || null,
          destination: parsed.destination || null,
          load_type: parsed.load_type || 'loaded',
          guns_in_pallet: parsed.gun_qty || null,  // only set for single build slip
          fulfillment_ids: ids,
          updated_by: user?.email,
        },
        accessToken || undefined
      );
      const made = res?.created?.length ?? 0;
      const skipped = res?.skipped?.length ?? 0;
      toast.success(`Created ${made} pallet(s)${skipped ? `, skipped ${skipped} existing` : ''}`);

      // Attach the original imported slip PDF to each newly created pallet so the
      // inspector can reference the exact NetSuite document it came from.
      const createdPallets: any[] = Array.isArray(res?.created) ? res.created : [];
      if (slipFile && createdPallets.length) {
        let saved = 0;
        for (const p of createdPallets) {
          if (!p?.row_id) continue;
          try {
            await qcPalletFileApi.upload(p.row_id, slipFile, 'slip_pdf', accessToken || undefined);
            saved++;
          } catch (err) {
            console.error('Failed to attach slip PDF to pallet', p.row_id, err);
          }
        }
        if (saved) toast.success(`Saved slip PDF to ${saved} pallet(s)`);
      }

      setSlipOpen(false);
      setParsed(null);
      setSlipFile(null);
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
            {/* Upload Slip */}
            <Dialog open={slipOpen} onOpenChange={(o) => { setSlipOpen(o); if (!o) { setParsed(null); setSlipFile(null); } }}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Slip
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Create pallets from a slip</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="slip_file">Packing slip or pallet build slip (PDF)</Label>
                    <Input
                      id="slip_file"
                      type="file"
                      accept="application/pdf"
                      onChange={(e) => handleSlipFile(e.target.files?.[0] || null)}
                      disabled={parsing || creating}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      The slip is read in your browser; we detect the Sales Order and each Order Fulfillment.
                    </p>
                  </div>

                  {parsing && <p className="text-sm text-gray-500">Reading slip…</p>}

                  {parsed && (
                    <div className="space-y-3 border-t pt-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>Sales Order</Label>
                          <Input
                            value={parsed.sales_order || ''}
                            onChange={(e) => setParsed({ ...parsed, sales_order: e.target.value })}
                          />
                        </div>
                        <div>
                          <Label>Customer</Label>
                          <Input
                            value={parsed.customer || ''}
                            onChange={(e) => setParsed({ ...parsed, customer: e.target.value })}
                          />
                        </div>
                        <div>
                          <Label>Operator</Label>
                          <Input
                            value={parsed.operator || ''}
                            onChange={(e) => setParsed({ ...parsed, operator: e.target.value })}
                          />
                        </div>
                        <div>
                          <Label>Destination</Label>
                          <Input
                            value={parsed.destination || ''}
                            onChange={(e) => setParsed({ ...parsed, destination: e.target.value })}
                          />
                        </div>
                      </div>

                      {parsed.gun_qty ? (
                        <p className="text-xs text-gray-600">
                          Detected lot size: <span className="font-medium">{parsed.gun_qty}</span> guns
                          {' '}(applied to each created pallet).
                        </p>
                      ) : (
                        <p className="text-xs text-gray-500">
                          No per-pallet gun count on this slip — set the lot size on each pallet later.
                        </p>
                      )}

                      <div>
                        <Label>Fulfillments to create</Label>
                        <div className="mt-1 space-y-1 max-h-40 overflow-auto">
                          {parsed.fulfillment_ids.map((id: string) => (
                            <label key={id} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={!!chosenIds[id]}
                                onChange={(e) => setChosenIds({ ...chosenIds, [id]: e.target.checked })}
                              />
                              <span className="font-mono">{id}</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      <Button className="w-full" onClick={handleCreateFromSlip} disabled={creating}>
                        {creating ? 'Creating…' : 'Create selected pallets'}
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
                                {(p.guns_passed ?? 0)}/{(p.guns_total ?? p.guns_count ?? 0)}
                                {p.guns_in_pallet ? <span className="text-gray-400"> · of {p.guns_in_pallet}</span> : null}
                                {p.guns_failed ? <span className="text-red-600"> ({p.guns_failed} failed)</span> : null}
                              </TableCell>
                              <TableCell>{getStatusBadge(p.status)}</TableCell>
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
