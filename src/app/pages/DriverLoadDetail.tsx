import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useAuth } from '../lib/auth-context';
import { driverLoadApi, qcPalletApi, qcPalletFileApi, driverLoadFileApi } from '../lib/api';
import { extractPdfText } from '../lib/pdfText';
import { XC_BASES } from '../lib/xcLocations';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import ImageUpload, { ImageRecord } from '../components/ImageUpload';
import SignaturePad from '../components/SignaturePad';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Switch } from '../components/ui/switch';
import { Checkbox } from '../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { ArrowLeft, Plus, Save, Trash2, Truck, AlertTriangle, CheckCircle2, FileText, Camera } from 'lucide-react';
import { toast } from 'sonner';

const baseUrl = `https://${projectId}.supabase.co/functions/v1/make-server-64775d98`;

const EXPLOSIVE_TYPES = [
  { key: 'detonators', label: 'Detonators' },
  { key: 'power_charges', label: 'Power Charges' },
  { key: 'igniters', label: 'Igniters' },
];

type Item = {
  pallet_build_no: string;
  description: string;
  qty_expected: number | string;
  qty_loaded: number | string;
  destination: string;
  checked: boolean;
  note: string;
  source_pallet_row_id?: string | null;
};

const emptyItem = (): Item => ({
  pallet_build_no: '', description: '', qty_expected: '', qty_loaded: '',
  destination: '', checked: false, note: '', source_pallet_row_id: null,
});

