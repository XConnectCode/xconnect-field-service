import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useAuth } from '../lib/auth-context';
import { qcPalletApi } from '../lib/api';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import ImageUpload from '../components/ImageUpload';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Progress } from '../components/ui/progress';
import { Badge } from '../components/ui/badge';
import { ArrowLeft, Save, Trash2, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

const baseUrl = `https://${projectId}.supabase.co/functions/v1/make-server-64775d98`;

const CHECK_ITEMS = [
  { key: 'parts', label: 'Correct parts (per order)' },
  { key: 'orientation', label: 'Correct orientation' },
  { key: 'charges', label: 'Shaped charges', loadOnly: true },
  { key: 'detcord', label: 'Det cord present/correct', loadOnly: true },
  { key: 'wiring', label: 'Wiring correct' },
  { key: 'build', label: 'Built correctly (overall)' },
];

const STATE_STYLE: Record<string, string> = {
  pass: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  fail: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  na: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
};

type Gun = {
  row_id: string;
  gun_index: number;
  serial?: string | null;
  result: string;
  notes?: string | null;
  checks: { item_key: string; state: string; note?: string | null }[];
};

export default function QcPalletDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { accessToken, user } = useAuth();

  const [pallet, setPallet] = useState<any>(null);
  const [guns, setGuns] = useState<Gun[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [gunCountInput, setGunCountInput] = useState('');
  const [lotInput, setLotInput] = useState('');

  const isAdmin = user?.role === 'admin';
  const isUnloaded = pallet?.load_type === 'unloaded';

  // AQL ANSI/ASQC Z1.4 — General Inspection Level II. Lot size → suggested sample.
  const aqlSampleSize = (lot: number): number => {
    const n = Math.max(0, Math.floor(Number(lot) || 0));
    if (n <= 1) return n;
    if (n <= 8) return 2;
    if (n <= 15) return 3;
    if (n <= 25) return 5;
    if (n <= 50) return 8;
    if (n <= 90) return 13;
    if (n <= 150) return 20;
    if (n <= 280) return 32;
    if (n <= 500) return 50;
    if (n <= 1200) return 80;
    if (n <= 3200) return 125;
    if (n <= 10000) return 200;
    if (n <= 35000) return 315;
    return 500;
  };
  const suggestedSample = useMemo(() => {
    const lot = Number(lotInput);
    return Number.isFinite(lot) && lot > 0 ? aqlSampleSize(lot) : null;
  }, [lotInput]);

  const fetchPallet = async () => {
    if (!id) return;
    try {
      const data = await qcPalletApi.get(id, accessToken || undefined);
      setPallet(data);
      const gunList: Gun[] = (Array.isArray(data.guns) ? data.guns : []).map((g: any) => ({
        row_id: g.row_id,
        gun_index: g.gun_index,
        serial: g.serial ?? '',
        result: g.result ?? 'pending',
        notes: g.notes ?? '',
        checks: CHECK_ITEMS.map((ci) => {
          const existing = (g.checks || []).find((c: any) => c.item_key === ci.key);
          // For unloaded pallets, default load-only items to 'na'.
          const fallback = ci.loadOnly && data.load_type === 'unloaded' ? 'na' : 'pass';
          return { item_key: ci.key, state: existing?.state ?? fallback, note: existing?.note ?? '' };
        }),
      }));
      setGuns(gunList);
      setGunCountInput(String(data.sample_size ?? data.guns_total ?? gunList.length ?? ''));
      setLotInput(data.guns_in_pallet != null ? String(data.guns_in_pallet) : '');
    } catch (error: any) {
      console.error('Error loading QC pallet:', error);
      toast.error('Failed to load pallet');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPallet();
  }, [id, accessToken]);

  const setPalletField = (key: string, value: any) => setPallet((prev: any) => ({ ...prev, [key]: value }));

  // ── gun count init ───────────────────────────────────────────────────────────
  const handleInitGuns = async () => {
    if (!id) return;
    const n = Number(gunCountInput);
    if (!Number.isFinite(n) || n < 1) {
      toast.error('Enter a valid number of guns (1 or more)');
      return;
    }
    if (guns.length > 0 && !confirm(`This will reset all ${guns.length} existing gun records. Continue?`)) return;
    const lot = Number(lotInput);
    const lotVal = Number.isFinite(lot) && lot > 0 ? lot : undefined;
    if (lotVal !== undefined && n > lotVal) {
      toast.error('Sample size cannot exceed total guns in the pallet');
      return;
    }
    setSaving(true);
    try {
      await qcPalletApi.initGuns(id, n, lotVal, accessToken || undefined);
      toast.success(lotVal ? `Inspecting ${n} of ${lotVal} guns` : `Initialised ${n} guns`);
      await fetchPallet();
    } catch (error: any) {
      toast.error(error.message || 'Failed to initialise guns');
    } finally {
      setSaving(false);
    }
  };

  // ── per-gun editing (local) ───────────────────────────────────────────────────
  const cycleState = (gunIdx: number, itemKey: string) => {
    setGuns((prev) =>
      prev.map((g, i) => {
        if (i !== gunIdx) return g;
        return {
          ...g,
          checks: g.checks.map((ck) => {
            if (ck.item_key !== itemKey) return ck;
            const order = ['pass', 'fail', 'na'];
            const next = order[(order.indexOf(ck.state) + 1) % order.length];
            return { ...ck, state: next };
          }),
        };
      })
    );
  };

  const setGunField = (gunIdx: number, key: keyof Gun, value: any) =>
    setGuns((prev) => prev.map((g, i) => (i === gunIdx ? { ...g, [key]: value } : g)));

  const gunComputedResult = (g: Gun) => (g.checks.some((c) => c.state === 'fail') ? 'fail' : 'pass');

  const saveGun = async (gunIdx: number) => {
    const g = guns[gunIdx];
    if (!g) return;
    setSaving(true);
    try {
      const updated = await qcPalletApi.saveGun(
        g.row_id,
        {
          checks: g.checks,
          serial: g.serial || null,
          notes: g.notes || null,
          inspected_by: user?.email,
        },
        accessToken || undefined
      );
      setGuns((prev) => prev.map((x, i) => (i === gunIdx ? { ...x, result: updated.result } : x)));
      toast.success(`Gun #${g.gun_index} saved (${updated.result})`);
      // refresh pallet to reflect aggregate status if needed
      await fetchPallet();
    } catch (error: any) {
      toast.error(error.message || 'Failed to save gun');
    } finally {
      setSaving(false);
    }
  };

  // ── pallet meta save ──────────────────────────────────────────────────────────
  const savePalletMeta = async () => {
    if (!id || !pallet) return;
    setSaving(true);
    try {
      await qcPalletApi.update(
        id,
        {
          build_no: pallet.build_no || null,
          customer: pallet.customer || null,
          destination: pallet.destination || null,
          load_type: pallet.load_type || 'loaded',
          notes: pallet.notes || null,
          updated_by: user?.email,
        },
        accessToken || undefined
      );
      toast.success('Saved');
      await fetchPallet();
    } catch (error: any) {
      toast.error(error.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleSignoff = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await qcPalletApi.signoff(id, user?.email || '', accessToken || undefined);
      toast.success('Pallet signed off — now selectable in driver loads');
      await fetchPallet();
    } catch (error: any) {
      toast.error(error.message || 'Sign-off blocked');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    if (!confirm('Delete this pallet and all its gun records? This cannot be undone.')) return;
    try {
      await qcPalletApi.remove(id, accessToken || undefined);
      toast.success('Pallet deleted');
      navigate('/qc');
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete');
    }
  };

  // ── progress / readiness ──────────────────────────────────────────────────────
  const passedCount = useMemo(() => guns.filter((g) => g.result === 'pass').length, [guns]);
  const failedCount = useMemo(() => guns.filter((g) => g.result === 'fail').length, [guns]);
  const pendingCount = useMemo(() => guns.filter((g) => g.result === 'pending').length, [guns]);
  const total = guns.length;
  const canSignOff = total > 0 && passedCount === total && pallet?.status !== 'passed';
  const progressPct = total > 0 ? Math.round(((passedCount + failedCount) / total) * 100) : 0;

  if (loading) {
    return <div className="p-8"><div className="max-w-5xl mx-auto text-center py-12">Loading...</div></div>;
  }
  if (!pallet) {
    return (
      <div className="p-8">
        <div className="max-w-5xl mx-auto text-center py-12">
          <p className="text-gray-500">Pallet not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/qc')}>Back to pallets</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/qc')}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Pallets
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                Build #{pallet.build_no || '—'}
              </h1>
              <p className="text-sm text-gray-500">
                {pallet.customer ? `${pallet.customer} · ` : ''}
                <span className="capitalize">{pallet.load_type}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={pallet.status === 'passed' ? 'default' : pallet.status === 'failed' ? 'destructive' : 'outline'} className="capitalize">
              {pallet.status}
            </Badge>
            <Button variant="outline" size="sm" onClick={savePalletMeta} disabled={saving}>
              <Save className="w-4 h-4 mr-1" /> Save
            </Button>
            {isAdmin && (
              <Button variant="ghost" size="sm" onClick={handleDelete}>
                <Trash2 className="w-4 h-4 text-red-500" />
              </Button>
            )}
          </div>
        </div>

        {/* Pallet info + NetSuite PDF */}
        <Card>
          <CardHeader><CardTitle className="text-lg">Pallet & Order Paperwork</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>Build #</Label>
                <Input value={pallet.build_no || ''} onChange={(e) => setPalletField('build_no', e.target.value)} />
              </div>
              <div>
                <Label>Customer</Label>
                <Input value={pallet.customer || ''} onChange={(e) => setPalletField('customer', e.target.value)} />
              </div>
              <div>
                <Label>Destination</Label>
                <Input value={pallet.destination || ''} onChange={(e) => setPalletField('destination', e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="mb-1 block">NetSuite paperwork (PDF / photos) — verify the build against this</Label>
              <ImageUpload
                parentTable="qc_pallets"
                parentRowId={id!}
                fieldName="netsuite_paperwork"
                baseUrl={baseUrl}
                publicAnonKey={publicAnonKey}
                autoLoad
                maxImages={10}
              />
            </div>
          </CardContent>
        </Card>

        {/* Gun sampling */}
        <Card>
          <CardHeader><CardTitle className="text-lg">Sampling &amp; Guns</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-40">
                <Label>Total guns in pallet</Label>
                <Input
                  type="number"
                  min={1}
                  placeholder="e.g. 100"
                  value={lotInput}
                  onChange={(e) => setLotInput(e.target.value)}
                />
              </div>
              <div className="w-40">
                <Label>Sample to inspect</Label>
                <Input type="number" min={1} value={gunCountInput} onChange={(e) => setGunCountInput(e.target.value)} />
              </div>
              {suggestedSample != null && String(suggestedSample) !== gunCountInput && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-blue-600"
                  onClick={() => setGunCountInput(String(suggestedSample))}
                >
                  Use AQL suggestion ({suggestedSample})
                </Button>
              )}
              <Button variant="outline" onClick={handleInitGuns} disabled={saving}>
                {guns.length > 0 ? 'Reset & re-init guns' : 'Initialise guns'}
              </Button>
            </div>
            {suggestedSample != null && (
              <p className="text-xs text-gray-500 mt-2">
                AQL Level II suggests inspecting <span className="font-medium">{suggestedSample}</span>
                {' '}of {lotInput} guns.
              </p>
            )}
            {pallet?.guns_in_pallet != null && guns.length > 0 && (
              <p className="text-sm text-gray-700 mt-1">
                Inspecting <span className="font-medium">{guns.length}</span> of{' '}
                <span className="font-medium">{pallet.guns_in_pallet}</span> guns (AQL Level II sample).
              </p>
            )}
            {isUnloaded && (
              <p className="text-xs text-gray-500 mt-2">
                Unloaded pallet — shaped charges and det cord default to N/A.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Progress */}
        {total > 0 && (
          <Card>
            <CardContent className="py-5 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Inspection progress</span>
                <span className="text-gray-500">
                  {passedCount} passed · {failedCount} failed · {pendingCount} pending of {total}
                </span>
              </div>
              <Progress value={progressPct} />
            </CardContent>
          </Card>
        )}

        {/* Per-gun checklist */}
        {guns.map((g, gunIdx) => (
          <Card key={g.row_id}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                Gun #{g.gun_index}
                {g.result === 'pass' && <Badge variant="default">Pass</Badge>}
                {g.result === 'fail' && <Badge variant="destructive">Fail</Badge>}
                {g.result === 'pending' && <Badge variant="secondary">Pending</Badge>}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Input
                  className="w-40"
                  placeholder="Serial (optional)"
                  value={g.serial || ''}
                  onChange={(e) => setGunField(gunIdx, 'serial', e.target.value)}
                />
                <Button size="sm" onClick={() => saveGun(gunIdx)} disabled={saving || pallet.status === 'passed'}>
                  <Save className="w-4 h-4 mr-1" /> Save gun
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {CHECK_ITEMS.map((ci) => {
                  const ck = g.checks.find((c) => c.item_key === ci.key)!;
                  return (
                    <button
                      key={ci.key}
                      type="button"
                      disabled={pallet.status === 'passed'}
                      onClick={() => cycleState(gunIdx, ci.key)}
                      className="flex items-center justify-between rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60"
                    >
                      <span className="text-sm">{ci.label}</span>
                      <span className={`text-xs font-semibold uppercase px-2 py-0.5 rounded ${STATE_STYLE[ck.state]}`}>
                        {ck.state}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-gray-400">Tap an item to cycle Pass → Fail → N/A. Any Fail fails the gun.</p>
              <Textarea
                rows={2}
                placeholder="Gun notes / defects (optional)"
                value={g.notes || ''}
                onChange={(e) => setGunField(gunIdx, 'notes', e.target.value)}
              />
              {gunComputedResult(g) === 'fail' && (
                <div className="flex items-center gap-2 text-red-600 text-sm">
                  <AlertTriangle className="w-4 h-4" /> This gun has a failing item — pallet will be blocked.
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        {/* Sign-off */}
        <Card>
          <CardContent className="py-5">
            {pallet.status === 'passed' ? (
              <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                <ShieldCheck className="w-5 h-5" />
                <span className="font-medium">
                  Signed off by {pallet.signed_off_by || 'unknown'}
                  {pallet.signed_off_at ? ` on ${new Date(pallet.signed_off_at).toLocaleString()}` : ''}.
                </span>
              </div>
            ) : (
              <>
                {canSignOff ? (
                  <div className="flex items-center gap-2 text-green-700 dark:text-green-400 mb-4">
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="font-medium">All {total} guns passed — ready to sign off.</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 mb-4">
                    <AlertTriangle className="w-5 h-5" />
                    <span className="font-medium">
                      {total === 0
                        ? 'Initialise and inspect guns before sign-off.'
                        : `Cannot sign off — ${total - passedCount} of ${total} guns not yet passed.`}
                    </span>
                  </div>
                )}
                <Button onClick={handleSignoff} disabled={!canSignOff || saving}>
                  <ShieldCheck className="w-4 h-4 mr-1" /> Sign off pallet
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
