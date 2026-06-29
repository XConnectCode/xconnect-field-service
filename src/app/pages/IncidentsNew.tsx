import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../lib/auth-context';
import { useSearchParams, Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { SortableHead, useSort } from '../components/SortableTable';
import { Badge } from '../components/ui/badge';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Plus, Edit, Trash2, Eye, AlertTriangle, X, ExternalLink, FileText, Download, Send, CheckCircle2, RefreshCw, Search } from 'lucide-react';
import { Input } from '../components/ui/input';
import IncidentForm from './forms/IncidentForm';
import IncidentEvidenceImages from '../components/IncidentEvidenceImages';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';
import {
  format, parseISO, isWithinInterval,
  startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  startOfQuarter, endOfQuarter, startOfYear, endOfYear,
  subWeeks, subMonths,
} from 'date-fns';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import { getBearerToken } from '../lib/authHeaders';
import { generateIncidentReportPDF, type IncidentReportImage } from '../lib/generateIncidentReportPDF';
import IncidentPdfImagePicker from '../components/IncidentPdfImagePicker';
import {
  normalizeStatus,
  canMarkReportSent,
  normalizeActionStatus,
  ACTION_STATUS_LABELS,
} from '../lib/incidentWorkflow';
import {
  resolveFailedComponentLabel,
  resolveFailureTypeLabel,
} from '../lib/failedComponent';
import {
  uploadIncidentReport,
  getIncidentReportUrl,
  listIncidentReportsForEvents,
  pickReport,
  type IncidentReportRow,
} from '../lib/incidentReportStorage';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
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

// Compare operational IDs like "EV-001", "EV-100" — numeric suffix wins, fallback to lexicographic.
function compareIds(a: string, b: string): number {
  const av = a || '';
  const bv = b || '';
  const an = parseInt(String(av).replace(/\D/g, ''), 10);
  const bn = parseInt(String(bv).replace(/\D/g, ''), 10);
  if (!isNaN(an) && !isNaN(bn) && an !== bn) return an - bn;
  return av.localeCompare(bv);
}

// ── Badges ────────────────────────────────────────────────────────────────────
function SeverityBadge({ severity }: { severity: string }) {
  if (!severity) return <span className="text-gray-300">-</span>;
  const s = severity.toLowerCase();
  if (s === 'critical') return <Badge className="bg-red-600 text-white">Critical</Badge>;
  if (s === 'moderate' || s === 'high') return <Badge className="bg-gray-900 text-white">Moderate</Badge>;
  if (s === 'low') return <Badge variant="secondary">Low</Badge>;
  return <Badge variant="outline">{severity}</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  if (!status) return <span className="text-gray-300">-</span>;
  const n = normalizeStatus(status);
  // Color-coded badges per workflow stage
  if (n === 'New')               return <Badge className="bg-indigo-100 text-indigo-700 hover:bg-indigo-100">New</Badge>;
  if (n === 'Investigating')     return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Investigating</Badge>;
  if (n === 'Root Cause Needed') return <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">Root Cause Needed</Badge>;
  if (n === 'Final Review')      return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">Final Review</Badge>;
  if (n === 'Closed')            return <Badge variant="secondary" className="text-gray-500 font-normal">Closed</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function XcCausedBadge({ caused }: { caused: string }) {
  if (!caused) return <span className="text-gray-300">-</span>;
  const s = caused.toLowerCase();
  if (s === 'yes')          return <Badge className="bg-red-600 text-white">Yes</Badge>;
  if (s === 'inconclusive') return <Badge variant="secondary" className="font-normal">Inconclusive</Badge>;
  if (s === 'no')           return <Badge variant="outline" className="text-gray-500 font-normal">No</Badge>;
  return <Badge variant="outline">{caused}</Badge>;
}

// ── View detail field helper ──────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  if (!children || children === '-' || children === '—') return null;
  return (
    <div>
      <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-1">{label}</p>
      <div className="text-sm text-gray-900 dark:text-gray-100">{children}</div>
    </div>
  );
}

function safeFmtDate(val: any, fmt: string): string {
  if (!val) return '';
  try {
    const d = parseISO(String(val));
    if (isNaN(d.getTime())) return '';
    return format(d, fmt);
  } catch { return ''; }
}

function TextBlock({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-1">{label}</p>
      <p className="text-sm text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700 rounded-lg p-3 whitespace-pre-wrap leading-relaxed">{value}</p>
    </div>
  );
}

// ── Split-view list row (master-detail prototype) ──────────────────────────────
function SplitListRow({ inc, selected, onSelect }: { inc: any; selected: boolean; onSelect: () => void }) {
  const dateStr = inc?.date_incident ? safeFmtDate(inc.date_incident, 'M/d/yyyy') : '';
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left px-3 py-2.5 border-b border-gray-100 dark:border-gray-800 border-l-4 transition-colors ${
        selected
          ? 'bg-emerald-50 dark:bg-emerald-900/20 border-l-emerald-500'
          : 'border-l-transparent hover:bg-gray-50 dark:hover:bg-gray-800/50'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-sm text-gray-900 dark:text-gray-100 truncate">
          {inc?.event_id || '—'} · {inc?.customerName || '-'}
        </span>
        <span className="text-xs text-gray-400 shrink-0">{dateStr}</span>
      </div>
      <div className="font-mono text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
        {(inc?.districtName || '-')} — {(inc?.event_category || '—')}
      </div>
      <div className="flex items-center gap-1 mt-1.5">
        <StatusBadge status={inc?.incident_status} />
        <XcCausedBadge caused={inc?.xc_caused} />
      </div>
    </button>
  );
}

