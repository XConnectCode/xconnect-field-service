import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useAuth } from '../lib/auth-context';
import { detailApi } from '../lib/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import {
  ArrowLeft, Edit, FileText, Download, Send, CheckCircle2,
  RefreshCw, Eye, X, ExternalLink, Clock, Plus,
} from 'lucide-react';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import { supabase } from '../lib/supabase';
import { generateIncidentReportPDF } from '../lib/generateIncidentReportPDF';
import {
  uploadIncidentReport,
  getIncidentReportUrl,
  listIncidentReports,
  pickReport,
  type IncidentReportRow,
} from '../lib/incidentReportStorage';
import IncidentForm from './forms/IncidentForm';
import ImageUpload from '../components/ImageUpload';
import IncidentPdfImagePicker from '../components/IncidentPdfImagePicker';
import type { IncidentReportImage } from '../lib/generateIncidentReportPDF';
import {
  normalizeStatus,
  canMarkReportSent,
  CLOSED_STATUS,
  FINAL_REVIEW_STATUS,
  ACTION_STATUS_COMPLETE,
  normalizeActionStatus,
  ACTION_STATUS_LABELS,
  getReviewSteps,
  validateForStatus,
} from '../lib/incidentWorkflow';
import ReviewProgress from '../components/ReviewProgress';
import { useTheme } from '../lib/theme-context';
import {
  resolveFailedComponentLabel,
  resolveFailureTypeLabel,
} from '../lib/failedComponent';
import { sendIncidentReportToCustomer } from '../lib/sendIncidentReport';
import { fetchIncidentReportImages } from '../lib/incidentReportImageFetch';
import { parseSlackUrl } from '../lib/slackUrl';

// ── Helpers ───────────────────────────────────────────────────────────────────
function safeFmtDate(val: any, fmt: string): string {
  if (!val) return '';
  try {
    const d = parseISO(String(val));
    if (isNaN(d.getTime())) return '';
    return format(d, fmt);
  } catch { return ''; }
}

function fmtLocalDate(val?: string | null): string {
  if (!val) return 'N/A';
  try { return new Date(val + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch { return val; }
}

// parseSlackUrl now lives in ../lib/slackUrl (shared with Dashboard.tsx).

// Slack's bracket glyph rendered inline so we don't need an external asset.
// lucide-react ships no Slack icon, so this matches the brand mark.
function SlackIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
    </svg>
  );
}

function SeverityBadge({ severity }: { severity?: string }) {
  if (!severity) return null;
  const s = severity.toLowerCase();
  if (s === 'critical') return <Badge className="bg-red-600 text-white">Critical</Badge>;
  if (s === 'moderate' || s === 'high') return <Badge className="bg-gray-900 text-white">{severity}</Badge>;
  if (s === 'low') return <Badge variant="secondary">Low</Badge>;
  return <Badge variant="outline">{severity}</Badge>;
}

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const n = normalizeStatus(status);
  if (n === 'New')               return <Badge className="bg-indigo-100 text-indigo-700 hover:bg-indigo-100">New</Badge>;
  if (n === 'Investigating')     return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Investigating</Badge>;
  if (n === 'Root Cause Needed') return <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">Root Cause Needed</Badge>;
  if (n === 'Final Review')      return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">Final Review</Badge>;
  if (n === 'Closed')            return <Badge variant="secondary" className="text-gray-500 font-normal">Closed</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function XcCausedBadge({ caused }: { caused?: string }) {
  if (!caused) return null;
  const s = caused.toLowerCase();
  if (s === 'yes')          return <Badge className="bg-red-600 text-white">Yes</Badge>;
  if (s === 'inconclusive') return <Badge variant="secondary" className="font-normal">Inconclusive</Badge>;
  if (s === 'no')           return <Badge variant="outline" className="text-gray-500 font-normal">No</Badge>;
  return <Badge variant="outline">{caused}</Badge>;
}

const CAPTION = 'text-xs text-gray-400 dark:text-gray-500 font-semibold uppercase tracking-wider mb-1';

// Read-only display helpers. All incident editing now routes through the
// IncidentForm modal so the status-machine validation + FK/enum logic in the
// form is never bypassed (parity requirement).
function Field({
  label, value, children,
}: {
  label: string;
  value?: string | null;
  children?: React.ReactNode;
}) {
  const content = children ?? value;
  if (!content || content === 'N/A') return null;
  return (
    <div>
      <p className={CAPTION}>{label}</p>
      <div className="text-sm text-gray-900 dark:text-gray-100">{content}</div>
    </div>
  );
}

function TextBlock({
  label, value,
}: {
  label: string;
  value?: string;
}) {
  if (!value) return null;
  return (
    <div>
      {label && <p className={CAPTION}>{label}</p>}
      <p className="text-sm text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700 rounded-lg p-3 whitespace-pre-wrap leading-relaxed">{value}</p>
    </div>
  );
}

// ── Legacy localStorage PDF cache (read-only fallback) ─────────────────────────
// Reports are now stored in Supabase Storage / the incident_reports table so
// every authenticated user/device sees the same PDFs. We still surface any
// pre-existing local PDFs so users aren't surprised by a missing badge — but
// new generations always upload to shared storage.
const LEGACY_LS_KEY = 'xc_incident_pdfs';

const getLegacyPDFStore = (): Record<string, { preliminary?: string; final?: string }> => {
  try { return JSON.parse(localStorage.getItem(LEGACY_LS_KEY) || '{}'); } catch { return {}; }
};

type PdfSlot = { row?: IncidentReportRow; legacyUrl?: string };

// ─────────────────────────────────────────────────────────────────────────────

