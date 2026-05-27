import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../lib/auth-context';
import { useSearchParams, Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Plus, Edit, ExternalLink, X, Download, FileText } from 'lucide-react';
import { generatePanelListPDF } from '../lib/generatePanelListPDF';
import { generateMonthlyPanelReport } from '../lib/generateMonthlyPanelReport';
import { getSerial } from '../lib/serialUtils';
import PanelForm from './forms/PanelForm';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { toast } from 'sonner';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';

const PANEL_STATUSES = ['At Facility', 'Leased', 'In Repair', 'Loaned', 'Sold'];

const STATUS_STYLES: Record<string, string> = {
  'At Facility': 'bg-green-600 hover:bg-green-700 text-white',
  'Leased':      'bg-blue-600 hover:bg-blue-700 text-white',
  'In Repair':   'bg-amber-500 hover:bg-amber-600 text-white',
  'Loaned':      'bg-purple-600 hover:bg-purple-700 text-white',
  'Sold':        'bg-red-600 hover:bg-red-700 text-white',
};

function StatusBadge({ status }: { status: string }) {
  if (!status) return <span className="text-gray-400">-</span>;
  const cls = STATUS_STYLES[status];
  return cls
    ? <Badge className={cls}>{status}</Badge>
    : <Badge variant="outline">{status}</Badge>;
}