export default function DriverLoadDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { accessToken, user } = useAuth();

  const [load, setLoad] = useState<any>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [passedPallets, setPassedPallets] = useState<any[]>([]);
  // Per-pallet documents rolled up from each linked QC pallet (build slip PDF + QC photos),
  // keyed by source_pallet_row_id, so the driver sees all docs on the load.
  const [palletDocs, setPalletDocs] = useState<Record<string, any[]>>({});
  // Full pallet records (sales_order / customer / destination) for the linked pallets,
  // keyed by source_pallet_row_id, used to auto-compute Document Correlation.
  const [palletMeta, setPalletMeta] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // true while a packing-slip PDF is being parsed + auto-attached.
  const [importingSlip, setImportingSlip] = useState(false);
  // All loads (used only to compute the next per-day sequence for the Load #).
  const [allLoads, setAllLoads] = useState<any[]>([]);

  const isAdmin = user?.role === 'admin';

  // ── load data ──────────────────────────────────────────────────────────────
  const fetchLoad = async () => {
    if (!id) return;
    try {
      const data = await driverLoadApi.get(id, accessToken || undefined);
      setLoad(data);
      setItems(
        Array.isArray(data.items) && data.items.length
          ? data.items.map((it: any) => ({
              pallet_build_no: it.pallet_build_no ?? '',
              description: it.description ?? '',
              qty_expected: it.qty_expected ?? '',
              qty_loaded: it.qty_loaded ?? '',
              destination: it.destination ?? '',
              checked: !!it.checked,
              note: it.note ?? '',
              source_pallet_row_id: it.source_pallet_row_id ?? null,
            }))
          : []
      );
      // load images to evaluate required-photo presence
      try {
        const resp = await fetch(`${baseUrl}/images/driver_loads/${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${accessToken ?? publicAnonKey}` },
        });
        if (resp.ok) {
          const imgData = await resp.json();
          setImages(Array.isArray(imgData.files) ? imgData.files : []);
        }
      } catch { /* non-fatal */ }
    } catch (error: any) {
      console.error('Error loading driver load:', error);
      toast.error('Failed to load checklist');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLoad();
  }, [id, accessToken]);

  // QC-passed pallets are selectable as load line items (the QC→Driver link).
  useEffect(() => {
    (async () => {
      try {
        const data = await qcPalletApi.getPassed(accessToken || undefined);
        setPassedPallets(Array.isArray(data) ? data : []);
      } catch { /* non-fatal */ }
    })();
  }, [accessToken]);

  // All loads — used to compute the daily sequence number for an auto Load #.
  useEffect(() => {
    (async () => {
      try {
        const data = await driverLoadApi.getAll(accessToken || undefined);
        setAllLoads(Array.isArray(data) ? data : []);
      } catch { /* non-fatal */ }
    })();
  }, [accessToken]);

  // Roll up documents from each linked QC pallet so the driver can view the
  // pallet build slip PDF + QC photos right on the load. Refetches when the set
  // of linked pallets changes.
  const linkedPalletIds = useMemo(
    () => Array.from(new Set(items.map((it) => it.source_pallet_row_id).filter(Boolean) as string[])),
    [items]
  );
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const nextDocs: Record<string, any[]> = {};
      const nextMeta: Record<string, any> = {};
      await Promise.all(
        linkedPalletIds.map(async (pid) => {
          try {
            const res = await qcPalletFileApi.list(pid, accessToken || undefined);
            const files: any[] = Array.isArray(res?.files) ? res.files : [];
            // Only surface slip PDFs and QC photos (not the verification selfie).
            // build_slip_pdf / packing_slip_pdf / slip_pdf are all labeled by type below.
            nextDocs[pid] = files.filter(
              (f) =>
                f.field_name === 'build_slip_pdf' ||
                f.field_name === 'packing_slip_pdf' ||
                f.field_name === 'slip_pdf' ||
                f.field_name === 'qc_photo'
            );
          } catch { nextDocs[pid] = []; }
          try {
            const rec = await qcPalletApi.get(pid, accessToken || undefined);
            nextMeta[pid] = rec || null;
          } catch { nextMeta[pid] = null; }
        })
      );
      if (!cancelled) { setPalletDocs(nextDocs); setPalletMeta(nextMeta); }
    })();
    return () => { cancelled = true; };
  }, [linkedPalletIds.join(','), accessToken]);

  const addPalletItem = (palletRowId: string) => {
    const p = passedPallets.find((x) => x.row_id === palletRowId);
    if (!p) return;
    // Auto-fill customer + customer district + destination from the pallet paperwork.
    setLoad((prev: any) => ({
      ...prev,
      customer: prev.customer || p.customer || null,
      destination: prev.destination || p.destination || null,
    }));
    setItems((prev) => [
      ...prev,
      {
        pallet_build_no: p.build_no ?? '',
        description: `Perforating guns (${p.load_type})`,
        qty_expected: p.guns_total ?? '',
        qty_loaded: '',
        destination: p.destination ?? '',
        checked: false,
        note: '',
        source_pallet_row_id: p.row_id,
      },
    ]);
    toast.success(`Added pallet ${p.build_no || ''}`);
  };

  // ── field helpers ───────────────────────────────────────────────────────────
  const setField = (key: string, value: any) => setLoad((prev: any) => ({ ...prev, [key]: value }));

  // Auto Load # = <BASECODE>-<YYYYMMDD>-<NN>.
  //   BASECODE: first 4 letters of the origin XC base, uppercased (e.g. Williston
  //             -> WILL, Midland -> MIDL); falls back to 'LOAD' before a base is
  //             chosen. NN: zero-padded daily sequence (count of loads sharing the
  //             same base+date prefix, + 1), so the second load that day is -02.
  const baseCode = (base?: string | null) => {
    const code = String(base || '').replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase();
    return code || 'LOAD';
  };
  const ymd = (dateStr?: string | null) => {
    const d = dateStr ? new Date(dateStr) : new Date();
    const valid = !isNaN(d.getTime()) ? d : new Date();
    const y = valid.getFullYear();
    const m = String(valid.getMonth() + 1).padStart(2, '0');
    const day = String(valid.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  };
  const genLoadNumber = () => {
    const code = baseCode(load?.origin_district);
    const datePart = ymd(load?.delivery_date);
    const prefix = `${code}-${datePart}-`;
    // Count existing loads that already use this prefix (excluding this one).
    let maxSeq = 0;
    for (const l of allLoads) {
      if (l?.row_id === id) continue;
      const ln = String(l?.load_number || '');
      if (!ln.startsWith(prefix)) continue;
      const n = parseInt(ln.slice(prefix.length), 10);
      if (!isNaN(n) && n > maxSeq) maxSeq = n;
    }
    const seq = String(maxSeq + 1).padStart(2, '0');
    return `${prefix}${seq}`;
  };
  const handleGenerateLoadNumber = () => setField('load_number', genLoadNumber());

  // Auto-fill the Load # once, when it is empty and we have what we need to build
  // a meaningful number (origin base chosen + loads list fetched for sequencing).
  // We never overwrite a number the user already has.
  useEffect(() => {
    if (!load) return;
    if (String(load.load_number || '').trim()) return;
    if (!load.origin_district) return;        // wait for a base so the prefix is real
    setField('load_number', genLoadNumber());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load?.origin_district, load?.delivery_date, allLoads.length]);

  // Set the packing slip number for a specific Sales Order group.
  const setSlipNoFor = (so: string, value: string) =>
    setLoad((prev: any) => {
      const cur = (prev?.packing_slips_by_so && typeof prev.packing_slips_by_so === 'object') ? prev.packing_slips_by_so : {};
      return { ...prev, packing_slips_by_so: { ...cur, [so]: value } };
    });

  const toggleExplosiveType = (key: string) => {
    setLoad((prev: any) => {
      const cur: string[] = Array.isArray(prev.explosive_types) ? prev.explosive_types : [];
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      return { ...prev, explosive_types: next };
    });
  };

  // ── required-photo evaluation (depends on load flags + uploaded images) ──────
  const photoFieldNames = useMemo(() => new Set(images.map((i) => i.fieldName || '')), [images]);
  const hasPhoto = (fieldName: string) => photoFieldNames.has(fieldName);

  const requiredPhotos = useMemo(() => {
    if (!load) return [] as { fieldName: string; label: string }[];
    // NOTE: the packing slip photo is now required per Sales Order via the
    // automated Document Correlation gate (one packing slip per SO), so it is
    // no longer a single load-level required photo here.
    const reqs: { fieldName: string; label: string }[] = [
      { fieldName: 'driver_side', label: 'Driver-side' },
      { fieldName: 'passenger_side', label: 'Passenger-side' },
    ];
    if (load.hazmat_load) reqs.push({ fieldName: 'hazmat', label: 'Hazmat' });
    if (load.ancillary_explosives) reqs.push({ fieldName: 'explosives', label: 'Explosives' });
    if (load.hardware_present) reqs.push({ fieldName: 'hardware', label: 'Hardware' });
    return reqs;
  }, [load]);

  const missingPhotos = useMemo(
    () => requiredPhotos.filter((r) => !hasPhoto(r.fieldName)),
    [requiredPhotos, photoFieldNames]
  );

  // ── automated Document Correlation (grouped by Sales Order) ───────────────────
  // A load may carry pallets from multiple Sales Orders, each with its own
  // packing slip. We group the linked pallets by SO and verify, per group:
  //  - the SO group has a packing slip number entered AND a packing slip photo
  //  - customer is consistent within the group
  //  - destination is consistent within the group
  // The load is "Correlated" only when every SO group passes. Each pallet's
  // build slip is separately verified against the physical slip during QC.
  const norm = (v: any) => String(v ?? '').trim().toLowerCase();
  // Per-SO packing slip photo field name on driver_loads (namespaced).
  const slipPhotoField = (so: string) => `packing_slip__${String(so).replace(/[^a-zA-Z0-9_-]/g, '_')}`;

  const soGroups = useMemo(() => {
    const linkedItems = items.filter((it) => it.source_pallet_row_id);
    const map: Record<string, { so: string; metas: any[]; count: number }> = {};
    for (const it of linkedItems) {
      const m = palletMeta[it.source_pallet_row_id as string];
      const so = (m?.sales_order || '').trim() || '(no SO)';
      if (!map[so]) map[so] = { so, metas: [], count: 0 };
      if (m) map[so].metas.push(m);
      map[so].count += 1;
    }
    return Object.values(map).sort((a, b) => a.so.localeCompare(b.so));
  }, [items, palletMeta]);

  const slipNoFor = (so: string) =>
    (load?.packing_slips_by_so && typeof load.packing_slips_by_so === 'object'
      ? load.packing_slips_by_so[so]
      : '') || '';

  // Auto-import a packing slip PDF: extract text -> parse SO# + packing slip # on
  // the server -> match to an SO group on this load -> fill the slip # and attach
  // the PDF as that group's packing slip document (no manual typing).
  const handleImportPackingSlip = async (file: File | null) => {
    if (!file || !id) return;
    setImportingSlip(true);
    try {
      const text = await extractPdfText(file);
      const parsed = await qcPalletApi.parseSlip(text, accessToken || undefined);
      if (parsed?.doc_type !== 'packing_slip') {
        toast.error('That PDF does not look like a packing slip (it may be a pallet build slip).');
        return;
      }
      const so = String(parsed?.sales_order || '').trim();
      const slipNo = String(parsed?.packing_slip_no || '').trim();
      if (!so) {
        toast.error('Could not read a Sales Order number from the PDF.');
        return;
      }
      // The Sales Order must already be on the load (via a linked QC-passed pallet).
      const group = soGroups.find((g) => g.so === so);
      if (!group) {
        const known = soGroups.map((g) => g.so).filter((s) => s !== '(no SO)');
        toast.error(
          `Packing slip is for ${so}, which is not on this load.` +
          (known.length ? ` Loaded Sales Orders: ${known.join(', ')}.` : ' Add its QC-passed pallets first.')
        );
        return;
      }
      const field = slipPhotoField(so);
      // Attach the PDF as the SO group's packing slip document.
      const rec = await driverLoadFileApi.upload(id, file, field, accessToken || undefined);
      setImages((p) => [
        ...p,
        { id: rec.id, url: rec.url, storagePath: rec.storagePath, fieldName: field, mimeType: file.type || 'application/pdf' },
      ]);
      // Auto-fill the packing slip number for the matching SO group.
      if (slipNo) setSlipNoFor(so, slipNo);
      toast.success(
        `Packing slip attached to ${so}` + (slipNo ? ` (#${slipNo})` : ' (no slip # found — enter manually)')
      );
    } catch (err: any) {
      toast.error(err?.message || 'Failed to import packing slip PDF.');
    } finally {
      setImportingSlip(false);
    }
  };

  const correlation = useMemo(() => {
    const checks: { ok: boolean; label: string; detail?: string }[] = [];
    const linkedCount = items.filter((it) => it.source_pallet_row_id).length;

    // 0. At least one pallet on the load.
    checks.push({
      ok: linkedCount > 0,
      label: 'At least one QC-passed pallet on the load',
      detail: linkedCount ? `${linkedCount} pallet(s) across ${soGroups.length} Sales Order(s)` : 'No pallets added',
    });

    // Per-SO group checks.
    for (const g of soGroups) {
      const hasSo = g.so !== '(no SO)';
      const custs = Array.from(new Set(g.metas.map((m) => norm(m.customer)).filter(Boolean)));
      const dests = Array.from(new Set(g.metas.map((m) => norm(m.destination)).filter(Boolean)));
      const hasSlipNo = !!norm(slipNoFor(g.so));
      const hasSlipPhoto = hasPhoto(slipPhotoField(g.so));
      const custOk = custs.length <= 1;
      const destOk = dests.length <= 1;
      const groupOk = hasSo && hasSlipNo && hasSlipPhoto && custOk && destOk;
      const problems: string[] = [];
      if (!hasSo) problems.push('pallet missing Sales Order');
      if (!hasSlipNo) problems.push('no packing slip #');
      if (!hasSlipPhoto) problems.push('no packing slip photo');
      if (!custOk) problems.push(`mixed customers (${custs.join(', ')})`);
      if (!destOk) problems.push(`mixed destinations (${dests.join(', ')})`);
      checks.push({
        ok: groupOk,
        label: `${g.so} — ${g.count} pallet(s)`,
        detail: groupOk ? 'packing slip + paperwork correlated' : problems.join('; '),
      });
    }

    const allOk = checks.every((c) => c.ok);
    return { checks, allOk };
  }, [items, soGroups, load, photoFieldNames]);

  // Keep the persisted document_correlation flag in lockstep with the automated
  // result so the existing departure blocker + saved record stay accurate.
  useEffect(() => {
    if (!load) return;
    if (!!load.document_correlation !== correlation.allOk) {
      setLoad((prev: any) => (prev ? { ...prev, document_correlation: correlation.allOk } : prev));
    }
  }, [correlation.allOk, load?.document_correlation]);

  // ── readiness validation ─────────────────────────────────────────────────────
  const blockers = useMemo(() => {
    if (!load) return [] as string[];
    const out: string[] = [];
    if (!load.document_correlation) out.push('Document Correlation must be confirmed');
    if (!load.items_secure) out.push("Item's Secure must be confirmed");
    missingPhotos.forEach((m) => out.push(`Missing required photo: ${m.label}`));
    if (!load.driver_sig_url) out.push('Driver signature required');
    if (!load.inspector_sig_url) out.push('Inspector signature required');
    if (!load.manager_sig_url) out.push('Manager signature required');
    return out;
  }, [load, missingPhotos]);

  const canDepart = blockers.length === 0;

  // ── persistence ──────────────────────────────────────────────────────────────
  const buildPayload = () => ({
    load_number: load.load_number || null,
    delivery_date: load.delivery_date || null,
    origin_district: load.origin_district || null,
    customer: load.customer || null,
    customer_district: load.customer_district || null,
    destination: load.destination || null,
    packing_slip_no: load.packing_slip_no || null,
    mode_of_delivery: load.mode_of_delivery || null,
    trailer_connected: !!load.trailer_connected,
    driver_type: load.driver_type || 'internal',
    driver: load.driver || null,
    driver_name: load.driver_name || null,
    driver_company: load.driver_company || null,
    hazmat_load: !!load.hazmat_load,
    hardware_present: !!load.hardware_present,
    ancillary_explosives: !!load.ancillary_explosives,
    explosive_types: Array.isArray(load.explosive_types) ? load.explosive_types : [],
    document_correlation: !!load.document_correlation,
    items_secure: !!load.items_secure,
    inspector_name: load.inspector_name || null,
    manager_name: load.manager_name || null,
    notes: load.notes || null,
    updated_by: user?.email,
  });

  const handleSave = async (opts?: { silent?: boolean }) => {
    if (!id || !load) return;
    setSaving(true);
    try {
      await driverLoadApi.update(id, buildPayload(), accessToken || undefined);
      const cleanItems = items
        .filter((it) => it.pallet_build_no || it.description)
        .map((it) => ({
          ...it,
          qty_expected: it.qty_expected === '' ? 0 : Number(it.qty_expected),
          qty_loaded: it.qty_loaded === '' ? 0 : Number(it.qty_loaded),
        }));
      await driverLoadApi.saveItems(id, cleanItems, accessToken || undefined);
      if (!opts?.silent) toast.success('Saved');
      await fetchLoad();
    } catch (error: any) {
      toast.error(error.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const markStatus = async (status: string) => {
    if (!id) return;
    if (status === 'departed' && !canDepart) {
      toast.error('Cannot mark ready to depart — resolve the blockers below');
      return;
    }
    setSaving(true);
    try {
      const patch: any = { ...buildPayload(), status };
      if (status === 'departed') {
        patch.departed_by = user?.email;
        patch.departed_at = new Date().toISOString();
      }
      await driverLoadApi.update(id, patch, accessToken || undefined);
      toast.success(status === 'departed' ? 'Marked ready to depart' : `Status: ${status}`);
      await fetchLoad();
    } catch (error: any) {
      toast.error(error.message || 'Failed to update status');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    if (!confirm('Delete this load? This cannot be undone.')) return;
    try {
      await driverLoadApi.remove(id, accessToken || undefined);
      toast.success('Load deleted');
      navigate('/driver');
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete');
    }
  };

  // ── item editing ─────────────────────────────────────────────────────────────
  const updateItem = (idx: number, key: keyof Item, value: any) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [key]: value } : it)));
  const addItem = () => setItems((prev) => [...prev, emptyItem()]);
  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  if (loading) {
    return <div className="p-8"><div className="max-w-5xl mx-auto text-center py-12">Loading...</div></div>;
  }
  if (!load) {
    return (
      <div className="p-8">
        <div className="max-w-5xl mx-auto text-center py-12">
          <p className="text-gray-500">Load not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/driver')}>Back to loads</Button>
        </div>
      </div>
    );
  }

  const is3rdParty = load.driver_type === 'third_party';
  const photoUploader = (fieldName: string, label: string, required: boolean) => (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Label className="text-sm">{label}</Label>
        {required && (
          hasPhoto(fieldName)
            ? <Badge variant="default" className="text-[10px]">Provided</Badge>
            : <Badge variant="destructive" className="text-[10px]">Required</Badge>
        )}
      </div>
      <ImageUpload
        parentTable="driver_loads"
        parentRowId={id!}
        fieldName={fieldName}
        baseUrl={baseUrl}
        publicAnonKey={publicAnonKey}
        existingImages={images.filter((i) => i.fieldName === fieldName)}
        maxImages={5}
        onImageUploaded={(rec) => setImages((p) => [...p, rec])}
        onImageDeleted={(rec) => setImages((p) => p.filter((i) => i.id !== rec.id))}
      />
    </div>
  );

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/driver')}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Loads
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {load.load_number || 'Driver Load'}
              </h1>
              <p className="text-sm text-gray-500">
                {load.customer ? `${load.customer} · ` : ''}{load.origin_district || ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="capitalize">{load.status || 'draft'}</Badge>
            <Button variant="outline" size="sm" onClick={() => handleSave()} disabled={saving}>
              <Save className="w-4 h-4 mr-1" /> {saving ? 'Saving...' : 'Save'}
            </Button>
            {isAdmin && (
              <Button variant="ghost" size="sm" onClick={handleDelete}>
                <Trash2 className="w-4 h-4 text-red-500" />
              </Button>
            )}
          </div>
        </div>

        {/* 1. Delivery info */}
        <Card>
          <CardHeader><CardTitle className="text-lg">1. Delivery Info</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Load #</Label>
              <div className="flex gap-2">
                <Input
                  value={load.load_number || ''}
                  onChange={(e) => setField('load_number', e.target.value)}
                  placeholder="auto: WILL-20260601-01"
                />
                <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={handleGenerateLoadNumber}>
                  Generate
                </Button>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Auto-fills from origin base + date once a base is selected. Format: BASE-YYYYMMDD-NN.
              </p>
            </div>
            <div>
              <Label>Delivery Date</Label>
              <Input type="date" value={load.delivery_date || ''} onChange={(e) => setField('delivery_date', e.target.value)} />
            </div>
            <div>
              <Label>Origin District (XC base)</Label>
              <Select value={load.origin_district || ''} onValueChange={(v) => setField('origin_district', v)}>
                <SelectTrigger><SelectValue placeholder="Select base" /></SelectTrigger>
                <SelectContent>
                  {XC_BASES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Mode of Delivery</Label>
              <Input value={load.mode_of_delivery || ''} onChange={(e) => setField('mode_of_delivery', e.target.value)} placeholder="e.g. Hotshot, LTL" />
            </div>
            <div className="md:col-span-2 grid grid-cols-2 gap-4">
              <div className="flex items-center justify-between rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2">
                <Label className="cursor-pointer">Trailer Connected</Label>
                <Switch checked={!!load.trailer_connected} onCheckedChange={(v) => setField('trailer_connected', v)} />
              </div>
              <div className="flex items-center justify-between rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2">
                <Label className="cursor-pointer">3rd-party Driver</Label>
                <Switch
                  checked={is3rdParty}
                  onCheckedChange={(v) => setField('driver_type', v ? 'third_party' : 'internal')}
                />
              </div>
            </div>
            {is3rdParty ? (
              <>
                <div>
                  <Label>Driver Name</Label>
                  <Input value={load.driver_name || ''} onChange={(e) => setField('driver_name', e.target.value)} />
                </div>
                <div>
                  <Label>Driver Company</Label>
                  <Input value={load.driver_company || ''} onChange={(e) => setField('driver_company', e.target.value)} />
                </div>
              </>
            ) : (
              <div>
                <Label>Driver (internal)</Label>
                <Input value={load.driver || ''} onChange={(e) => setField('driver', e.target.value)} placeholder="driver@email" />
              </div>
            )}
            <div className="md:col-span-2 rounded-md bg-gray-50 dark:bg-gray-800/50 px-3 py-2 text-sm text-gray-500">
              Customer &amp; customer district auto-populate from the selected pallet / packing slip once QC pallets are linked.
              Current: <span className="font-medium">{load.customer || '—'}</span>
              {load.customer_district ? ` / ${load.customer_district}` : ''}
            </div>
          </CardContent>
        </Card>

        {/* 2. Load / cargo */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">2. Load / Cargo</CardTitle>
            <div className="flex items-center gap-2">
              {passedPallets.length > 0 && (
                <Select value="" onValueChange={addPalletItem}>
                  <SelectTrigger className="w-56"><SelectValue placeholder="Add QC-passed pallet" /></SelectTrigger>
                  <SelectContent>
                    {passedPallets.map((p) => (
                      <SelectItem key={p.row_id} value={p.row_id}>
                        {p.build_no || p.row_id.slice(0, 8)} {p.customer ? `· ${p.customer}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button variant="outline" size="sm" onClick={addItem}><Plus className="w-4 h-4 mr-1" /> Add row</Button>
            </div>
          </CardHeader>
          <CardContent>
            {items.length === 0 ? (
              <p className="text-sm text-gray-500 py-2">No pallets added. (QC-passed pallets become selectable once the QC module is live.)</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Build #</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-24" title="Quantity expected on this pallet (from QC)">Expected qty</TableHead>
                    <TableHead className="w-24" title="Quantity actually loaded onto the truck">Loaded qty</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead className="w-16" title="Confirm this item is physically loaded">Loaded?</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it, idx) => (
                    <TableRow key={idx}>
                      <TableCell><Input value={it.pallet_build_no} onChange={(e) => updateItem(idx, 'pallet_build_no', e.target.value)} /></TableCell>
                      <TableCell><Input value={it.description} onChange={(e) => updateItem(idx, 'description', e.target.value)} /></TableCell>
                      <TableCell><Input type="number" value={it.qty_expected} onChange={(e) => updateItem(idx, 'qty_expected', e.target.value)} /></TableCell>
                      <TableCell><Input type="number" value={it.qty_loaded} onChange={(e) => updateItem(idx, 'qty_loaded', e.target.value)} /></TableCell>
                      <TableCell><Input value={it.destination} onChange={(e) => updateItem(idx, 'destination', e.target.value)} /></TableCell>
                      <TableCell className="text-center"><Checkbox checked={it.checked} onCheckedChange={(v) => updateItem(idx, 'checked', !!v)} /></TableCell>
                      <TableCell><Button variant="ghost" size="sm" onClick={() => removeItem(idx)}><Trash2 className="w-4 h-4 text-red-500" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {/* Rolled-up pallet documents: build slip PDF + QC photos for each linked pallet */}
            {linkedPalletIds.length > 0 && (
              <div className="mt-4 border-t pt-4 space-y-3">
                <Label className="flex items-center gap-2">
                  <FileText className="w-4 h-4" /> Pallet Documents
                </Label>
                <p className="text-xs text-gray-500">
                  Build slips and QC photos pulled from each QC-passed pallet on this load.
                </p>
                {items.filter((it) => it.source_pallet_row_id).map((it, i) => {
                  const pid = it.source_pallet_row_id as string;
                  const docs = palletDocs[pid] || [];
                  const pdfs = docs.filter(
                    (d) =>
                      d.field_name === 'build_slip_pdf' ||
                      d.field_name === 'packing_slip_pdf' ||
                      d.field_name === 'slip_pdf'
                  );
                  const photos = docs.filter((d) => d.field_name === 'qc_photo');
                  // Label each PDF by its true document type so a packing slip
                  // never shows up under a "Build slip PDF" link (and vice-versa).
                  const pdfLabel = (fieldName: string) =>
                    fieldName === 'packing_slip_pdf' ? 'Packing slip PDF' : 'Build slip PDF';
                  return (
                    <div key={`${pid}-${i}`} className="rounded-md border border-gray-200 dark:border-gray-700 p-3">
                      <div className="text-sm font-medium mb-2">
                        {it.pallet_build_no ? `Pallet ${it.pallet_build_no}` : 'Pallet'}
                        {it.description ? <span className="text-gray-500 font-normal"> — {it.description}</span> : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-sm">
                        {pdfs.length > 0 ? pdfs.map((f) => (
                          <a
                            key={f.id}
                            href={f.signedUrl || f.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline inline-flex items-center gap-1"
                          >
                            <FileText className="w-4 h-4" /> {pdfLabel(f.field_name)}
                          </a>
                        )) : <span className="text-xs text-gray-400 inline-flex items-center gap-1"><FileText className="w-4 h-4" /> No build slip</span>}
                      </div>
                      {photos.length > 0 && (
                        <div className="mt-2">
                          <div className="text-xs text-gray-500 mb-1 inline-flex items-center gap-1"><Camera className="w-4 h-4" /> QC photos ({photos.length})</div>
                          <div className="flex flex-wrap gap-2">
                            {photos.map((f) => (
                              <a key={f.id} href={f.signedUrl || f.url} target="_blank" rel="noopener noreferrer">
                                <img src={f.signedUrl || f.url} alt="QC" className="w-16 h-16 object-cover rounded border border-gray-200 dark:border-gray-700" />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-4 flex items-center justify-between rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2">
              <Label className="cursor-pointer">Hardware present</Label>
              <Switch checked={!!load.hardware_present} onCheckedChange={(v) => setField('hardware_present', v)} />
            </div>
            {load.hardware_present && <div className="mt-3">{photoUploader('hardware', 'Hardware photo', true)}</div>}
          </CardContent>
        </Card>

        {/* 3. Paperwork */}
        <Card>
          <CardHeader><CardTitle className="text-lg">3. Paperwork</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2">
              <Label className="cursor-pointer">Hazmat Load</Label>
              <Switch checked={!!load.hazmat_load} onCheckedChange={(v) => setField('hazmat_load', v)} />
            </div>

            {/* Packing slips — one per Sales Order on this load. */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <Label className="font-medium">Packing Slips (one per Sales Order)</Label>
                <Button asChild variant="outline" size="sm" disabled={importingSlip || soGroups.length === 0}>
                  <label className="cursor-pointer">
                    <FileText className="w-4 h-4 mr-1" />
                    {importingSlip ? 'Reading PDF…' : 'Import Packing Slip PDF'}
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      className="hidden"
                      disabled={importingSlip || soGroups.length === 0}
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        e.target.value = '';
                        handleImportPackingSlip(f);
                      }}
                    />
                  </label>
                </Button>
              </div>
              <p className="text-xs text-gray-400">
                Import a NetSuite packing slip PDF and the Sales Order # and packing slip # are read automatically and attached to the matching Sales Order below.
              </p>
              {soGroups.length === 0 ? (
                <p className="text-xs text-gray-400">Add QC-passed pallets above; a packing slip section appears per Sales Order.</p>
              ) : soGroups.map((g) => {
                const field = slipPhotoField(g.so);
                const slipNo = slipNoFor(g.so);
                const ok = g.so !== '(no SO)' && !!String(slipNo).trim() && hasPhoto(field);
                return (
                  <div key={g.so} className={`rounded-md border px-3 py-3 ${ok ? 'border-green-300 bg-green-50 dark:bg-green-900/10' : 'border-gray-200 dark:border-gray-700'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-medium">
                        Sales Order {g.so === '(no SO)' ? <span className="text-amber-600">(missing on pallet)</span> : g.so}
                        <span className="text-gray-500 font-normal"> · {g.count} pallet(s)</span>
                      </div>
                      {ok
                        ? <Badge variant="default" className="text-[10px]">Correlated</Badge>
                        : <Badge variant="outline" className="text-[10px]">Incomplete</Badge>}
                    </div>
                    <div className="mb-2">
                      <Label className="text-sm">Packing Slip #</Label>
                      <Input
                        value={slipNo}
                        onChange={(e) => setSlipNoFor(g.so, e.target.value)}
                        placeholder="e.g. PS-12345"
                        disabled={g.so === '(no SO)'}
                      />
                    </div>
                    {g.so !== '(no SO)' && photoUploader(field, 'Packing Slip photo', true)}
                  </div>
                );
              })}
            </div>

            {load.hazmat_load && photoUploader('hazmat', 'Hazmat photo', true)}
            {/* Automated Document Correlation: cross-checks packing slip vs pallets on the load. */}
            <div className={`rounded-md border px-3 py-3 ${correlation.allOk ? 'border-green-300 bg-green-50 dark:bg-green-900/10' : 'border-amber-300 bg-amber-50 dark:bg-amber-900/10'}`}>
              <div className="flex items-center justify-between mb-2">
                <Label className="font-medium">Document Correlation (automated — hard blocker)</Label>
                {correlation.allOk
                  ? <Badge variant="default" className="inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Correlated</Badge>
                  : <Badge variant="outline" className="inline-flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Not correlated</Badge>}
              </div>
              <ul className="space-y-1">
                {correlation.checks.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    {c.ok
                      ? <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                      : <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />}
                    <span>
                      {c.label}
                      {c.detail ? <span className="text-gray-500"> — {c.detail}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-gray-500 mt-2">
                Auto-verified per Sales Order from the linked QC pallets and packing slips. Every Sales Order group must be correlated to clear the blocker.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* 4. Ancillary explosives */}
        <Card>
          <CardHeader><CardTitle className="text-lg">4. Ancillary Explosives</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2">
              <Label className="cursor-pointer">Ancillary explosives present</Label>
              <Switch checked={!!load.ancillary_explosives} onCheckedChange={(v) => setField('ancillary_explosives', v)} />
            </div>
            {load.ancillary_explosives && (
              <>
                <div className="flex flex-wrap gap-4">
                  {EXPLOSIVE_TYPES.map((t) => {
                    const checked = Array.isArray(load.explosive_types) && load.explosive_types.includes(t.key);
                    return (
                      <label key={t.key} className="flex items-center gap-2 cursor-pointer">
                        <Checkbox checked={checked} onCheckedChange={() => toggleExplosiveType(t.key)} />
                        <span className="text-sm">{t.label}</span>
                      </label>
                    );
                  })}
                </div>
                {photoUploader('explosives', 'Explosives photo', true)}
              </>
            )}
          </CardContent>
        </Card>

        {/* 5. Vehicle / securing */}
        <Card>
          <CardHeader><CardTitle className="text-lg">5. Vehicle / Securing</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className={`flex items-center justify-between rounded-md border px-3 py-2 ${load.items_secure ? 'border-green-300 bg-green-50 dark:bg-green-900/10' : 'border-amber-300 bg-amber-50 dark:bg-amber-900/10'}`}>
              <Label className="cursor-pointer font-medium">Item's Secure confirmed (hard blocker)</Label>
              <Switch checked={!!load.items_secure} onCheckedChange={(v) => setField('items_secure', v)} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {photoUploader('driver_side', 'Driver-side photo', true)}
              {photoUploader('passenger_side', 'Passenger-side photo', true)}
            </div>
          </CardContent>
        </Card>

        {/* 6. Sign-off */}
        <Card>
          <CardHeader><CardTitle className="text-lg">6. Sign-off</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <SignaturePad
                parentTable="driver_loads" parentRowId={id!} fieldName="driver_signature" label="Driver"
                baseUrl={baseUrl} publicAnonKey={publicAnonKey} existingUrl={load.driver_sig_url}
                onSaved={(url) => setField('driver_sig_url', url)}
              />
              <div className="space-y-2">
                <SignaturePad
                  parentTable="driver_loads" parentRowId={id!} fieldName="inspector_signature" label="Inspector"
                  baseUrl={baseUrl} publicAnonKey={publicAnonKey} existingUrl={load.inspector_sig_url}
                  onSaved={(url) => setField('inspector_sig_url', url)}
                />
                <Input placeholder="Inspector name" value={load.inspector_name || ''} onChange={(e) => setField('inspector_name', e.target.value)} />
              </div>
              <div className="space-y-2">
                <SignaturePad
                  parentTable="driver_loads" parentRowId={id!} fieldName="manager_signature" label="Manager"
                  baseUrl={baseUrl} publicAnonKey={publicAnonKey} existingUrl={load.manager_sig_url}
                  onSaved={(url) => setField('manager_sig_url', url)}
                />
                <Input placeholder="Manager name" value={load.manager_name || ''} onChange={(e) => setField('manager_name', e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea rows={3} value={load.notes || ''} onChange={(e) => setField('notes', e.target.value)} />
            </div>
          </CardContent>
        </Card>

        {/* Readiness / departure */}
        <Card>
          <CardContent className="py-5">
            {canDepart ? (
              <div className="flex items-center gap-2 text-green-700 dark:text-green-400 mb-4">
                <CheckCircle2 className="w-5 h-5" />
                <span className="font-medium">All checks complete — ready to depart.</span>
              </div>
            ) : (
              <div className="mb-4">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 mb-2">
                  <AlertTriangle className="w-5 h-5" />
                  <span className="font-medium">Not ready to depart — {blockers.length} item(s) outstanding:</span>
                </div>
                <ul className="list-disc list-inside text-sm text-gray-600 dark:text-gray-300 space-y-1">
                  {blockers.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => handleSave()} disabled={saving}>
                <Save className="w-4 h-4 mr-1" /> Save progress
              </Button>
              <Button onClick={() => markStatus('departed')} disabled={!canDepart || saving}>
                <Truck className="w-4 h-4 mr-1" /> Mark Ready to Depart
              </Button>
              {load.status === 'departed' && (
                <Button variant="outline" onClick={() => markStatus('delivered')} disabled={saving}>
                  <CheckCircle2 className="w-4 h-4 mr-1" /> Mark Delivered
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
