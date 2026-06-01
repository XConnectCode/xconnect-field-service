import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../lib/auth-context';
import { driverLoadApi } from '../lib/api';
import { XC_BASES } from '../lib/xcLocations';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Plus, Truck } from 'lucide-react';
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
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);

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

  useEffect(() => {
    loadData();
  }, [accessToken]);

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
