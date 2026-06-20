import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { useAuth } from '../lib/auth-context';
import { detailApi, hardwareInspectionApi } from '../lib/api';
import { supabase } from '../lib/supabase';
import { listSessions, type ChecklistSession } from '../lib/trainingChecklists';
import { generateDistrictSummaryPDF, type DistrictSummaryData } from '../lib/generateDistrictSummaryPDF';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import {
  ArrowLeft, MapPin, Phone, Mail, TrendingUp, AlertTriangle, Package, Clock,
  BarChart3, ClipboardList, Wrench, GraduationCap, FileDown, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter,
} from 'date-fns';

type SummaryPeriod = 'weekly' | 'monthly' | 'quarterly';

const PERIOD_LABEL: Record<SummaryPeriod, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
};

const HW_STATUS_LABEL: Record<string, string> = {
  pass: 'Pass',
  monitor: 'Monitor',
  replace_soon: 'Replace soon',
  remove: 'Remove from service',
};

const HW_STATUS_BADGE: Record<string, string> = {
  pass: 'bg-green-100 text-green-800 border-green-200',
  monitor: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  replace_soon: 'bg-orange-100 text-orange-800 border-orange-200',
  remove: 'bg-red-100 text-red-800 border-red-200',
};

// Compute [start, end] for the selected period anchored to "now" (naive wall-clock).
function periodWindow(period: SummaryPeriod, now: Date): { start: Date; end: Date } {
  if (period === 'weekly') return { start: startOfWeek(now), end: endOfWeek(now) };
  if (period === 'quarterly') return { start: startOfQuarter(now), end: endOfQuarter(now) };
  return { start: startOfMonth(now), end: endOfMonth(now) };
}

// Parse a stored date (date-only or ISO) into a Date without TZ conversion games.
function parseWallClock(val?: string | null): Date | null {
  if (!val) return null;
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(val);
  const d = new Date(isDateOnly ? val + 'T12:00:00' : val);
  return isNaN(d.getTime()) ? null : d;
}

function inWindow(val: string | null | undefined, start: Date, end: Date): boolean {
  const d = parseWallClock(val);
  if (!d) return false;
  return d.getTime() >= start.getTime() && d.getTime() <= end.getTime();
}

function fmtShort(val?: string | null): string {
  const d = parseWallClock(val);
  return d ? d.toLocaleDateString() : '—';
}

