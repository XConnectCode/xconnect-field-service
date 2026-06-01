import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useAuth } from '../lib/auth-context';
import { driverLoadApi } from '../lib/api';
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
import { ArrowLeft, Plus, Save, Trash2, Truck, AlertTriangle, CheckCircle2 } from 'lucide-react';
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

  // ── field helpers ───────────────────────────────────────────────────────────
  const setField = (key: string, value: any) => setLoad((prev: any) => ({ ...prev, [key]: value }));

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
    const reqs: { fieldName: string; label: string }[] = [
      { fieldName: 'packing_slip', label: 'Packing Slip' },
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
              <Input value={load.load_number || ''} onChange={(e) => setField('load_number', e.target.value)} />
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
            <Button variant="outline" size="sm" onClick={addItem}><Plus className="w-4 h-4 mr-1" /> Add pallet</Button>
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
                    <TableHead className="w-20">Exp</TableHead>
                    <TableHead className="w-20">Loaded</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead className="w-16">Loaded?</TableHead>
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Packing Slip #</Label>
                <Input value={load.packing_slip_no || ''} onChange={(e) => setField('packing_slip_no', e.target.value)} />
              </div>
              <div className="flex items-center justify-between rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2 self-end">
                <Label className="cursor-pointer">Hazmat Load</Label>
                <Switch checked={!!load.hazmat_load} onCheckedChange={(v) => setField('hazmat_load', v)} />
              </div>
            </div>
            {photoUploader('packing_slip', 'Packing Slip photo', true)}
            {load.hazmat_load && photoUploader('hazmat', 'Hazmat photo', true)}
            <div className={`flex items-center justify-between rounded-md border px-3 py-2 ${load.document_correlation ? 'border-green-300 bg-green-50 dark:bg-green-900/10' : 'border-amber-300 bg-amber-50 dark:bg-amber-900/10'}`}>
              <Label className="cursor-pointer font-medium">Document Correlation confirmed (hard blocker)</Label>
              <Switch checked={!!load.document_correlation} onCheckedChange={(v) => setField('document_correlation', v)} />
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
