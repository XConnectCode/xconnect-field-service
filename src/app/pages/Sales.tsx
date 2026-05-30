import { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../lib/auth-context';
import { salesApi, customerApi, districtApi } from '../lib/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { SortableHead, useSort } from '../components/SortableTable';
import { Plus, TrendingUp, X } from 'lucide-react';
import { toast } from 'sonner';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
         startOfQuarter, endOfQuarter, startOfYear, endOfYear,
         subWeeks, subMonths, parseISO, isWithinInterval } from 'date-fns';

// ── Time filter helpers ───────────────────────────────────────────────────────
function getDateRange(tf: string | null): { start: Date | null; end: Date | null } {
  if (!tf || tf === 'all_time') return { start: null, end: null };
  const now = new Date();
  if (tf === 'this_week')    return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
  if (tf === 'last_week')    { const d = subWeeks(now, 1);  return { start: startOfWeek(d, { weekStartsOn: 1 }), end: endOfWeek(d, { weekStartsOn: 1 }) }; }
  if (tf === 'this_month')   return { start: startOfMonth(now), end: endOfMonth(now) };
  if (tf === 'last_month')   { const d = subMonths(now, 1); return { start: startOfMonth(d), end: endOfMonth(d) }; }
  if (tf === 'this_quarter') return { start: startOfQuarter(now), end: endOfQuarter(now) };
  if (tf === 'this_year')    return { start: startOfYear(now), end: endOfYear(now) };
  return { start: null, end: null };
}

const TIME_FILTER_LABELS: Record<string, string> = {
  this_week: 'This Week', last_week: 'Last Week',
  this_month: 'This Month', last_month: 'Last Month',
  this_quarter: 'This Quarter', this_year: 'This Year', all_time: 'All Time',
};

