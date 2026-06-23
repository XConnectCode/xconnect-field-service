import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../lib/auth-context';
import { useSearchParams, Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { SortableHead, useSort } from '../components/SortableTable';
import { Badge } from '../components/ui/badge';
import { Plus, Edit, ExternalLink, X, Download, FileText, Eye, Search } from 'lucide-react';
import { Input } from '../components/ui/input';
import { generatePanelListPDF } from '../lib/generatePanelListPDF';
import { generateMonthlyPanelReport } from '../lib/generateMonthlyPanelReport';
import { getSerial } from '../lib/serialUtils';
import FirmwareStatusPanel from '../components/FirmwareStatusPanel';
import { evaluateFirmware, panelFirmwareParts, formatPanelFirmware, type FirmwareField, type FirmwareTargets } from '../lib/firmwareVersion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import PanelForm from './forms/PanelForm';
import { toast } from 'sonner';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const PANEL_STATUSES = ['At Facility', 'Leased', 'In Repair', 'Loaned', 'Sold'];

const STATUS_STYLES: Record<string, string> = {
  'At Facility': 'bg-green-600 hover:bg-green-700 text-white',
  'Leased':      'bg-blue-600 hover:bg-blue-700 text-white',
  'In Repair':   'bg-amber-500 hover:bg-amber-600 text-white',
  'Loaned':      'bg-purple-600 hover:bg-purple-700 text-white',
  'Sold':        'bg-red-600 hover:bg-red-700 text-white',
};

const CHART_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#84cc16'];

function StatusBadge({ status }: { status: string }) {
  if (!status) return <span className="text-gray-400">-</span>;
  const cls = STATUS_STYLES[status];
  return cls
    ? <Badge className={cls}>{status}</Badge>
    : <Badge variant="outline">{status}</Badge>;
}

type DrillState = { dim: string; value: string } | null;

export default function PanelsNew() {
  const { accessToken, user } = useAuth();
  const [searchParams] = useSearchParams();
  const baseUrl = `https://${projectId}.supabase.co/functions/v1/make-server-64775d98`;

  // ── Tab state ──────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<'dashboard' | 'list'>('dashboard');

  // ── Drill-down state for dashboard ────────────────────────────────────────
  const [drill, setDrill] = useState<DrillState>(null);

  const [panels,    setPanels]    = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [districts, setDistricts] = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);

  const [filterCustomer, setFilterCustomer] = useState('');
  const [filterDistrict, setFilterDistrict] = useState('');
  const [filterStatus,   setFilterStatus]   = useState('');
  const [filterVerified, setFilterVerified] = useState('yes'); // default to verified-only view
  const [searchText,     setSearchText]     = useState('');

  // Firmware update tracking
  const [firmwareTargets, setFirmwareTargets] = useState<FirmwareTargets>({});
  const [firmwareFilter,  setFirmwareFilter]  = useState<FirmwareField | ''>('');

  const [dialogOpen,   setDialogOpen]   = useState(false);
  const [editingPanel, setEditingPanel] = useState<any>(null);

  // Quick view dialog state
  const [quickOpen,  setQuickOpen]  = useState(false);
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
      // Edge data routes require a real user token after the auth lockdown
      // (anon key returns 401). loadData only runs once accessToken exists.
      const headers = { 'Authorization': `Bearer ${accessToken ?? publicAnonKey}` };
      const [panelsRes, customersRes, districtsRes, fwRes] = await Promise.all([
        fetch(`${baseUrl}/panels`,    { headers }),
        fetch(`${baseUrl}/customers`, { headers }),
        fetch(`${baseUrl}/districts`, { headers }),
        fetch(`${baseUrl}/firmware-targets`, { headers }),
      ]);
      const [panelsData, customersData, districtsData, fwData] = await Promise.all([
        panelsRes.json(), customersRes.json(), districtsRes.json(), fwRes.json(),
      ]);
      // Show all panels in the table (Verified column reflects status).
      // KPI cards below are computed from verified-only panels.
      // Guard against non-array error responses so the page never crashes.
      setPanels(Array.isArray(panelsData)       ? panelsData       : []);
      setCustomers(Array.isArray(customersData) ? customersData : []);
      setDistricts(Array.isArray(districtsData) ? districtsData : []);
      setFirmwareTargets(fwData && typeof fwData === 'object' && !fwData.error ? fwData : {});
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

  // Verified detection helper (used by filter, sort, KPI cards, and badges).
  const isVerified = (v: any) =>
    ['y', 'yes', 'true', '1'].includes(String(v ?? '').trim().toLowerCase());

  // Free-text search across the most useful identifying fields. Case-insensitive
  // substring match; an empty query matches everything.
  const matchesSearch = (p: any) => {
    const q = searchText.trim().toLowerCase();
    if (!q) return true;
    return [
      getSerial(p),
      p.panel_type,
      p.panel_status,
      p.xc_base,
      p.customerName,
      p.districtName,
      p.wl_controlfw,
      p.unit_number,
      p['so#'],
    ]
      .filter(Boolean)
      .some(v => String(v).toLowerCase().includes(q));
  };

  const filteredPanels = useMemo(() =>
    panels.filter(p => {
      if (filterCustomer && p.customerName !== filterCustomer) return false;
      if (filterDistrict && p.districtName !== filterDistrict) return false;
      if (filterStatus   && p.panel_status !== filterStatus)   return false;
      if (filterVerified) {
        const yes = isVerified(p.verified);
        if (filterVerified === 'yes' && !yes) return false;
        if (filterVerified === 'no'  &&  yes) return false;
      }
      if (firmwareFilter) {
        // Show only panels that are behind or need review on the selected firmware
        const s = evaluateFirmware(p[firmwareFilter], firmwareTargets[firmwareFilter]);
        if (s !== 'behind' && s !== 'needs_review') return false;
      }
      if (!matchesSearch(p)) return false;
      return true;
    })
  , [panels, filterCustomer, filterDistrict, filterStatus, filterVerified, firmwareFilter, firmwareTargets, searchText]);

  // Firmware status summary cards operate on the panels matching the
  // non-firmware filters (so toggling the firmware filter doesn't change counts).
  const firmwareScopePanels = useMemo(() =>
    panels.filter(p => {
      if (filterCustomer && p.customerName !== filterCustomer) return false;
      if (filterDistrict && p.districtName !== filterDistrict) return false;
      if (filterStatus   && p.panel_status !== filterStatus)   return false;
      if (filterVerified) {
        const yes = isVerified(p.verified);
        if (filterVerified === 'yes' && !yes) return false;
        if (filterVerified === 'no'  &&  yes) return false;
      }
      if (!matchesSearch(p)) return false;
      return true;
    })
  , [panels, filterCustomer, filterDistrict, filterStatus, filterVerified, searchText]);

  // Sorting (applied after filtering)
  const { sorted: sortedPanels, sort, toggleSort } = useSort(filteredPanels, {
    serial:    p => getSerial(p),
    type:      p => p.panel_type,
    status:    p => p.panel_status,
    verified:  p => (isVerified(p.verified) ? 1 : (p.verified ? 0 : -1)),
    base:      p => p.xc_base,
    customer:  p => p.customerName,
    fw:        p => formatPanelFirmware(p),
    updated:   p => p.date_updated,
  }, { key: 'updated', dir: 'desc' });

  const clearFilters = () => {
    setFilterCustomer('');
    setFilterDistrict('');
    setFilterStatus('');
    setFilterVerified('yes'); // reset to the default verified-only view
    setFirmwareFilter('');
    setSearchText('');
    window.history.replaceState({}, '', window.location.pathname);
  };

  // The Verified filter defaults to 'yes', so it only counts as an "active"
  // filter when the user has moved it off the default (to 'no' or All).
  const filtersActive = !!(filterCustomer || filterDistrict || filterStatus || (filterVerified && filterVerified !== 'yes') || firmwareFilter || searchText.trim());

  // Save firmware target versions (admin only).
  const saveFirmwareTargets = async (next: Record<FirmwareField, string>) => {
    try {
      const res = await fetch(`${baseUrl}/firmware-targets`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken ?? publicAnonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...next, updated_by: user?.email ?? user?.name ?? null }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.error || `HTTP ${res.status}`);
      }
      const saved = await res.json();
      setFirmwareTargets(saved || {});
      toast.success('Firmware targets saved');
    } catch (err: any) {
      console.error('Error saving firmware targets:', err);
      toast.error(err?.message === 'Forbidden' ? 'Only admins can set firmware targets' : 'Failed to save firmware targets');
      throw err;
    }
  };

  // Verified-only subset drives the KPI cards (cards stay verified = Y).
  const verifiedPanels = useMemo(() =>
    panels.filter(p => isVerified(p.verified))
  , [panels]);

  const statusCounts = useMemo(() => ({
    total:      verifiedPanels.length,
    atFacility: verifiedPanels.filter(p => p.panel_status === 'At Facility').length,
    leased:     verifiedPanels.filter(p => p.panel_status === 'Leased').length,
    inRepair:   verifiedPanels.filter(p => p.panel_status === 'In Repair').length,
    loaned:     verifiedPanels.filter(p => p.panel_status === 'Loaned').length,
  }), [verifiedPanels]);

  // ── Dashboard metric counts (operate on ALL panels, no verified filter) ──
  const now = Date.now();
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

  const dashMetrics = useMemo(() => {
    const total      = panels.length;
    const sold       = panels.filter(p => p.panel_status === 'Sold').length;
    const atFacility = panels.filter(p => p.panel_status === 'At Facility').length;
    const leased     = panels.filter(p => p.panel_status === 'Leased').length;
    const inRepair   = panels.filter(p => p.panel_status === 'In Repair').length;
    const loaned     = panels.filter(p => p.panel_status === 'Loaned').length;
    const unverified = panels.filter(p => !isVerified(p.verified)).length;
    const needsAttn  = panels.filter(p => {
      const unv = !isVerified(p.verified);
      const lastSeen = p.last_seen_date ? new Date(p.last_seen_date).getTime() : null;
      const stale = lastSeen === null || (now - lastSeen) > NINETY_DAYS_MS;
      return unv || stale;
    }).length;
    return { total, atFacility, leased, inRepair, loaned, sold, unverified, needsAttn };
  }, [panels, now]);

  // ── Chart data ────────────────────────────────────────────────────────────
  const panelTypeData = useMemo(() => {
    const counts: Record<string, number> = {};
    panels.forEach(p => {
      const t = p.panel_type || 'Unknown';
      counts[t] = (counts[t] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value }));
  }, [panels]);

  const verifiedPieData = useMemo(() => {
    const ver   = panels.filter(p =>  isVerified(p.verified)).length;
    const unver = panels.filter(p => !isVerified(p.verified)).length;
    return [
      { name: 'Verified',   value: ver   },
      { name: 'Unverified', value: unver },
    ];
  }, [panels]);

  const statusBarData = useMemo(() =>
    PANEL_STATUSES.map(s => ({
      name: s,
      count: panels.filter(p => p.panel_status === s).length,
    }))
  , [panels]);

  // ── Drill-down filtered rows ───────────────────────────────────────────────
  const drillRows = useMemo(() => {
    if (!drill) return [];
    const { dim, value } = drill;
    return panels.filter(p => {
      if (dim === 'status')     return p.panel_status === value;
      if (dim === 'total')      return true;
      if (dim === 'unverified') return !isVerified(p.verified);
      if (dim === 'needsAttn')  return (() => {
        const unv = !isVerified(p.verified);
        const lastSeen = p.last_seen_date ? new Date(p.last_seen_date).getTime() : null;
        const stale = lastSeen === null || (now - lastSeen) > NINETY_DAYS_MS;
        return unv || stale;
      })();
      if (dim === 'type')       return (p.panel_type || 'Unknown') === value;
      if (dim === 'verified')   return value === 'Verified' ? isVerified(p.verified) : !isVerified(p.verified);
      return false;
    });
  }, [drill, panels, now]);

  // ── Note: panel deletion intentionally not exposed in UI ─────────────────

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

  // ── Dark mode helper (evaluated at render time) ───────────────────────────
  const isDark = typeof document !== 'undefined' &&
    document.documentElement.classList.contains('dark');
  const tooltipStyle = isDark
    ? { backgroundColor: '#1e293b', border: '1px solid #334155', color: '#f1f5f9' }
    : undefined;

  // ── Drill toggle helper ───────────────────────────────────────────────────
  const toggleDrill = (dim: string, value: string) =>
    setDrill(prev => prev?.dim === dim && prev?.value === value ? null : { dim, value });

  return (
    <div className="p-8">
      <div className="max-w-[1600px] mx-auto">

        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">XFire Panel Inventory</h1>
            <p className="text-gray-600 dark:text-gray-300 mt-1">Track and manage panel inventory, installations, and movements</p>
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

        {/* ── Tab toggle ── */}
        <div className="flex gap-1 mb-6 bg-gray-100 dark:bg-gray-800 rounded-lg p-1 w-fit">
          <button
            type="button"
            onClick={() => setTab('dashboard')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              tab === 'dashboard'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
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
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            List
          </button>
        </div>

        {/* ══════════════════════════════════════════════════════════════════
            DASHBOARD TAB
        ══════════════════════════════════════════════════════════════════ */}
        {tab === 'dashboard' && (
          <div>
            {/* Metric cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              {/* Total */}
              {([
                { key: 'total',      label: 'Total Panels',  count: dashMetrics.total,      dim: 'total',      value: 'all' },
                { key: 'atFacility', label: 'At Facility',   count: dashMetrics.atFacility, dim: 'status',     value: 'At Facility' },
                { key: 'leased',     label: 'Leased',        count: dashMetrics.leased,     dim: 'status',     value: 'Leased' },
                { key: 'inRepair',   label: 'In Repair',     count: dashMetrics.inRepair,   dim: 'status',     value: 'In Repair' },
                { key: 'loaned',     label: 'Loaned',        count: dashMetrics.loaned,     dim: 'status',     value: 'Loaned' },
                { key: 'sold',       label: 'Sold',          count: dashMetrics.sold,       dim: 'status',     value: 'Sold' },
                { key: 'unverified', label: 'Unverified',    count: dashMetrics.unverified, dim: 'unverified', value: 'unverified' },
                { key: 'needsAttn',  label: 'Needs Attention', count: dashMetrics.needsAttn, dim: 'needsAttn', value: 'needsAttn' },
              ] as { key: string; label: string; count: number; dim: string; value: string }[]).map(({ key, label, count, dim, value }) => {
                const isActive = drill?.dim === dim && drill?.value === value;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleDrill(dim, value)}
                    className={`text-left rounded-lg border p-4 transition-all bg-white dark:bg-gray-800 ${
                      isActive
                        ? 'ring-2 ring-blue-400 border-blue-400'
                        : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'
                    }`}
                  >
                    <div className="text-2xl font-bold">{count}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
                  </button>
                );
              })}
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">

              {/* Chart 1: Bar — Panels by Type */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-300">Panels by Type</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart
                      data={panelTypeData}
                      layout="vertical"
                      margin={{ top: 0, right: 16, bottom: 0, left: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#334155' : '#e5e7eb'} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: isDark ? '#94a3b8' : '#6b7280' }} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={140}
                        tick={{ fontSize: 11, fill: isDark ? '#94a3b8' : '#6b7280' }}
                      />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar
                        dataKey="value"
                        radius={[0, 4, 4, 0]}
                        cursor="pointer"
                        onClick={(data: any) => toggleDrill('type', data.name)}
                      >
                        {panelTypeData.map((entry, idx) => {
                          const isActive = drill?.dim === 'type' && drill?.value === entry.name;
                          return (
                            <Cell
                              key={entry.name}
                              fill={CHART_COLORS[idx % CHART_COLORS.length]}
                              opacity={isActive ? 1 : 0.82}
                              stroke={isActive ? '#1d4ed8' : 'none'}
                              strokeWidth={isActive ? 2 : 0}
                            />
                          );
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Chart 2: Pie — Verified vs Unverified */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-300">Verified vs Unverified</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={verifiedPieData}
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        dataKey="value"
                        label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                        labelLine={false}
                        cursor="pointer"
                        onClick={(data: any) => toggleDrill('verified', data.name)}
                      >
                        {verifiedPieData.map((entry, idx) => {
                          const isActive = drill?.dim === 'verified' && drill?.value === entry.name;
                          return (
                            <Cell
                              key={entry.name}
                              fill={idx === 0 ? '#10b981' : '#ef4444'}
                              opacity={isActive ? 1 : 0.82}
                              stroke={isActive ? '#1d4ed8' : 'none'}
                              strokeWidth={isActive ? 2 : 0}
                            />
                          );
                        })}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Chart 3: Bar — Panels by Status */}
              <Card className="md:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-300">Panels by Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={statusBarData} margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#334155' : '#e5e7eb'} />
                      <XAxis dataKey="name" tick={{ fontSize: 12, fill: isDark ? '#94a3b8' : '#6b7280' }} />
                      <YAxis tick={{ fontSize: 12, fill: isDark ? '#94a3b8' : '#6b7280' }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar
                        dataKey="count"
                        radius={[4, 4, 0, 0]}
                        cursor="pointer"
                        onClick={(data: any) => toggleDrill('status', data.name)}
                      >
                        {statusBarData.map((entry, idx) => {
                          const isActive = drill?.dim === 'status' && drill?.value === entry.name;
                          return (
                            <Cell
                              key={entry.name}
                              fill={CHART_COLORS[idx % CHART_COLORS.length]}
                              opacity={isActive ? 1 : 0.82}
                              stroke={isActive ? '#1d4ed8' : 'none'}
                              strokeWidth={isActive ? 2 : 0}
                            />
                          );
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* Drill-down list */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-sm font-medium">
                  {drill ? (
                    <>
                      <span className="text-gray-700 dark:text-gray-200">
                        Showing {drillRows.length} panel{drillRows.length !== 1 ? 's' : ''} · <span className="text-blue-500">{drill.value === 'all' ? 'All Panels' : drill.value === 'unverified' ? 'Unverified' : drill.value === 'needsAttn' ? 'Needs Attention' : drill.value}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setDrill(null)}
                        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 border border-gray-200 dark:border-gray-600 rounded px-2 py-1"
                      >
                        <X className="w-3 h-3" /> Clear
                      </button>
                    </>
                  ) : (
                    <span className="text-gray-400 dark:text-gray-500 font-normal text-xs">
                      Select a card or chart segment to see matching records
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              {drill && (
                <CardContent className="pt-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Serial #</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Verified</TableHead>
                        <TableHead>Last Seen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {drillRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-gray-400 py-6">No matching panels.</TableCell>
                        </TableRow>
                      ) : (
                        drillRows.map(panel => (
                          <TableRow key={panel.row_id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                            <TableCell className="font-medium">
                              <Link
                                to={`/panels/${panel.row_id}`}
                                className="flex items-center gap-1 text-blue-600 hover:underline"
                              >
                                {getSerial(panel)}
                                <ExternalLink className="w-3 h-3" />
                              </Link>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{panel.panel_type || '-'}</Badge>
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={panel.panel_status} />
                            </TableCell>
                            <TableCell>
                              {(() => {
                                const yes = isVerified(panel.verified);
                                return (
                                  <Badge
                                    variant={yes ? 'default' : 'secondary'}
                                    className={yes ? 'bg-green-600 hover:bg-green-600' : 'bg-gray-400 hover:bg-gray-400'}
                                  >
                                    {yes ? 'Yes' : (panel.verified ? 'No' : '-')}
                                  </Badge>
                                );
                              })()}
                            </TableCell>
                            <TableCell className="text-sm text-gray-500">
                              {panel.last_seen_date
                                ? new Date(panel.last_seen_date).toLocaleDateString()
                                : <span className="text-gray-400">—</span>}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              )}
            </Card>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            LIST TAB  — unchanged existing page
        ══════════════════════════════════════════════════════════════════ */}
        {tab === 'list' && (
          <div>
            {/* KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
              {[
                { label: 'Total Panels', value: statusCounts.total,      color: 'text-gray-900 dark:text-gray-100', filter: '' },
                { label: 'At Facility',  value: statusCounts.atFacility, color: 'text-green-600 dark:text-green-400',  filter: 'At Facility' },
                { label: 'Leased',       value: statusCounts.leased,     color: 'text-blue-600 dark:text-blue-400',   filter: 'Leased' },
                { label: 'In Repair',    value: statusCounts.inRepair,   color: 'text-amber-500 dark:text-amber-400',  filter: 'In Repair' },
                { label: 'Loaned',       value: statusCounts.loaned,     color: 'text-purple-600 dark:text-purple-400', filter: 'Loaned' },
              ].map(({ label, value, color, filter }) => (
                <Card
                  key={label}
                  className={`cursor-pointer transition-shadow hover:shadow-md ${filterStatus === filter && filter ? 'ring-2 ring-blue-400' : ''}`}
                  onClick={() => setFilterStatus(filterStatus === filter ? '' : filter)}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-300">{label}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className={`text-3xl font-bold ${color}`}>{value}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Firmware update status */}
            <FirmwareStatusPanel
              panels={firmwareScopePanels}
              targets={firmwareTargets}
              activeFilter={firmwareFilter}
              onFilterChange={setFirmwareFilter}
              canEdit={user?.role === 'admin'}
              onSaveTargets={saveFirmwareTargets}
            />

            {/* Filter bar */}
            <Card className="mb-6">
              <CardContent className="pt-4">
                {/* Search bar — free-text filter across serial, type, status, base,
                    customer/district, firmware, unit and SO number. */}
                <div className="mb-4">
                  <Label className="text-xs text-gray-500 mb-1 block">Search</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    <Input
                      type="text"
                      value={searchText}
                      onChange={e => setSearchText(e.target.value)}
                      placeholder="Search serial, type, customer, district, firmware…"
                      className="pl-9 pr-9"
                    />
                    {searchText && (
                      <button
                        type="button"
                        onClick={() => setSearchText('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        title="Clear search"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
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

                  <div className="flex-1 min-w-[150px]">
                    <Label className="text-xs text-gray-500 mb-1 block">Verified</Label>
                    <Select
                      value={filterVerified || '__all__'}
                      onValueChange={v => setFilterVerified(v === '__all__' ? '' : v)}
                    >
                      <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">All</SelectItem>
                        <SelectItem value="yes">Verified</SelectItem>
                        <SelectItem value="no">Not verified</SelectItem>
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
                      <SortableHead sortKey="serial"   sort={sort} onSort={toggleSort}>Serial #</SortableHead>
                      <SortableHead sortKey="type"     sort={sort} onSort={toggleSort}>Type</SortableHead>
                      <SortableHead sortKey="status"   sort={sort} onSort={toggleSort}>Status</SortableHead>
                      <SortableHead sortKey="verified" sort={sort} onSort={toggleSort}>Verified</SortableHead>
                      <SortableHead sortKey="base"     sort={sort} onSort={toggleSort}>XC Base</SortableHead>
                      <SortableHead sortKey="customer" sort={sort} onSort={toggleSort}>Customer / District</SortableHead>
                      <SortableHead sortKey="fw"       sort={sort} onSort={toggleSort}>FW</SortableHead>
                      <SortableHead sortKey="updated"  sort={sort} onSort={toggleSort}>Last Updated</SortableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedPanels.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-gray-500 py-8">
                          {filtersActive ? 'No panels match the current filters.' : 'No panels found.'}
                          {filtersActive && (
                            <button onClick={clearFilters} className="ml-2 text-blue-600 underline text-sm">
                              Clear filters
                            </button>
                          )}
                        </TableCell>
                      </TableRow>
                    ) : (
                      sortedPanels.map(panel => (
                        <TableRow key={panel.row_id} className="hover:bg-gray-50">
                          <TableCell className="font-medium">
                            <Link
                              to={`/panels/${panel.row_id}`}
                              className="flex items-center gap-1 text-blue-600 hover:underline"
                            >
                              {getSerial(panel)}
                              <ExternalLink className="w-3 h-3" />
                            </Link>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{panel.panel_type || '-'}</Badge>
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={panel.panel_status} />
                          </TableCell>
                          <TableCell>
                            {(() => {
                              const yes = isVerified(panel.verified);
                              return (
                                <Badge
                                  variant={yes ? 'default' : 'secondary'}
                                  className={yes ? 'bg-green-600 hover:bg-green-600' : 'bg-gray-400 hover:bg-gray-400'}
                                >
                                  {yes ? 'Yes' : (panel.verified ? 'No' : '-')}
                                </Badge>
                              );
                            })()}
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
                          <TableCell className="text-sm">
                            {(() => {
                              const parts = panelFirmwareParts(panel);
                              if (parts.length === 0) return <span className="text-gray-400">-</span>;
                              return (
                                <div className="space-y-0.5">
                                  {parts.map(pt => (
                                    <div key={pt.field} className="whitespace-nowrap">
                                      <span className="text-gray-500">{pt.label}:</span>{' '}
                                      <span className="font-medium">{pt.value}</span>
                                    </div>
                                  ))}
                                </div>
                              );
                            })()}
                          </TableCell>
                          <TableCell className="text-sm">{panel.date_updated}</TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                title="Quick view"
                                onClick={() => { setQuickPanel(panel); setQuickOpen(true); }}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => openEdit(panel)}>
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
          </div>
        )}

        {/* Quick view dialog for row click */}
        <Dialog open={quickOpen} onOpenChange={(open) => { setQuickOpen(open); if (!open) setQuickPanel(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Panel {getSerial(quickPanel) || ''}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 mt-2 text-sm">
              <div><strong>Type:</strong> {quickPanel?.panel_type || '-'}</div>
              <div><strong>Status:</strong> <StatusBadge status={quickPanel?.panel_status} /></div>
              <div className="flex items-center gap-2">
                <strong>Verified:</strong>
                {(() => {
                  const v = String(quickPanel?.verified ?? '').trim().toLowerCase();
                  const isYes = v === 'y' || v === 'yes' || v === 'true' || v === '1';
                  return (
                    <Badge variant={isYes ? 'default' : 'secondary'} className={isYes ? 'bg-green-600 hover:bg-green-600' : 'bg-gray-400 hover:bg-gray-400'}>
                      {isYes ? 'Yes' : (quickPanel?.verified ? 'No' : '-')}
                    </Badge>
                  );
                })()}
              </div>
              <div><strong>XC Base:</strong> {quickPanel?.xc_base || '-'}</div>
              <div><strong>Customer:</strong> {quickPanel?.customerName || 'Not assigned'}</div>
              <div><strong>District:</strong> {quickPanel?.districtName || '-'}</div>
              <div><strong>FW:</strong> {(quickPanel && formatPanelFirmware(quickPanel)) || '-'}</div>
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
