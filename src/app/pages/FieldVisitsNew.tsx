import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../lib/auth-context';
import { useSearchParams, Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Plus, Edit, Trash, ExternalLink, X, Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  startOfQuarter, endOfQuarter, startOfYear, endOfYear,
  subWeeks, subMonths, parseISO, isWithinInterval
} from 'date-fns';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import FieldVisitForm from './forms/FieldVisitForm';

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

// Compare operational IDs like "FV-001", "FV-100" — numeric suffix wins, fallback to lexicographic.
function compareIds(a: string, b: string): number {
  const av = a || '';
  const bv = b || '';
  const an = parseInt(String(av).replace(/\D/g, ''), 10);
  const bn = parseInt(String(bv).replace(/\D/g, ''), 10);
  if (!isNaN(an) && !isNaN(bn) && an !== bn) return an - bn;
  return av.localeCompare(bv);
}

export default function FieldVisitsNew() {
  const { accessToken, user } = useAuth();
  const [searchParams] = useSearchParams();
  const baseUrl = `https://${projectId}.supabase.co/functions/v1/make-server-64775d98`;

  // ── Raw data ────────────────────────────────────────────────────────────────
  const [visits, setVisits] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [districts, setDistricts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Table filters ───────────────────────────────────────────────────────────
  const [filterCustomer, setFilterCustomer] = useState('');   // customer NAME
  const [filterDistrict, setFilterDistrict] = useState('');   // district NAME
  const [filterTime, setFilterTime] = useState('all_time');
  const [searchTerm, setSearchTerm] = useState('');

  // ── Dialog state ────────────────────────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingVisit, setEditingVisit] = useState<any>(null);
  // ── Report URL params ───────────────────────────────────────────────────────
  const reportCustomerName = searchParams.get('customerName');
  const reportDistrictName = searchParams.get('districtName');
  const reportTimeFilter   = searchParams.get('timeFilter');
  const fromReport = !!(reportCustomerName || reportDistrictName || reportTimeFilter);

  // ── Open the add dialog when ?new=1 is present (deep-link from SQM dashboard) ─
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setEditingVisit(null);
      setDialogOpen(true);
    }
  }, [searchParams]);

  // ── Load all data ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (accessToken) loadData();
    else setLoading(false);
  }, [accessToken]);

  const loadData = async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const [visitsRes, customersRes, districtsRes] = await Promise.all([
        fetch(`${baseUrl}/fieldvisits`,  { headers: { 'Authorization': `Bearer ${publicAnonKey}` } }),
        fetch(`${baseUrl}/customers`,    { headers: { 'Authorization': `Bearer ${publicAnonKey}` } }),
        fetch(`${baseUrl}/districts`,    { headers: { 'Authorization': `Bearer ${publicAnonKey}` } }),
      ]);
      const [visitsData, customersData, districtsData] = await Promise.all([
        visitsRes.json(), customersRes.json(), districtsRes.json(),
      ]);
      setVisits(visitsData || []);
      setCustomers(customersData || []);
      setDistricts(districtsData || []);
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  // ── Apply report URL params once data loads ─────────────────────────────────
  useEffect(() => {
    if (!fromReport || !customers.length) return;
    if (reportCustomerName) setFilterCustomer(reportCustomerName);
    if (reportTimeFilter)   setFilterTime(reportTimeFilter);
  }, [fromReport, reportCustomerName, reportTimeFilter, customers]);

  useEffect(() => {
    if (!fromReport || !districts.length || !filterCustomer) return;
    if (reportDistrictName) setFilterDistrict(reportDistrictName);
  }, [fromReport, reportDistrictName, districts, filterCustomer]);

  // ── Districts scoped to selected filter customer ────────────────────────────
  const filterDistricts = useMemo(() => {
    if (!filterCustomer) return [];
    const match = customers.find(c => c.customer === filterCustomer);
    if (!match) return [];
    return districts.filter(d => d.customer === match.row_id);
  }, [filterCustomer, customers, districts]);



  // ── Client-side filtering ───────────────────────────────────────────────────
  const filteredVisits = useMemo(() => {
    const { start, end } = getDateRange(filterTime);
    const q = searchTerm.trim().toLowerCase();
    const filtered = visits.filter((v) => {
      // customerName is resolved by the edge function join
      if (filterCustomer && v.customerName !== filterCustomer) return false;
      if (filterDistrict && v.districtName !== filterDistrict)  return false;
      if (start && end && v.arrival_date) {
        try {
          if (!isWithinInterval(parseISO(v.arrival_date), { start, end })) return false;
        } catch { /* skip bad dates */ }
      }
      if (q) {
        const haystack = [
          v.field_visit_id, v.customerName, v.districtName, v.operating_company,
          v.visit_purpose, v.field_or_facility, v.xc_rep, v.arrival_date,
          v.notes, v.summary, v.visit_summary,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    // Default sort: Field Visit ID descending (newer IDs first)
    return [...filtered].sort((a, b) => compareIds(b.field_visit_id, a.field_visit_id));
  }, [visits, filterCustomer, filterDistrict, filterTime, searchTerm]);

  const clearFilters = () => {
    setFilterCustomer('');
    setFilterDistrict('');
    setFilterTime('all_time');
    setSearchTerm('');
    window.history.replaceState({}, '', window.location.pathname);
  };

  const filtersActive = filterCustomer || filterDistrict || filterTime !== 'all_time' || searchTerm;

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this field visit?')) return;
    try {
      const res = await fetch(`${baseUrl}/fieldvisits/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${accessToken ?? publicAnonKey}` },
      });
      if (res.ok) { toast.success('Field visit deleted'); loadData(); }
      else toast.error('Failed to delete field visit');
    } catch { toast.error('Failed to delete field visit'); }
  };

  const openEdit    = (visit: any) => { setEditingVisit(visit); setDialogOpen(true); };
  const closeDialog = () => { setDialogOpen(false); setEditingVisit(null); };

  if (loading) return <div className="p-8">Loading...</div>;

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">

        {/* ── Header ── */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Field Visits</h1>
            <p className="text-gray-600 mt-2">Track all customer site visits by Service Quality Managers</p>
          </div>
          <Button onClick={() => { setEditingVisit(null); setDialogOpen(true); }}>
            <Plus className="w-4 h-4 mr-2" />
            New Field Visit
          </Button>
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
          <CardContent className="pt-4 space-y-4">
            {/* Search */}
            <div>
              <Label className="text-xs text-gray-500 mb-1 block">Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by Field Visit ID, customer, district, operating company, rep, notes…"
                  className="pl-9 pr-9"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                    aria-label="Clear search"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-4 items-end">
              {/* Customer */}
              <div className="flex-1 min-w-[180px]">
                <Label className="text-xs text-gray-500 mb-1 block">Customer</Label>
                <Select
                  value={filterCustomer || '__all__'}
                  onValueChange={(v) => { setFilterCustomer(v === '__all__' ? '' : v); setFilterDistrict(''); }}
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

              {/* District */}
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
                      <SelectItem key={d.row_id} value={d.customer_district}>{d.customer_district}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Time */}
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

              {filtersActive && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="text-gray-500">
                  <X className="w-4 h-4 mr-1" /> Clear
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Table ── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              All Field Visits
              <span className="text-sm font-normal text-gray-500">
                {filtersActive
                  ? `Showing ${filteredVisits.length} of ${visits.length}`
                  : `${visits.length} total`}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Visit ID</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer / District</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>SQM</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredVisits.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-gray-500 py-8">
                      {filtersActive ? 'No visits match the current filters.' : 'No field visits found.'}
                      {filtersActive && (
                        <button onClick={clearFilters} className="ml-2 text-blue-600 underline text-sm">Clear filters</button>
                      )}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredVisits.map((visit) => (
                    <TableRow key={visit.row_id} className="hover:bg-gray-50">
                      <TableCell className="font-medium">
                        <Link to={`/field-visits/${visit.row_id}`} className="flex items-center gap-1 text-blue-600 hover:underline">
                          {visit.field_visit_id}
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      </TableCell>
                      <TableCell>{visit.arrival_date ? new Date(visit.arrival_date).toLocaleDateString() : '-'}</TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{visit.customerName || '-'}</div>
                        <div className="text-xs text-gray-500">{visit.districtName || '-'}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={visit.visit_purpose === 'Incident' ? 'destructive' : 'default'}>
                          {visit.visit_purpose}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{visit.field_or_facility}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{visit.xc_rep}</TableCell>
                      <TableCell className="text-sm">{visit.visit_duration || '-'}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => openEdit(visit)}>
                            <Edit className="w-4 h-4" />
                          </Button>
                          {user?.role !== 'sqm' && (
                            <Button size="sm" variant="destructive" onClick={() => handleDelete(visit.row_id)}>
                              <Trash className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* ── Add / Edit Dialog — extracted to FieldVisitForm ── */}
        <FieldVisitForm
          open={dialogOpen}
          onClose={closeDialog}
          onSaved={loadData}
          visit={editingVisit}
          currentUser={user}
        />

      </div>
    </div>
  );
}