export default function Sales() {
  const { accessToken, user } = useAuth();
  const [searchParams] = useSearchParams();

  // ── Raw data ────────────────────────────────────────────────────────────────
  const [sales, setSales] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Table filters (driven by URL params or user interaction) ────────────────
  const [filterCustomer, setFilterCustomer] = useState('');      // plain NAME string
  const [filterDistrict, setFilterDistrict] = useState('');      // plain NAME string
  const [filterDistricts, setFilterDistricts] = useState<any[]>([]); // districts for filter dropdown
  const [filterTime, setFilterTime] = useState('all_time');

  // ── Add-dialog state ────────────────────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogCustomer, setDialogCustomer] = useState('');      // row_id for dialog
  const [dialogDistricts, setDialogDistricts] = useState<any[]>([]);

  // ── Read report URL params ──────────────────────────────────────────────────
  const reportCustomerName = searchParams.get('customerName');
  const reportDistrictName = searchParams.get('districtName');
  const reportTimeFilter   = searchParams.get('timeFilter');
  const fromReport = !!(reportCustomerName || reportDistrictName || reportTimeFilter);

  // ── Load data on mount ──────────────────────────────────────────────────────
  useEffect(() => {
    if (accessToken) loadData();
    else setLoading(false);
  }, [accessToken]);

  const loadData = async () => {
    try {
      const [salesData, customersData] = await Promise.all([
        salesApi.getAll(accessToken || undefined),
        customerApi.getAll(accessToken || undefined),
      ]);
      setSales(salesData || []);
      setCustomers(customersData?.customers || customersData || []);
    } catch (error: any) {
      console.error('Error loading data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  // ── Apply URL params once customers are loaded ──────────────────────────────
  useEffect(() => {
    if (!fromReport || !customers.length) return;
    if (reportCustomerName) setFilterCustomer(reportCustomerName);
    if (reportTimeFilter)   setFilterTime(reportTimeFilter);
  }, [fromReport, reportCustomerName, reportTimeFilter, customers]);

  // ── Apply district URL param once filterDistricts loads ────────────────────
  useEffect(() => {
    if (!fromReport || !filterDistricts.length) return;
    if (reportDistrictName) setFilterDistrict(reportDistrictName);
  }, [fromReport, reportDistrictName, filterDistricts]);

  // ── Load filter districts when filter customer changes ──────────────────────
  useEffect(() => {
    if (!filterCustomer) {
      setFilterDistricts([]);
      setFilterDistrict('');
      return;
    }
    // Resolve customer name → row_id to call districtApi
    const match = customers.find(
      (c) => c.customer.toLowerCase() === filterCustomer.toLowerCase()
    );
    if (!match) return;
    districtApi.getByCustomer(match.row_id, accessToken || undefined)
      .then((data: any) => setFilterDistricts(data?.districts || data || []))
      .catch(() => setFilterDistricts([]));
  }, [filterCustomer, customers]);

  // ── Load dialog districts when dialog customer changes ──────────────────────
  useEffect(() => {
    if (!dialogCustomer) { setDialogDistricts([]); return; }
    districtApi.getByCustomer(dialogCustomer, accessToken || undefined)
      .then((data: any) => setDialogDistricts(data?.districts || data || []))
      .catch(() => setDialogDistricts([]));
  }, [dialogCustomer]);

  // ── Client-side filtering ───────────────────────────────────────────────────
  const filteredSales = useMemo(() => {
    const { start, end } = getDateRange(filterTime);
    return sales.filter((sale) => {
      // Customer filter — barrels_sold/stages store plain NAME in customerName
      if (filterCustomer && sale.customerName !== filterCustomer) return false;
      // District filter
      if (filterDistrict && sale.districtName !== filterDistrict) return false;
      // Date filter — sale.weekEnding is "YYYY-MM-DD"
      if (start && end && sale.weekEnding) {
        try {
          const d = parseISO(sale.weekEnding);
          if (!isWithinInterval(d, { start, end })) return false;
        } catch { /* ignore unparseable dates */ }
      }
      return true;
    });
  }, [sales, filterCustomer, filterDistrict, filterTime]);

  const { sorted: sortedSales, sort, toggleSort } = useSort(filteredSales, {
    week:     s => s.weekEnding,
    customer: s => s.customerName,
    district: s => s.districtName,
    barrels:  s => s.barrels || 0,
    stages:   s => s.stages || 0,
  });

  const clearFilters = () => {
    setFilterCustomer('');
    setFilterDistrict('');
    setFilterTime('all_time');
    // Strip URL params without a full navigation
    window.history.replaceState({}, '', window.location.pathname);
  };

  // ── Dialog submit ───────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    try {
      await salesApi.create({
        customer: formData.get('customerId'),
        customer_district: formData.get('districtId'),
        weekEnding: formData.get('weekEnding'),
        barrels: parseInt(formData.get('barrels') as string) || 0,
        stages: parseInt(formData.get('stages') as string) || 0,
      }, accessToken || undefined);
      toast.success('Sales data added successfully');
      setDialogOpen(false);
      loadData();
    } catch (error: any) {
      toast.error(error.message || 'Failed to add sales data');
    }
  };

  if (loading) {
    return <div className="p-8"><div className="max-w-7xl mx-auto text-center py-12">Loading...</div></div>;
  }

  const totalBarrels = filteredSales.reduce((sum, s) => sum + (s.barrels || 0), 0);
  const totalStages  = filteredSales.reduce((sum, s) => sum + (s.stages || 0), 0);
  const filtersActive = filterCustomer || filterDistrict || filterTime !== 'all_time';

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">

        {/* ── Header ── */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Sales Tracking</h1>
            <p className="text-gray-600 mt-2">Track weekly barrel and stage sales per customer</p>
          </div>
          {user?.role === 'admin' && (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Sales Data
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Add Weekly Sales Data</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Customer</Label>
                      <Select name="customerId" required onValueChange={setDialogCustomer}>
                        <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                        <SelectContent>
                          {customers.map((c) => (
                            <SelectItem key={c.row_id} value={c.row_id}>{c.customer}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>District</Label>
                      <Select name="districtId" required disabled={!dialogCustomer}>
                        <SelectTrigger><SelectValue placeholder="Select district" /></SelectTrigger>
                        <SelectContent>
                          {dialogDistricts.map((d) => (
                            <SelectItem key={d.row_id} value={d.row_id}>{d.customer_district}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label>Week Ending Date</Label>
                    <Input name="weekEnding" type="date" required />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Barrels</Label>
                      <Input name="barrels" type="number" min="0" defaultValue="0" required />
                    </div>
                    <div>
                      <Label>Stages</Label>
                      <Input name="stages" type="number" min="0" defaultValue="0" required />
                    </div>
                  </div>
                  <Button type="submit" className="w-full">Add Sales Data</Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {/* ── Report filter banner ── */}
        {fromReport && (
          <div className="mb-4 flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800">
            <span>📊</span>
            <span>
              Filtered from Report —{' '}
              {reportCustomerName && <strong>{reportCustomerName}</strong>}
              {reportDistrictName && <> · {reportDistrictName}</>}
              {reportTimeFilter   && <> · {TIME_FILTER_LABELS[reportTimeFilter] ?? reportTimeFilter}</>}
            </span>
            <button onClick={clearFilters} className="ml-auto flex items-center gap-1 text-blue-600 hover:text-blue-800 underline">
              <X className="w-3 h-3" /> Clear filters
            </button>
          </div>
        )}

        {/* ── Filter bar ── */}
        <Card className="mb-6">
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-4 items-end">
              {/* Customer filter */}
              <div className="flex-1 min-w-[180px]">
                <Label className="text-xs text-gray-500 mb-1 block">Customer</Label>
                <Select
                  value={filterCustomer || '__all__'}
                  onValueChange={(v) => {
                    setFilterCustomer(v === '__all__' ? '' : v);
                    setFilterDistrict('');
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="All customers" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All customers</SelectItem>
                    {customers.map((c) => (
                      <SelectItem key={c.row_id} value={c.customer}>{c.customer}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* District filter */}
              <div className="flex-1 min-w-[180px]">
                <Label className="text-xs text-gray-500 mb-1 block">District</Label>
                <Select
                  value={filterDistrict || '__all__'}
                  onValueChange={(v) => setFilterDistrict(v === '__all__' ? '' : v)}
                  disabled={!filterCustomer}
                >
                  <SelectTrigger><SelectValue placeholder="All districts" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All districts</SelectItem>
                    {filterDistricts.map((d) => (
                      <SelectItem key={d.row_id} value={d.customer_district}>
                        {d.customer_district}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Time filter */}
              <div className="flex-1 min-w-[160px]">
                <Label className="text-xs text-gray-500 mb-1 block">Timeframe</Label>
                <Select value={filterTime} onValueChange={setFilterTime}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TIME_FILTER_LABELS).map(([val, label]) => (
                      <SelectItem key={val} value={val}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Clear */}
              {filtersActive && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="text-gray-500">
                  <X className="w-4 h-4 mr-1" /> Clear
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── KPI cards ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Total Barrels</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{totalBarrels.toLocaleString()}</div>
              {filtersActive && (
                <p className="text-xs text-gray-400 mt-1">filtered from {sales.reduce((s, r) => s + (r.barrels || 0), 0).toLocaleString()} total</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Total Stages</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{totalStages.toLocaleString()}</div>
              {filtersActive && (
                <p className="text-xs text-gray-400 mt-1">filtered from {sales.reduce((s, r) => s + (r.stages || 0), 0).toLocaleString()} total</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Table ── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Sales History
              {filtersActive && (
                <span className="text-sm font-normal text-gray-500">
                  Showing {filteredSales.length} of {sales.length} records
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filteredSales.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <TrendingUp className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p>{filtersActive ? 'No sales records match the current filters.' : 'No sales data yet.'}</p>
                {filtersActive && (
                  <button onClick={clearFilters} className="mt-2 text-sm text-blue-600 underline">Clear filters</button>
                )}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead sortKey="week"     sort={sort} onSort={toggleSort}>Week Ending</SortableHead>
                    <SortableHead sortKey="customer" sort={sort} onSort={toggleSort}>Customer</SortableHead>
                    <SortableHead sortKey="district" sort={sort} onSort={toggleSort}>District</SortableHead>
                    <SortableHead sortKey="barrels"  sort={sort} onSort={toggleSort} className="text-right">Barrels</SortableHead>
                    <SortableHead sortKey="stages"   sort={sort} onSort={toggleSort} className="text-right">Stages</SortableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedSales.map((sale) => (
                    <TableRow key={sale.id}>
                      <TableCell className="font-medium">
                        {sale.weekEnding ? format(parseISO(sale.weekEnding), 'MMM dd, yyyy') : '-'}
                      </TableCell>
                      <TableCell>{sale.customerName}</TableCell>
                      <TableCell>{sale.districtName}</TableCell>
                      <TableCell className="text-right font-mono">{(sale.barrels || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono">{(sale.stages || 0).toLocaleString()}</TableCell>
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
