import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth-context';
import { fieldVisitApi, customerApi, districtApi } from '../lib/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Combobox } from '../components/ui/combobox';
import { Textarea } from '../components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { SortableHead, useSort } from '../components/SortableTable';
import { Badge } from '../components/ui/badge';
import { Plus, ClipboardList } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function FieldVisits() {
  const { accessToken, user } = useAuth();
  const [visits, setVisits] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [selectedDistrict, setSelectedDistrict] = useState('');
  const [districts, setDistricts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    loadData();
  }, [accessToken]);

  useEffect(() => {
    if (selectedCustomer) {
      loadDistricts(selectedCustomer);
    }
  }, [selectedCustomer]);

  const loadData = async () => {
    try {
      const [visitsData, customersData] = await Promise.all([
        fieldVisitApi.getAll(accessToken || undefined),
        customerApi.getAll(accessToken || undefined),
      ]);
      setVisits(visitsData || []);
      setCustomers(customersData || []);
    } catch (error: any) {
      console.error('Error loading data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const loadDistricts = async (customerId: string) => {
    try {
      const data = await districtApi.getByCustomer(customerId, accessToken || undefined);
      setDistricts(data || []);
    } catch (error: any) {
      console.error('Error loading districts:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    
    const customer = customers.find(c => c.id === formData.get('customerId'));
    const district = districts.find(d => d.id === formData.get('districtId'));
    
    try {
      await fieldVisitApi.create({
        customerId: formData.get('customerId'),
        customerName: customer?.name,
        districtId: formData.get('districtId'),
        districtName: district?.name,
        date: formData.get('date'),
        visitType: formData.get('visitType'),
        hours: parseFloat(formData.get('hours') as string),
        sqmName: user?.name,
        sqmId: user?.id,
        summary: formData.get('summary'),
        notes: formData.get('notes'),
        trainingTopics: formData.get('trainingTopics'),
        attendees: formData.get('attendees'),
      }, accessToken || undefined);
      
      toast.success('Field visit logged successfully');
      setDialogOpen(false);
      setSelectedCustomer('');
      setSelectedDistrict('');
      loadData();
    } catch (error: any) {
      toast.error(error.message || 'Failed to log visit');
    }
  };

  const { sorted: sortedVisits, sort, toggleSort } = useSort(visits, {
    date:     v => v.date,
    customer: v => v.customerName,
    district: v => v.districtName,
    type:     v => v.visitType,
    sqm:      v => v.sqmName,
    hours:    v => v.hours,
    summary:  v => v.summary,
  });

  const getVisitTypeBadge = (type: string) => {
    const variants: Record<string, { variant: any, label: string }> = {
      training: { variant: 'default', label: 'Training' },
      impromptu: { variant: 'secondary', label: 'Impromptu Visit' },
      incident: { variant: 'destructive', label: 'Incident Investigation' },
    };
    const config = variants[type] || { variant: 'outline', label: type };
    return <Badge variant={config.variant}>{config.label}</Badge>;
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
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Field Visits</h1>
            <p className="text-gray-600 dark:text-gray-300 mt-2">Track and manage all field visits</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Log Visit
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Log Field Visit</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="customerId">Customer</Label>
                    <input type="hidden" name="customerId" value={selectedCustomer} />
                    <Combobox
                      value={selectedCustomer}
                      onValueChange={(v) => { setSelectedCustomer(v); setSelectedDistrict(''); }}
                      options={customers.map((customer) => ({ value: customer.id, label: customer.name }))}
                      placeholder="Select customer"
                      searchPlaceholder="Search customers…"
                      emptyText="No customers found."
                    />
                  </div>
                  <div>
                    <Label htmlFor="districtId">District</Label>
                    <input type="hidden" name="districtId" value={selectedDistrict} />
                    <Combobox
                      value={selectedDistrict}
                      onValueChange={setSelectedDistrict}
                      disabled={!selectedCustomer}
                      options={districts.map((district) => ({ value: district.id, label: district.name }))}
                      placeholder="Select district"
                      searchPlaceholder="Search districts…"
                      emptyText="No districts found."
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="date">Visit Date</Label>
                    <Input id="date" name="date" type="date" required />
                  </div>
                  <div>
                    <Label htmlFor="hours">Hours Spent</Label>
                    <Input id="hours" name="hours" type="number" step="0.5" required />
                  </div>
                </div>

                <div>
                  <Label htmlFor="visitType">Visit Type</Label>
                  <Select name="visitType" required>
                    <SelectTrigger>
                      <SelectValue placeholder="Select visit type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="training">Training</SelectItem>
                      <SelectItem value="impromptu">Impromptu Visit</SelectItem>
                      <SelectItem value="incident">Incident Investigation</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="summary">Visit Summary</Label>
                  <Input id="summary" name="summary" required />
                </div>

                <div>
                  <Label htmlFor="trainingTopics">Training Topics (if applicable)</Label>
                  <Input id="trainingTopics" name="trainingTopics" placeholder="Gun building, Software training, etc." />
                </div>

                <div>
                  <Label htmlFor="attendees">Attendees</Label>
                  <Input id="attendees" name="attendees" placeholder="Names of attendees" />
                </div>

                <div>
                  <Label htmlFor="notes">Detailed Notes</Label>
                  <Textarea id="notes" name="notes" rows={4} />
                </div>

                <Button type="submit" className="w-full">Log Field Visit</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>All Field Visits</CardTitle>
          </CardHeader>
          <CardContent>
            {visits.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <ClipboardList className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p>No field visits logged yet. Create your first visit log.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead sortKey="date"     sort={sort} onSort={toggleSort}>Date</SortableHead>
                    <SortableHead sortKey="customer" sort={sort} onSort={toggleSort}>Customer</SortableHead>
                    <SortableHead sortKey="district" sort={sort} onSort={toggleSort}>District</SortableHead>
                    <SortableHead sortKey="type"     sort={sort} onSort={toggleSort}>Type</SortableHead>
                    <SortableHead sortKey="sqm"      sort={sort} onSort={toggleSort}>SQM</SortableHead>
                    <SortableHead sortKey="hours"    sort={sort} onSort={toggleSort}>Hours</SortableHead>
                    <SortableHead sortKey="summary"  sort={sort} onSort={toggleSort}>Summary</SortableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedVisits.map((visit) => (
                    <TableRow key={visit.id}>
                      <TableCell>
                        {visit.date ? format(new Date(visit.date), 'MMM dd, yyyy') : '-'}
                      </TableCell>
                      <TableCell className="font-medium">{visit.customerName}</TableCell>
                      <TableCell>{visit.districtName}</TableCell>
                      <TableCell>{getVisitTypeBadge(visit.visitType)}</TableCell>
                      <TableCell>{visit.sqmName}</TableCell>
                      <TableCell>{visit.hours} hrs</TableCell>
                      <TableCell className="max-w-xs truncate">{visit.summary}</TableCell>
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