export default function IncidentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { accessToken, user } = useAuth();
  const { isDark } = useTheme();

  const [incident,    setIncident]    = useState<any>(null);
  const [lists,       setLists]       = useState<any[]>([]);
  const [components,  setComponents]  = useState<any[]>([]);
  const [vendors,     setVendors]     = useState<any[]>([]);
  const [customers,   setCustomers]   = useState<any[]>([]);
  const [districts,   setDistricts]   = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [sendingReport, setSendingReport] = useState(false);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sendRecipient, setSendRecipient] = useState('');
  const [sendMessage, setSendMessage] = useState('');
  const [linkedVisitRowId, setLinkedVisitRowId] = useState<string | null>(null);
  const [updates,     setUpdates]     = useState<any[]>([]);
  const [updatesLoading, setUpdatesLoading] = useState(false);
  const [storedReports, setStoredReports] = useState<IncidentReportRow[]>([]);

  // Add Update dialog
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [updateType, setUpdateType] = useState('Investigation');
  const [updateNote, setUpdateNote] = useState('');
  const [savingUpdate, setSavingUpdate] = useState(false);

  // All incident editing routes through the full IncidentForm modal, which owns
  // the status-machine validation + FK/enum dropdown logic. There is no inline
  // edit path (it would bypass that validation).
  const [formOpen,    setFormOpen]    = useState(false);

  // PDF state
  const [generatingPDF,  setGeneratingPDF]  = useState<string | null>(null);
  const [pdfPreviewUrl,  setPdfPreviewUrl]  = useState('');
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  const [pdfTick,        setPdfTick]        = useState(0); // forces re-render on generate

  // Image picker shown before each PDF generation
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerVersion, setPickerVersion] = useState<'preliminary' | 'final' | null>(null);

  // Director-review checklist busy flag (shared across its action buttons).
  const [reviewBusy, setReviewBusy] = useState(false);

  useEffect(() => {
    if (id && accessToken) loadAll();
  }, [id, accessToken]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const restBase = `https://${projectId}.supabase.co/rest/v1`;
      // Forward the user's session token so RLS sees the authenticated user on
      // REST reads, and so the guarded edge routes (which reject the anon key)
      // accept the request. loadAll only runs once accessToken exists.
      const token = accessToken ?? publicAnonKey;
      const restHeaders = { 'apikey': publicAnonKey, 'Authorization': `Bearer ${token}` };
      const edgeHeaders = { 'Authorization': `Bearer ${token}` };
      const baseUrl = `https://${projectId}.supabase.co/functions/v1/make-server-64775d98`;

      const [incidentData, listsRes, compRes, vendorsRes, custRes, distRes] = await Promise.all([
        detailApi.getIncident(id!, accessToken!),
        fetch(`${restBase}/lists?select=row_id,failed_component,failure_type`, { headers: restHeaders }),
        fetch(`${restBase}/components?select=row_id,failed_component`, { headers: restHeaders }),
        fetch(`${restBase}/vendors?select=row_id,vendor`, { headers: restHeaders }),
        fetch(`${baseUrl}/customers`, { headers: edgeHeaders }),
        fetch(`${baseUrl}/districts`, { headers: edgeHeaders }),
      ]);

      setIncident(incidentData);
      // Guard each response so a non-array error body can't crash the page.
      if (listsRes.ok)   { const d = await listsRes.json();   setLists(Array.isArray(d) ? d : []); }
      if (compRes.ok)    { const d = await compRes.json();    setComponents(Array.isArray(d) ? d : []); }
      if (vendorsRes.ok) { const d = await vendorsRes.json(); setVendors(Array.isArray(d) ? d : []); }
      if (custRes.ok)    { const d = await custRes.json();    setCustomers(Array.isArray(d) ? d : []); }
      if (distRes.ok)    { const d = await distRes.json();    setDistricts(Array.isArray(d) ? d : []); }

      // Resolve linked field visit row_id (for cross-nav) using business field_visit_id
      if (incidentData?.field_visit_id) {
        const { data: fv } = await supabase
          .from('fieldvisits')
          .select('row_id')
          .eq('field_visit_id', incidentData.field_visit_id)
          .maybeSingle();
        setLinkedVisitRowId(fv?.row_id || null);
      } else {
        setLinkedVisitRowId(null);
      }

      // Load incident_updates timeline (keyed by event_id)
      if (incidentData?.event_id) {
        await loadUpdates(String(incidentData.event_id));
      } else {
        setUpdates([]);
      }

      // Evidence images are now rendered by <RecordImages /> which fetches
      // signed URLs from the Edge Function (GET /images/incidents/:row_id).

      // Load stored reports (AppSheet originals + generated preliminary/final PDFs)
      if (incidentData?.event_id) {
        const reports = await listIncidentReports(String(incidentData.event_id));
        setStoredReports(reports);
      } else {
        setStoredReports([]);
      }
    } catch (error: any) {
      console.error('Error loading incident:', error);
      toast.error('Failed to load incident details');
    } finally {
      setLoading(false);
    }
  };

  // ── Lookup maps ───────────────────────────────────────────────────────────
  const listMap = useMemo(() => {
    const map: Record<string, { failed_component: string; failure_type: string }> = {};
    lists.forEach((l: any) => {
      if (l.row_id) map[l.row_id] = { failed_component: l.failed_component || '', failure_type: l.failure_type || '' };
    });
    return map;
  }, [lists]);

  const componentsMap = useMemo(() => {
    const map: Record<string, { failed_component: string }> = {};
    components.forEach((c: any) => {
      if (c.row_id) map[c.row_id] = { failed_component: c.failed_component || '' };
    });
    return map;
  }, [components]);

  const vendorMap = useMemo(() => {
    const map: Record<string, string> = {};
    vendors.forEach((v: any) => { if (v.row_id) map[v.row_id] = v.vendor; });
    return map;
  }, [vendors]);

  const customerMap = useMemo(() => {
    const map: Record<string, { name: string; logo: string; email?: string }> = {};
    customers.forEach(c => {
      if (c.row_id) {
        map[c.row_id] = {
          name: c.customer,
          logo: c.customer_logo,
          email: c.customer_email || undefined,
        };
      }
    });
    return map;
  }, [customers]);

  const districtMap = useMemo(() => {
    const map: Record<string, string> = {};
    districts.forEach(d => { if (d.row_id) map[d.row_id] = d.customer_district; });
    return map;
  }, [districts]);

  // ── Resolved display values ────────────────────────────────────────────────
  // Authoritative table mapping (verified in DB):
  //   failed_component → components table only
  //   failure_type     → lists table only
  const resolvedFailedComponent = resolveFailedComponentLabel(
    incident?.failed_component,
    componentsMap,
    'N/A',
  );

  const resolvedFailureType = resolveFailureTypeLabel(
    incident?.failure_type,
    listMap,
    'N/A',
  );

  const resolvedVendor = incident?.vendor
    ? (vendorMap[incident.vendor] || incident.vendor)
    : 'N/A';

  const customerDisplay = incident?.customerName
    || (incident?.customer ? customerMap[incident.customer]?.name : null)
    || incident?.customer || 'N/A';

  const districtDisplay = incident?.districtName
    || (incident?.customer_district ? districtMap[incident.customer_district] : null)
    || incident?.customer_district || 'N/A';

  // Real Slack thread URL (unwrapped from the AppSheet JSON blob).
  const slackUrl = parseSlackUrl(incident?.slack_url);

  // ── PDF helpers ────────────────────────────────────────────────────────────
  const openPdfPicker = (version: 'preliminary' | 'final') => {
    if (!incident) return;
    if (!incident.event_id) {
      toast.error('Cannot save report — incident is missing event_id');
      return;
    }
    setPickerVersion(version);
    setPickerOpen(true);
  };

  const handleGeneratePDF = async (
    version: 'preliminary' | 'final',
    selectedImages: IncidentReportImage[],
  ) => {
    if (!incident || !incident.event_id) return;
    const genKey = `${incident.row_id}-${version}`;
    setGeneratingPDF(genKey);
    try {
      toast.info(`Generating ${version} report…`);
      const incData = { ...incident, report_version: version === 'preliminary' ? 'Preliminary' : 'Final' };

      // Build customerMap/districtMap in the shape generateIncidentReportPDF expects
      const custMapForPDF: Record<string, any> = {};
      customers.forEach(c => { if (c.row_id) custMapForPDF[c.row_id] = { name: c.customer }; });

      const blob = await generateIncidentReportPDF({
        incident:   incData,
        listMap:    listMap as any,
        componentsMap: componentsMap,
        vendorMap:  vendorMap,
        customerMap: custMapForPDF,
        districtMap: districtMap,
        selectedImages,
        returnBlob: true,
      }) as Blob;

      const inserted = await uploadIncidentReport({
        blob,
        eventId: incident.event_id,
        version,
        generatedBy: user?.email || (user as any)?.user_metadata?.name || null,
      });

      setStoredReports(prev => {
        const filtered = prev.filter(r => r.report_type !== inserted.report_type);
        return [inserted, ...filtered];
      });

      // Stamp the incident's report_generated_at/by so the Review Progress
      // "Generate report" step flags done (it reads incident.report_generated_at).
      // Only the FINAL report is the customer-facing artifact the workflow gates
      // on — a preliminary PDF shouldn't satisfy the generate step.
      if (version === 'final') {
        const generatedAt = new Date().toISOString();
        const generatedBy = user?.email || user?.name || null;
        const { error: stampErr } = await supabase
          .from('incidents')
          .update({ report_generated_at: generatedAt, report_generated_by: generatedBy, report_version: 'Final' })
          .eq('row_id', incident.row_id);
        if (stampErr) {
          console.warn('Failed to stamp report_generated_at:', stampErr.message);
        } else {
          setIncident((prev: any) => ({
            ...prev,
            report_generated_at: generatedAt,
            report_generated_by: generatedBy,
            report_version: 'Final',
          }));
        }
      }

      setPdfTick(t => t + 1);
      setPickerOpen(false);
      setPickerVersion(null);
      toast.success(`${version === 'preliminary' ? 'Preliminary' : 'Final'} report saved`);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to generate PDF');
    } finally {
      setGeneratingPDF(null);
    }
  };

  const previewReport = async (slot: PdfSlot) => {
    try {
      let url = slot.legacyUrl || '';
      if (slot.row) url = await getIncidentReportUrl(slot.row);
      if (!url) return;
      setPdfPreviewUrl(url);
      setPdfPreviewOpen(true);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Could not load report');
    }
  };

  const downloadReport = async (slot: PdfSlot, fileName: string) => {
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


  const loadUpdates = async (eventId: string) => {
    setUpdatesLoading(true);
    const { data: ups } = await supabase
      .from('incident_updates')
      .select('*')
      .eq('incident_id', eventId)
      .order('update_date', { ascending: false });
    setUpdates(ups || []);
    setUpdatesLoading(false);
  };

  const UPDATE_TYPES = [
    'Investigation',
    'Root Cause',
    'Corrective Action',
    'Preventive Action',
    'Status Change',
    'Slack Note',
    'General Note',
  ];

  const handleSubmitUpdate = async () => {
    if (!incident?.event_id) {
      toast.error('Cannot add update: incident has no Event ID');
      return;
    }
    if (!updateNote.trim()) {
      toast.error('Please enter a note');
      return;
    }

    setSavingUpdate(true);
    try {
      const { error } = await supabase.from('incident_updates').insert({
        incident_id: String(incident.event_id),
        update_date: new Date().toISOString(),
        updated_by: user?.name || user?.email || 'Unknown',
        update_type: updateType,
        note: updateNote.trim(),
      });
      if (error) throw error;

      toast.success('Update added');
      setUpdateDialogOpen(false);
      setUpdateNote('');
      setUpdateType('Investigation');
      await loadUpdates(String(incident.event_id));
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to add update');
    } finally {
      setSavingUpdate(false);
    }
  };

  const handleOpenSendDialog = () => {
    if (!incident) return;
    if (normalizeStatus(incident.incident_status) !== CLOSED_STATUS) {
      toast.error('Incident must be Closed (Final/Completed) before sending to the customer.');
      return;
    }
    // Pre-fill from last send if any, or the customer record's email if surfaced.
    setSendRecipient(incident.report_sent_to || (customerMap[incident.customer] as any)?.email || '');
    setSendMessage('');
    setSendDialogOpen(true);
  };

  const handleSendToCustomer = async () => {
    if (!incident) return;
    if (!sendRecipient.trim()) {
      toast.error('Please provide at least one recipient email address.');
      return;
    }
    if (normalizeStatus(incident.incident_status) !== CLOSED_STATUS) {
      toast.error('Incident must be Closed (Final/Completed) before sending to the customer.');
      return;
    }
    setSendingReport(true);
    try {
      // Re-generate the final PDF on the fly so the customer always gets the
      // current data, then deliver via the Netlify function. The image picker
      // is not shown here, so we auto-include every image attached to the
      // incident — INCLUDING native / backfilled AppSheet images, which live in
      // the `images` table rather than the (empty) legacy image1/image2 columns.
      // Fetching them here means the customer-facing report captures native
      // evidence instead of silently rendering no Visual Evidence section.
      const incData = { ...incident, report_version: 'Final' };
      const custMapForPDF: Record<string, any> = {};
      customers.forEach(c => { if (c.row_id) custMapForPDF[c.row_id] = { name: c.customer }; });

      const baseUrl = `https://${projectId}.supabase.co/functions/v1/make-server-64775d98`;
      const autoImages = await fetchIncidentReportImages(baseUrl, incident.row_id);

      const blob = await generateIncidentReportPDF({
        incident:    incData,
        listMap:     listMap as any,
        componentsMap,
        vendorMap,
        customerMap: custMapForPDF,
        districtMap,
        // Pass the resolved list (even if empty) so the generator uses the
        // images table rather than falling back to legacy image1/image2.
        selectedImages: autoImages,
        returnBlob:  true,
      }) as Blob;

      const result = await sendIncidentReportToCustomer({
        incidentRowId: incident.row_id,
        eventId: String(incident.event_id || ''),
        recipients: sendRecipient,
        message: sendMessage,
        pdfBlob: blob,
        senderName: user?.name || (user as any)?.user_metadata?.name || null,
        senderEmail: user?.email || null,
      });

      setIncident((prev: any) => ({
        ...prev,
        report_sent: result.sentAt,
        report_sent_to: sendRecipient,
        report_sent_by: user?.email || user?.name || null,
        report_sent_message: sendMessage,
      }));

      setSendDialogOpen(false);
      if (result.simulated) {
        toast.success('Report queued (MAIL_PROVIDER=log — no email actually sent). Audit trail updated.');
      } else {
        toast.success(`Report sent to ${sendRecipient}`);
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to send report');
    } finally {
      setSendingReport(false);
    }
  };

  const handleToggleReportSent = async () => {
    if (!incident) return;
    if (!canMarkReportSent(user?.role as any)) {
      toast.error('Only admins can mark a report as sent.');
      return;
    }
    const newValue = incident.report_sent ? null : new Date().toISOString();
    const { error } = await supabase
      .from('incidents')
      .update({ report_sent: newValue })
      .eq('row_id', incident.row_id);
    if (error) { toast.error('Failed to update'); return; }
    setIncident((prev: any) => ({ ...prev, report_sent: newValue }));
    toast.success(newValue ? 'Marked as sent' : 'Marked as not sent');
  };

  // ── Director review checklist actions ──────────────────────────────────────
  // Mirrors the Dashboard review queue so the Detail page is a full, equivalent
  // workflow surface. Admin-only, with the same hard field gate before sign-off.
  const handleMarkReviewed = async () => {
    if (!incident) return;
    if (user?.role !== 'admin') {
      toast.error('Only the director/admin can mark an incident reviewed.');
      return;
    }
    const missing = validateForStatus(incident, FINAL_REVIEW_STATUS);
    if (missing.length) {
      toast.error(`Cannot mark reviewed — complete these first: ${missing.join(', ')}.`, { duration: 6000 });
      return;
    }
    const reviewer = user?.name || user?.email || 'Director';
    const reviewedAt = new Date().toISOString();
    setReviewBusy(true);
    const { error } = await supabase
      .from('incidents')
      .update({ reviewed_by: reviewer, reviewed_at: reviewedAt })
      .eq('row_id', incident.row_id);
    setReviewBusy(false);
    if (error) { toast.error(error.message || 'Failed to mark reviewed'); return; }
    setIncident((prev: any) => ({ ...prev, reviewed_by: reviewer, reviewed_at: reviewedAt }));
    // Timeline log — best-effort, don't block on failure.
    supabase.from('incident_updates').insert({
      event_id: incident.event_id ?? null,
      incident_id: incident.row_id ?? null,
      update_type: 'review',
      note: `Reviewed by ${reviewer}`,
      created_by: reviewer,
    }).then(({ error: e }) => { if (e) console.warn('timeline log failed', e.message); });
    toast.success('Marked as reviewed');
  };

  const handleCloseFromChecklist = async () => {
    if (!incident) return;
    if (user?.role !== 'admin') {
      toast.error('Only the director/admin can close an incident.');
      return;
    }
    const missing = validateForStatus(incident, CLOSED_STATUS);
    if (missing.length) {
      toast.error(`Cannot close — missing: ${missing.join(', ')}.`, { duration: 6000 });
      return;
    }
    setReviewBusy(true);
    const { error } = await supabase
      .from('incidents')
      .update({ incident_status: CLOSED_STATUS, action_status: ACTION_STATUS_COMPLETE })
      .eq('row_id', incident.row_id);
    setReviewBusy(false);
    if (error) { toast.error(error.message || 'Failed to close incident'); return; }
    setIncident((prev: any) => ({ ...prev, incident_status: CLOSED_STATUS, action_status: ACTION_STATUS_COMPLETE }));
    toast.success('Incident closed.');
  };

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) {
    return <div className="p-8"><div className="max-w-5xl mx-auto text-center py-12">Loading...</div></div>;
  }

  if (!incident) {
    return (
      <div className="p-8">
        <div className="max-w-5xl mx-auto text-center py-12">
          <p className="text-gray-500 dark:text-gray-400 mb-4">Incident not found</p>
          <Button onClick={() => navigate('/incidents')}>Back to Incidents</Button>
        </div>
      </div>
    );
  }

  const legacyForIncident = getLegacyPDFStore()[incident.row_id] || {};
  const pdfs: Record<'preliminary' | 'final', PdfSlot> = {
    preliminary: {
      row: pickReport(storedReports, 'preliminary'),
      legacyUrl: legacyForIncident.preliminary,
    },
    final: {
      row: pickReport(storedReports, 'final'),
      legacyUrl: legacyForIncident.final,
    },
  };
  // storedReports already drive pdfs; surface anything else (e.g. AppSheet
  // originals) in the Archive list below.
  const archiveReports = storedReports.filter(
    r => r.report_type !== 'Preliminary' && r.report_type !== 'Final',
  );
  // Force re-renders on regenerate (pdfPreviewUrl signed URLs are short-lived).
  void pdfTick;

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto">

        {/* ── Hero Header ── */}
        <div className="mb-6 rounded-xl border dark:border-gray-700 bg-gradient-to-br from-slate-50 to-white dark:from-gray-800 dark:to-gray-900 p-6 shadow-sm">
          <Button variant="ghost" onClick={() => navigate('/incidents')} className="mb-4 -ml-2">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Incidents
          </Button>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-50 truncate">
                Incident #{incident.event_id || 'N/A'}
              </h1>
              <p className="text-gray-600 dark:text-gray-300 mt-1">
                {customerDisplay !== 'N/A' ? customerDisplay : 'Incident'}
                {incident.well_name ? ` • ${incident.well_name}` : ''}
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <StatusBadge status={incident.incident_status} />
                <SeverityBadge severity={incident.incident_severity} />
                {incident.xc_caused && (
                  <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                    XC Caused: <XcCausedBadge caused={incident.xc_caused} />
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {/* View in Slack — only shown when a real Slack thread URL exists.
                  Styled with Slack's aubergine brand color + Slack glyph. */}
              {slackUrl && (
                <a href={slackUrl} target="_blank" rel="noopener noreferrer">
                  <Button
                    className="gap-2 bg-[#4A154B] text-white hover:bg-[#611f64] border-0"
                    title="Open the Slack thread for this incident"
                  >
                    <SlackIcon className="w-4 h-4" /> View in Slack
                  </Button>
                </a>
              )}
              {/* Single Edit entry point — opens the full IncidentForm modal so the
                  status-machine + FK/enum logic always applies. */}
              <Button onClick={() => setFormOpen(true)} className="gap-2">
                <Edit className="w-4 h-4" /> Edit
              </Button>
            </div>
          </div>
        </div>

        {/* ── Action Bar ── */}
        <Card className="mb-6">
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-wrap items-center gap-3">
              {(['preliminary', 'final'] as const).map(version => {
                const slot   = pdfs[version];
                const has    = !!(slot.row || slot.legacyUrl);
                const label  = version === 'preliminary' ? 'Preliminary' : 'Final';
                const genKey = `${incident.row_id}-${version}`;
                return (
                  <div key={version} className="flex items-center gap-1">
                    {has && (
                      <>
                        <Button variant="outline" className="gap-1.5"
                          onClick={() => previewReport(slot)}>
                          <Eye className="w-4 h-4" /> {label}
                        </Button>
                        <Button variant="outline" className="gap-1.5"
                          onClick={() => downloadReport(slot, `Incident_${incident.event_id}_${label}.pdf`)}>
                          <Download className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                    <Button
                      variant={has ? 'outline' : 'default'}
                      className={!has ? 'bg-gray-900 text-white hover:bg-gray-800 gap-1.5' : 'gap-1.5'}
                      disabled={generatingPDF === genKey}
                      onClick={() => openPdfPicker(version)}>
                      {generatingPDF === genKey
                        ? <><RefreshCw className="w-4 h-4 animate-spin" /> Generating…</>
                        : <><FileText className="w-4 h-4" />{has ? `Regen ${label}` : `Generate ${label}`}</>}
                    </Button>
                  </div>
                );
              })}

              <div className="ml-auto flex items-center gap-2">
                {incident.report_sent && (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                    <CheckCircle2 className="w-4 h-4" />
                    Sent {safeFmtDate(incident.report_sent, 'M/d/yyyy')}
                  </span>
                )}
                {/* Primary: send the final PDF to the customer.
                    Gated on the incident being Closed (Final/Completed) so
                    only locked-down reports are emailed out. */}
                <Button
                  className="gap-1.5"
                  disabled={
                    normalizeStatus(incident.incident_status) !== CLOSED_STATUS ||
                    !canMarkReportSent(user?.role as any)
                  }
                  title={
                    normalizeStatus(incident.incident_status) !== CLOSED_STATUS
                      ? 'Close the incident (Final/Completed) before sending to the customer'
                      : !canMarkReportSent(user?.role as any)
                        ? 'Only admins can send reports to customers'
                        : undefined
                  }
                  onClick={handleOpenSendDialog}>
                  <Send className="w-4 h-4" /> Send to Customer
                </Button>
                <Button variant="outline"
                  disabled={!canMarkReportSent(user?.role as any)}
                  title={!canMarkReportSent(user?.role as any) ? 'Only admins can mark a report as sent' : undefined}
                  className={incident.report_sent
                    ? 'text-red-600 border-red-200 hover:bg-red-50 gap-1.5'
                    : 'text-emerald-700 border-emerald-200 hover:bg-emerald-50 gap-1.5'}
                  onClick={handleToggleReportSent}>
                  {incident.report_sent
                    ? <><X className="w-4 h-4" /> Mark Unsent</>
                    : <><CheckCircle2 className="w-4 h-4" /> Mark as Sent</>}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Director Review checklist ──
            Full review workflow surface, identical to the Dashboard review
            queue. Hidden once every step is done so it doesn't clutter a
            fully-closed incident. */}
        {(() => {
          const reviewSteps = getReviewSteps(incident, user?.role as any);
          if (reviewSteps.every(s => s.done)) return null;
          return (
            <ReviewProgress
              steps={reviewSteps}
              isDark={isDark}
              busy={reviewBusy}
              onMarkReviewed={handleMarkReviewed}
              onGenerateReport={() => openPdfPicker('final')}
              onSendToCustomer={handleOpenSendDialog}
              onCloseIncident={handleCloseFromChecklist}
            />
          );
        })()}

        <div className="grid gap-6">

          {/* ── General Information ── */}
          <Card>
            <CardHeader><CardTitle>General Information</CardTitle></CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-4">
              <Field label="Customer" value={customerDisplay} />
              <Field label="District" value={districtDisplay} />
              <Field label="Date" value={fmtLocalDate(incident.date_incident)} />
              <Field label="Status" value={incident.incident_status} />
              <Field label="Operating Company" value={incident.operating_company} />
              <Field label="Field / Facility" value={incident.field_facility} />
              <Field label="Well Name" value={incident.well_name} />
              <Field label="Stage #" value={incident['stage#'] ?? incident.stage_number} />
              <Field label="SO #" value={incident['so#'] ?? incident.so_number} />
              <Field label="Field Visit">
                {incident.field_visit_id ? (
                  linkedVisitRowId ? (
                    <button
                      type="button"
                      onClick={() => navigate(`/field-visits/${linkedVisitRowId}`)}
                      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {incident.field_visit_id}
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <span>{incident.field_visit_id}</span>
                  )
                ) : (
                  <span className="text-gray-400">N/A</span>
                )}
              </Field>
              <Field label="QC Pallet / Build Slip">
                {incident.qc_pallet_id ? (
                  <button
                    type="button"
                    onClick={() => navigate(`/qc/${incident.qc_pallet_id}`)}
                    className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    {incident.qc_build_no || incident.qc_pallet_id}
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <span className="text-gray-400">N/A</span>
                )}
              </Field>
              <Field label="Report Version" value={incident.report_version} />
            </CardContent>
          </Card>

          {/* ── Personnel ── */}
          <Card>
            <CardHeader><CardTitle>Personnel</CardTitle></CardHeader>
            <CardContent className="grid md:grid-cols-3 gap-4">
              <Field label="XC Representative" value={incident.xc_rep} />
              <Field label="XC District" value={incident.xc_district} />
              <Field label="Customer Representative" value={incident.customer_rep} />
              <Field label="EP Representative" value={incident.ep_rep} />
            </CardContent>
          </Card>

          {/* ── Technical Details ── */}
          <Card>
            <CardHeader><CardTitle>Technical Details</CardTitle></CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-4">
              <Field label="Product Line" value={incident.product_line} />
              <Field label="Firing System" value={incident.firing_system} />
              <Field label="Event Category" value={incident.event_category} />
              <Field label="Severity" value={incident.incident_severity} />
              <Field label="Failed Component" value={resolvedFailedComponent} />
              <Field label="Failure Type" value={resolvedFailureType} />
              <Field label="Vendor" value={resolvedVendor} />
              <Field label="Vendor Caused" value={incident.vendor_caused} />
              <div className="md:col-span-2">
                <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-1">XC Caused</p>
                <XcCausedBadge caused={incident.xc_caused} />
              </div>
            </CardContent>
          </Card>

          {/* ── AI Summary ── */}
          {incident.ai_summary && (
            <Card>
              <CardHeader><CardTitle>AI Summary</CardTitle></CardHeader>
              <CardContent>
                <TextBlock label="" value={incident.ai_summary} />
              </CardContent>
            </Card>
          )}

          {/* ── Incident Narrative ── */}
          {(incident.incident_description || incident.investigation || incident.root_cause) && (
            <Card>
              <CardHeader><CardTitle>Incident Narrative</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <TextBlock label="Incident Description" value={incident.incident_description} />
                <TextBlock label="Investigation Findings" value={incident.investigation} />
                <TextBlock label="Root Cause" value={incident.root_cause} />
              </CardContent>
            </Card>
          )}

          {/* ── Corrective & Preventive Actions ── */}
          {(incident.corrective_action || incident.preventive_action || incident.action_assigned_to || incident.action_due_date || incident.action_status) && (
            <Card>
              <CardHeader><CardTitle>Corrective &amp; Preventive Actions</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <TextBlock label="Corrective Action" value={incident.corrective_action} />
                <TextBlock label="Preventive Action" value={incident.preventive_action} />
                <div className="grid md:grid-cols-3 gap-4 pt-2">
                  <Field label="Assigned To" value={incident.action_assigned_to} />
                  <Field label="Due Date" value={incident.action_due_date ? fmtLocalDate(incident.action_due_date) : null} />
                  <Field label="Action Status" value={(() => {
                    const a = normalizeActionStatus(incident.action_status);
                    return a ? ACTION_STATUS_LABELS[a] : incident.action_status;
                  })()} />
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Closure ── */}
          {(incident.closed_date || incident.closed_by) && (
            <Card>
              <CardHeader><CardTitle>Closure</CardTitle></CardHeader>
              <CardContent className="grid md:grid-cols-2 gap-4">
                <Field label="Closed Date" value={incident.closed_date ? fmtLocalDate(incident.closed_date) : null} />
                <Field label="Closed By" value={incident.closed_by} />
              </CardContent>
            </Card>
          )}

          {/* ── Notes ── */}
          {incident.notes && (
            <Card>
              <CardHeader><CardTitle>Additional Notes</CardTitle></CardHeader>
              <CardContent>
                <TextBlock label="" value={incident.notes} />
              </CardContent>
            </Card>
          )}

          {/* ── Review & Tracking ── surfaces remaining columns so the view is
              complete (review trail, Slack/source metadata, identifiers). */}
          {(incident.reviewed_by || incident.reviewed_at || incident.event_id ||
            slackUrl || incident.slack_channel || incident.slack_ts) && (
            <Card>
              <CardHeader><CardTitle>Review &amp; Tracking</CardTitle></CardHeader>
              <CardContent className="grid md:grid-cols-2 gap-4">
                <Field label="Event ID" value={incident.event_id} />
                <Field label="Reviewed By" value={incident.reviewed_by} />
                <Field label="Reviewed At" value={incident.reviewed_at ? safeFmtDate(incident.reviewed_at, 'MMM d, yyyy h:mm a') : null} />
                <Field label="Report Sent" value={incident.report_sent ? safeFmtDate(incident.report_sent, 'MMM d, yyyy') : null} />
                <Field label="Slack Channel" value={incident.slack_channel} />
                <Field label="Slack Thread">
                  {slackUrl ? (
                    <a
                      href={slackUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[#4A154B] dark:text-[#d9a3db] hover:underline"
                    >
                      <SlackIcon className="w-3.5 h-3.5" /> Open thread
                    </a>
                  ) : null}
                </Field>
              </CardContent>
            </Card>
          )}

          {/* ── Evidence Images (polymorphic) ── */}
          {incident?.row_id && (
            <Card>
              <CardHeader>
                <CardTitle>Evidence Images</CardTitle>
              </CardHeader>
              <CardContent>
                <ImageUpload
                  parentTable="incidents"
                  parentRowId={incident.row_id}
                  baseUrl={`https://${projectId}.supabase.co/functions/v1/make-server-64775d98`}
                  publicAnonKey={publicAnonKey}
                  autoLoad
                  maxImages={20}
                />
              </CardContent>
            </Card>
          )}

          {/* ── Activity Timeline ── */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-gray-500" />
                Activity Timeline
              </CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setUpdateDialogOpen(true)}
                disabled={!incident?.event_id}
              >
                <Plus className="w-4 h-4 mr-1" />
                Add Update
              </Button>
            </CardHeader>
            <CardContent>
              {updatesLoading ? (
                <p className="text-sm text-gray-400">Loading…</p>
              ) : updates.length === 0 ? (
                <p className="text-sm text-gray-400 italic">
                  No activity recorded for this incident yet.
                </p>
              ) : (
                <ol className="relative border-l border-gray-200 dark:border-gray-700 ml-2 space-y-6">
                  {updates.map((u: any) => (
                    <li key={u.row_id} className="ml-4">
                      <div className="absolute -left-1.5 mt-1.5 w-3 h-3 rounded-full border border-white bg-gray-400" />
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <time className="text-xs text-gray-500">
                          {safeFmtDate(u.update_date, 'MMM d, yyyy h:mm a')}
                        </time>
                        {u.update_type && (
                          <Badge variant="outline" className="text-xs">{u.update_type}</Badge>
                        )}
                        {u.updated_by && (
                          <span className="text-xs text-gray-600 dark:text-gray-400">by {u.updated_by}</span>
                        )}
                      </div>
                      {u.note && (
                        <p className="text-sm text-gray-700 dark:text-gray-200 mt-1 whitespace-pre-wrap">{u.note}</p>
                      )}
                      {parseSlackUrl(u.slack_url) && (
                        <a
                          href={parseSlackUrl(u.slack_url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline mt-1"
                        >
                          View Slack thread
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          {/* ── Reports ── */}
          <Card>
            <CardHeader><CardTitle>Reports</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(['preliminary', 'final'] as const).map(version => {
                const slot   = pdfs[version];
                const has    = !!(slot.row || slot.legacyUrl);
                const isLegacyOnly = !slot.row && !!slot.legacyUrl;
                const isAppSheetOriginal = slot.row?.report_type === 'AppSheet Original';
                const label  = version === 'preliminary' ? 'Preliminary' : 'Final';
                const genKey = `${incident.row_id}-${version}`;
                const color  = version === 'preliminary' ? 'amber' : 'blue';
                const status = !has
                  ? 'Not yet generated'
                  : isLegacyOnly
                    ? 'Local-only — regenerate to share with team'
                    : isAppSheetOriginal
                      ? 'Original report from AppSheet'
                      : 'Saved in shared storage';
                // For migrated AppSheet originals, keep the source file name
                // (and its real extension) on download.
                const downloadName = isAppSheetOriginal && slot.row?.file_name
                  ? slot.row.file_name
                  : `Incident_${incident.event_id}_${label}.pdf`;
                return (
                  <div key={version} className="flex items-center gap-3 px-4 py-3 rounded-lg border dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <span className={`inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold shrink-0
                      ${color === 'amber' ? 'bg-amber-100 text-amber-700 border border-amber-300' : 'bg-blue-100 text-blue-700 border border-blue-300'}`}>
                      {label[0]}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">{label} Report</p>
                      <p className="text-xs text-gray-400">{status}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {has && (
                        <>
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1"
                            onClick={() => previewReport(slot)}>
                            <Eye className="w-3 h-3" /> Preview
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1"
                            onClick={() => downloadReport(slot, downloadName)}>
                            <Download className="w-3 h-3" /> Download
                          </Button>
                        </>
                      )}
                      <Button size="sm"
                        variant={has ? 'outline' : 'default'}
                        className={`h-7 px-2 text-xs gap-1 ${!has ? 'bg-gray-900 text-white hover:bg-gray-800' : ''}`}
                        disabled={generatingPDF === genKey}
                        onClick={() => openPdfPicker(version)}>
                        {generatingPDF === genKey
                          ? <><RefreshCw className="w-3 h-3 animate-spin" /> Generating…</>
                          : <><FileText className="w-3 h-3" />{has ? 'Regenerate' : 'Generate'}</>}
                      </Button>
                    </div>
                  </div>
                );
              })}

              {/* Stored reports (AppSheet originals — generated preliminary/final are
                  rendered above and excluded here) */}
              {archiveReports.length > 0 && (
                <div className="pt-2 mt-2 border-t border-gray-100 dark:border-gray-700">
                  <p className="text-xs font-semibold uppercase text-gray-500 mb-2">
                    Archive ({archiveReports.length})
                  </p>
                  <div className="space-y-2">
                    {archiveReports.map((r) => {
                      const isAppSheet = r.report_type === 'AppSheet Original';
                      return (
                        <div key={r.row_id} className="flex items-center gap-3 px-4 py-2 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-800/40">
                          <span
                            className={`inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold shrink-0 ${
                              isAppSheet
                                ? 'bg-gray-100 text-gray-600 border border-gray-300'
                                : r.report_type === 'Final'
                                ? 'bg-blue-100 text-blue-700 border border-blue-300'
                                : 'bg-amber-100 text-amber-700 border border-amber-300'
                            }`}
                          >
                            {isAppSheet ? 'A' : r.report_type[0]}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">
                              {r.report_type}
                              {r.file_name && (
                                <span className="text-xs text-gray-400 font-normal ml-2">
                                  {r.file_name}
                                </span>
                              )}
                            </p>
                            {r.generated_at && (
                              <p className="text-xs text-gray-400">
                                {safeFmtDate(r.generated_at, 'MMM d, yyyy')}
                                {r.generated_by && ` • ${r.generated_by}`}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs gap-1"
                              onClick={() => previewReport({ row: r })}
                            >
                              <Eye className="w-3 h-3" /> Preview
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs gap-1"
                              onClick={() => downloadReport(
                                { row: r },
                                r.file_name || `Incident_${incident.event_id}_${r.report_type}.pdf`,
                              )}
                            >
                              <Download className="w-3 h-3" /> Download
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Report Sent */}
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg border dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Report Sent to Customer</p>
                  {incident.report_sent
                    ? <p className="text-xs text-emerald-600">Sent {safeFmtDate(incident.report_sent, 'MMMM d, yyyy')}</p>
                    : <p className="text-xs text-gray-400">Not yet sent</p>}
                </div>
                <Button size="sm" variant="outline"
                  disabled={!canMarkReportSent(user?.role as any)}
                  title={!canMarkReportSent(user?.role as any) ? 'Only admins can mark a report as sent' : undefined}
                  className={`h-7 px-3 text-xs gap-1 ${incident.report_sent ? 'text-red-600 border-red-200 hover:bg-red-50' : 'text-emerald-700 border-emerald-200 hover:bg-emerald-50'}`}
                  onClick={handleToggleReportSent}>
                  {incident.report_sent
                    ? <><X className="w-3 h-3" /> Mark Unsent</>
                    : <><Send className="w-3 h-3" /> Mark as Sent</>}
                </Button>
              </div>
            </CardContent>
          </Card>

        </div>
      </div>

      {/* ── Edit Form ── */}
      <IncidentForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); loadAll(); }}
        incident={incident}
        currentUser={user}
      />

      {/* ── PDF Image Picker ── */}
      {pickerVersion && incident?.row_id && (
        <IncidentPdfImagePicker
          open={pickerOpen}
          onClose={() => { setPickerOpen(false); setPickerVersion(null); }}
          incidentRowId={incident.row_id}
          baseUrl={`https://${projectId}.supabase.co/functions/v1/make-server-64775d98`}
          publicAnonKey={publicAnonKey}
          actionLabel={pickerVersion === 'preliminary'
            ? 'Generate Preliminary Report'
            : 'Generate Final Report'}
          generating={generatingPDF === `${incident.row_id}-${pickerVersion}`}
          onConfirm={(selected) => handleGeneratePDF(pickerVersion, selected)}
        />
      )}

      {/* ── PDF Preview Modal ── */}
      <Dialog open={pdfPreviewOpen} onOpenChange={setPdfPreviewOpen}>
        <DialogContent className="max-w-5xl max-h-[95vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 py-4 border-b shrink-0">
            <DialogTitle className="flex items-center justify-between pr-8">
              <span className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-gray-500" />
                Report Preview
              </span>
              <a href={pdfPreviewUrl} download className="mr-2">
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5">
                  <Download className="w-3 h-3" /> Download PDF
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

      {/* ── Add Update Dialog ── */}
      <Dialog open={updateDialogOpen} onOpenChange={setUpdateDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Timeline Update</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1 block">
                Update Type
              </Label>
              <select
                value={updateType}
                onChange={(e) => setUpdateType(e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md p-2 text-sm"
              >
                {UPDATE_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1 block">
                Note <span className="text-red-500">*</span>
              </Label>
              <Textarea
                rows={5}
                value={updateNote}
                onChange={(e) => setUpdateNote(e.target.value)}
                placeholder="What's the update? Investigation finding, action taken, status change, etc."
                autoFocus
              />
            </div>
            <div className="text-xs text-gray-500">
              Posting as <span className="font-medium">{user?.name || user?.email || 'Unknown'}</span>
            </div>
            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
              <Button
                type="button"
                variant="outline"
                onClick={() => setUpdateDialogOpen(false)}
                disabled={savingUpdate}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleSubmitUpdate}
                disabled={savingUpdate || !updateNote.trim()}
              >
                {savingUpdate ? 'Saving…' : 'Add Update'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Send to Customer Dialog ── */}
      <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Send Incident Report to Customer</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="text-sm text-gray-600 dark:text-gray-300">
              The current final PDF will be re-generated and emailed to the
              recipients below. The send is recorded on this incident for audit.
            </div>
            <div>
              <Label className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1 block">
                Recipient email(s) <span className="text-red-500">*</span>
              </Label>
              <Input
                type="text"
                value={sendRecipient}
                onChange={(e) => setSendRecipient(e.target.value)}
                placeholder="customer@example.com, another@example.com"
                autoFocus
              />
              <p className="text-xs text-gray-400 mt-1">
                Separate multiple addresses with commas.
              </p>
            </div>
            <div>
              <Label className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1 block">
                Optional message
              </Label>
              <Textarea
                rows={4}
                value={sendMessage}
                onChange={(e) => setSendMessage(e.target.value)}
                placeholder="Optional note to include in the email body."
              />
            </div>
            {incident?.report_sent && (
              <div className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700 rounded-md p-2">
                Last sent {safeFmtDate(incident.report_sent, 'MMM d, yyyy h:mm a')}
                {incident.report_sent_to && <> to <span className="font-medium">{incident.report_sent_to}</span></>}
                {incident.report_sent_by && <> by {incident.report_sent_by}</>}.
              </div>
            )}
            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
              <Button type="button" variant="outline"
                onClick={() => setSendDialogOpen(false)}
                disabled={sendingReport}>
                Cancel
              </Button>
              <Button type="button"
                onClick={handleSendToCustomer}
                disabled={sendingReport || !sendRecipient.trim()}>
                {sendingReport ? 'Sending…' : 'Send Report'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
