import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../lib/auth-context';
import { useTheme } from '../lib/theme-context';
import { customerApi, districtApi } from '../lib/api';
import { supabase } from '../lib/supabase';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { FileText, Download, BarChart3, Building2, ArrowUpRight } from 'lucide-react';
import { toast } from 'sonner';
import { 
  format, startOfWeek, endOfWeek, subWeeks, 
  startOfMonth, endOfMonth, subMonths, 
  startOfQuarter, endOfQuarter, startOfYear, 
  addDays 
} from 'date-fns';
import {
  BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell, ComposedChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { generateReportPDF } from '../lib/generateReport';

const LOGO_BASE_URL = 'https://gbllxumuogsncoiaksum.supabase.co/storage/v1/object/public/Native%20Files/Customer%20Districts_Images/';

function getLogoUrl(path: string | null) {
  if (!path || path.trim() === '') return null;
  if (path.startsWith('http')) return path;
  return `${LOGO_BASE_URL}${path}`;
}

async function fetchAll(query: any) {
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await query.range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

// ── Date Range Formatter ──
function getReportTimeframeLabel(tf: string): string {
  const now = new Date();
  switch (tf) {
    case 'this_week':
      const mon = startOfWeek(now, { weekStartsOn: 1 });
      const fri = addDays(mon, 4);
      return `${format(mon, 'MMM d')} – ${format(fri, 'MMM d, yyyy')}`;
    case 'last_week':
      const lMon = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
      const lFri = addDays(lMon, 4);
      return `${format(lMon, 'MMM d')} – ${format(lFri, 'MMM d, yyyy')}`;
    case 'this_month': return format(now, 'MMMM yyyy');
    case 'last_month': return format(subMonths(now, 1), 'MMMM yyyy');
    case 'this_quarter':
      const q = Math.floor((now.getMonth() + 3) / 3);
      return `Q${q} ${now.getFullYear()}`;
    case 'this_year': return `Full Year ${now.getFullYear()}`;
    default: return 'All Time';
  }
}

function getDateRange(tf: string) {
  if (!tf || tf === 'all_time') return { start: null, end: null };
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = `${y}-${pad(m + 1)}-${pad(now.getDate())}`;
  
  const map: Record<string, {start: string, end: string}> = {
    this_week:    { start: startOfWeek(now, { weekStartsOn: 1 }).toISOString().slice(0,10), end: today },
    last_week:    { start: startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 }).toISOString().slice(0,10), end: endOfWeek(subWeeks(now, 1), { weekStartsOn: 1 }).toISOString().slice(0,10) },
    this_month:   { start: `${y}-${pad(m + 1)}-01`, end: today },
    last_month:   { start: format(startOfMonth(subMonths(now, 1)), 'yyyy-MM-dd'), end: format(endOfMonth(subMonths(now, 1)), 'yyyy-MM-dd') },
    this_quarter: { start: startOfQuarter(now).toISOString().slice(0,10), end: today },
    this_year:    { start: `${y}-01-01`, end: today },
  };
  return map[tf] ?? { start: null, end: null };
}