export default function IncidentsNew() {
  const { accessToken, user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const baseUrl = `https://${projectId}.supabase.co/functions/v1/make-server-64775d98`;

  // ── Data ──────────────────────────────────────────────────────────────────
  const [incidents,    setIncidents]    = useState<any[]>([]);
  const [customers,    setCustomers]    = useState<any[]>([]);
  const [districts,    setDistricts]    = useState<any[]>([]);
  const [lists,        setLists]        = useState<any[]>([]);
  const [components,   setComponents]   = useState<any[]>([]);
  const [vendors,      setVendors]      = useState<any[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [apiListMap,   setApiListMap]   = useState<Record<string, any>>({});
  const [apiVendorMap, setApiVendorMap] = useState<Record<string, string>>({});

  // ── Tab + drill state ────────────────────────────────────────────────────
  const [tab,   setTab]   = useState<'dashboard' | 'list'>('dashboard');
  const [drill, setDrill] = useState<{ dim: string; value: string } | null>(null);

  // ── Filters ───────────────────────────────────────────────────────────────
  const [filterCustomer, setFilterCustomer] = useState('');
  const [filterDistrict, setFilterDistrict] = useState('');
  const [filterTime,     setFilterTime]     = useState('all_time');
  const [searchTerm,     setSearchTerm]     = useState('');
  const [filterXcCaused, setFilterXcCaused] = useState('');   // drill-down: 'Yes' etc.
  const [filterSeverity, setFilterSeverity] = useState('');   // drill-down: 'Critical' etc.
  const [filterMonth,    setFilterMonth]    = useState('');   // drill-down: 'YYYY-MM'

  // ── Dialogs ───────────────────────────────────────────────────────────────
  const [formOpen,        setFormOpen]        = useState(false);
  const [viewOpen,        setViewOpen]        = useState(false);
  const [editingIncident, setEditingIncident] = useState<any>(null);
  // Seed for a NEW incident (e.g. "Log Incident" from a Field Visit). Kept
  // separate from editingIncident so the form does NOT flip into edit mode
  // (editing = !!incident) and attempt an update with no row_id.
  const [prefillIncident, setPrefillIncident] = useState<any>(null);
  const [viewingIncident, setViewingIncident] = useState<any>(null);
  const [generatingPDF,   setGeneratingPDF]   = useState<string | null>(null);
  const [pdfPreviewUrl,   setPdfPreviewUrl]   = useState('');
  const [pdfPreviewOpen,  setPdfPreviewOpen]  = useState(false);
  // Image picker shown before each PDF generation
  const [pickerOpen,      setPickerOpen]      = useState(false);
  const [pickerVersion,   setPickerVersion]   = useState<'preliminary' | 'final' | null>(null);
  const [pickerIncident,  setPickerIncident]  = useState<any>(null);
  // Reports loaded from Supabase Storage / incident_reports table, keyed by event_id
  const [reportsByEvent,  setReportsByEvent]  = useState<Record<string, IncidentReportRow[]>>({});

  // ── Layout flag (master-detail "split" prototype, opt-in via ?layout=split) ─
  const layoutMode: 'table' | 'split' = searchParams.get('layout') === 'split' ? 'split' : 'table';
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ── URL params ────────────────────────────────────────────────────────────
  const reportCustomerName = searchParams.get('customerName');
  const reportDistrictName = searchParams.get('districtName');
  const reportTimeFilter   = searchParams.get('timeFilter');
  const reportXcCaused     = searchParams.get('xcCaused');
  const reportSeverity     = searchParams.get('severity');
  const reportMonth        = searchParams.get('month');
  const fromReport = !!(reportCustomerName || reportDistrictName || reportTimeFilter || reportXcCaused || reportSeverity || reportMonth);

  // ── Open the add dialog when ?new=1 is present (deep-link from SQM dashboard
  //    and from "Log Incident" on a Field Visit). When a fieldVisitId is
  //    supplied, seed the new incident so the form pre-links the field visit
  //    (and carries customer/district context). ───────────────────────────────
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      const fieldVisitId = searchParams.get('fieldVisitId');
      const customerId   = searchParams.get('customerId');
      const districtId   = searchParams.get('districtId');
      const qcPalletId   = searchParams.get('qcPalletId');
      const qcBuildNo    = searchParams.get('qcBuildNo');
      const soNumber     = searchParams.get('soNumber');
      if (fieldVisitId || customerId || districtId || qcPalletId || soNumber) {
        setEditingIncident(null);
        setPrefillIncident({
          field_visit_id: fieldVisitId || '',
          customer: customerId || '',
          customer_district: districtId || '',
          qc_pallet_id: qcPalletId || '',
          qc_build_no: qcBuildNo || '',
          so_number: soNumber || '',
        });
      } else {
        setEditingIncident(null);
        setPrefillIncident(null);
      }
      setFormOpen(true);
    }
  }, [searchParams]);

  // ── Load lookup maps ──────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      // Forward the user's session token so RLS applies on the REST reads.
      const headers = { 'apikey': publicAnonKey, 'Authorization': `Bearer ${await getBearerToken()}` };
      try {
        const [listsData, vendorsData] = await Promise.all([
          fetch(`https://${projectId}.supabase.co/rest/v1/lists?select=row_id,failed_component,failure_type`, { headers }).then(r => r.json()),
          fetch(`https://${projectId}.supabase.co/rest/v1/vendors?select=row_id,vendor`, { headers }).then(r => r.json()),
        ]);
        const lm: Record<string, any> = {};
        (Array.isArray(listsData) ? listsData : []).forEach((l: any) => { lm[l.row_id] = l; });
        setApiListMap(lm);
        const vm: Record<string, string> = {};
        (Array.isArray(vendorsData) ? vendorsData : []).forEach((v: any) => { vm[v.row_id] = v.vendor; });
        setApiVendorMap(vm);
      } catch (err) {
        console.error('Error fetching lookup maps:', err);
      }
    })();
  }, []);

  // ── Load data ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (accessToken) loadData();
    else setLoading(false);
  }, [accessToken]);

  const loadData = async () => {
    setLoading(true);
    try {
      const restBase    = `https://${projectId}.supabase.co/rest/v1`;
      // After the edge auth lockdown, the edge data routes require a real user
      // token (anon key returns 401). Forward the logged-in user's session
      // token; loadData only runs once accessToken exists. REST reads still use
      // the anon apikey + the user token so RLS sees the authenticated user.
      const token       = accessToken ?? publicAnonKey;
      const edgeHeaders = { 'Authorization': `Bearer ${token}` };
      const restHeaders = { 'apikey': publicAnonKey, 'Authorization': `Bearer ${token}` };
      const [incRes, custRes, distRes, listsRes, vendorsRes, compRes] = await Promise.all([
        fetch(`${baseUrl}/incidents`,  { headers: edgeHeaders }),
        fetch(`${baseUrl}/customers`,  { headers: edgeHeaders }),
        fetch(`${baseUrl}/districts`,  { headers: edgeHeaders }),
        fetch(`${restBase}/lists?select=row_id,failed_component,failure_type`, { headers: restHeaders }),
        fetch(`${restBase}/vendors?select=row_id,vendor`, { headers: restHeaders }),
        fetch(`${restBase}/components?select=row_id,failed_component`, { headers: restHeaders }),
      ]);
      const [incData, custData, distData] = await Promise.all([
        incRes.json(), custRes.json(), distRes.json(),
      ]);
      // Guard: an error response is a non-array object; never let it reach the
      // array consumers (e.g. customers.forEach) and crash the page.
      setIncidents(Array.isArray(incData)  ? incData  : []);
      setCustomers(Array.isArray(custData) ? custData : []);
      setDistricts(Array.isArray(distData) ? distData : []);
      if (listsRes.ok)   { const d = await listsRes.json();   setLists(Array.isArray(d) ? d : []); }
      if (vendorsRes.ok) { const d = await vendorsRes.json(); setVendors(Array.isArray(d) ? d : []); }
      if (compRes.ok)    { const d = await compRes.json();    setComponents(Array.isArray(d) ? d : []); }

      // Load shared incident reports (PDFs) from Supabase Storage
      const eventIds = (Array.isArray(incData) ? incData : []).map((i: any) => i.event_id).filter(Boolean);
      const reports  = await listIncidentReportsForEvents(eventIds);
      setReportsByEvent(reports);
    } catch (err) {
      console.error('Error loading data:', err);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  // ── Derived maps ──────────────────────────────────────────────────────────
  const customerMap = useMemo(() => {
    const map: Record<string, { name: string; logo: string }> = {};
    customers.forEach(c => { if (c.row_id) map[c.row_id] = { name: c.customer, logo: c.customer_logo }; });
    return map;
  }, [customers]);

  const districtMap = useMemo(() => {
    const map: Record<string, string> = {};
    districts.forEach(d => { if (d.row_id) map[d.row_id] = d.customer_district; });
    return map;
  }, [districts]);

  const listLookupMap = useMemo(() => {
    const map: Record<string, { failed_component: string; failure_type: string }> = {};
    lists.forEach((l: any) => { if (l.row_id) map[l.row_id] = { failed_component: l.failed_component || '', failure_type: l.failure_type || '' }; });
    return map;
  }, [lists]);

  const componentsMap = useMemo(() => {
    const map: Record<string, { failed_component: string }> = {};
    components.forEach((c: any) => { if (c.row_id) map[c.row_id] = { failed_component: c.failed_component || '' }; });
    return map;
  }, [components]);

  const vendorLookupMap = useMemo(() => {
    const map: Record<string, string> = {};
    vendors.forEach((v: any) => { if (v.row_id) map[v.row_id] = v.vendor; });
    return map;
  }, [vendors]);

  const enrichedIncidents = useMemo(() =>
    incidents.map(inc => ({
      ...inc,
      customerName: inc.customerName || customerMap[inc.customer]?.name || inc.customer || '-',
      districtName: inc.districtName || districtMap[inc.customer_district] || inc.customer_district || '-',
    }))
  , [incidents, customerMap, districtMap]);

  // ── URL param filters ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!fromReport || !enrichedIncidents.length) return;
    if (reportCustomerName) setFilterCustomer(reportCustomerName);
    if (reportTimeFilter)   setFilterTime(reportTimeFilter);
    if (reportXcCaused)     setFilterXcCaused(reportXcCaused);
    if (reportSeverity)     setFilterSeverity(reportSeverity);
    if (reportMonth)        setFilterMonth(reportMonth);
  }, [fromReport, reportCustomerName, reportTimeFilter, reportXcCaused, reportSeverity, reportMonth, enrichedIncidents]);

  useEffect(() => {
    if (!fromReport || !reportDistrictName || !filterCustomer) return;
    setFilterDistrict(reportDistrictName);
  }, [fromReport, reportDistrictName, filterCustomer]);

  // ── Filtered data ─────────────────────────────────────────────────────────
  const uniqueCustomers = useMemo(() =>
    [...new Set(enrichedIncidents.map(i => i.customerName).filter(n => n && n !== '-'))].sort()
  , [enrichedIncidents]);

  const filterDistricts = useMemo(() => {
    if (!filterCustomer) return [];
    const match = customers.find(c => c.customer === filterCustomer || c.row_id === filterCustomer);
    if (!match) return [];
    return districts.filter(d => d.customer === match.row_id);
  }, [filterCustomer, customers, districts]);

  const filteredIncidents = useMemo(() => {
    const { start, end } = getDateRange(filterTime);
    const q = searchTerm.trim().toLowerCase();
    const filtered = enrichedIncidents.filter(inc => {
      if (filterCustomer && inc.customerName !== filterCustomer) return false;
      if (filterDistrict && inc.districtName !== filterDistrict) return false;
      if (filterXcCaused && inc.xc_caused !== filterXcCaused) return false;
      if (filterSeverity && inc.incident_severity !== filterSeverity) return false;
      if (filterMonth && String(inc.date_incident || '').slice(0, 7) !== filterMonth) return false;
      if (start && end && inc.date_incident) {
        try { if (!isWithinInterval(parseISO(inc.date_incident), { start, end })) return false; }
        catch { /* skip */ }
      }
      if (q) {
        const failedComponent = resolveFailedComponentLabel(inc.failed_component, componentsMap, '');
        const failureType     = resolveFailureTypeLabel(inc.failure_type, listLookupMap, '');
        const vendorName      = vendorLookupMap[inc.vendor] || inc.vendor;
        const haystack = [
          inc.event_id, inc.customerName, inc.districtName, inc.operating_company,
          inc.event_category, inc.product_line, inc.firing_system,
          inc.incident_severity, inc.incident_status, inc.xc_caused,
          inc.xc_rep, inc.customer_rep, inc.ep_rep, inc.field_facility,
          inc.well_name, inc.field_visit_id, inc.date_incident,
          inc.incident_description, inc.investigation, inc.root_cause, inc.notes,
          inc.corrective_action, inc.preventive_action,
          failedComponent, failureType, vendorName,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    // Default sort: Event ID descending (newer IDs first)
    return [...filtered].sort((a, b) => compareIds(b.event_id, a.event_id));
  }, [enrichedIncidents, filterCustomer, filterDistrict, filterTime, filterXcCaused, filterSeverity, filterMonth, searchTerm, listLookupMap, vendorLookupMap]);

  // Interactive column sorting (layers on top of the default Event ID sort).
  const { sorted: sortedIncidents, sort, toggleSort } = useSort(filteredIncidents, {
    event_id:  inc => inc.event_id,
    date:      inc => inc.date_incident,
    customer:  inc => inc.customerName,
    category:  inc => inc.event_category,
    severity:  inc => {
      const s = String(inc.incident_severity ?? '').toLowerCase();
      if (s === 'critical') return 3;
      if (s === 'moderate' || s === 'high') return 2;
      if (s === 'low') return 1;
      return 0;
    },
    status:    inc => inc.incident_status,
    xc_caused: inc => inc.xc_caused,
  });

  // Keep the split view's selection valid: default to the first row when the
  // split view is active, and re-anchor if the current selection falls out of
  // the filtered/sorted list.
  useEffect(() => {
    if (layoutMode !== 'split') return;
    if (!sortedIncidents.length) { setSelectedId(null); return; }
    setSelectedId(prev => {
      const stillExists = prev && sortedIncidents.some(i => (i.row_id || i.event_id) === prev);
      return stillExists ? prev : (sortedIncidents[0].row_id || sortedIncidents[0].event_id);
    });
  }, [layoutMode, sortedIncidents]);

  // Toggle the split/table layout while preserving all other search params.
  const setLayout = (mode: 'table' | 'split') => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (mode === 'split') next.set('layout', 'split');
      else next.delete('layout');
      return next;
    }, { replace: true });
  };

  const clearFilters = () => {
    setFilterCustomer('');
    setFilterDistrict('');
    setFilterTime('all_time');
    setSearchTerm('');
    window.history.replaceState({}, '', window.location.pathname);
  };

  const filtersActive = filterCustomer || filterDistrict || filterTime !== 'all_time' || searchTerm;

  // ── Dashboard metrics (computed over ALL enrichedIncidents) ───────────────
  const COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#84cc16'];

  const statusCounts = useMemo(() => {
    const map: Record<string, number> = {};
    enrichedIncidents.forEach(inc => {
      const s = normalizeStatus(inc.incident_status) || 'Unknown';
      map[s] = (map[s] || 0) + 1;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [enrichedIncidents]);

  const severityCounts = useMemo(() => {
    const map: Record<string, number> = {};
    enrichedIncidents.forEach(inc => {
      const s = inc.incident_severity || 'Unknown';
      map[s] = (map[s] || 0) + 1;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [enrichedIncidents]);

  const xcCausedCounts = useMemo(() => {
    const map: Record<string, number> = {};
    enrichedIncidents.forEach(inc => {
      const s = inc.xc_caused || 'Unknown';
      map[s] = (map[s] || 0) + 1;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [enrichedIncidents]);

  const totalIncidents   = enrichedIncidents.length;
  const openCount        = useMemo(() => enrichedIncidents.filter(i => normalizeStatus(i.incident_status) !== 'Closed').length, [enrichedIncidents]);
  const closedCount      = useMemo(() => enrichedIncidents.filter(i => normalizeStatus(i.incident_status) === 'Closed').length, [enrichedIncidents]);
  const criticalCount    = useMemo(() => enrichedIncidents.filter(i => (i.incident_severity || '').toLowerCase() === 'critical').length, [enrichedIncidents]);
  const xcCausedYesCount = useMemo(() => enrichedIncidents.filter(i => (i.xc_caused || '').toLowerCase() === 'yes').length, [enrichedIncidents]);

  // ── Drill rows ────────────────────────────────────────────────────────────
  const drillRows = useMemo(() => {
    if (!drill) return [];
    return enrichedIncidents.filter(inc => {
      if (drill.dim === 'status')   return normalizeStatus(inc.incident_status) === drill.value;
      if (drill.dim === 'severity') return (inc.incident_severity || '') === drill.value;
      if (drill.dim === 'xc_caused') return (inc.xc_caused || '') === drill.value;
      if (drill.dim === 'open_closed') {
        const isClosed = normalizeStatus(inc.incident_status) === 'Closed';
        return drill.value === 'Closed' ? isClosed : !isClosed;
      }
      return false;
    });
  }, [drill, enrichedIncidents]);

  // ── CRUD ──────────────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this incident?')) return;
    try {
      const res = await fetch(`${baseUrl}/incidents/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${accessToken ?? publicAnonKey}` },
      });
      if (res.ok) { toast.success('Incident deleted'); loadData(); }
      else toast.error('Failed to delete incident');
    } catch { toast.error('Failed to delete incident'); }
  };

  const openEdit  = (inc: any) => { setEditingIncident(inc); setFormOpen(true); };
  const openView  = (inc: any) => { setViewingIncident(inc); setViewOpen(true); };
  const closeForm = () => { setFormOpen(false); setEditingIncident(null); setPrefillIncident(null); };

  // ── PDF helpers ───────────────────────────────────────────────────────────
  // PDFs are generated client-side and uploaded to Supabase Storage so every
  // authenticated user/device sees the same reports. We still detect legacy
  // localStorage PDFs (from before this change) so users aren't surprised by
  // a "missing" badge — but the legacy cache is read-only; regenerate to
  // promote it into shared storage.
  const LEGACY_LS_KEY = 'xc_incident_pdfs';

  const getLegacyPDFStore = (): Record<string, { preliminary?: string; final?: string }> => {
    try { return JSON.parse(localStorage.getItem(LEGACY_LS_KEY) || '{}'); } catch { return {}; }
  };

  type PdfSlot = { row?: IncidentReportRow; legacyUrl?: string };

  const getPDFs = (inc: any): { preliminary: PdfSlot; final: PdfSlot } => {
    const reports = reportsByEvent[String(inc?.event_id)] || [];
    const legacy  = getLegacyPDFStore()[inc?.row_id] || {};
    return {
      preliminary: {
        row: pickReport(reports, 'preliminary'),
        legacyUrl: legacy.preliminary,
      },
      final: {
        row: pickReport(reports, 'final'),
        legacyUrl: legacy.final,
      },
    };
  };

  const openPDFPreview = async (slot: PdfSlot) => {
    try {
      if (slot.row) {
        const url = await getIncidentReportUrl(slot.row);
        setPdfPreviewUrl(url);
      } else if (slot.legacyUrl) {
        setPdfPreviewUrl(slot.legacyUrl);
      } else {
        return;
      }
      setPdfPreviewOpen(true);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Could not load report');
    }
  };

  const downloadPDF = async (slot: PdfSlot, fileName: string) => {
    try {
      let url = slot.legacyUrl || '';
      if (slot.row) url = await getIncidentReportUrl(slot.row);
      if (!url) return;
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Could not download report');
    }
  };

  const openPdfPicker = (inc: any, version: 'preliminary' | 'final') => {
    if (!inc?.event_id) {
      toast.error('Cannot save report — incident is missing event_id');
      return;
    }
    setPickerIncident(inc);
    setPickerVersion(version);
    setPickerOpen(true);
  };

  const handleGeneratePDF = async (
    inc: any,
    version: 'preliminary' | 'final',
    selectedImages: IncidentReportImage[],
  ) => {
    const key = `${inc.row_id}-${version}`;
    if (!inc.event_id) {
      toast.error('Cannot save report — incident is missing event_id');
      return;
    }
    setGeneratingPDF(key);
    try {
      toast.info(`Generating ${version} report…`);
      const incData = { ...inc, report_version: version === 'preliminary' ? 'Preliminary' : 'Final' };

      const blob = await generateIncidentReportPDF({
        incident:   incData,
        listMap:    apiListMap,
        componentsMap,
        vendorMap:  apiVendorMap,
        customerMap,
        districtMap,
        selectedImages,
        returnBlob: true,
      }) as Blob;

      const inserted = await uploadIncidentReport({
        blob,
        eventId: inc.event_id,
        version,
        generatedBy: user?.email || user?.user_metadata?.name || null,
      });

      setReportsByEvent(prev => {
        const eventKey = String(inc.event_id);
        const existing = (prev[eventKey] || []).filter(
          r => r.report_type !== inserted.report_type,
        );
        return { ...prev, [eventKey]: [inserted, ...existing] };
      });
      if (viewingIncident?.row_id === inc.row_id) {
        setViewingIncident((prev: any) => ({ ...prev, _pdfTick: Date.now() }));
      }

      setPickerOpen(false);
      setPickerVersion(null);
      setPickerIncident(null);
      toast.success(`${version === 'preliminary' ? 'Preliminary' : 'Final'} report saved — click Preview or Download`);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to generate PDF');
    } finally {
      setGeneratingPDF(null);
    }
  };

  const handleToggleReportSent = async (inc: any) => {
    if (!canMarkReportSent(user?.role as any)) {
      toast.error('Only admins can mark a report as sent.');
      return;
    }
    const newValue = inc.report_sent ? null : new Date().toISOString();
    const { error } = await supabase
      .from('incidents')
      .update({ report_sent: newValue })
      .eq('row_id', inc.row_id);
    if (error) { toast.error('Failed to update'); return; }
    const patch = { report_sent: newValue };
    setIncidents(prev => prev.map(i => i.row_id === inc.row_id ? { ...i, ...patch } : i));
    if (viewingIncident?.row_id === inc.row_id) {
      setViewingIncident((prev: any) => ({ ...prev, ...patch }));
    }
    toast.success(newValue ? 'Marked as sent' : 'Marked as not sent');
  };

  if (loading) return <div className="p-8 text-center">Loading Incident Data...</div>;

  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const tooltipStyle = isDark ? { backgroundColor: '#1e293b', border: '1px solid #334155', color: '#f1f5f9' } : undefined;

  return (
    <div className="p-4 md:p-8">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Incident Management</h1>
            <p className="text-gray-600 dark:text-gray-300 mt-2">Track and investigate field incidents</p>
          </div>
          <div className="flex items-center gap-3 w-full md:w-auto">
            {/* Layout toggle (split prototype, opt-in) */}
            <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 p-1 gap-1">
              <button
                type="button"
                onClick={() => setLayout('table')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  layoutMode === 'table'
                    ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                Table
              </button>
              <button
                type="button"
                onClick={() => setLayout('split')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  layoutMode === 'split'
                    ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                Split
              </button>
            </div>
            <Button className="flex-1 md:flex-none bg-gray-900 hover:bg-gray-800 text-white"
              onClick={() => { setEditingIncident(null); setFormOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" />
              Report Incident
            </Button>
          </div>
        </div>

        {/* ── Dashboard / List tab toggle ── */}
        <div className="flex mb-6">
          <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 p-1 gap-1">
            <button
              type="button"
              onClick={() => setTab('dashboard')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                tab === 'dashboard'
                  ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm'
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
                  ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              List
            </button>
          </div>
        </div>

        {/* ── DASHBOARD TAB ── */}
        {tab === 'dashboard' && (
          <div className="space-y-6">

            {/* Metric cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {/* Total */}
              <button
                type="button"
                onClick={() => setDrill(null)}
                className="text-left rounded-lg border p-4 transition-all bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-blue-300"
              >
                <div className="text-2xl font-bold">{totalIncidents}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Total Incidents</div>
              </button>

              {/* Open */}
              <button
                type="button"
                onClick={() => setDrill(prev => prev?.dim === 'open_closed' && prev.value === 'Open' ? null : { dim: 'open_closed', value: 'Open' })}
                className={`text-left rounded-lg border p-4 transition-all bg-white dark:bg-gray-800 ${
                  drill?.dim === 'open_closed' && drill.value === 'Open'
                    ? 'ring-2 ring-blue-400 border-blue-400'
                    : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'
                }`}
              >
                <div className="text-2xl font-bold text-amber-600">{openCount}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Open</div>
              </button>

              {/* Closed */}
              <button
                type="button"
                onClick={() => setDrill(prev => prev?.dim === 'open_closed' && prev.value === 'Closed' ? null : { dim: 'open_closed', value: 'Closed' })}
                className={`text-left rounded-lg border p-4 transition-all bg-white dark:bg-gray-800 ${
                  drill?.dim === 'open_closed' && drill.value === 'Closed'
                    ? 'ring-2 ring-blue-400 border-blue-400'
                    : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'
                }`}
              >
                <div className="text-2xl font-bold text-emerald-600">{closedCount}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Closed</div>
              </button>

              {/* Critical */}
              <button
                type="button"
                onClick={() => setDrill(prev => prev?.dim === 'severity' && prev.value === 'Critical' ? null : { dim: 'severity', value: 'Critical' })}
                className={`text-left rounded-lg border p-4 transition-all bg-white dark:bg-gray-800 ${
                  drill?.dim === 'severity' && drill.value === 'Critical'
                    ? 'ring-2 ring-blue-400 border-blue-400'
                    : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'
                }`}
              >
                <div className="text-2xl font-bold text-red-600">{criticalCount}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Critical Severity</div>
              </button>

              {/* XC Caused */}
              <button
                type="button"
                onClick={() => setDrill(prev => prev?.dim === 'xc_caused' && prev.value === 'Yes' ? null : { dim: 'xc_caused', value: 'Yes' })}
                className={`text-left rounded-lg border p-4 transition-all bg-white dark:bg-gray-800 ${
                  drill?.dim === 'xc_caused' && drill.value === 'Yes'
                    ? 'ring-2 ring-blue-400 border-blue-400'
                    : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'
                }`}
              >
                <div className="text-2xl font-bold text-purple-600">{xcCausedYesCount}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">XC Caused (Yes)</div>
              </button>
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

              {/* Chart 1: Pie by status */}
              <Card className="p-4">
                <CardHeader className="p-0 pb-3">
                  <CardTitle className="text-sm font-semibold text-gray-700 dark:text-gray-200">Incidents by Status</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={statusCounts}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        label={({ name, percent }) => (percent >= 0.05 ? `${name} ${(percent * 100).toFixed(0)}%` : null)}
                        labelLine={false}
                        onClick={(entry: any) => {
                          if (!entry) return;
                          setDrill(prev => prev?.dim === 'status' && prev.value === entry.name ? null : { dim: 'status', value: entry.name });
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        {statusCounts.map((entry, idx) => (
                          <Cell
                            key={entry.name}
                            fill={drill?.dim === 'status' && drill.value === entry.name ? '#1d4ed8' : COLORS[idx % COLORS.length]}
                            stroke={drill?.dim === 'status' && drill.value === entry.name ? '#1d4ed8' : 'none'}
                            strokeWidth={2}
                          />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Chart 2: Bar by severity */}
              <Card className="p-4">
                <CardHeader className="p-0 pb-3">
                  <CardTitle className="text-sm font-semibold text-gray-700 dark:text-gray-200">Incidents by Severity</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={severityCounts} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#374151' : '#e5e7eb'} />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar
                        dataKey="value"
                        radius={[4, 4, 0, 0]}
                        onClick={(entry: any) => {
                          if (!entry) return;
                          setDrill(prev => prev?.dim === 'severity' && prev.value === entry.name ? null : { dim: 'severity', value: entry.name });
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        {severityCounts.map((entry, idx) => (
                          <Cell
                            key={entry.name}
                            fill={drill?.dim === 'severity' && drill.value === entry.name ? '#1d4ed8' : COLORS[idx % COLORS.length]}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Chart 3: Bar by XC Caused */}
              <Card className="p-4 md:col-span-2">
                <CardHeader className="p-0 pb-3">
                  <CardTitle className="text-sm font-semibold text-gray-700 dark:text-gray-200">Incidents by XC Caused</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={xcCausedCounts} layout="vertical" margin={{ top: 4, right: 24, left: 24, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#374151' : '#e5e7eb'} />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={100} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar
                        dataKey="value"
                        radius={[0, 4, 4, 0]}
                        onClick={(entry: any) => {
                          if (!entry) return;
                          setDrill(prev => prev?.dim === 'xc_caused' && prev.value === entry.name ? null : { dim: 'xc_caused', value: entry.name });
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        {xcCausedCounts.map((entry, idx) => (
                          <Cell
                            key={entry.name}
                            fill={drill?.dim === 'xc_caused' && drill.value === entry.name ? '#1d4ed8' : COLORS[idx % COLORS.length]}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* Drill-down list */}
            <Card className="border shadow-sm rounded-xl overflow-hidden">
              <CardHeader className="border-b bg-white dark:bg-gray-800 pb-3 pt-4 px-6">
                <CardTitle className="flex items-center justify-between text-sm font-semibold text-gray-700 dark:text-gray-200">
                  {drill ? (
                    <span>
                      Showing {drillRows.length} incident{drillRows.length !== 1 ? 's' : ''}
                      {' '}·{' '}
                      <span className="text-blue-600">{drill.value}</span>
                    </span>
                  ) : (
                    <span className="text-gray-400 font-normal italic">Select a card or chart segment to see matching incidents</span>
                  )}
                  {drill && (
                    <button
                      type="button"
                      onClick={() => setDrill(null)}
                      className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                    >
                      <X className="w-3 h-3" /> Clear
                    </button>
                  )}
                </CardTitle>
              </CardHeader>
              {drill && drillRows.length > 0 && (
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-gray-50/50">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="font-semibold text-gray-700 dark:text-gray-200 w-[90px]">Event ID</TableHead>
                          <TableHead className="font-semibold text-gray-700 dark:text-gray-200 w-[100px]">Date</TableHead>
                          <TableHead className="font-semibold text-gray-700 dark:text-gray-200">Customer</TableHead>
                          <TableHead className="font-semibold text-gray-700 dark:text-gray-200">Severity</TableHead>
                          <TableHead className="font-semibold text-gray-700 dark:text-gray-200">Status</TableHead>
                          <TableHead className="font-semibold text-gray-700 dark:text-gray-200">XC Caused</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {drillRows.map(inc => (
                          <TableRow key={inc.row_id || inc.event_id} className="hover:bg-gray-50 transition-colors">
                            <TableCell className="font-medium text-blue-600">
                              <Link to={`/incidents/${inc.row_id}`} className="flex items-center gap-1 hover:underline">
                                {inc.event_id}
                                <ExternalLink className="w-3 h-3" />
                              </Link>
                            </TableCell>
                            <TableCell className="text-gray-600 dark:text-gray-300 text-sm">
                              {inc.date_incident ? format(parseISO(inc.date_incident), 'M/d/yyyy') : '-'}
                            </TableCell>
                            <TableCell>
                              <div className="font-medium text-gray-900 dark:text-gray-100 text-sm">{inc.customerName || '-'}</div>
                            </TableCell>
                            <TableCell><SeverityBadge severity={inc.incident_severity} /></TableCell>
                            <TableCell><StatusBadge status={inc.incident_status} /></TableCell>
                            <TableCell><XcCausedBadge caused={inc.xc_caused} /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              )}
              {drill && drillRows.length === 0 && (
                <CardContent className="py-10 text-center text-gray-400 text-sm">
                  No incidents match the selected filter.
                </CardContent>
              )}
            </Card>

          </div>
        )}

        {/* ── LIST TAB ── */}
        {tab === 'list' && (
          <>
        {/* Report filter banner */}
        {fromReport && (
          <div className="mb-4 flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800 dark:bg-blue-950/30 dark:border-blue-900 dark:text-blue-300">
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

        {/* Filter bar */}
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
                  placeholder="Search by Event ID, customer, district, product line, description, vendor…"
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

        {/* Table (default) or master-detail Split view (?layout=split) */}
        {layoutMode === 'split' ? (
          sortedIncidents.length === 0 ? (
            <Card className="border shadow-sm rounded-xl overflow-hidden">
              <CardContent className="p-0">
                <div className="text-center py-16 bg-gray-50/50">
                  <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                  <p className="text-lg font-medium text-gray-900 dark:text-gray-100">No incidents found.</p>
                  {filtersActive && (
                    <button onClick={clearFilters} className="mt-2 text-sm text-blue-600 underline">Clear filters</button>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (() => {
            const selected = sortedIncidents.find(i => (i.row_id || i.event_id) === selectedId) || null;
            return (
              <Card className="w-full border shadow-sm rounded-xl overflow-hidden">
                <div className="flex w-full">

                  {/* LEFT: dense incident list */}
                  <div className="w-[360px] shrink-0 border-r border-gray-200 dark:border-gray-700 overflow-y-auto max-h-[calc(100vh-260px)]">
                    {sortedIncidents.map(inc => (
                      <SplitListRow
                        key={inc.row_id || inc.event_id}
                        inc={inc}
                        selected={(inc.row_id || inc.event_id) === selectedId}
                        onSelect={() => setSelectedId(inc.row_id || inc.event_id)}
                      />
                    ))}
                  </div>

                  {/* RIGHT: read-only detail summary */}
                  <div className="flex-1 overflow-y-auto max-h-[calc(100vh-260px)]">
                    {!selected ? (
                      <div className="h-full flex items-center justify-center py-24 text-gray-400 text-sm">
                        Select an incident
                      </div>
                    ) : (() => {
                      const r = selected;
                      const fComp = resolveFailedComponentLabel(r.failed_component, componentsMap, '');
                      const fType = resolveFailureTypeLabel(r.failure_type, listLookupMap, '');
                      const dateStr = r.date_incident ? safeFmtDate(r.date_incident, 'M/d/yyyy') : '';
                      const pdfs = getPDFs(r);
                      const hasPrelim = !!(pdfs.preliminary.row || pdfs.preliminary.legacyUrl);
                      const hasFinal  = !!(pdfs.final.row || pdfs.final.legacyUrl);
                      return (
                        <div className="p-6 space-y-6">

                          {/* Header */}
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-3 flex-wrap">
                              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                                Incident {r.event_id || '—'}
                              </h2>
                              <StatusBadge status={r.incident_status} />
                              <XcCausedBadge caused={r.xc_caused} />
                            </div>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                              {(r.customerName || '-')} — {(r.districtName || '-')}
                              {dateStr && <> · {dateStr}</>}
                            </p>
                          </div>

                          {/* Open full record + reachable per-row actions */}
                          <div className="flex items-center gap-2 flex-wrap">
                            {r.row_id && (
                              <Link to={`/incidents/${r.row_id}`}>
                                <Button className="bg-gray-900 hover:bg-gray-800 text-white">
                                  <ExternalLink className="w-4 h-4 mr-2" />
                                  Open full record
                                </Button>
                              </Link>
                            )}
                            <Button variant="outline" size="sm" className="h-9" onClick={() => openView(r)}>
                              <Eye className="w-4 h-4 mr-1.5" /> View
                            </Button>
                            <Button variant="outline" size="sm" className="h-9" onClick={() => openEdit(r)}>
                              <Edit className="w-4 h-4 mr-1.5" /> Edit
                            </Button>
                          </div>

                          {/* Key fields */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                            <Field label="Well Name">{r.well_name}</Field>
                            <Field label="Stage #">{r.stage_number ?? r['stage#']}</Field>
                            <Field label="Event Category">{r.event_category}</Field>
                            <Field label="Severity"><SeverityBadge severity={r.incident_severity} /></Field>
                            <Field label="Reported By">{r.reported_by}</Field>
                            <Field label="Failed Component">{fComp}</Field>
                            <Field label="Failure Type">{fType}</Field>
                          </div>

                          {/* Description */}
                          {r.incident_description && (
                            <div>
                              <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-1">Description</p>
                              <p className="text-sm text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700 rounded-lg p-3 whitespace-pre-wrap leading-relaxed">
                                {r.incident_description}
                              </p>
                            </div>
                          )}

                          {/* Reports indicator (same P/F lookup the table uses) */}
                          <div>
                            <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-1">Reports</p>
                            <div className="flex items-center gap-1">
                              {hasPrelim ? (
                                <button
                                  type="button"
                                  onClick={() => openPDFPreview(pdfs.preliminary)}
                                  title="Preview preliminary report"
                                  className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold cursor-pointer transition-colors bg-amber-100 text-amber-700 border border-amber-300 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800 dark:hover:bg-amber-900/70">
                                  P
                                </button>
                              ) : (
                                <span title="No preliminary report"
                                  className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold bg-gray-100 text-gray-400 border border-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:border-gray-700">
                                  P
                                </span>
                              )}
                              {hasFinal ? (
                                <button
                                  type="button"
                                  onClick={() => openPDFPreview(pdfs.final)}
                                  title="Preview final report"
                                  className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold cursor-pointer transition-colors bg-blue-100 text-blue-700 border border-blue-300 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800 dark:hover:bg-blue-900/70">
                                  F
                                </button>
                              ) : (
                                <span title="No final report"
                                  className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold bg-gray-100 text-gray-400 border border-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:border-gray-700">
                                  F
                                </span>
                              )}
                              {r.report_sent && (
                                <CheckCircle2 className="w-4 h-4 text-emerald-500" title={`Sent ${safeFmtDate(r.report_sent, 'M/d/yy') || ''}`} />
                              )}
                            </div>
                          </div>

                        </div>
                      );
                    })()}
                  </div>

                </div>
              </Card>
            );
          })()
        ) : (
        <Card className="border shadow-sm rounded-xl overflow-hidden">
          <CardHeader className="border-b bg-white dark:bg-gray-800 pb-4 pt-6 px-6">
            <CardTitle className="flex items-center justify-between text-lg font-semibold text-gray-900 dark:text-gray-100">
              {filtersActive ? 'Filtered Incidents' : 'All Incidents'}
              <span className="text-sm font-normal text-gray-500">
                {filtersActive ? `${filteredIncidents.length} of ${incidents.length}` : `${incidents.length} total`}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {filteredIncidents.length === 0 ? (
              <div className="text-center py-16 bg-gray-50/50">
                <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p className="text-lg font-medium text-gray-900 dark:text-gray-100">No incidents found.</p>
                {filtersActive && (
                  <button onClick={clearFilters} className="mt-2 text-sm text-blue-600 underline">Clear filters</button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-gray-50/50">
                    <TableRow className="hover:bg-transparent">
                      <SortableHead sortKey="event_id"  sort={sort} onSort={toggleSort} className="font-semibold text-gray-700 dark:text-gray-200 w-[90px]">Event ID</SortableHead>
                      <SortableHead sortKey="date"      sort={sort} onSort={toggleSort} className="font-semibold text-gray-700 dark:text-gray-200 w-[100px]">Date</SortableHead>
                      <SortableHead sortKey="customer"  sort={sort} onSort={toggleSort} className="font-semibold text-gray-700 dark:text-gray-200">Customer / District</SortableHead>
                      <SortableHead sortKey="category"  sort={sort} onSort={toggleSort} className="font-semibold text-gray-700 dark:text-gray-200">Category</SortableHead>
                      <SortableHead sortKey="severity"  sort={sort} onSort={toggleSort} className="font-semibold text-gray-700 dark:text-gray-200">Severity</SortableHead>
                      <SortableHead sortKey="status"    sort={sort} onSort={toggleSort} className="font-semibold text-gray-700 dark:text-gray-200">Status</SortableHead>
                      <SortableHead sortKey="xc_caused" sort={sort} onSort={toggleSort} className="font-semibold text-gray-700 dark:text-gray-200">XC Caused</SortableHead>
                      <TableHead className="font-semibold text-gray-700 dark:text-gray-200 w-[96px]">Reports</TableHead>
                      <TableHead className="font-semibold text-gray-700 dark:text-gray-200 text-right w-[110px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedIncidents.map(inc => (
                      <TableRow key={inc.row_id || inc.event_id} className="hover:bg-gray-50 transition-colors">
                        <TableCell className="font-medium text-blue-600">
                          <Link to={`/incidents/${inc.row_id}`} className="flex items-center gap-1 hover:underline">
                            {inc.event_id}
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                        </TableCell>
                        <TableCell className="text-gray-600 dark:text-gray-300 text-sm">
                          {inc.date_incident ? format(parseISO(inc.date_incident), 'M/d/yyyy') : '-'}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-gray-900 dark:text-gray-100 text-sm">{inc.customerName || '-'}</div>
                          <div className="text-xs text-gray-500 mt-0.5">{inc.districtName || '-'}</div>
                        </TableCell>
                        <TableCell>
                          {inc.event_category
                            ? <Badge variant="outline" className="bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-normal">{inc.event_category}</Badge>
                            : <span className="text-gray-300">-</span>}
                        </TableCell>
                        <TableCell><SeverityBadge severity={inc.incident_severity} /></TableCell>
                        <TableCell><StatusBadge status={inc.incident_status} /></TableCell>
                        <TableCell><XcCausedBadge caused={inc.xc_caused} /></TableCell>

                        {/* Reports indicator */}
                        <TableCell>
                          {(() => {
                            const pdfs = getPDFs(inc);
                            const hasPrelim = !!(pdfs.preliminary.row || pdfs.preliminary.legacyUrl);
                            const hasFinal  = !!(pdfs.final.row || pdfs.final.legacyUrl);
                            return (
                              <div className="flex items-center gap-1">
                                {hasPrelim ? (
                                  <button
                                    type="button"
                                    onClick={() => openPDFPreview(pdfs.preliminary)}
                                    title="Preview preliminary report"
                                    className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold cursor-pointer transition-colors bg-amber-100 text-amber-700 border border-amber-300 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800 dark:hover:bg-amber-900/70">
                                    P
                                  </button>
                                ) : (
                                  <span title="No preliminary report"
                                    className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold bg-gray-100 text-gray-400 border border-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:border-gray-700">
                                    P
                                  </span>
                                )}
                                {hasFinal ? (
                                  <button
                                    type="button"
                                    onClick={() => openPDFPreview(pdfs.final)}
                                    title="Preview final report"
                                    className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold cursor-pointer transition-colors bg-blue-100 text-blue-700 border border-blue-300 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800 dark:hover:bg-blue-900/70">
                                    F
                                  </button>
                                ) : (
                                  <span title="No final report"
                                    className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold bg-gray-100 text-gray-400 border border-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:border-gray-700">
                                    F
                                  </span>
                                )}
                                {inc.report_sent && (
                                  <CheckCircle2 className="w-4 h-4 text-emerald-500" title={`Sent ${safeFmtDate(inc.report_sent, 'M/d/yy') || ''}`} />
                                )}
                              </div>
                            );
                          })()}
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="outline" size="icon" className="h-8 w-8 text-gray-500"
                              onClick={() => openEdit(inc)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button variant="outline" size="icon"
                              className="h-8 w-8 text-green-600 hover:bg-green-50 border-green-200"
                              onClick={() => openView(inc)} title="View details">
                              <Eye className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
        )}

          </>
        )}

        {/* ── Form Dialog ── */}
        <IncidentForm
          open={formOpen}
          onClose={closeForm}
          onSaved={loadData}
          incident={editingIncident}
          prefill={prefillIncident}
          currentUser={user}
        />

        {/* ── View All Data Dialog ── */}
        <Dialog open={viewOpen} onOpenChange={setViewOpen}>
          <DialogContent className="max-w-4xl w-[95vw] md:w-full max-h-[90vh] flex flex-col p-4 md:p-6">
            <DialogHeader className="shrink-0">
              <DialogTitle className="flex items-center gap-3 pr-8">
                <span>Incident #{viewingIncident?.event_id}</span>
                <StatusBadge status={viewingIncident?.incident_status} />
                <SeverityBadge severity={viewingIncident?.incident_severity} />
              </DialogTitle>
            </DialogHeader>

            {/* Scrollable body */}
            <div className="overflow-y-auto flex-1 pr-1">
              {viewingIncident && (() => {
                const r = viewingIncident;
                const fComp = resolveFailedComponentLabel(r.failed_component, componentsMap, '');
                const fType = resolveFailureTypeLabel(r.failure_type, listLookupMap, '');
                const vName = vendorLookupMap[r.vendor] || r.vendor;
                return (
                  <div className="space-y-6 py-2 text-sm">

                    {/* General Information */}
                    <section>
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 border-b pb-1">General Information</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                        <Field label="Date">{r.date_incident ? new Date(r.date_incident + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : null}</Field>
                        <Field label="Event ID">{r.event_id}</Field>
                        <Field label="Customer">{r.customerName}</Field>
                        <Field label="District">{r.districtName}</Field>
                        <Field label="XC Representative">{r.xc_rep}</Field>
                        <Field label="Customer Rep">{r.customer_rep}</Field>
                        <Field label="EP Representative">{r.ep_rep}</Field>
                        <Field label="XC District">{r.xc_district}</Field>
                        <Field label="Field / Facility">{r.field_facility}</Field>
                        <Field label="Operating Company">{r.operating_company}</Field>
                        <Field label="Well Name">{r.well_name}</Field>
                        <Field label="Stage #">{r['stage#']}</Field>
                        <Field label="SO #">{r['so#']}</Field>
                        <Field label="Field Visit ID">{r.field_visit_id}</Field>
                      </div>
                    </section>

                    {/* Technical Investigation */}
                    <section>
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 border-b pb-1">Technical Investigation</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                        <Field label="XC Caused"><XcCausedBadge caused={r.xc_caused} /></Field>
                        <Field label="Event Category">{r.event_category}</Field>
                        <Field label="Product Line">{r.product_line}</Field>
                        <Field label="Firing System">{r.firing_system}</Field>
                        <Field label="Vendor">{vName}</Field>
                        <Field label="Vendor Caused">{r.vendor_caused}</Field>
                        <Field label="Failed Component">{fComp}</Field>
                        <Field label="Failure Type">{fType}</Field>
                      </div>
                    </section>

                    {/* Narrative */}
                    {(r.incident_description || r.investigation || r.root_cause || r.notes) && (
                      <section>
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 border-b pb-1">Incident Narrative</p>
                        <div className="space-y-4">
                          <TextBlock label="Description"         value={r.incident_description} />
                          <TextBlock label="Investigation"       value={r.investigation} />
                          <TextBlock label="Root Cause"          value={r.root_cause} />
                          <TextBlock label="Field Notes"         value={r.notes} />
                        </div>
                      </section>
                    )}

                    {/* Corrective & Preventive Actions */}
                    {(r.corrective_action || r.preventive_action || r.action_assigned_to || r.action_due_date || r.action_status) && (
                      <section>
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 border-b pb-1">Corrective &amp; Preventive Actions</p>
                        <div className="space-y-4">
                          <TextBlock label="Corrective Action"  value={r.corrective_action} />
                          <TextBlock label="Preventive Action"  value={r.preventive_action} />
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-4">
                            <Field label="Assigned To">{r.action_assigned_to}</Field>
                            <Field label="Due Date">{r.action_due_date ? new Date(r.action_due_date + 'T12:00:00').toLocaleDateString() : null}</Field>
                            <Field label="Action Status">{(() => {
                              const a = normalizeActionStatus(r.action_status);
                              return a ? ACTION_STATUS_LABELS[a] : r.action_status;
                            })()}</Field>
                          </div>
                        </div>
                      </section>
                    )}

                    {/* Closure */}
                    {(r.closed_date || r.closed_by) && (
                      <section>
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 border-b pb-1">Closure</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                          <Field label="Closed Date">{r.closed_date ? new Date(r.closed_date + 'T12:00:00').toLocaleDateString() : null}</Field>
                          <Field label="Closed By">{r.closed_by}</Field>
                        </div>
                      </section>
                    )}

                    {/* Visual Evidence — photos live in images_legacy keyed by
                        event_id; renders nothing (incl. heading) if there are none. */}
                    <IncidentEvidenceImages title="Visual Evidence" eventId={r.event_id} inline={[r.image1, r.image2]} />

                    {/* Reports */}
                    <section>
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 border-b pb-1">Reports</p>
                      <div className="space-y-2">

                        {/* Preliminary */}
                        {(['preliminary', 'final'] as const).map(version => {
                          const slot   = getPDFs(r)[version];
                          const has    = !!(slot.row || slot.legacyUrl);
                          const isLegacyOnly = !slot.row && !!slot.legacyUrl;
                          const genKey = `${r.row_id}-${version}`;
                          const label  = version === 'preliminary' ? 'Preliminary' : 'Final';
                          const color  = version === 'preliminary' ? 'amber' : 'blue';
                          const status = !has
                            ? 'Not yet generated'
                            : isLegacyOnly
                              ? 'Local-only — regenerate to share with team'
                              : 'Saved in shared storage';
                          return (
                            <div key={version} className="flex items-center gap-3 px-4 py-3 rounded-lg border bg-gray-50 dark:bg-gray-800/50">
                              <span className={`inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold shrink-0
                                ${color === 'amber' ? 'bg-amber-100 text-amber-700 border border-amber-300' : 'bg-blue-100 text-blue-700 border border-blue-300'}`}>
                                {label[0]}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">{label} Report</p>
                                <p className="text-xs text-gray-400">{status}</p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {has && (
                                  <>
                                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
                                      onClick={() => openPDFPreview(slot)}>
                                      <Eye className="w-3 h-3 mr-1" /> Preview
                                    </Button>
                                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
                                      onClick={() => downloadPDF(slot, `Incident_${r.event_id}_${label}.pdf`)}>
                                      <Download className="w-3 h-3 mr-1" /> Download
                                    </Button>
                                  </>
                                )}
                                <Button size="sm" variant={has ? 'outline' : 'default'}
                                  className={`h-7 px-2 text-xs ${!has ? 'bg-gray-900 text-white hover:bg-gray-800' : ''}`}
                                  disabled={generatingPDF === genKey}
                                  onClick={() => openPdfPicker(r, version)}>
                                  {generatingPDF === genKey
                                    ? <><RefreshCw className="w-3 h-3 mr-1 animate-spin" /> Generating…</>
                                    : <><FileText className="w-3 h-3 mr-1" />{has ? 'Regenerate' : 'Generate'}</>}
                                </Button>
                              </div>
                            </div>
                          );
                        })}

                        {/* Report Sent toggle — admin only */}
                        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border bg-gray-50 dark:bg-gray-800/50">
                          <div className="flex-1">
                            <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">Report Sent to Customer</p>
                            {r.report_sent
                              ? <p className="text-xs text-emerald-600">Sent{safeFmtDate(r.report_sent, ' MMMM d, yyyy')}</p>
                              : <p className="text-xs text-gray-400">
                                  Not yet sent{!canMarkReportSent(user?.role as any) && <span className="text-gray-400"> · admin only</span>}
                                </p>}
                          </div>
                          <Button size="sm" variant="outline"
                            disabled={!canMarkReportSent(user?.role as any)}
                            title={!canMarkReportSent(user?.role as any) ? 'Only admins can mark a report as sent' : undefined}
                            className={`h-7 px-3 text-xs ${r.report_sent ? 'text-red-600 border-red-200 hover:bg-red-50' : 'text-emerald-700 border-emerald-200 hover:bg-emerald-50'}`}
                            onClick={() => handleToggleReportSent(r)}>
                            {r.report_sent
                              ? <><X className="w-3 h-3 mr-1" /> Mark Unsent</>
                              : <><Send className="w-3 h-3 mr-1" /> Mark as Sent</>}
                          </Button>
                        </div>
                      </div>
                    </section>

                  </div>
                );
              })()}
            </div>
          </DialogContent>
        </Dialog>

      </div>

      {/* ── PDF Image Picker ── */}
      {pickerVersion && pickerIncident?.row_id && (
        <IncidentPdfImagePicker
          open={pickerOpen}
          onClose={() => { setPickerOpen(false); setPickerVersion(null); setPickerIncident(null); }}
          incidentRowId={pickerIncident.row_id}
          baseUrl={`https://${projectId}.supabase.co/functions/v1/make-server-64775d98`}
          publicAnonKey={publicAnonKey}
          actionLabel={pickerVersion === 'preliminary'
            ? 'Generate Preliminary Report'
            : 'Generate Final Report'}
          generating={generatingPDF === `${pickerIncident.row_id}-${pickerVersion}`}
          onConfirm={(selected) => handleGeneratePDF(pickerIncident, pickerVersion, selected)}
        />
      )}

      {/* ── PDF Preview Modal ── */}
      <Dialog open={pdfPreviewOpen} onOpenChange={setPdfPreviewOpen}>
        <DialogContent className="max-w-5xl w-[95vw] md:w-full max-h-[95vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 py-4 border-b shrink-0">
            <DialogTitle className="flex items-center justify-between pr-8">
              <span className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-gray-500" />
                Report Preview
              </span>
              <a href={pdfPreviewUrl} download className="mr-2">
                <Button size="sm" variant="outline" className="h-8 text-xs">
                  <Download className="w-3 h-3 mr-1.5" /> Download PDF
                </Button>
              </a>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            {pdfPreviewUrl && (
              <iframe
                src={pdfPreviewUrl}
                title="Incident Report PDF"
                className="w-full h-full"
                style={{ minHeight: '75vh' }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
