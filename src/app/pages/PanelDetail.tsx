import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useAuth } from '../lib/auth-context';
import { detailApi, panelApi, panelFileApi } from '../lib/api';
import { supabase } from '../lib/supabase';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Combobox } from '../components/ui/combobox';
import { Textarea } from '../components/ui/textarea';
import { ArrowLeft, Pencil, Save, X, Loader2, History, PackageCheck, PackageX, FileDown, Eye, Paperclip, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import ImageUpload from '../components/ImageUpload';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import { XC_PANEL_BASES } from '../lib/xcLocations';
import { generateRepairFailureReportPDF } from '../lib/generateRepairFailureReportPDF';
import PanelForm from './forms/PanelForm';

// ── Option arrays ──────────────────────────────────────────────────────────────
const PANEL_TYPE_OPTS = [
  'Surface Tester',
  'Master Safe Panel',
  'Digital Shooting Panel',
  'P1000',
  'P2000',
  'P2500',
  'Toolstring Simulator',
  'Pressure Box',
];

const PANEL_STATUS_OPTS = [
  'At Facility',
  'Leased',
  'In Repair',
  'Loaned',
  'Sold',
  'Shipped',
];

// Statuses where a panel is out with a customer / off-site and can be returned
// to a XC facility. 'Sold' is excluded (goes to a customer permanently) and
// 'At Facility' is excluded (already home). Returning auto-sets 'At Facility'.
const RETURNABLE_STATUSES = ['Leased', 'Loaned', 'In Repair'];
const RETURNED_STATUS = 'At Facility';

const XC_BASE_OPTS = XC_PANEL_BASES; // shared list (Denver kept for Panels inventory)
const YES_NO_OPTS = ['Yes', 'No'];
const YN_OPTS = ['Y', 'N'];

// Conditional field rules (identical to PanelForm)
const GUI_TYPES    = ['P1000', 'P2000', 'P2500'];
const GUI_STATUSES = ['Leased', 'Loaned'];
const showPlusPanel  = (type: string) => type === 'P2500';
const showGui        = (type: string, status: string) => GUI_TYPES.includes(type) && GUI_STATUSES.includes(status);
const showSurfaceFw  = (type: string) => type === 'Surface Tester';
const showShootingFw = (type: string) => type === 'Digital Shooting Panel';

// ── Carrier tracking link ───────────────────────────────────────────────────────
// Turns a raw tracking value (bare number — usually FedEx — or a full URL) into a
// clickable carrier tracking URL. Returns null when there's nothing to link to.
function buildTrackingUrl(raw: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const t = trimmed.replace(/[\s-]/g, '');
  const enc = encodeURIComponent(t);

  if (/^1Z[0-9A-Z]{16}$/i.test(t)) return `https://www.ups.com/track?tracknum=${enc}`;
  if (/^(\d{20,22}|\d{13}|[A-Z]{2}\d{9}US)$/i.test(t)) {
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${enc}`;
  }
  // Default / fallback — user is ~99% FedEx.
  return `https://www.fedex.com/fedextrack/?trknbr=${enc}`;
}

// Renders the raw tracking value as a clickable carrier link (falls back to plain
// text if it can't be turned into a URL).
function TrackingLink({ value, className }: { value: string; className?: string }) {
  const url = buildTrackingUrl(value);
  if (!url) {
    return <span className={className}>{value}</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`text-blue-600 hover:underline inline-flex items-center gap-1 ${className ?? ''}`}
    >
      {value}
      <ExternalLink className="w-3.5 h-3.5" />
    </a>
  );
}

// ── Field helper ───────────────────────────────────────────────────────────────
interface FieldProps {
  label: string;
  value: React.ReactNode;
  editing?: boolean;
  children?: React.ReactNode; // edit control
}

function Field({ label, value, editing = false, children }: FieldProps) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      {editing && children ? (
        children
      ) : (
        <p className="text-sm text-gray-900 dark:text-gray-100">{value || '—'}</p>
      )}
    </div>
  );
}

// ── Status badge color ─────────────────────────────────────────────────────────
function getStatusColor(status: string) {
  switch (status?.toLowerCase()) {
    case 'at facility': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300';
    case 'leased': return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
    case 'in repair': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300';
    case 'loaned': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300';
    case 'sold': return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    case 'shipped': return 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300';
    // legacy values kept for backwards compat
    case 'installed': return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
    case 'in stock': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300';
    case 'in transit': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300';
    case 'maintenance': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300';
    default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
  }
}

