import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../lib/auth-context';
import { qcPalletApi } from '../lib/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Plus, ClipboardCheck } from 'lucide-react';
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

  const getStatusBadge = (status: string) => {
    const cfg = STATUS_BADGE[status] || { variant: 'outline', label: status || '-' };
    return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
  };

  // KPI tiles
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
              Inspect each gun, then sign off the pallet. A pallet can only pass once every gun passes.
            </p>
          </div>
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
                  <Input id="build_no" name="build_no" placeholder="e.g. BLD-100423" required />
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

        <div className="grid grid-cols-3 gap-4 mb-8">
          <Card><CardContent className="py-5"><div className="text-sm text-gray-500">Open / In progress</div><div className="text-3xl font-bold">{counts.open}</div></CardContent></Card>
          <Card><CardContent className="py-5"><div className="text-sm text-gray-500">Passed</div><div className="text-3xl font-bold text-green-600">{counts.passed}</div></CardContent></Card>
          <Card><CardContent className="py-5"><div className="text-sm text-gray-500">Failed</div><div className="text-3xl font-bold text-red-600">{counts.failed}</div></CardContent></Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>All Pallets</CardTitle>
          </CardHeader>
          <CardContent>
            {pallets.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <ClipboardCheck className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p>No pallets yet. Create your first pallet to start inspection.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Build #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Guns (passed/total)</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Signed off by</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pallets.map((p) => (
                    <TableRow
                      key={p.row_id}
                      className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
                      onClick={() => navigate(`/qc/${p.row_id}`)}
                    >
                      <TableCell className="font-medium">{p.build_no || '-'}</TableCell>
                      <TableCell>{p.customer || '-'}</TableCell>
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
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