export default function PanelsNew() {
  const { accessToken, user } = useAuth();
  const [searchParams] = useSearchParams();
  const baseUrl = `https://${projectId}.supabase.co/functions/v1/make-server-64775d98`;

  const [panels,    setPanels]    = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [districts, setDistricts] = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);

  const [filterCustomer, setFilterCustomer] = useState('');
  const [filterDistrict, setFilterDistrict] = useState('');
  const [filterStatus,   setFilterStatus]   = useState('');

  const [dialogOpen,   setDialogOpen]   = useState(false);
  const [editingPanel, setEditingPanel] = useState<any>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickPanel, setQuickPanel] = useState<any>(null);

  const reportCustomerName = searchParams.get('customerName');
  const reportDistrictName = searchParams.get('districtName');
  const fromReport = !!(reportCustomerName || reportDistrictName);

  useEffect(() => {
    if (accessToken) loadData();
    else setLoading(false);
  }, [accessToken]);

  const loadData = async () => {
    setLoading(true);
    try {
      const headers = { 'Authorization': `Bearer ${publicAnonKey}` };
      const [panelsRes, customersRes, districtsRes] = await Promise.all([
        fetch(`${baseUrl}/panels`,    { headers }),
        fetch(`${baseUrl}/customers`, { headers }),
        fetch(`${baseUrl}/districts`, { headers }),
      ]);
      const [panelsData, customersData, districtsData] = await Promise.all([
        panelsRes.json(), customersRes.json(), districtsRes.json(),
      ]);
      setPanels(panelsData       || []);
      setCustomers(customersData || []);
      setDistricts(districtsData || []);
    } catch (err) {
      console.error('Error loading panels:', err);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!fromReport || !panels.length) return;
    if (reportCustomerName) setFilterCustomer(reportCustomerName);
    if (reportDistrictName) setFilterDistrict(reportDistrictName);
  }, [fromReport, reportCustomerName, reportDistrictName, panels]);

  const uniqueCustomers = useMemo(() =>
    [...new Set(panels.map(p => p.customerName).filter(Boolean))].sort()
  , [panels]);

  const filterDistricts = useMemo(() => {
    if (!filterCustomer) return [];
    const match = customers.find(c => c.customer === filterCustomer);
    if (!match) return [];
    return districts.filter(d => d.customer === match.row_id);
  }, [filterCustomer, customers, districts]);

  const filteredPanels = useMemo(() =>
    panels.filter(p => {
      if (filterCustomer && p.customerName !== filterCustomer) return false;
      if (filterDistrict && p.districtName !== filterDistrict) return false;
      if (filterStatus   && p.panel_status !== filterStatus)   return false;
      return true;
    })
  , [panels, filterCustomer, filterDistrict, filterStatus]);

  const clearFilters = () => {
    setFilterCustomer('');
    setFilterDistrict('');
    setFilterStatus('');
    window.history.replaceState({}, '', window.location.pathname);
  };

  const filtersActive = !!(filterCustomer || filterDistrict || filterStatus);

  const statusCounts = useMemo(() => ({
    total:      panels.length,
    atFacility: panels.filter(p => p.panel_status === 'At Facility').length,
    leased:     panels.filter(p => p.panel_status === 'Leased').length,
    inRepair:   panels.filter(p => p.panel_status === 'In Repair').length,
    loaned:     panels.filter(p => p.panel_status === 'Loaned').length,
  }), [panels]);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this panel?')) return;
    try {
      const res = await fetch(`${baseUrl}/panels/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${publicAnonKey}` },
      });
      if (res.ok) { toast.success('Panel deleted'); loadData(); }
      else toast.error('Failed to delete panel');
    } catch { toast.error('Failed to delete panel'); }
  };

  const handleExportPDF = async () => {
    try {
      toast.info('Generating panel list PDF…');
      const custObj = customers.find(c => c.customer === filterCustomer);
      const logoUrl = custObj?.customer_logo
        ? custObj.customer_logo.startsWith('http')
          ? custObj.customer_logo
          : `https://${projectId}.supabase.co/storage/v1/object/public/Native%20Files/Customer%20Districts_Images/${custObj.customer_logo}`
        : null;
      await generatePanelListPDF({
        panels: filteredPanels,
        customerName: filterCustomer || undefined,
        districtName: filterDistrict || undefined,
        logoUrl,
      });
      toast.success('Panel list PDF downloaded');
    } catch (err) {
      console.error(err);
      toast.error('Failed to generate PDF');
    }
  };

  const handleMonthlyReport = async () => {
    try {
      toast.info('Generating monthly panel report…');
      const month = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      await generateMonthlyPanelReport({
        panels: filteredPanels,
        customerName: filterCustomer || 'All Customers',
        districtName: filterDistrict || undefined,
        reportMonth: month,
        preparedBy: (user as any)?.name || (user as any)?.email || undefined,
      });
      toast.success('Monthly panel report downloaded');
    } catch (err) {
      console.error(err);
      toast.error('Failed to generate monthly report');
    }
  };

  const openEdit    = (panel: any) => { setEditingPanel(panel); setDialogOpen(true); };
  const closeDialog = () => { setDialogOpen(false); setEditingPanel(null); };

  if (loading) return <div className="p-8 text-gray-500">Loading panels…</div>;

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">XFire Panel Inventory</h1>
            <p className="text-gray-600 mt-1">Track and manage panel inventory, installations, and movements</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleExportPDF} title="Export current view as PDF">
              <Download className="w-4 h-4 mr-2" />
              Export PDF
            </Button>
            <Button variant="outline" onClick={handleMonthlyReport} title="Generate monthly lease report">
              <FileText className="w-4 h-4 mr-2" />
              Monthly Report
            </Button>
            <Button onClick={() => { setEditingPanel(null); setDialogOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" />
              Add Panel
            </Button>
          </div>
        </div>

        {/* Report filter banner */}
        {fromReport && (
          <div className="mb-4 flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800">
            <span>📊</span>
            <span>
              Filtered from Report —{' '}
              {reportCustomerName && <strong>{reportCustomerName}</strong>}
              {reportDistrictName && <> · {reportDistrictName}</>}
            </span>
            <button onClick={clearFilters} className="ml-auto flex items-center gap-1 text-blue-600 hover:text-blue-800 underline">
              <X className="w-3 h-3" /> Clear filters
            </button>
          </div>
        )}

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          {[
            { label: 'Total Panels', value: statusCounts.total,      color: 'text-gray-900',   filter: '' },
            { label: 'At Facility',  value: statusCounts.atFacility, color: 'text-green-600',  filter: 'At Facility' },
            { label: 'Leased',       value: statusCounts.leased,     color: 'text-blue-600',   filter: 'Leased' },
            { label: 'In Repair',    value: statusCounts.inRepair,   color: 'text-amber-500',  filter: 'In Repair' },
            { label: 'Loaned',       value: statusCounts.loaned,     color: 'text-purple-600', filter: 'Loaned' },
          ].map(({ label, value, color, filter }) => (
            <Card
              key={label}
              className={`cursor-pointer transition-shadow hover:shadow-md ${filterStatus === filter && filter ? 'ring-2 ring-blue-400' : ''}`}
              onClick={() => setFilterStatus(filterStatus === filter ? '' : filter)}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-600">{label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-3xl font-bold ${color}`}>{value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filter bar */}
        <Card className="mb-6">
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex-1 min-w-[180px]">
                <Label className="text-xs text-gray-500 mb-1 block">Customer</Label>
                <Select
                  value={filterCustomer || '__all__'}
                  onValueChange={v => { setFilterCustomer(v === '__all__' ? '' : v); setFilterDistrict(''); }}
                >
                  <SelectTrigger><SelectValue placeholder="All customers" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All customers</SelectItem>
                    {uniqueCustomers.map(name => (
                      <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 min-w-[180px]">
                <Label className="text-xs text-gray-500 mb-1 block">District</Label>
                <Select
                  value={filterDistrict || '__all__'}
                  onValueChange={v => setFilterDistrict(v === '__all__' ? '' : v)}
                  disabled={!filterCustomer}
                >
                  <SelectTrigger><SelectValue placeholder="All districts" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All districts</SelectItem>
                    {filterDistricts.map(d => (
                      <SelectItem key={d.row_id} value={d.customer_district}>{d.customer_district}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 min-w-[160px]">
                <Label className="text-xs text-gray-500 mb-1 block">Status</Label>
                <Select
                  value={filterStatus || '__all__'}
                  onValueChange={v => setFilterStatus(v === '__all__' ? '' : v)}
                >
                  <SelectTrigger><SelectValue placeholder="All statuses" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All statuses</SelectItem>
                    {PANEL_STATUSES.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {filtersActive && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="text-gray-500">
                  <X className="w-4 h-4 mr-1" /> Clear
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              All Panels
              <span className="text-sm font-normal text-gray-500">
                {filtersActive
                  ? `Showing ${filteredPanels.length} of ${panels.length}`
                  : `${panels.length} total`}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Serial #</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>XC Base</TableHead>
                  <TableHead>Customer / District</TableHead>
                  <TableHead>FW Version</TableHead>
                  <TableHead>Last Updated</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPanels.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-gray-500 py-8">
                      {filtersActive ? 'No panels match the current filters.' : 'No panels found.'}
                      {filtersActive && (
                        <button onClick={clearFilters} className="ml-2 text-blue-600 underline text-sm">
                          Clear filters
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredPanels.map(panel => (
                    <TableRow
                      key={panel.row_id}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => { setQuickPanel(panel); setQuickOpen(true); }}
                    >
                      <TableCell className="font-medium">
                        <Link
                          to={`/panels/${panel.row_id}`}
                          className="flex items-center gap-1 text-blue-600 hover:underline"
                          onClick={e => e.stopPropagation()}
                        >
                          {getSerial(panel)}
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{panel.panel_type}</Badge>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={panel.panel_status} />
                      </TableCell>
                      <TableCell>{panel.xc_base}</TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {panel.customerName
                            ? <>
                                <div className="font-medium">{panel.customerName}</div>
                                <div className="text-gray-500 text-xs">{panel.districtName || '-'}</div>
                              </>
                            : <span className="text-gray-400">Not assigned</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{panel.shootingfw || '-'}</TableCell>
                      <TableCell className="text-sm">{panel.date_updated}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openEdit(panel); }}>
                            <Edit className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Quick view dialog for row click */}
        <Dialog open={quickOpen} onOpenChange={(open) => { setQuickOpen(open); if (!open) setQuickPanel(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Panel {getSerial(quickPanel) || ''}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 mt-2 text-sm">
              <div><strong>Type:</strong> {quickPanel?.panel_type || '-'}</div>
              <div><strong>Status:</strong> <StatusBadge status={quickPanel?.panel_status} /></div>
              <div><strong>XC Base:</strong> {quickPanel?.xc_base || '-'}</div>
              <div><strong>Customer:</strong> {quickPanel?.customerName || 'Not assigned'}</div>
              <div><strong>District:</strong> {quickPanel?.districtName || '-'}</div>
              <div><strong>FW Version:</strong> {quickPanel?.shootingfw || '-'}</div>
              <div><strong>Last Updated:</strong> {quickPanel?.date_updated || '-'}</div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Add / Edit Dialog */}
        <PanelForm
          open={dialogOpen}
          onClose={closeDialog}
          onSaved={loadData}
          panel={editingPanel}
          currentUser={user}
        />

      </div>
    </div>
  );
}
