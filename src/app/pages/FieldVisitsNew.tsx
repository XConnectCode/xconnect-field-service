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
  subWeeks, subMonths, subDays, parseISO, isWithinInterval, format
} from 'date-fns';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import FieldVisitForm from './forms/FieldVisitForm';
import { displayVisitDuration } from '../lib/visitDuration';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

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

const VISIT_PURPOSE_OPTS = [
  'XFire Installation','Training','Sales','R&D','Incident','Impromptu','Follow Up/Check Up','Delivery/Pickup'
];

const COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#84cc16'];

export default function FieldVisitsNew() {
  const { accessToken, user } = useAuth();
  const [searchParams] = useSearchParams();
  const baseUrl = `https://${projectId}.supabase.co/functions/v1/make-server-64775d98`;

  // ── Tab state ────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<'dashboard' | 'list'>('dashboard');

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

  // ── Dashboard drill state ────────────────────────────────────────────────────
  const [drill, setDrill] = useState<{ dim: string; value: string } | null>(null);

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
      const headers = { 'Authorization': `Bearer ${accessToken ?? publicAnonKey}` };
      const [visitsRes, customersRes, districtsRes] = await Promise.all([
        fetch(`${baseUrl}/fieldvisits`,  { headers }),
        fetch(`${baseUrl}/customers`,    { headers }),
        fetch(`${baseUrl}/districts`,    { headers }),
      ]);
      const [visitsData, customersData, districtsData] = await Promise.all([
        visitsRes.json(), customersRes.json(), districtsRes.json(),
      ]);
      setVisits(Array.isArray(visitsData)       ? visitsData    : []);
      setCustomers(Array.isArray(customersData) ? customersData : []);
      setDistricts(Array.isArray(districtsData) ? districtsData : []);
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

  // ── Dashboard metrics ───────────────────────────────────────────────────────
  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd   = endOfMonth(now);
  const day90Ago   = subDays(now, 90);

  const totalVisits = visits.length;

  const thisMonthVisits = useMemo(() =>
    visits.filter(v => {
      if (!v.arrival_date) return false;
      try { return isWithinInterval(parseISO(v.arrival_date), { start: monthStart, end: monthEnd }); }
      catch { return false; }
    }),
  [visits]);

  const last90Visits = useMemo(() =>
    visits.filter(v => {
      if (!v.arrival_date) return false;
      try { return parseISO(v.arrival_date) >= day90Ago; }
      catch { return false; }
    }),
  [visits]);

  const fieldVisits    = useMemo(() => visits.filter(v => v.field_or_facility === 'Field'), [visits]);
  const facilityVisits = useMemo(() => visits.filter(v => v.field_or_facility === 'Facility'), [visits]);

  // ── Purpose breakdown for bar chart ─────────────────────────────────────────
  const purposeData = useMemo(() => {
    const counts: Record<string, number> = {};
    visits.forEach(v => {
      const p = v.visit_purpose || 'Unknown';
      counts[p] = (counts[p] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [visits]);

  // ── SQM (xc_rep) breakdown for bar chart ────────────────────────────────────
  const repData = useMemo(() => {
    const counts: Record<string, number> = {};
    visits.forEach(v => {
      const r = v.xc_rep || 'Unknown';
      counts[r] = (counts[r] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [visits]);

  // ── Monthly trend (last 6 months) bar chart ──────────────────────────────────
  const monthlyTrendData = useMemo(() => {
    const buckets: Record<string, number> = {};
    for (let i = 5; i >= 0; i--) {
      const d = subMonths(now, i);
      buckets[format(d, 'MMM yyyy')] = 0;
    }
    visits.forEach(v => {
      if (!v.arrival_date) return;
      try {
        const d = parseISO(v.arrival_date);
        const key = format(d, 'MMM yyyy');
        if (key in buckets) buckets[key]++;
      } catch { /* skip */ }
    });
    return Object.entries(buckets).map(([name, count]) => ({ name, count }));
  }, [visits]);

  // ── Drill-down filtered rows ─────────────────────────────────────────────────
  const drillRows = useMemo(() => {
    if (!drill) return [];
    if (drill.dim === 'total')    return [...visits].sort((a, b) => compareIds(b.field_visit_id, a.field_visit_id));
    if (drill.dim === 'month')    return [...thisMonthVisits].sort((a, b) => compareIds(b.field_visit_id, a.field_visit_id));
    if (drill.dim === '90days')   return [...last90Visits].sort((a, b) => compareIds(b.field_visit_id, a.field_visit_id));
    if (drill.dim === 'location') return visits.filter(v => v.field_or_facility === drill.value).sort((a, b) => compareIds(b.field_visit_id, a.field_visit_id));
    if (drill.dim === 'purpose')  return visits.filter(v => (v.visit_purpose || 'Unknown') === drill.value).sort((a, b) => compareIds(b.field_visit_id, a.field_visit_id));
    if (drill.dim === 'rep')      return visits.filter(v => (v.xc_rep || 'Unknown') === drill.value).sort((a, b) => compareIds(b.field_visit_id, a.field_visit_id));
    if (drill.dim === 'month_trend') {
      return visits.filter(v => {
        if (!v.arrival_date) return false;
        try { return format(parseISO(v.arrival_date), 'MMM yyyy') === drill.value; }
        catch { return false; }
      }).sort((a, b) => compareIds(b.field_visit_id, a.field_visit_id));
    }
    return [];
  }, [drill, visits, thisMonthVisits, last90Visits]);

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

  // ── Dark mode detection ──────────────────────────────────────────────────────
  const isDark = document.documentElement.classList.contains('dark');
  const tooltipStyle = isDark
    ? { backgroundColor: '#1e293b', border: '1px solid #334155', color: '#f1f5f9' }
    : undefined;
  const axisColor = isDark ? '#94a3b8' : '#6b7280';

  // ── Metric card helper ───────────────────────────────────────────────────────
  const MetricCard = ({
    cardKey, count, label
  }: { cardKey: string; count: number; label: string }) => {
    const active = drill?.dim === cardKey;
    return (
      <button
        type="button"
        onClick={() => setDrill(prev => prev?.dim === cardKey ? null : { dim: cardKey, value: label })}
        className={`text-left rounded-lg border p-4 transition-all bg-white dark:bg-gray-800 ${
          active
            ? 'ring-2 ring-blue-400 border-blue-400'
            : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'
        }`}
      >
        <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{count}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      </button>
    );
  };

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">

        {/* ── Header ── */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Field Visits</h1>
            <p className="text-gray-600 dark:text-gray-300 mt-2">Track all customer site visits by Service Quality Managers</p>
          </div>
          <Button onClick={() => { setEditingVisit(null); setDialogOpen(true); }}>
            <Plus className="w-4 h-4 mr-2" />
            New Field Visit
          </Button>
        </div>

        {/* ── Tab toggle ── */}
        <div className="flex gap-1 mb-6 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg w-fit">
          <button
            type="button"
            onClick={() => setTab('dashboard')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              tab === 'dashboard'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => setTab('list')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              tab === 'list'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            List
          </button>
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

        {/* ════════════════════════════════════════════════════════════════════
            DASHBOARD TAB
        ════════════════════════════════════════════════════════════════════ */}
        {tab === 'dashboard' && (
          <>
            {/* ── Metric cards ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <MetricCard cardKey="total"    count={totalVisits}          label="Total Visits" />
              <MetricCard cardKey="month"    count={thisMonthVisits.length} label="This Month" />
              <MetricCard cardKey="90days"   count={last90Visits.length}  label="Last 90 Days" />
              {/* Field vs Facility split */}
              <button
                type="button"
                onClick={() => setDrill(prev => prev?.dim === 'location' && prev.value === 'Field' ? null : { dim: 'location', value: 'Field' })}
                className={`text-left rounded-lg border p-4 transition-all bg-white dark:bg-gray-800 ${
                  drill?.dim === 'location' && drill.value === 'Field'
                    ? 'ring-2 ring-blue-400 border-blue-400'
                    : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'
                }`}
              >
                <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {fieldVisits.length}
                  <span className="text-sm font-normal text-gray-400 ml-1">/ {facilityVisits.length}</span>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Field / Facility</div>
              </button>
            </div>

            {/* ── Charts row ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

              {/* Chart 1: Visits by Purpose */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Visits by Purpose</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={purposeData} margin={{ top: 4, right: 16, left: 0, bottom: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#334155' : '#e5e7eb'} />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 11, fill: axisColor }}
                        angle={-35}
                        textAnchor="end"
                        interval={0}
                      />
                      <YAxis tick={{ fontSize: 11, fill: axisColor }} allowDecimals={false} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar
                        dataKey="count"
                        name="Visits"
                        radius={[4, 4, 0, 0]}
                        onClick={(data: any) => {
                          const v = data?.name as string;
                          setDrill(prev => prev?.dim === 'purpose' && prev.value === v ? null : { dim: 'purpose', value: v });
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        {purposeData.map((_, i) => (
                          <rect
                            key={i}
                            fill={COLORS[i % COLORS.length]}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Chart 2: Visits by SQM (xc_rep) */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Visits by SQM (Top 10)</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={repData} layout="vertical" margin={{ top: 4, right: 16, left: 80, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#334155' : '#e5e7eb'} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: axisColor }} allowDecimals={false} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        tick={{ fontSize: 11, fill: axisColor }}
                        width={80}
                      />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar
                        dataKey="count"
                        name="Visits"
                        fill={COLORS[0]}
                        radius={[0, 4, 4, 0]}
                        onClick={(data: any) => {
                          const v = data?.name as string;
                          setDrill(prev => prev?.dim === 'rep' && prev.value === v ? null : { dim: 'rep', value: v });
                        }}
                        style={{ cursor: 'pointer' }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

            </div>

            {/* Chart 3: Monthly trend — last 6 months */}
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="text-base">Monthly Trend (Last 6 Months)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={monthlyTrendData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#334155' : '#e5e7eb'} />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: axisColor }} />
                    <YAxis tick={{ fontSize: 12, fill: axisColor }} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar
                      dataKey="count"
                      name="Visits"
                      fill={COLORS[2]}
                      radius={[4, 4, 0, 0]}
                      onClick={(data: any) => {
                        const v = data?.name as string;
                        setDrill(prev => prev?.dim === 'month_trend' && prev.value === v ? null : { dim: 'month_trend', value: v });
                      }}
                      style={{ cursor: 'pointer' }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* ── Drill-down list ── */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  {drill ? (
                    <>
                      <span>
                        Showing {drillRows.length} visit{drillRows.length !== 1 ? 's' : ''} · <span className="text-blue-600">{drill.value}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setDrill(null)}
                        className="text-sm font-normal text-gray-500 hover:text-gray-700 flex items-center gap-1"
                      >
                        <X className="w-3 h-3" /> Clear
                      </button>
                    </>
                  ) : (
                    <span className="text-gray-400 font-normal text-sm">
                      Select a card or chart segment to see matching visits
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              {drill && (
                <CardContent>
                  {drillRows.length === 0 ? (
                    <p className="text-sm text-gray-500 py-4 text-center">No visits match this filter.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Visit ID</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Customer / District</TableHead>
                          <TableHead>Purpose</TableHead>
                          <TableHead>Location</TableHead>
                          <TableHead>SQM</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {drillRows.map((visit) => (
                          <TableRow key={visit.row_id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
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
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              )}
            </Card>
          </>
        )}

        {/* ════════════════════════════════════════════════════════════════════
            LIST TAB — existing filter Card + table Card, unchanged
        ════════════════════════════════════════════════════════════════════ */}
        {tab === 'list' && (
          <>
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
                          <TableCell className="text-sm">{displayVisitDuration(visit)}</TableCell>
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
          </>
        )}

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