// ── Select helper ──────────────────────────────────────────────────────────────
function Sel({
  value,
  onChange,
  opts,
  placeholder = '',
}: {
  value: string;
  onChange: (v: string) => void;
  opts: string[];
  placeholder?: string;
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {opts.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function PanelDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { accessToken, user } = useAuth();

  const [panel, setPanel] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Mark-Returned hero action state (optional overrides before confirming).
  const [returning, setReturning] = useState(false);
  const [returnDateInput, setReturnDateInput] = useState('');
  const [returnNotesInput, setReturnNotesInput] = useState('');
  const [seenSaving, setSeenSaving] = useState(false);

  // Return-to-Manufacturer (RMA) action state + controlled form inputs.
  const [returningMfr, setReturningMfr] = useState(false);
  const [mfrNameInput, setMfrNameInput] = useState('AWS');
  const [mfrRmaInput, setMfrRmaInput] = useState('');
  const [mfrShipDateInput, setMfrShipDateInput] = useState('');
  const [mfrTrackingInput, setMfrTrackingInput] = useState('');
  const [failureDescInput, setFailureDescInput] = useState('');
  const [failureDateInput, setFailureDateInput] = useState('');
  const [failureReportedByInput, setFailureReportedByInput] = useState('');

  // Change history (field-level diffs from panel_change_log).
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  // Global id -> name maps so FK changes (customer/district) render readable
  // values, including historical ones no longer tied to the current customer.
  const [nameMap, setNameMap] = useState<Record<string, string>>({});

  useEffect(() => {
    loadPanel();
  }, [id]);

  const loadPanel = async () => {
    if (!id || !accessToken) {
      setLoading(false);
      return;
    }
    try {
      const data = await detailApi.getPanel(id, accessToken);
      setPanel(data);
      return data;
    } catch (error: any) {
      console.error('Error loading panel:', error);
      toast.error('Failed to load panel details');
    } finally {
      setLoading(false);
    }
  };

  // Build a global id -> name map for customers + districts so FK changes in
  // the change history (which store raw ids) render as readable names.
  useEffect(() => {
    if (!accessToken) return;
    Promise.all([
      supabase.from('customers').select('row_id,customer'),
      supabase.from('districts').select('row_id,customer_district'),
    ]).then(([c, d]) => {
      const m: Record<string, string> = {};
      (c.data || []).forEach((r: any) => { if (r.row_id) m[r.row_id] = r.customer; });
      (d.data || []).forEach((r: any) => { if (r.row_id) m[r.row_id] = r.customer_district; });
      setNameMap(m);
    });
  }, [accessToken]);

  // Load the change history for this panel (by row_id, falling back to serial
  // so edits made before a row_id existed still surface). Routed through the
  // server API (service-role client) instead of the browser anon client: RLS on
  // panel_change_log otherwise returns zero rows silently, leaving the section
  // empty with no error.
  const loadHistory = async () => {
    if (!panel?.row_id || !accessToken) return;
    setHistoryLoading(true);
    try {
      const data = await detailApi.getPanelHistory(panel.row_id, panel.serial_number, accessToken);
      setHistory(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error loading panel history:', err);
      toast.error('Failed to load change history');
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
    // Reload after a save so the new diffs show without a full page refresh.
  }, [panel?.row_id, accessToken]);

  // FK fields whose stored value is an id we should resolve to a name.
  const FK_FIELDS = new Set(['customer', 'customer_district']);
  const displayValue = (field: string, value: string | null): string => {
    if (value === null || value === '') return '—';
    if (FK_FIELDS.has(field)) return nameMap[value] || value;
    return value;
  };
  const fmtWhen = (iso: string): string => {
    // Legacy snapshots with no parseable date were stamped with a sentinel of
    // 2000-01-01; show those as undated rather than a misleading timestamp.
    if (iso && iso.startsWith('2000-01-01')) return 'Legacy (date unknown)';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };

  // Open the full-page editor. Editing now routes through the shared PanelForm
  // (variant="page") via the early return below, so the panel detail and the
  // create/quick-add modal enforce the SAME required-field validation. The old
  // hand-rolled inline editor (which skipped all required-field checks) is gone.
  const handleEdit = () => {
    if (!panel) return;
    setEditing(true);
  };

  // ── Mark Returned ──────────────────────────────────────────────────────────
  // One-tap action: panel has come back to a XC facility. Stamps the returned
  // date (today by default, overridable), records who confirmed it + optional
  // notes, and auto-flips panel_status to 'At Facility'. Only offered for panels
  // that are out in the field (Leased / Loaned / In Repair).
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const handleMarkReturned = async () => {
    if (!id || !accessToken || !panel) return;
    setSaving(true);
    try {
      const who = user?.name || user?.email || null;
      const payload: Record<string, any> = {
        // Carry forward all existing values so the targeted update doesn't blank
        // unrelated columns (the edge PUT writes the whole object).
        panel_type: panel.panel_type ?? null,
        plus_panel: panel.plus_panel ?? null,
        serial_number: panel.serial_number ?? null,
        shootingfw: panel.shootingfw ?? null,
        wl_controlfw: panel.wl_controlfw ?? null,
        loggingfw: panel.loggingfw ?? null,
        surfacefw: panel.surfacefw ?? null,
        received_date: panel.received_date ?? null,
        xc_base: panel.xc_base ?? null,
        'so#': panel['so#'] ?? null,
        tracking_info: panel.tracking_info ?? null,
        comments: panel.comments ?? null,
        rma: panel.rma ?? null,
        activity: panel.activity ?? 'N',
        // Return workflow + auto-status.
        panel_status: RETURNED_STATUS,
        returned_date: returnDateInput || todayISO(),
        return_notes: returnNotesInput || null,
        return_confirmed_by: who,
        updated_by: who,
        date_updated: new Date().toLocaleDateString(),
        // At-Facility transition: clear customer/assignment fields and reset
        // verified/is_spare (mirrors handleSave + edge net).
        customer: null,
        customer_district: null,
        operating_company: null,
        unit_number: null,
        gui_version: null,
        verified: 'Y',
        is_spare: 'No',
      };
      await panelApi.update(id, payload, accessToken);
      toast.success(`Panel returned — status set to ${RETURNED_STATUS}`);
      setReturning(false);
      setReturnDateInput('');
      setReturnNotesInput('');
      await loadPanel();
      await loadHistory();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to mark panel returned');
    } finally {
      setSaving(false);
    }
  };

  // ── Repair Complete / Return ────────────────────────────────────────────────
  // An In-Repair panel comes back from the manufacturer. Returns it to a XC
  // facility (status 'At Facility') AND clears all RMA + repair fields. Mirrors
  // handleMarkReturned's full carry-forward + At-Facility clearing, then layers
  // the RMA/repair clearing on top. The edge net repeats this server-side so the
  // cleared values land in the change log.
  const handleRepairComplete = async () => {
    if (!id || !accessToken || !panel) return;
    setSaving(true);
    try {
      const who = user?.name || user?.email || null;
      const payload: Record<string, any> = {
        // Carry forward unrelated columns so the whole-object PUT doesn't blank
        // them (mirrors handleMarkReturned).
        panel_type: panel.panel_type ?? null,
        plus_panel: panel.plus_panel ?? null,
        serial_number: panel.serial_number ?? null,
        shootingfw: panel.shootingfw ?? null,
        wl_controlfw: panel.wl_controlfw ?? null,
        loggingfw: panel.loggingfw ?? null,
        surfacefw: panel.surfacefw ?? null,
        received_date: panel.received_date ?? null,
        xc_base: panel.xc_base ?? null,
        'so#': panel['so#'] ?? null,
        comments: panel.comments ?? null,
        activity: panel.activity ?? 'N',
        return_notes: panel.return_notes ?? null,
        // Return workflow + auto-status.
        panel_status: RETURNED_STATUS,
        returned_date: todayISO(),
        return_confirmed_by: who,
        updated_by: who,
        date_updated: new Date().toLocaleDateString(),
        // At-Facility clearing (same as handleMarkReturned).
        customer: null,
        customer_district: null,
        operating_company: null,
        unit_number: null,
        gui_version: null,
        verified: 'Y',
        is_spare: 'No',
        // RMA + repair clearing (repair complete).
        rma: null,
        failure_description: null,
        failure_date: null,
        failure_reported_by: null,
        mfr_rma_date: null,
        tracking_info: null,
        shipped_date: null,
      };
      await panelApi.update(id, payload, accessToken);
      toast.success('Repair complete — panel returned to At Facility');
      setMfrNameInput('');
      setMfrRmaInput('');
      setMfrShipDateInput('');
      setMfrTrackingInput('');
      setFailureDescInput('');
      setFailureDateInput('');
      setFailureReportedByInput('');
      await loadPanel();
      await loadHistory();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to complete repair');
    } finally {
      setSaving(false);
    }
  };

  // ── Return to Manufacturer (RMA) ────────────────────────────────────────────
  // A failed panel ships back to the manufacturer (default "AWS"). Mirrors
  // handleMarkReturned's full carry-forward pattern (the edge PUT writes the
  // whole object) but sets status to 'In Repair' and stamps RMA / ship / failure
  // fields. The failure data persists in the 4 dedicated columns.
  const handleReturnToManufacturer = async () => {
    if (!id || !accessToken || !panel) return;
    setSaving(true);
    try {
      const who = user?.name || user?.email || null;
      const shipDate = mfrShipDateInput || todayISO();
      const payload: Record<string, any> = {
        // Carry forward all existing values so the whole-object PUT doesn't blank
        // unrelated columns.
        panel_type: panel.panel_type ?? null,
        plus_panel: panel.plus_panel ?? null,
        serial_number: panel.serial_number ?? null,
        shootingfw: panel.shootingfw ?? null,
        wl_controlfw: panel.wl_controlfw ?? null,
        loggingfw: panel.loggingfw ?? null,
        gui_version: panel.gui_version ?? null,
        surfacefw: panel.surfacefw ?? null,
        received_date: panel.received_date ?? null,
        xc_base: panel.xc_base ?? null,
        unit_number: panel.unit_number ?? null,
        'so#': panel['so#'] ?? null,
        comments: panel.comments ?? null,
        verified: panel.verified ?? 'N',
        is_spare: panel.is_spare ?? null,
        customer_district: panel.customer_district ?? null,
        operating_company: panel.operating_company ?? null,
        customer: panel.customer ?? null,
        activity: panel.activity ?? 'N',
        returned_date: panel.returned_date ?? null,
        return_notes: panel.return_notes ?? null,
        return_confirmed_by: panel.return_confirmed_by ?? null,
        // Manufacturer-return workflow.
        panel_status: 'In Repair',
        // RMA is auto-assigned server-side (next RMA_NNN in sequence). Send empty
        // so the edge's !body.rma branch fires and generates the number.
        rma: '',
        shipped_date: shipDate,
        tracking_info: mfrTrackingInput || panel.tracking_info || null,
        mfr_rma_date: shipDate,
        failure_description: failureDescInput || null,
        failure_date: failureDateInput || null,
        failure_reported_by: failureReportedByInput || who,
        updated_by: who,
        date_updated: new Date().toLocaleDateString(),
      };
      await panelApi.update(id, payload, accessToken);
      toast.success(`Panel marked In Repair — returned to ${mfrNameInput || 'manufacturer'}`);
      setReturningMfr(false);
      const fresh = await loadPanel();
      await loadHistory();

      // Auto-save the failure report to the panel's files. Never let an upload
      // failure break the return flow — soft-warn at most.
      const p = fresh || panel;
      try {
        const { blob, filename } = await generateRepairFailureReportPDF({
          mode: 'blob',
          manufacturer: mfrNameInput || 'AWS',
          rma: p?.rma || mfrRmaInput || undefined,
          shipDate: mfrShipDateInput || p?.shipped_date || undefined,
          trackingInfo: mfrTrackingInput || p?.tracking_info || undefined,
          panel: {
            serial_number: p?.serial_number,
            panel_type: p?.panel_type,
            unit_number: p?.unit_number,
            panel_status: p?.panel_status,
            xc_base: p?.xc_base,
            shootingfw: p?.shootingfw,
            wl_controlfw: p?.wl_controlfw,
            loggingfw: p?.loggingfw,
            surfacefw: p?.surfacefw,
            gui_version: p?.gui_version,
            received_date: p?.received_date,
          },
          failureDescription: failureDescInput || p?.failure_description || undefined,
          failureDate: failureDateInput || p?.failure_date || undefined,
          reportedBy: failureReportedByInput || p?.failure_reported_by || user?.name || user?.email || undefined,
        });
        if (blob && p?.row_id) {
          const file = new File([blob], filename, { type: 'application/pdf' });
          await panelFileApi.upload(p.row_id, file, 'failure_report', accessToken);
          toast.success('Failure report saved to panel files');
        }
      } catch (e) {
        console.error('auto-save failure report failed', e);
      }
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to return panel to manufacturer');
    } finally {
      setSaving(false);
    }
  };

  // Build & download the Repair / Failure Report PDF from the current form inputs
  // (falling back to stored panel values).
  const handleDownloadFailureReport = async () => {
    if (!panel) return;
    try {
      await generateRepairFailureReportPDF({
        manufacturer: mfrNameInput || 'AWS',
        rma: mfrRmaInput || panel.rma || undefined,
        shipDate: mfrShipDateInput || panel.shipped_date || undefined,
        trackingInfo: mfrTrackingInput || panel.tracking_info || undefined,
        panel: {
          serial_number: panel.serial_number,
          'serial#': panel['serial#'],
          panel_type: panel.panel_type,
          unit_number: panel.unit_number,
          panel_status: panel.panel_status,
          xc_base: panel.xc_base,
          shootingfw: panel.shootingfw,
          wl_controlfw: panel.wl_controlfw,
          loggingfw: panel.loggingfw,
          surfacefw: panel.surfacefw,
          gui_version: panel.gui_version,
          received_date: panel.received_date,
        },
        failureDescription: failureDescInput || panel.failure_description || undefined,
        failureDate: failureDateInput || panel.failure_date || undefined,
        reportedBy: failureReportedByInput || panel.failure_reported_by || user?.name || user?.email || undefined,
      });
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to generate report');
    }
  };

  // Download the Repair / Failure Report sourced purely from stored panel.*
  // values (no mfr form inputs — they don't exist once the panel is In Repair).
  const handleDownloadFailureReportFromPanel = async () => {
    if (!panel) return;
    try {
      await generateRepairFailureReportPDF({
        manufacturer: 'AWS',
        rma: panel.rma || undefined,
        shipDate: panel.shipped_date || undefined,
        trackingInfo: panel.tracking_info || undefined,
        panel: {
          serial_number: panel.serial_number,
          'serial#': panel['serial#'],
          panel_type: panel.panel_type,
          unit_number: panel.unit_number,
          panel_status: panel.panel_status,
          xc_base: panel.xc_base,
          shootingfw: panel.shootingfw,
          wl_controlfw: panel.wl_controlfw,
          loggingfw: panel.loggingfw,
          surfacefw: panel.surfacefw,
          gui_version: panel.gui_version,
          received_date: panel.received_date,
        },
        failureDescription: panel.failure_description || undefined,
        failureDate: panel.failure_date || undefined,
        reportedBy: panel.failure_reported_by || undefined,
      });
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to generate report');
    }
  };

  // ── Attach an RMA document (PDF or image) to the panel's files ──────────────
  const rmaDocInputRef = useRef<HTMLInputElement>(null);
  const [rmaDocUploading, setRmaDocUploading] = useState(false);

  const handleRmaDocSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file || !panel?.row_id) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File is too large (max 10MB)');
      return;
    }
    setRmaDocUploading(true);
    try {
      await panelFileApi.upload(panel.row_id, file, 'rma_document', accessToken);
      toast.success('RMA document attached');
      await loadPanel();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to attach document');
    } finally {
      setRmaDocUploading(false);
    }
  };

  // Mark this panel as seen right now: sets verified='Y' and stamps the
  // last-seen audit trail (date = now, by = current user). Uses the dedicated
  // mark-seen route so it never touches other panel columns.
  const handleMarkSeen = async () => {
    if (!id || !accessToken || !panel) return;
    setSeenSaving(true);
    try {
      const who = user?.name || user?.email || null;
      await panelApi.markSeen(id, { seen_by: who, seen_date: new Date().toISOString(), visit_id: null }, accessToken);
      toast.success('Panel marked seen — Verified set to Y');
      await loadPanel();
      await loadHistory();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to mark panel seen');
    } finally {
      setSeenSaving(false);
    }
  };

  // ── Loading / not-found states ─────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-8">
        <div className="max-w-5xl mx-auto text-center py-12">Loading...</div>
      </div>
    );
  }

  if (!panel) {
    return (
      <div className="p-8">
        <div className="max-w-5xl mx-auto text-center py-12">
          <p className="text-gray-500 mb-4">Panel not found</p>
          <Button onClick={() => navigate('/panels')}>Back to Panels</Button>
        </div>
      </div>
    );
  }

  // ── Edit mode: render the SHARED PanelForm full-page ─────────────────────────
  // Placed AFTER all hooks (required by the Rules of Hooks). Editing the panel
  // reuses the exact same form — and therefore the exact same required-field
  // validation — as the create / quick-add modal, eliminating the divergence
  // where the old inline editor saved records the modal would have rejected.
  if (editing) {
    return (
      <PanelForm
        open
        variant="page"
        onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); loadPanel(); loadHistory(); }}
        panel={panel}
        currentUser={user}
      />
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Hero header */}
        <div className="rounded-xl border dark:border-slate-700 bg-gradient-to-br from-slate-50 to-white dark:from-slate-800 dark:to-slate-900 p-6 shadow-sm">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/panels')}
            className="mb-4 -ml-2"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Panels
          </Button>

          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {panel.serial_number || 'Panel Detail'}
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {panel.panel_type || 'Unknown type'} &mdash; {panel.xc_base || 'No base'}
              </p>
            </div>

            <div className="flex items-center gap-3 flex-shrink-0">
              <Badge className={getStatusColor(panel.panel_status)}>
                {panel.panel_status || 'Unknown'}
              </Badge>

              <Button
                size="sm"
                variant="outline"
                onClick={handleMarkSeen}
                disabled={seenSaving}
                title="Set Verified = Y and stamp last-seen now"
              >
                {seenSaving ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <Eye className="w-4 h-4 mr-1" />
                )}
                Mark Seen
              </Button>
              <Button size="sm" onClick={handleEdit}>
                <Pencil className="w-4 h-4 mr-1" />
                Edit
              </Button>
            </div>
          </div>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ── Main column ── */}
          <div className="lg:col-span-2 space-y-6">

            {/* Panel Information */}
            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle>Panel Information</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
                  {/* Panel Type is LOCKED after creation (PanelForm parity). */}
                  <Field label="Panel Type" value={panel.panel_type} />
                  <Field label="Panel Status" value={panel.panel_status} />
                  <Field label="Customer" value={panel.customerName} />
                  <Field label="District" value={panel.districtName} />
                  <Field label="Operating Company" value={panel.operating_company} />
                  <Field label="XC Base" value={panel.xc_base} />
                  <Field label="Unit Number" value={panel.unit_number} />
                  <Field label="SO #" value={panel['so#']} />
                  {/* Plus Panel — only applies to P2500 (PanelForm parity). */}
                  {showPlusPanel(panel.panel_type) && (
                    <Field label="Plus Panel" value={panel.plus_panel} />
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Firmware Versions */}
            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle>Firmware Versions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
                  {/* Shooting FW — only for Digital Shooting Panel (PanelForm parity). */}
                  {showShootingFw(panel.panel_type) && (
                    <Field label="Shooting FW" value={panel.shootingfw} />
                  )}
                  <Field label="WL Control FW" value={panel.wl_controlfw} />
                  <Field label="Logging FW" value={panel.loggingfw} />
                  {/* Surface FW — only for Surface Tester (PanelForm parity). */}
                  {showSurfaceFw(panel.panel_type) && (
                    <Field label="Surface FW" value={panel.surfacefw} />
                  )}
                  {/* GUI Version — only for GUI panel types in Leased/Loaned status. */}
                  {showGui(panel.panel_type, panel.panel_status) && (
                    <Field label="GUI Version" value={panel.gui_version} />
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Tracking & Status */}
            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle>Tracking &amp; Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
                  <Field label="RMA" value={panel.rma} />
                  <Field label="Is Spare?" value={panel.is_spare} />
                  <Field label="Verified" value={panel.verified} />
                  <Field
                    label="Last Seen"
                    value={panel.last_seen_date ? new Date(panel.last_seen_date).toLocaleDateString() : ''}
                  />
                  <Field label="Last Seen By" value={panel.last_seen_by} />
                  <Field label="Activity" value={panel.activity} />
                  <Field
                    label="Returned Date"
                    value={
                      panel.returned_date
                        ? new Date(panel.returned_date).toLocaleDateString()
                        : '—'
                    }
                  />
                  <Field label="Return Confirmed By" value={panel.return_confirmed_by} />
                  <Field label="Return Notes" value={panel.return_notes} />
                  {/* Ship Date — shown when the panel is Shipped. */}
                  {panel.panel_status === 'Shipped' && (
                    <Field
                      label="Ship Date"
                      value={
                        panel.shipped_date
                          ? new Date(panel.shipped_date).toLocaleDateString()
                          : '—'
                      }
                    />
                  )}
                  {/* Tracking — read-only clickable carrier link. Editable via the
                      Return-to-Manufacturer flow / form below. */}
                  <Field
                    label="Tracking"
                    value={
                      panel.tracking_info
                        ? <TrackingLink value={panel.tracking_info} />
                        : '—'
                    }
                  />
                </div>
              </CardContent>
            </Card>

            {/* Comments */}
            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle>Comments</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg min-h-[60px]">
                  <pre className="whitespace-pre-wrap text-sm text-gray-900 dark:text-gray-100 font-sans">
                    {panel.comments || '—'}
                  </pre>
                </div>
              </CardContent>
            </Card>

            {/* Change History — field-level diffs from panel_change_log. */}
            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <History className="w-4 h-4 text-gray-500" />
                  Change History
                </CardTitle>
              </CardHeader>
              <CardContent>
                {historyLoading ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading history…
                  </div>
                ) : history.length === 0 ? (
                  <p className="text-sm text-gray-500 py-4">
                    No changes recorded yet. Edits made from here on are tracked automatically.
                  </p>
                ) : (
                  <ol className="relative border-l border-gray-200 dark:border-gray-700 ml-2 space-y-4">
                    {history.map((h) => {
                      const isSnapshot = h.entry_type === 'snapshot';
                      return (
                        <li key={h.id} className="ml-4">
                          <span
                            className={`absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white dark:border-gray-900 ${isSnapshot ? 'bg-amber-400' : 'bg-blue-500'}`}
                          />
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                              {h.field_label}
                            </span>
                            {isSnapshot && (
                              <span className="text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                                Legacy
                              </span>
                            )}
                            <span className="text-xs text-gray-400">
                              {fmtWhen(h.changed_at)}
                              {h.changed_by ? ` · ${h.changed_by}` : ''}
                            </span>
                          </div>
                          {isSnapshot ? (
                            <div className="text-sm mt-0.5 text-gray-600 dark:text-gray-300 break-words">
                              {h.new_value || '—'}
                            </div>
                          ) : (
                            <div className="text-sm mt-0.5 flex flex-wrap items-center gap-1.5">
                              <span className="line-through text-gray-400 break-all">
                                {displayValue(h.field, h.old_value)}
                              </span>
                              <span className="text-gray-400">→</span>
                              <span className="font-medium text-gray-900 dark:text-gray-100 break-all">
                                {displayValue(h.field, h.new_value)}
                              </span>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </CardContent>
            </Card>

            {/* Images */}
            {panel?.row_id && (
              <Card className="rounded-xl">
                <CardHeader>
                  <CardTitle>Images</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ImageUpload
                    parentTable="panels"
                    parentRowId={panel.row_id}
                    baseUrl={`https://${projectId}.supabase.co/functions/v1/make-server-64775d98`}
                    publicAnonKey={publicAnonKey}
                    autoLoad
                    maxImages={10}
                  />
                </CardContent>
              </Card>
            )}
          </div>

          {/* ── Right sidebar ── */}
          <div className="space-y-6">

            {/* Mark Returned — hero action. Only for panels currently out in the
                field (Leased / Loaned / In Repair). Returning auto-sets the
                status to 'At Facility'. Sold panels never return. */}
            {!editing && panel.panel_status !== 'In Repair' && RETURNABLE_STATUSES.includes(panel.panel_status) && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-900 p-5 shadow-sm">
                <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
                  <PackageCheck className="w-4 h-4" />
                  <span className="text-xs font-semibold uppercase tracking-wide">
                    Panel Return
                  </span>
                </div>
                <p className="mt-2 text-sm text-blue-900/80 dark:text-blue-200/80">
                  Currently <span className="font-semibold">{panel.panel_status}</span>.
                  Mark it returned when it&rsquo;s back at a XC facility &mdash;
                  status will switch to <span className="font-semibold">{RETURNED_STATUS}</span>.
                </p>

                {!returning ? (
                  <Button
                    className="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={() => {
                      setReturnDateInput('');
                      setReturnNotesInput('');
                      setReturning(true);
                    }}
                  >
                    <PackageCheck className="w-4 h-4 mr-2" />
                    Mark Returned
                  </Button>
                ) : (
                  <div className="mt-4 space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-blue-900/70 dark:text-blue-200/70">
                        Returned Date (defaults to today)
                      </Label>
                      <Input
                        type="date"
                        value={returnDateInput}
                        onChange={(e) => setReturnDateInput(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-blue-900/70 dark:text-blue-200/70">
                        Return Notes
                      </Label>
                      <Textarea
                        rows={3}
                        value={returnNotesInput}
                        onChange={(e) => setReturnNotesInput(e.target.value)}
                        placeholder="Condition, who dropped it off, etc."
                      />
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => {
                          setReturning(false);
                          setReturnDateInput('');
                          setReturnNotesInput('');
                        }}
                        disabled={saving}
                      >
                        <X className="w-4 h-4 mr-1" />
                        Cancel
                      </Button>
                      <Button
                        className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                        onClick={handleMarkReturned}
                        disabled={saving}
                      >
                        {saving ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <PackageCheck className="w-4 h-4 mr-1" />
                        )}
                        Confirm Return
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Return to Manufacturer (RMA) — a failed panel ships back to the
                manufacturer (default AWS). Offered for any panel not Sold.
                Sets status to 'In Repair' and stamps RMA / failure fields. */}
            {!editing && panel.panel_status !== 'Sold' && panel.panel_status !== 'In Repair' && (
              <div className="rounded-xl border border-orange-200 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-900 p-5 shadow-sm">
                <div className="flex items-center gap-2 text-orange-700 dark:text-orange-300">
                  <PackageX className="w-4 h-4" />
                  <span className="text-xs font-semibold uppercase tracking-wide">
                    Return to Manufacturer
                  </span>
                </div>
                <p className="mt-2 text-sm text-orange-900/80 dark:text-orange-200/80">
                  Ship a failed panel back to the manufacturer for repair &mdash;
                  status will switch to <span className="font-semibold">In Repair</span>.
                </p>

                {!returningMfr ? (
                  <Button
                    className="mt-4 w-full bg-orange-600 hover:bg-orange-700 text-white"
                    onClick={() => {
                      setMfrNameInput('AWS');
                      setMfrRmaInput(panel.rma || '');
                      setMfrShipDateInput(todayISO());
                      setMfrTrackingInput(panel.tracking_info || '');
                      setFailureDescInput(panel.failure_description || '');
                      setFailureDateInput(panel.failure_date || todayISO());
                      setFailureReportedByInput(panel.failure_reported_by || user?.name || user?.email || '');
                      setReturningMfr(true);
                    }}
                  >
                    <PackageX className="w-4 h-4 mr-2" />
                    Return to Manufacturer
                  </Button>
                ) : (
                  <div className="mt-4 space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-orange-900/70 dark:text-orange-200/70">Manufacturer</Label>
                      <Input value={mfrNameInput} onChange={(e) => setMfrNameInput(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-orange-900/70 dark:text-orange-200/70">RMA #</Label>
                      <div className="text-sm text-orange-900/60 dark:text-orange-200/60 italic">
                        Auto-assigned on save (next in sequence)
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-orange-900/70 dark:text-orange-200/70">Ship Date</Label>
                      <Input type="date" value={mfrShipDateInput} onChange={(e) => setMfrShipDateInput(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-orange-900/70 dark:text-orange-200/70">Tracking #</Label>
                      <Input value={mfrTrackingInput} onChange={(e) => setMfrTrackingInput(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-orange-900/70 dark:text-orange-200/70">Failure Description</Label>
                      <Textarea
                        rows={3}
                        value={failureDescInput}
                        onChange={(e) => setFailureDescInput(e.target.value)}
                        placeholder="What failed and how it was observed…"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-orange-900/70 dark:text-orange-200/70">Failure Date</Label>
                      <Input type="date" value={failureDateInput} onChange={(e) => setFailureDateInput(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-orange-900/70 dark:text-orange-200/70">Reported By</Label>
                      <Input value={failureReportedByInput} onChange={(e) => setFailureReportedByInput(e.target.value)} />
                    </div>

                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={handleDownloadFailureReport}
                    >
                      <FileDown className="w-4 h-4 mr-2" />
                      Download Failure Report
                    </Button>

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => setReturningMfr(false)}
                        disabled={saving}
                      >
                        <X className="w-4 h-4 mr-1" />
                        Cancel
                      </Button>
                      <Button
                        className="flex-1 bg-orange-600 hover:bg-orange-700 text-white"
                        onClick={handleReturnToManufacturer}
                        disabled={saving}
                      >
                        {saving ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4 mr-1" />
                        )}
                        Save &amp; Mark In Repair
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Repair / Failure Report — only while the panel is In Repair. The
                Return-to-Manufacturer card (with its own download button) is
                hidden in this state, so this provides always-available access to
                regenerate the report and attach RMA paperwork. */}
            {!editing && panel.panel_status === 'In Repair' && (
              <Card className="rounded-xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <PackageX className="w-4 h-4 text-orange-600" />
                    Repair / Failure Report
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {panel.tracking_info && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                        RMA Tracking
                      </p>
                      <p className="text-sm">
                        <TrackingLink value={panel.tracking_info} />
                      </p>
                    </div>
                  )}
                  <Button
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={handleRepairComplete}
                    disabled={saving}
                  >
                    {saving ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <PackageCheck className="w-4 h-4 mr-2" />
                    )}
                    Repair Complete / Return
                  </Button>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Returns panel to At Facility and clears RMA/repair fields.
                  </p>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={handleDownloadFailureReportFromPanel}
                  >
                    <FileDown className="w-4 h-4 mr-2" />
                    Download Failure Report
                  </Button>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Auto-saved to panel files when marked In Repair. Regenerate anytime.
                  </p>

                  <input
                    ref={rmaDocInputRef}
                    type="file"
                    accept="application/pdf,image/*"
                    className="hidden"
                    onChange={handleRmaDocSelected}
                  />
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => rmaDocInputRef.current?.click()}
                    disabled={rmaDocUploading}
                  >
                    {rmaDocUploading ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Paperclip className="w-4 h-4 mr-2" />
                    )}
                    Attach RMA Document
                  </Button>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    PDF or image, up to 10MB. Appears in the panel Images card.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Return details — shown once a panel has been returned. */}
            {!editing && panel.returned_date && (
              <Card className="rounded-xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <PackageCheck className="w-4 h-4 text-blue-600" />
                    Return Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Field
                    label="Returned Date"
                    value={
                      panel.returned_date
                        ? new Date(panel.returned_date).toLocaleDateString()
                        : '—'
                    }
                  />
                  <Field label="Confirmed By" value={panel.return_confirmed_by} />
                  <Field label="Return Notes" value={panel.return_notes} />
                </CardContent>
              </Card>
            )}

            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle>Metadata</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field label="Serial Number" value={panel.serial_number} />
                <Field label="Customer" value={panel.customerName} />
                <Field label="District" value={panel.districtName} />
                <Field
                  label="Received Date"
                  value={
                    panel.received_date
                      ? new Date(panel.received_date).toLocaleDateString()
                      : '—'
                  }
                />
                <Field
                  label="Last Updated"
                  value={
                    panel.date_updated
                      ? new Date(panel.date_updated).toLocaleDateString()
                      : '—'
                  }
                />
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Status
                  </p>
                  <Badge className={getStatusColor(panel.panel_status)}>
                    {panel.panel_status || 'Unknown'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>

        </div>
      </div>
    </div>
  );
}