export default function DistrictDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { accessToken, user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // ── District summary (visits / checklists / inspections over a period) ──
  const [period, setPeriod] = useState<SummaryPeriod>('monthly');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [allVisits, setAllVisits] = useState<any[]>([]);
  const [allSessions, setAllSessions] = useState<ChecklistSession[]>([]);
  const [allInspections, setAllInspections] = useState<any[]>([]);
  const [summaryError, setSummaryError] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    loadDistrict();
  }, [id]);

  // Load the raw records once; period filtering happens client-side so toggling
  // is instant and tz-free. `customer_district` stores the district row_id.
  useEffect(() => {
    if (!id || !accessToken) return;
    let alive = true;
    (async () => {
      setSummaryLoading(true);
      setSummaryError(false);
      try {
        const [visitsRes, sessionsRes, inspRes] = await Promise.all([
          supabase
            .from('fieldvisits')
            .select('field_visit_id, arrival_date, xc_rep, visit_purpose, pad_name, customer, customer_district')
            .eq('customer_district', id),
          listSessions().catch(() => [] as ChecklistSession[]),
          hardwareInspectionApi.getByDistrict(id, accessToken ?? undefined).catch(() => []),
        ]);
        if (!alive) return;
        const visits = visitsRes.data || [];
        // Resolve customer names for the visit list.
        const custIds = Array.from(new Set(visits.map((v: any) => v.customer).filter(Boolean)));
        const nameById = new Map<string, string>();
        if (custIds.length) {
          const { data: custs } = await supabase
            .from('customers').select('row_id, customer').in('row_id', custIds);
          for (const c of custs || []) if (c?.row_id) nameById.set(c.row_id, c.customer);
        }
        if (!alive) return;
        setAllVisits(visits.map((v: any) => ({
          ...v,
          customerName: (v.customer && nameById.get(v.customer)) || null,
        })));
        setAllSessions((sessionsRes as ChecklistSession[]).filter((s) => s.customer_district === id));
        setAllInspections(Array.isArray(inspRes) ? inspRes : []);
      } catch (e) {
        console.error('Failed to load district summary data:', e);
        if (alive) setSummaryError(true);
      } finally {
        if (alive) setSummaryLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id, accessToken]);

  // Build the period-scoped aggregation.
  const buildSummary = useCallback((): DistrictSummaryData => {
    const now = new Date();
    const { start, end } = periodWindow(period, now);

    const visits = allVisits.filter((v) => inWindow(v.arrival_date, start, end));
    const checklists = allSessions.filter((s) => inWindow(s.training_date, start, end));
    const inspections = allInspections.filter((i) => inWindow(i.inspection_date, start, end));

    const checklistStatusCounts: Record<string, number> = {};
    for (const c of checklists) {
      const key = c.status === 'completed' ? 'completed' : 'in_progress';
      checklistStatusCounts[key] = (checklistStatusCounts[key] || 0) + 1;
    }

    const inspectionStatusCounts: Record<string, number> = {};
    let totalComponentsInspected = 0;
    const inspSummaries = inspections.map((i) => {
      const status = i.overall_status || 'pass';
      inspectionStatusCounts[status] = (inspectionStatusCounts[status] || 0) + 1;
      const items = Array.isArray(i.items) ? i.items : [];
      const parts = items.reduce(
        (sum: number, it: any) => sum + (Number(it.quantity) > 0 ? Number(it.quantity) : 1), 0);
      totalComponentsInspected += parts;
      return {
        inspector: i.inspector,
        inspection_date: i.inspection_date,
        overall_status: i.overall_status,
        componentCount: items.length,
        totalParts: parts,
      };
    });

    return {
      districtName: data?.district?.customer_district ?? null,
      customerName: data?.customerInfo?.customer ?? null,
      periodLabel: PERIOD_LABEL[period],
      rangeStart: start,
      rangeEnd: end,
      visits: visits.map((v) => ({
        field_visit_id: v.field_visit_id,
        arrival_date: v.arrival_date,
        xc_rep: v.xc_rep,
        visit_purpose: v.visit_purpose,
        customerName: v.customerName,
        pad_name: v.pad_name,
      })),
      checklists: checklists.map((c) => ({
        template_name: c.template_name,
        status: c.status,
        training_date: c.training_date,
        trainer_name: c.trainer_name,
      })),
      checklistStatusCounts,
      inspections: inspSummaries,
      inspectionStatusCounts,
      totalComponentsInspected,
    };
  }, [period, allVisits, allSessions, allInspections, data]);

  async function handleDownloadSummaryPDF() {
    setPdfLoading(true);
    try {
      await generateDistrictSummaryPDF({ data: buildSummary() });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to generate district summary PDF');
    } finally {
      setPdfLoading(false);
    }
  }

  const loadDistrict = async () => {
    if (!id || !accessToken) {
      setLoading(false);
      return;
    }

    try {
      const result = await detailApi.getDistrict(id, accessToken);
      setData(result);
    } catch (error: any) {
      console.error('Error loading district:', error);
      toast.error('Failed to load district details');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-8"><div className="max-w-6xl mx-auto text-center py-12">Loading...</div></div>;
  }

  if (!data) {
    return (
      <div className="p-8">
        <div className="max-w-6xl mx-auto text-center py-12">
          <p className="text-gray-500 mb-4">District not found</p>
          <Button onClick={() => navigate('/customers')}>Back to Customers</Button>
        </div>
      </div>
    );
  }

  const { district, customerInfo, kpis } = data;
  const isSqm = user?.role === 'sqm';
  const summary = buildSummary();
  const customerNameParam = customerInfo?.customer
    ? `customerName=${encodeURIComponent(customerInfo.customer)}`
    : '';
  const districtNameParam = district?.customer_district
    ? `districtName=${encodeURIComponent(district.customer_district)}`
    : '';
  const linkQuery = [customerNameParam, districtNameParam].filter(Boolean).join('&');
  const linkBase = linkQuery ? `?${linkQuery}` : '';

  return (
    <div className="p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <Button variant="ghost" onClick={() => navigate('/customers')} className="mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Customers
          </Button>
          <div className="flex items-start gap-4">
            {customerInfo?.customer_logo && (
              <div className="bg-white dark:bg-gray-800 p-3 rounded-lg shadow-sm border">
                <img src={customerInfo.customer_logo} alt={customerInfo.customer} className="h-16 w-16 object-contain" />
              </div>
            )}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <MapPin className="w-6 h-6 text-blue-600" />
                <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">{district.customer_district}</h1>
              </div>
              <p className="text-gray-600 dark:text-gray-300">{customerInfo?.customer || 'Unknown Customer'}</p>
            </div>
          </div>
        </div>

        {/* Contact Information */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Contact Information</CardTitle>
          </CardHeader>
          <CardContent className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-500">Address</label>
              <p className="text-gray-900 dark:text-gray-100 mt-1">{district.customer_address || 'No address provided'}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Contact Person</label>
              <p className="text-gray-900 dark:text-gray-100 mt-1">{district.district_contact || 'No contact provided'}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Phone</label>
              {district.customer_phone_number ? (
                <a href={`tel:${district.customer_phone_number}`} className="flex items-center gap-2 text-blue-600 hover:underline mt-1">
                  <Phone className="w-4 h-4" />
                  {district.customer_phone_number}
                </a>
              ) : (
                <p className="text-gray-500 mt-1">No phone provided</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Email</label>
              {district.customer_email ? (
                <a href={`mailto:${district.customer_email}`} className="flex items-center gap-2 text-blue-600 hover:underline mt-1">
                  <Mail className="w-4 h-4" />
                  {district.customer_email}
                </a>
              ) : (
                <p className="text-gray-500 mt-1">No email provided</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className={`grid ${isSqm ? 'md:grid-cols-3' : 'md:grid-cols-4'} gap-4 mb-6`}>
          <Link to={`/field-visits${linkBase}`} className="block focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-lg">
            <Card className="hover:shadow-md hover:border-blue-300 transition-all cursor-pointer h-full">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Field Visits</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{kpis.visitCount}</p>
                    <p className="text-xs text-gray-500 mt-1">{kpis.totalVisitHours}h total • {kpis.avgVisitHours}h avg</p>
                  </div>
                  <Clock className="w-8 h-8 text-blue-500" />
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link to={`/incidents${linkBase}`} className="block focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-lg">
            <Card className="hover:shadow-md hover:border-blue-300 transition-all cursor-pointer h-full">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Incidents</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{kpis.totalIncidents}</p>
                    <p className="text-xs text-gray-500 mt-1">{kpis.xcCausedYes} XC caused</p>
                  </div>
                  <AlertTriangle className="w-8 h-8 text-orange-500" />
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link to={`/panels${linkBase}`} className="block focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-lg">
            <Card className="hover:shadow-md hover:border-blue-300 transition-all cursor-pointer h-full">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Panels</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{kpis.totalPanels}</p>
                    <p className="text-xs text-gray-500 mt-1">Total panels</p>
                  </div>
                  <Package className="w-8 h-8 text-purple-500" />
                </div>
              </CardContent>
            </Card>
          </Link>

          {!isSqm && (
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Barrels Sold</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{kpis.totalBarrels.toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-1">Total barrels</p>
                  </div>
                  <TrendingUp className="w-8 h-8 text-green-500" />
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Visit / Checklist / Inspection Summary ─────────────────────── */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <CardTitle className="flex items-center gap-2">
                <ClipboardList className="w-5 h-5" />
                Activity Summary
              </CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Period toggle */}
                <div className="inline-flex rounded-lg border bg-gray-50 dark:bg-gray-800 p-0.5">
                  {(['weekly', 'monthly', 'quarterly'] as SummaryPeriod[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPeriod(p)}
                      className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                        period === p
                          ? 'bg-white dark:bg-gray-900 shadow-sm font-medium text-gray-900 dark:text-gray-100'
                          : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                      }`}
                    >
                      {PERIOD_LABEL[p]}
                    </button>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={handleDownloadSummaryPDF}
                  disabled={pdfLoading || summaryLoading}
                >
                  {pdfLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                  {pdfLoading ? 'Generating…' : 'Download District Summary PDF'}
                </Button>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {summary.rangeStart.toLocaleDateString()} – {summary.rangeEnd.toLocaleDateString()}
            </p>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <div className="flex items-center gap-2 text-gray-500 py-8 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading summary…
              </div>
            ) : summaryError ? (
              <p className="text-sm text-red-500 py-4">Could not load summary data.</p>
            ) : (
              <div className="space-y-6">
                {/* Totals */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="rounded-lg border p-4">
                    <div className="flex items-center gap-2 text-gray-500 text-sm"><Clock className="w-4 h-4" /> Field Visits</div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{summary.visits.length}</p>
                  </div>
                  <div className="rounded-lg border p-4">
                    <div className="flex items-center gap-2 text-gray-500 text-sm"><GraduationCap className="w-4 h-4" /> Checklists</div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{summary.checklists.length}</p>
                  </div>
                  <div className="rounded-lg border p-4">
                    <div className="flex items-center gap-2 text-gray-500 text-sm"><Wrench className="w-4 h-4" /> Inspections</div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{summary.inspections.length}</p>
                  </div>
                  <div className="rounded-lg border p-4">
                    <div className="flex items-center gap-2 text-gray-500 text-sm"><Package className="w-4 h-4" /> Components</div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{summary.totalComponentsInspected}</p>
                  </div>
                </div>

                {/* Status breakdowns */}
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="text-sm font-medium text-gray-500 mb-2">Checklist status</h4>
                    {Object.keys(summary.checklistStatusCounts).length === 0 ? (
                      <p className="text-sm text-gray-400 italic">None in this period.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(summary.checklistStatusCounts).map(([k, n]) => (
                          <Badge key={k} variant="outline">
                            {(k === 'completed' ? 'Completed' : 'In progress')}: {n}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-gray-500 mb-2">Inspection status</h4>
                    {Object.keys(summary.inspectionStatusCounts).length === 0 ? (
                      <p className="text-sm text-gray-400 italic">None in this period.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(summary.inspectionStatusCounts).map(([k, n]) => (
                          <Badge key={k} variant="outline" className={HW_STATUS_BADGE[k] || ''}>
                            {(HW_STATUS_LABEL[k] || k)}: {n}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Recent field visits */}
                {summary.visits.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-500 mb-2">Field visits</h4>
                    <ul className="divide-y divide-gray-100 dark:divide-gray-800 border rounded-lg">
                      {summary.visits.slice(0, 10).map((v, i) => (
                        <li key={`${v.field_visit_id}-${i}`} className="px-3 py-2 text-sm">
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <span className="font-medium text-gray-900 dark:text-gray-100">
                              {fmtShort(v.arrival_date)} — {v.visit_purpose || 'Visit'}
                            </span>
                            <span className="text-xs text-gray-500">
                              {[v.field_visit_id ? `#${v.field_visit_id}` : null, v.xc_rep, v.pad_name]
                                .filter(Boolean).join('  ·  ')}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Additional Sales Metric */}
        {!isSqm && (
          <div className="grid md:grid-cols-1 gap-4 mb-6">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Stages Sold</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{kpis.totalStages.toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-1">Total stages</p>
                  </div>
                  <BarChart3 className="w-8 h-8 text-blue-500" />
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Performance Metrics */}
        {!isSqm && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                Performance Metrics
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h4 className="text-sm font-medium text-gray-500 mb-3">Incidents Per 10,000 Barrels</h4>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600 dark:text-gray-300">XC Caused Incidents:</span>
                      <span className="text-lg font-bold text-gray-900 dark:text-gray-100">
                        {kpis.totalBarrels > 0 ? ((kpis.xcCausedYes / kpis.totalBarrels) * 10000).toFixed(2) : '0.00'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600 dark:text-gray-300">Percentage:</span>
                      <span className="text-lg font-bold text-gray-900 dark:text-gray-100">{kpis.incidentsPerBarrelPct.toFixed(2)}%</span>
                    </div>
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-gray-500 mb-3">Incidents Per 1,000 Stages</h4>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600 dark:text-gray-300">XC Caused Incidents:</span>
                      <span className="text-lg font-bold text-gray-900 dark:text-gray-100">
                        {kpis.totalStages > 0 ? ((kpis.xcCausedYes / kpis.totalStages) * 1000).toFixed(2) : '0.00'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600 dark:text-gray-300">Percentage:</span>
                      <span className="text-lg font-bold text-gray-900 dark:text-gray-100">{kpis.incidentsPerStagePct.toFixed(2)}%</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}