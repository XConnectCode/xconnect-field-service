import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../lib/auth-context';
import { driverLoadApi, qcPalletApi } from '../lib/api';
import { XC_BASES } from '../lib/xcLocations';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Plus, Truck, ClipboardCheck, PackageCheck, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

const STATUS_BADGE: Record<string, { variant: any; label: string }> = {
  draft: { variant: 'secondary', label: 'Draft' },
  ready: { variant: 'default', label: 'Ready' },
  departed: { variant: 'outline', label: 'Departed' },
  delivered: { variant: 'default', label: 'Delivered' },
};

export default function DriverLoads() {
  const { accessToken, user } = useAuth();
  const navigate = useNavigate();
  const [loads, setLoads] = useState<any[]>([]);
  const [readyPallets, setReadyPallets] = useState<any[]>([]);
  const [allPallets, setAllPallets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  // Sales Order currently being turned into a load via the one-click button.
  const [creatingSo, setCreatingSo] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const data = await driverLoadApi.getAll(accessToken || undefined);
      setLoads(Array.isArray(data) ? data : []);
    } catch (error: any) {
      console.error('Error loading driver loads:', error);
      toast.error('Failed to load driver loads');
    } finally {
      setLoading(false);
    }
  };

  // QC-passed / no-QC pallets not yet on any load — "ready to load".
  const loadReady = async () => {
    try {
      const data = await qcPalletApi.getReady(accessToken || undefined);
      setReadyPallets(Array.isArray(data) ? data : []);
    } catch { /* non-fatal */ }
  };

  // ALL pallets — used to detect when a Sales Order still has pallets that are
  // NOT QC-passed (open / in-progress / failed). Those won't appear in the ready
  // list, so without this the panel couldn't warn that the order is incomplete.
  const loadAllPallets = async () => {
    try {
      const data = await qcPalletApi.getAll(accessToken || undefined);
      setAllPallets(Array.isArray(data) ? data : []);
    } catch { /* non-fatal */ }
  };

  useEffect(() => {
    loadData();
    loadReady();
    loadAllPallets();
  }, [accessToken]);

  // Per-Sales-Order QC completeness, computed from ALL pallets for that SO.
  // A pallet is "done" if it passed QC or is no-QC hardware; anything else
  // (open / in_progress / failed) means the order is not fully QC'd yet.
  const soCompleteness = useMemo(() => {
    const map: Record<string, { total: number; done: number; notDone: any[] }> = {};
    for (const p of allPallets) {
      const key = (p.sales_order || '').trim() || 'Ungrouped';
      if (!map[key]) map[key] = { total: 0, done: 0, notDone: [] };
      map[key].total += 1;
      const isDone = p.status === 'passed' || p.requires_qc === false;
      if (isDone) map[key].done += 1;
      else map[key].notDone.push(p);
    }
    return map;
  }, [allPallets]);

  // Group ready pallets by Sales Order so dispatch sees whole orders waiting.
  const readyGroups = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const p of readyPallets) {
      const key = (p.sales_order || '').trim() || 'Ungrouped';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return [...map.entries()].sort((a, b) => {
      if (a[0] === 'Ungrouped') return 1;
      if (b[0] === 'Ungrouped') return -1;
      return b[0].localeCompare(a[0]);
    });
  }, [readyPallets]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    setCreating(true);
    try {
      const created = await driverLoadApi.create(
        {
          load_number: formData.get('load_number') || null,
          delivery_date: formData.get('delivery_date') || null,
          origin_district: formData.get('origin_district') || null,
          status: 'draft',
          driver: user?.email,
          driver_type: 'internal',
          updated_by: user?.email,
        },
        accessToken || undefined
      );
      toast.success('Load created');
      setDialogOpen(false);
      if (created?.row_id) navigate(`/driver/${created.row_id}`);
      else loadData();
    } catch (error: any) {
      toast.error(error.message || 'Failed to create load');
    } finally {
      setCreating(false);
    }
  };

  // One-click: spin up a new draft load pre-filled with every ready pallet for a
  // Sales Order, then open it. Mirrors the per-pallet line-item shape used by the
  // load detail's "Add QC-passed pallet" flow so the two paths stay consistent.
  const createLoadFromSo = async (so: string, palletList: any[]) => {
    if (!palletList.length) return;

    // Guard: if this Sales Order still has pallets that aren't QC-passed (open,
    // in-progress, or failed), warn before building a load from a partial order.
    const comp = soCompleteness[so];
    if (comp && comp.notDone.length > 0) {
      const labels = comp.notDone
        .map((p: any) => p.build_no || p.fulfillment_id || (p.row_id || '').slice(0, 8))
        .slice(0, 6);
      const more = comp.notDone.length > labels.length ? `, +${comp.notDone.length - labels.length} more` : '';
      const proceed = window.confirm(
        `Heads up: ${so === 'Ungrouped' ? 'these pallets' : so} ${comp.notDone.length === 1 ? 'has' : 'have'} ` +
        `${comp.notDone.length} pallet(s) NOT QC-passed yet ` +
        `(${comp.done}/${comp.total} ready): ${labels.join(', ')}${more}.\n\n` +
        `Only the ${palletList.length} ready pallet(s) will be added to this load. Create it anyway?`
      );
      if (!proceed) return;
    }

    setCreatingSo(so);
    try {
      const customer = palletList.find((p) => p.customer)?.customer || null;
      const destination = palletList.find((p) => p.destination)?.destination || null;
      // Use the pallet's origin base only if it matches a known XC base.
      const originRaw = palletList.find((p) => p.origin_district || p.destination)?.origin_district || '';
      const origin = (XC_BASES as readonly string[]).includes(originRaw) ? originRaw : null;

      const created = await driverLoadApi.create(
        {
          load_number: null,                 // auto-fills on the detail page once a base is set
          delivery_date: null,
          origin_district: origin,
          customer,
          destination,
          status: 'draft',
          driver: user?.email,
          driver_type: 'internal',
          updated_by: user?.email,
        },
        accessToken || undefined
      );
      if (!created?.row_id) throw new Error('Load was not created');

      const items = palletList.map((p) => ({
        pallet_build_no: p.build_no ?? '',
        description:
          p.requires_qc === false
            ? 'Hardware / spare parts'
            : `Perforating guns (${p.load_type || 'loaded'})`,
        qty_expected: p.guns_total ?? 0,
        qty_loaded: 0,
        destination: p.destination ?? '',
        checked: false,
        note: '',
        source_pallet_row_id: p.row_id,
      }));
      await driverLoadApi.saveItems(created.row_id, items, accessToken || undefined);

      toast.success(`Load created for ${so === 'Ungrouped' ? 'ungrouped pallets' : so} with ${items.length} pallet(s)`);
      navigate(`/driver/${created.row_id}`);
    } catch (error: any) {
      toast.error(error.message || 'Failed to create load from Sales Order');
    } finally {
      setCreatingSo(null);
    }
  };

  const getStatusBadge = (status: string) => {
    const cfg = STATUS_BADGE[status] || { variant: 'outline', label: status || '-' };
    return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
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
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Driver Loads</h1>
            <p className="text-gray-600 dark:text-gray-300 mt-2">
              Hotshot delivery checklist — confirm cargo, paperwork, explosives, and sign-off before departure.
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                New Load
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>New Driver Load</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <Label htmlFor="load_number">Load # (optional)</Label>
                  <Input id="load_number" name="load_number" placeholder="e.g. LD-2026-0142" />
                </div>
                <div>
                  <Label htmlFor="delivery_date">Delivery Date</Label>
                  <Input id="delivery_date" name="delivery_date" type="date" required />
                </div>
                <div>
                  <Label htmlFor="origin_district">Origin District (XC base)</Label>
                  <Select name="origin_district" required>
                    <SelectTrigger>
                      <SelectValue placeholder="Select base" />
                    </SelectTrigger>
                    <SelectContent>
                      {XC_BASES.map((b) => (
                        <SelectItem key={b} value={b}>{b}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" className="w-full" disabled={creating}>
                  {creating ? 'Creating...' : 'Create & Open Checklist'}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Ready to load — QC-passed / no-QC pallets not yet on any load, by Sales Order. */}
        {readyPallets.length > 0 && (
          <Card className="mb-6 border-green-300 dark:border-green-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <PackageCheck className="w-5 h-5 text-green-600" />
                Ready to load
                <Badge variant="secondary">{readyPallets.length} pallet{readyPallets.length === 1 ? '' : 's'}</Badge>
                <Badge variant="outline">{readyGroups.length} Sales Order{readyGroups.length === 1 ? '' : 's'}</Badge>
              </CardTitle>
              <p className="text-sm text-gray-500 mt-1">
                QC-passed and no-QC hardware pallets waiting to be loaded. Create or open a load, then pick these from the
                {' '}“Add QC-passed pallet” list — each pallet drops off here once it’s added to a load.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {readyGroups.map(([so, items]) => {
                const allPassed = items.every((p) => p.status === 'passed' || p.requires_qc === false);
                const customer = items.find((p) => p.customer)?.customer || '';
                const destination = items.find((p) => p.destination)?.destination || '';
                // Per-SO QC completeness across ALL pallets (not just ready ones).
                const comp = soCompleteness[so];
                const notDone = comp?.notDone.length ?? 0;
                return (
                  <div key={so} className="rounded-md border border-gray-200 dark:border-gray-700 px-4 py-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <ClipboardCheck className="w-4 h-4 text-gray-400" />
                        <span className="font-medium">
                          {so === 'Ungrouped' ? 'Ungrouped (no Sales Order)' : `Sales Order ${so}`}
                        </span>
                        <Badge variant="secondary">{items.length} pallet{items.length === 1 ? '' : 's'}</Badge>
                        {allPassed
                          ? <Badge variant="default">All ready</Badge>
                          : <Badge variant="outline">Partial</Badge>}
                      </div>
                      <div className="flex items-center gap-3 flex-wrap">
                        {(customer || destination) && (
                          <span className="text-sm text-gray-500">
                            {customer}{customer && destination ? ' · ' : ''}{destination}
                          </span>
                        )}
                        <Button
                          size="sm"
                          onClick={() => createLoadFromSo(so, items)}
                          disabled={creatingSo === so}
                        >
                          {creatingSo === so ? 'Creating…' : 'Create load'}
                        </Button>
                      </div>
                    </div>
                    {/* Warn when this Sales Order still has pallets that aren't QC-passed. */}
                    {notDone > 0 && (
                      <div className="mt-2 flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-500">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>
                          {comp!.done}/{comp!.total} QC’d — {notDone} pallet{notDone === 1 ? '' : 's'} not ready yet for this Sales Order
                        </span>
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {items.map((p) => (
                        <Badge key={p.row_id} variant="outline" className="font-mono text-[11px]">
                          {p.build_no || p.fulfillment_id || p.row_id.slice(0, 8)}
                          {p.requires_qc === false ? ' · hardware' : ''}
                        </Badge>
                      ))}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{user?.role === 'admin' ? 'All Loads' : 'My Loads'}</CardTitle>
          </CardHeader>
          <CardContent>
            {loads.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Truck className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p>No loads yet. Create your first load to start a checklist.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Load #</TableHead>
                    <TableHead>Origin</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead>Driver</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loads.map((l) => (
                    <TableRow
                      key={l.row_id}
                      className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
                      onClick={() => navigate(`/driver/${l.row_id}`)}
                    >
                      <TableCell>
                        {l.delivery_date ? format(new Date(l.delivery_date), 'MMM dd, yyyy') : '-'}
                      </TableCell>
                      <TableCell className="font-medium">{l.load_number || '-'}</TableCell>
                      <TableCell>{l.origin_district || '-'}</TableCell>
                      <TableCell>{l.customer || '-'}</TableCell>
                      <TableCell>{l.destination || '-'}</TableCell>
                      <TableCell>
                        {l.driver_type === 'third_party'
                          ? `${l.driver_name || '3rd party'}${l.driver_company ? ` (${l.driver_company})` : ''}`
                          : l.driver || '-'}
                      </TableCell>
                      <TableCell>{getStatusBadge(l.status)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