export default function Reports() {
  const { accessToken } = useAuth();
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const axisTick = isDark ? '#94a3b8' : '#64748b';
  const gridStroke = isDark ? '#334155' : '#f0f0f0';

  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Persisted state ──
  const LS_KEY = 'fst-reports-state';
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    } catch { return {}; }
  })();

  const [selectedCustomer, setSelectedCustomer] = useState(saved.selectedCustomer || '');
  const [selectedDistrict, setSelectedDistrict] = useState(saved.selectedDistrict || '');
  const [timeFilter, setTimeFilter] = useState(saved.timeFilter || 'all_time');
  const [districts, setDistricts] = useState<any[]>([]);
  const [generated, setGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Data states
  const [totalVisits, setTotalVisits] = useState(0);
  const [totalHours, setTotalHours] = useState(0);
  const [totalBarrels, setTotalBarrels] = useState(0);
  const [totalStages, setTotalStages] = useState(0);
  const [incidentRaw, setIncidentRaw] = useState<any[]>([]);
  const [visitRaw, setVisitRaw] = useState<any[]>([]);
  const [panelRaw, setPanelRaw] = useState<any[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const persist = useCallback((cust: string, dist: string, tf: string) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ selectedCustomer: cust, selectedDistrict: dist, timeFilter: tf })); } catch {}
  }, []);

  // Build a deep-link into the Incidents page carrying the current report filters
  // plus any extra drill-down dimension (xcCaused / severity / month).
  const drillToIncidents = useCallback((extra: Record<string, string> = {}) => {
    const params = new URLSearchParams();
    const cust = customers.find(c => c.row_id === selectedCustomer);
    const dist = districts.find(d => d.row_id === selectedDistrict);
    if (cust?.customer) params.set('customerName', cust.customer);
    if (dist?.customer_district) params.set('districtName', dist.customer_district);
    if (timeFilter && timeFilter !== 'all_time') params.set('timeFilter', timeFilter);
    Object.entries(extra).forEach(([k, v]) => { if (v) params.set(k, v); });
    navigate(`/incidents?${params.toString()}`);
  }, [customers, districts, selectedCustomer, selectedDistrict, timeFilter, navigate]);

  useEffect(() => {
    customerApi.getAll(accessToken || undefined)
      .then(data => setCustomers(data.customers || data || []))
      .catch(() => toast.error('Failed to load customers'))
      .finally(() => setLoading(false));
  }, [accessToken]);

  useEffect(() => {
    if (selectedCustomer) {
      districtApi.getByCustomer(selectedCustomer, accessToken || undefined)
        .then(data => setDistricts(data.districts || data || []))
        .catch(console.error);
    } else {
      setDistricts([]);
    }
  }, [selectedCustomer]);

  const handleGenerateReport = async () => {
    setGenerating(true);
    try {
      const { start, end } = getDateRange(timeFilter);
      const custObj = customers.find(c => c.row_id === selectedCustomer);
      const custName = custObj?.customer || null;
      const distObj  = districts.find(d => d.row_id === selectedDistrict);
      const distName = distObj?.customer_district || null;

      const applyFilters = (q: any, dateCol: string) => {
        if (start) q = q.gte(dateCol, start);
        if (end)   q = q.lte(dateCol, end);
        if (selectedCustomer) q = q.eq('customer', selectedCustomer);
        if (selectedDistrict) q = q.eq('customer_district', selectedDistrict);
        return q;
      };

      const [visitData, incData, panels, barrels, stages] = await Promise.all([
        fetchAll(applyFilters(supabase.from('fieldvisits').select('arrival_date,visit_purpose,visit_duration'), 'arrival_date')),
        fetchAll(applyFilters(supabase.from('incidents').select('date_incident,incident_status,incident_severity,xc_caused,event_category'), 'date_incident')),
        fetchAll(applyFilters(supabase.from('panels').select('panel_type,panel_status').in('panel_status', ['Leased', 'Loaned', 'Sold']), 'created_at')),
        fetchAll((() => {
          let q = supabase.from('sales_volume').select('date,quantity').eq('metric_type', 'barrels');
          if (start) q = q.gte('date', start); if (end) q = q.lte('date', end);
          if (custName) q = q.eq('customer', custName);
          if (distName) q = q.eq('customer_district', distName);
          return q;
        })()),
        fetchAll((() => {
          let q = supabase.from('sales_volume').select('date,quantity').eq('metric_type', 'stages');
          if (start) q = q.gte('date', start); if (end) q = q.lte('date', end);
          if (custName) q = q.eq('customer', custName);
          if (distName) q = q.eq('customer_district', distName);
          return q;
        })()),
      ]);

      const totalHrs = visitData.reduce((s, r) => {
        if (!r.visit_duration) return s;
        const parts = r.visit_duration.split(':').map(Number);
        return s + (parts[0] || 0) + (parts[1] || 0)/60 + (parts[2] || 0)/3600;
      }, 0);

      setTotalVisits(visitData.length);
      setTotalHours(Math.round(totalHrs));
      setTotalBarrels(barrels.reduce((s, r) => s + (parseFloat(r.quantity) || 0), 0));
      setTotalStages(stages.reduce((s, r) => s + (parseFloat(r.quantity) || 0), 0));
      setIncidentRaw(incData);
      setVisitRaw(visitData);
      setPanelRaw(panels);
      setGeneratedAt(new Date().toISOString());
      setGenerated(true);
      toast.success('Metrics updated');
    } catch (err) {
      console.error(err);
      toast.error('Failed to update report data');
    } finally {
      setGenerating(false);
    }
  };

  const xcCausedCount = useMemo(() => incidentRaw.filter(i => i.xc_caused === 'Yes').length, [incidentRaw]);
  const openIncCount  = useMemo(() => incidentRaw.filter(i => i.incident_status === 'Open').length, [incidentRaw]);
  const avgHours      = useMemo(() => totalVisits > 0 ? (totalHours / totalVisits).toFixed(1) : '0', [totalHours, totalVisits]);

  const panelBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    panelRaw.forEach(p => {
      const type = p.panel_type || 'Standard XFire';
      counts[type] = (counts[type] || 0) + 1;
    });
    return Object.entries(counts).map(([type, count]) => ({ type, count }));
  }, [panelRaw]);

  const visitPurposeBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    visitRaw.forEach(v => {
      const p = v.visit_purpose || 'General Service';
      counts[p] = (counts[p] || 0) + 1;
    });
    return Object.entries(counts).map(([purpose, count]) => ({ purpose, count }));
  }, [visitRaw]);

  // ── Monthly incident trend (XC-caused vs other, + critical) ──
  const incidentTrend = useMemo(() => {
    const buckets: Record<string, { month: string; xcCaused: number; other: number; critical: number; total: number }> = {};
    incidentRaw.forEach(i => {
      if (!i.date_incident) return;
      const month = String(i.date_incident).slice(0, 7); // YYYY-MM
      if (!buckets[month]) buckets[month] = { month, xcCaused: 0, other: 0, critical: 0, total: 0 };
      buckets[month].total += 1;
      if (i.xc_caused === 'Yes') buckets[month].xcCaused += 1; else buckets[month].other += 1;
      if (i.incident_severity === 'Critical') buckets[month].critical += 1;
    });
    return Object.values(buckets)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(b => ({ ...b, label: format(new Date(b.month + '-01T00:00:00'), 'MMM yyyy') }));
  }, [incidentRaw]);

  const handleDownloadReport = async () => {
    const customer = customers.find(c => c.row_id === selectedCustomer);
    const district = districts.find(d => d.row_id === selectedDistrict);
    try {
      toast.info('Generating PDF…');
      await generateReportPDF({
        customerName:    customer?.customer || 'All Customers',
        districtName:    district?.customer_district,
        timeFilter:      getReportTimeframeLabel(timeFilter),
        generatedAt:     generatedAt || new Date().toISOString(),
        totalVisits,
        totalHours,
        avgHours,
        totalBarrels,
        totalStages,
        totalPanels:     panelRaw.length,
        totalIncidents:  incidentRaw.length,
        xcCaused:        xcCausedCount,
        openIncidents:   openIncCount,
        panelBreakdown,
        visitPurposeBreakdown,
      });
      toast.success('Executive summary downloaded');
    } catch (err) {
      console.error(err);
      toast.error('PDF generation failed');
    }
  };

  const activeCustomer = customers.find(c => c.row_id === selectedCustomer);
  const activeDistrict = districts.find(d => d.row_id === selectedDistrict);

  if (loading) return <div className="p-8 text-center">Loading...</div>;

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">Performance Analytics</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Operational KPIs and production reliability metrics</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1">
            <Card className="shadow-sm border-gray-200 dark:border-gray-700">
              <CardHeader className="bg-gray-50/50 dark:bg-gray-800/50 border-b dark:border-gray-700"><CardTitle className="text-sm">Report Filters</CardTitle></CardHeader>
              <CardContent className="pt-6 space-y-5">
                <div>
                  <Label className="text-xs uppercase text-gray-400 font-bold mb-2 block">Timeframe</Label>
                  <Select value={timeFilter} onValueChange={v => { setTimeFilter(v); persist(selectedCustomer, selectedDistrict, v); setGenerated(false); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[['this_week','This Week (M-F)'],['last_week','Last Week'],['this_month','This Month'],['last_month','Last Month'],['this_quarter','This Quarter'],['this_year','This Year'],['all_time','All Time']].map(([v,l]) => (
                        <SelectItem key={v} value={v}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs uppercase text-gray-400 font-bold mb-2 block">Customer</Label>
                  <Select value={selectedCustomer} onValueChange={v => { setSelectedCustomer(v); setSelectedDistrict(''); persist(v, '', timeFilter); setGenerated(false); }}>
                    <SelectTrigger><SelectValue placeholder="All Accounts" /></SelectTrigger>
                    <SelectContent>
                      {customers.map(c => <SelectItem key={c.row_id} value={c.row_id}>{c.customer}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs uppercase text-gray-400 font-bold mb-2 block">District</Label>
                  <Select value={selectedDistrict} onValueChange={v => { setSelectedDistrict(v); persist(selectedCustomer, v, timeFilter); setGenerated(false); }} disabled={!selectedCustomer}>
                    <SelectTrigger><SelectValue placeholder="All Districts" /></SelectTrigger>
                    <SelectContent>
                      {districts.map(d => <SelectItem key={d.row_id} value={d.row_id}>{d.customer_district}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="pt-4 space-y-3">
                  <Button className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-500" onClick={handleGenerateReport} disabled={generating}>
                    {generating ? 'Processing Live Data...' : 'Generate Dashboard'}
                  </Button>
                  {generated && (
                    <Button className="w-full text-emerald-700 border-emerald-200 hover:bg-emerald-50" variant="outline" onClick={handleDownloadReport}>
                      <Download className="w-4 h-4 mr-2" /> Download Executive PDF
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-2 space-y-6">
            {!generated ? (
              <Card className="h-full border-dashed border-2 flex items-center justify-center min-h-[500px]">
                <div className="text-center text-gray-400">
                  <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p>Configure filters to generate performance metrics.</p>
                </div>
              </Card>
            ) : (
              <div>
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-gray-800 dark:to-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex items-center gap-6 mb-6">
                  <div className="h-16 w-16 bg-white dark:bg-gray-900/50 rounded-lg flex items-center justify-center text-gray-400">
                    <Building2 className="w-8 h-8" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-black text-gray-900 dark:text-gray-100">{activeCustomer?.customer || 'XConnect Network'}</h2>
                    <p className="text-gray-500 dark:text-gray-400 font-medium">{activeDistrict?.customer_district || 'Combined Districts'}</p>
                    <div className="mt-2 flex items-center gap-2">
                       <Badge className="bg-emerald-50 text-emerald-700 border-emerald-100">{getReportTimeframeLabel(timeFilter)}</Badge>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   <Card className="border-l-4 border-l-blue-500">
                      <CardContent className="p-5">
                         <Label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Field Service</Label>
                         <div className="text-3xl font-black text-gray-900 dark:text-gray-100 mt-1">{totalVisits} <span className="text-sm font-normal text-gray-400">Visits</span></div>
                         <div className="text-xs text-blue-600 font-bold mt-1">{totalHours.toLocaleString()} Total Hours invested</div>
                      </CardContent>
                   </Card>
                   <Card
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                         const params = new URLSearchParams();
                         if (activeCustomer?.customer) params.set('customerName', activeCustomer.customer);
                         if (activeDistrict?.customer_district) params.set('districtName', activeDistrict.customer_district);
                         if (timeFilter && timeFilter !== 'all_time') params.set('timeFilter', timeFilter);
                         navigate(`/sales?${params.toString()}`);
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLElement).click(); }}
                      className="border-l-4 border-l-indigo-500 cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                   >
                      <CardContent className="p-5">
                         <div className="flex items-start justify-between">
                            <Label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest cursor-pointer">Production Volume</Label>
                            <ArrowUpRight className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600" />
                         </div>
                         <div className="text-3xl font-black text-gray-900 dark:text-gray-100 mt-1">{totalBarrels.toLocaleString()} <span className="text-sm font-normal text-gray-400">Barrels</span></div>
                         <div className="text-xs text-indigo-600 font-bold mt-1">{totalStages.toLocaleString()} Stages Completed</div>
                      </CardContent>
                   </Card>
                   <Card
                      role="button"
                      tabIndex={0}
                      onClick={() => drillToIncidents({ xcCaused: 'Yes' })}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLElement).click(); }}
                      className="border-l-4 border-l-red-500 cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-red-400"
                   >
                      <CardContent className="p-5">
                         <div className="flex items-start justify-between">
                            <Label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest cursor-pointer">XC Reliability</Label>
                            <ArrowUpRight className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600" />
                         </div>
                         <div className="text-3xl font-black text-red-600 mt-1">{xcCausedCount} <span className="text-sm font-normal text-gray-400">XC Incidents</span></div>
                         <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); drillToIncidents({}); }}
                            className="text-xs text-gray-500 font-medium mt-1 hover:text-blue-600 hover:underline"
                         >
                            From {incidentRaw.length} total investigations
                         </button>
                      </CardContent>
                   </Card>
                   <Card className="border-l-4 border-l-emerald-500">
                      <CardContent className="p-5">
                         <Label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Efficiency</Label>
                         <div className="text-3xl font-black text-emerald-600 mt-1">
                            {xcCausedCount > 0 ? Math.round(totalStages / xcCausedCount).toLocaleString() : totalStages.toLocaleString()}:1
                         </div>
                         <div className="text-xs text-gray-500 font-medium mt-1">Stages per hardware event</div>
                      </CardContent>
                   </Card>
                </div>

                {/* ── Monthly incident trend ── */}
                <Card className="mt-6">
                   <CardHeader>
                      <CardTitle className="text-sm font-bold text-gray-600 dark:text-gray-300">Incident Trend (Monthly)</CardTitle>
                      <p className="text-xs text-gray-400 dark:text-gray-500">XC-caused vs other incidents per month, with critical-severity overlay — lower &amp; flatter is better.</p>
                   </CardHeader>
                   <CardContent className="h-72">
                      {incidentTrend.length === 0 ? (
                         <div className="h-full flex items-center justify-center text-sm text-gray-400">No incidents in the selected range.</div>
                      ) : (
                      <ResponsiveContainer width="100%" height="100%">
                         <ComposedChart data={incidentTrend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
                            <XAxis dataKey="label" tick={{ fontSize: 10, fill: axisTick }} interval="preserveStartEnd" minTickGap={24} />
                            <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: axisTick }} />
                            <Tooltip contentStyle={isDark ? { backgroundColor: '#1e293b', border: '1px solid #334155', color: '#f1f5f9' } : undefined} />
                            <Legend wrapperStyle={isDark ? { color: '#94a3b8', fontSize: 12 } : { fontSize: 12 }} />
                            <Bar dataKey="xcCaused" name="XC-Caused" stackId="a" fill="#ef4444" radius={[0, 0, 0, 0]} cursor="pointer" onClick={(d: any) => d?.payload?.month && drillToIncidents({ month: d.payload.month, xcCaused: 'Yes' })} />
                            <Bar dataKey="other" name="Other" stackId="a" fill="#94a3b8" radius={[3, 3, 0, 0]} cursor="pointer" onClick={(d: any) => d?.payload?.month && drillToIncidents({ month: d.payload.month })} />
                            <Line type="monotone" dataKey="critical" name="Critical" stroke="#f59e0b" strokeWidth={2} dot={false} />
                         </ComposedChart>
                      </ResponsiveContainer>
                      )}
                   </CardContent>
                </Card>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                   <Card>
                      <CardHeader><CardTitle className="text-sm font-bold text-gray-600 dark:text-gray-300">Service Focus</CardTitle></CardHeader>
                      <CardContent className="h-64">
                         <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={visitPurposeBreakdown} layout="vertical">
                               <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={gridStroke} />
                               <XAxis type="number" hide />
                               <YAxis dataKey="purpose" type="category" width={100} tick={{ fontSize: 10, fill: axisTick }} />
                               <Tooltip contentStyle={isDark ? { backgroundColor: '#1e293b', border: '1px solid #334155', color: '#f1f5f9' } : undefined} />
                               <Bar dataKey="count" fill="#5db848" radius={[0, 4, 4, 0]} />
                            </BarChart>
                         </ResponsiveContainer>
                      </CardContent>
                   </Card>
                   <Card>
                      <CardHeader><CardTitle className="text-sm font-bold text-gray-600 dark:text-gray-300">Panel Fleet</CardTitle></CardHeader>
                      <CardContent className="h-64">
                         <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                               <Pie data={panelBreakdown} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="count" nameKey="type">
                                  {panelBreakdown.map((_, index) => <Cell key={index} fill={[isDark ? '#64748b' : '#232323', '#5db848', '#94a3b8'][index % 3]} />)}
                               </Pie>
                               <Tooltip contentStyle={isDark ? { backgroundColor: '#1e293b', border: '1px solid #334155', color: '#f1f5f9' } : undefined} />
                               <Legend wrapperStyle={isDark ? { color: '#94a3b8' } : undefined} />
                            </PieChart>
                         </ResponsiveContainer>
                      </CardContent>
                   </Card>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}