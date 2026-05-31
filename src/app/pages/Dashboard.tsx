import React, { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth-context";
import { useTheme } from "../lib/theme-context";
import IncidentEvidenceImages from "../components/IncidentEvidenceImages";
import { toast } from "sonner";
import {
  INCIDENT_STATUSES,
  STATUS_COLORS as WORKFLOW_STATUS_COLORS,
  normalizeStatus,
  validateForStatus,
  statusOptionsForRole,
  isGatedStatus,
  CLOSED_STATUS,
  ACTION_STATUS_COMPLETE,
  needsReview,
  isReviewed,
} from "../lib/incidentWorkflow";
import {
  resolveFailedComponentLabel,
  resolveFailureTypeLabel,
} from "../lib/failedComponent";
import { parseSlackUrl } from "../lib/slackUrl";

// ── Helpers ───────────────────────────────────────────────────────────────────
async function fetchAllPages(query: any) {
  const all: any[] = [];
  let from = 0;
  const step = 1000;
  while (true) {
    const { data, error } = await query.range(from, from + step - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < step) break;
    from += step;
  }
  return all;
}

function parseHHMMSS(str: string | null | undefined): number {
  if (!str) return 0;
  const parts = str.split(":").map(Number);
  if (parts.length === 3) return parts[0] + parts[1] / 60 + parts[2] / 3600;
  if (parts.length === 2) return parts[0] + parts[1] / 60;
  return 0;
}

function fmt(n: number | null | undefined): string | number {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function getDateRange(filter: string): { start: string | null; end: string | null } {
  if (filter === "all_time") return { start: null, end: null };
  const now = new Date();
  let start = new Date(); let end = new Date();
  start.setHours(0, 0, 0, 0); end.setHours(23, 59, 59, 999);
  switch (filter) {
    case "this_week":    start.setDate(now.getDate() - now.getDay()); break;
    case "last_week":   start.setDate(now.getDate() - now.getDay() - 7); end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23,59,59,999); break;
    case "this_month":  start = new Date(now.getFullYear(), now.getMonth(), 1); break;
    case "last_month":  start = new Date(now.getFullYear(), now.getMonth()-1, 1); end = new Date(now.getFullYear(), now.getMonth(), 0); end.setHours(23,59,59,999); break;
    case "this_quarter":start = new Date(now.getFullYear(), Math.floor(now.getMonth()/3)*3, 1); break;
    case "this_year":   start = new Date(now.getFullYear(), 0, 1); break;
  }
  return { start: start.toISOString(), end: end.toISOString() };
}

// ── Time filter labels (human-readable, for banners/headings) ────────────────
const TIME_FILTER_LABELS: Record<string, string> = {
  this_week:    "this week",
  last_week:    "last week",
  this_month:   "this month",
  last_month:   "last month",
  this_quarter: "this quarter",
  this_year:    "this year",
  all_time:     "all time",
};

// ── Panel status config ───────────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { color: string; bg: string }> = {
  "At Facility": { color: "#22c55e", bg: "#f0fdf4" },
  "Leased":      { color: "#3b82f6", bg: "#eff6ff" },
  "In Repair":   { color: "#f59e0b", bg: "#fffbeb" },
  "Loaned":      { color: "#a855f7", bg: "#faf5ff" },
  "Sold":        { color: "#ef4444", bg: "#fef2f2" },
};

// ── Quick-edit enums ──────────────────────────────────────────────────────────
const XC_CAUSED_OPTS   = ["Yes", "No", "Inconclusive"];
const SEVERITY_OPTS    = ["Low", "Moderate", "Critical"];
const STATUS_OPTS      = INCIDENT_STATUSES;
const VENDOR_CAUSED_OPTS = ["Yes", "No", "Pending Investigation"];

const SEVERITY_COLORS: Record<string, { bg: string; color: string }> = {
  Low:      { bg: "#f0fdf4", color: "#16a34a" },
  Moderate: { bg: "#1e293b", color: "#ffffff" },
  Critical: { bg: "#dc2626", color: "#ffffff" },
};
const XC_COLORS: Record<string, { bg: string; color: string }> = {
  Yes:          { bg: "#dc2626", color: "#ffffff" },
  No:           { bg: "#f1f5f9", color: "#475569" },
  Inconclusive: { bg: "#f1f5f9", color: "#475569" },
};
const STATUS_COLORS: Record<string, { bg: string; color: string }> = WORKFLOW_STATUS_COLORS;

// ── Inline pill button for quick editing ─────────────────────────────────────
function QuickEdit({ value, options, colorMap, field, rowId, onUpdated, incident, role, isDark = false }: {
  value: string; options: string[];
  colorMap: Record<string, { bg: string; color: string }>;
  field: string; rowId: string;
  onUpdated: (rowId: string, field: string, value: string) => void;
  incident?: Record<string, any>;
  role?: 'admin' | 'sqm';
  isDark?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const cur = colorMap[value] ?? { bg: isDark ? "#334155" : "#f1f5f9", color: isDark ? "#cbd5e1" : "#475569" };

  // For the status field, restrict options by role (SQMs can't pick Closed).
  const effectiveOptions = field === "incident_status"
    ? statusOptionsForRole(role) as string[]
    : options;

  const handleSelect = async (opt: string) => {
    if (opt === value) { setOpen(false); return; }
    // Workflow gates: validate before allowing transition to Final Review / Closed.
    if (field === "incident_status" && incident && isGatedStatus(opt)) {
      const missing = validateForStatus(incident, opt);
      if (missing.length) {
        setOpen(false);
        toast.error(
          `Cannot move to "${opt}" — missing required fields: ${missing.join(", ")}.`,
          { duration: 6000 },
        );
        return;
      }
      if (opt === CLOSED_STATUS && role !== 'admin') {
        setOpen(false);
        toast.error("Only admins can mark an incident Closed.");
        return;
      }
    }
    setSaving(true);
    setOpen(false);
    // When transitioning the incident to Closed via the quick-edit pill,
    // force action_status to 'Complete' so it can't contradict the cover
    // (and so a downstream save can't trip the DB CHECK constraint).
    const updates: Record<string, any> = { [field]: opt };
    if (field === "incident_status" && normalizeStatus(opt) === CLOSED_STATUS) {
      updates.action_status = ACTION_STATUS_COMPLETE;
    }
    const { error } = await supabase.from("incidents").update(updates).eq("row_id", rowId);
    if (!error) {
      onUpdated(rowId, field, opt);
      if (updates.action_status) onUpdated(rowId, "action_status", ACTION_STATUS_COMPLETE);
    } else {
      toast.error(error.message || "Failed to update");
    }
    setSaving(false);
  };

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen(o => !o)}
        disabled={saving}
        style={{
          padding: "3px 10px", borderRadius: 20, border: "none", cursor: saving ? "wait" : "pointer",
          fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
          background: cur.bg, color: cur.color,
          opacity: saving ? 0.6 : 1, transition: "opacity 0.15s",
        }}
      >
        {saving ? "…" : (value || "—")}
        <span style={{ marginLeft: 4, opacity: 0.6 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 9999,
          background: isDark ? "#1e293b" : "#fff", border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`, borderRadius: 8,
          boxShadow: isDark ? "0 4px 16px rgba(0,0,0,0.5)" : "0 4px 16px rgba(0,0,0,0.12)", minWidth: 140, overflow: "hidden",
        }}>
          {effectiveOptions.map(opt => {
            const c = colorMap[opt] ?? { bg: isDark ? "#334155" : "#f8fafc", color: isDark ? "#cbd5e1" : "#475569" };
            const selectedBg = isDark ? "#334155" : "#f8fafc";
            return (
              <button key={opt} onClick={() => handleSelect(opt)} style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "8px 12px", border: "none", cursor: "pointer",
                fontSize: 12, fontWeight: opt === value ? 700 : 400,
                background: opt === value ? selectedBg : (isDark ? "#1e293b" : "#fff"), color: isDark ? "#f1f5f9" : "#0f172a",
                borderLeft: opt === value ? `3px solid ${c.bg === "#f8fafc" ? "#94a3b8" : c.bg}` : "3px solid transparent",
              }}>
                <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: c.bg === "#f8fafc" ? "#94a3b8" : c.bg, marginRight: 8 }} />
                {opt}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Full incident popup modal ─────────────────────────────────────────────────
function IncidentModal({ incident, listMap, componentsMap, vendorMap, onClose, onUpdated, role, isDark = false }: {
  incident: any;
  listMap: Record<string, any>;
  componentsMap: Record<string, { failed_component: string }>;
  vendorMap: Record<string, string>;
  onClose: () => void;
  onUpdated: (rowId: string, field: string, value: string) => void;
  role?: 'admin' | 'sqm';
  isDark?: boolean;
}) {
  const r = incident;
  const modal = makeModal(isDark);
  const txtPrimary = isDark ? "#f1f5f9" : "#0f172a";
  const txtSubtle = isDark ? "#94a3b8" : "#64748b";
  // Authoritative mapping (verified in DB): failed_component → components,
  // failure_type → lists. Never leaks a raw row_id into the popup.
  const failedComp  = resolveFailedComponentLabel(r.failed_component, componentsMap, '') || null;
  const failureType = resolveFailureTypeLabel(r.failure_type, listMap, '') || null;
  const vendorName  = vendorMap[r.vendor] || r.vendor || null;

  return (
    <div style={modal.overlay} onClick={onClose}>
      <div style={modal.box} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={modal.header}>
          <div>
            <span style={{ fontSize: 18, fontWeight: 700, color: txtPrimary }}>Incident #{r.event_id}</span>
            <span style={{ marginLeft: 10, fontSize: 13, color: txtSubtle }}>{r.date_incident ? new Date(r.date_incident + "T00:00:00").toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" }) : ""}</span>
            {r.reviewed_at && (
              <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: isDark ? "#14532d" : "#dcfce7", color: isDark ? "#86efac" : "#166534" }}>
                ✓ Reviewed{r.reviewed_by ? ` by ${r.reviewed_by}` : ""}
              </span>
            )}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: txtSubtle, lineHeight: 1 }}>✕</button>
        </div>

        {/* Quick-edit row */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "12px 20px", background: isDark ? "#0f172a" : "#f8fafc", borderBottom: `1px solid ${isDark ? "#334155" : "#e2e8f0"}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={modal.qLabel}>XC Caused</span>
            <QuickEdit value={r.xc_caused || "—"} options={XC_CAUSED_OPTS} colorMap={XC_COLORS} field="xc_caused" rowId={r.row_id} onUpdated={onUpdated} isDark={isDark} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={modal.qLabel}>Severity</span>
            <QuickEdit value={r.incident_severity || "—"} options={SEVERITY_OPTS} colorMap={SEVERITY_COLORS} field="incident_severity" rowId={r.row_id} onUpdated={onUpdated} isDark={isDark} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={modal.qLabel}>Status</span>
            <QuickEdit value={normalizeStatus(r.incident_status) || "—"} options={STATUS_OPTS} colorMap={STATUS_COLORS} field="incident_status" rowId={r.row_id} onUpdated={onUpdated} incident={r} role={role} isDark={isDark} />
          </div>
          {r.vendor_caused !== null && r.vendor_caused !== undefined && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={modal.qLabel}>Vendor Caused</span>
              <QuickEdit value={r.vendor_caused || "—"} options={VENDOR_CAUSED_OPTS} colorMap={{ Yes: { bg: "#dc2626", color: "#fff" }, No: { bg: isDark ? "#334155" : "#f1f5f9", color: isDark ? "#cbd5e1" : "#475569" }, "Pending Investigation": { bg: "#fef9c3", color: "#854d0e" } }} field="vendor_caused" rowId={r.row_id} onUpdated={onUpdated} isDark={isDark} />
            </div>
          )}
        </div>

        {/* Scrollable content */}
        <div style={modal.body}>
          {/* Info grid */}
          <div style={modal.grid}>
            {r.customerName  && <InfoItem label="Customer"        value={r.customerName} isDark={isDark} />}
            {r.districtName  && <InfoItem label="District"        value={r.districtName} isDark={isDark} />}
            {r.xc_rep        && <InfoItem label="XC Rep"          value={r.xc_rep} isDark={isDark} />}
            {r.customer_rep  && <InfoItem label="Customer Rep"    value={r.customer_rep} isDark={isDark} />}
            {r.ep_rep        && <InfoItem label="EP Rep"          value={r.ep_rep} isDark={isDark} />}
            {r.event_category && <InfoItem label="Category"       value={r.event_category} isDark={isDark} />}
            {r.product_line  && <InfoItem label="Product Line"    value={r.product_line} isDark={isDark} />}
            {r.firing_system && <InfoItem label="Firing System"   value={r.firing_system} isDark={isDark} />}
            {r.field_facility && <InfoItem label="Field/Facility" value={r.field_facility} isDark={isDark} />}
            {r.well_name     && <InfoItem label="Well Name"       value={r.well_name} isDark={isDark} />}
            {r['stage#']     && <InfoItem label="Stage #"         value={r['stage#']} isDark={isDark} />}
            {r['so#']        && <InfoItem label="SO #"            value={r['so#']} isDark={isDark} />}
            {failedComp      && <InfoItem label="Failed Component" value={failedComp} isDark={isDark} />}
            {failureType     && <InfoItem label="Failure Type"    value={failureType} isDark={isDark} />}
            {vendorName      && <InfoItem label="Vendor"          value={vendorName} isDark={isDark} />}
          </div>

          {/* Text blocks */}
          {[
            { label: "Notes",          text: r.notes },
            { label: "Description",    text: r.incident_description },
            { label: "Investigation",  text: r.investigation },
            { label: "Root Cause",     text: r.root_cause },
          ].filter(b => b.text).map(({ label, text }) => (
            <div key={label} style={{ marginBottom: 14 }}>
              <div style={modal.blockLabel}>{label}</div>
              <div style={modal.blockText}>{text}</div>
            </div>
          ))}

          {/* Images — photos live in images_legacy keyed by event_id (incidents
              image1/image2 are unused). Shared component renders nothing if none. */}
          <IncidentEvidenceImages eventId={r.event_id} inline={[r.image1, r.image2]} title="Evidence Images" />

          {/* Slack — only render when the row holds a real https URL. AppSheet
              stores this column as a JSON blob ({"Url":"...","LinkText":"..."}),
              so parse it first; using the raw blob as an href made the browser
              treat it as a relative path and prepend the app domain. */}
          {(() => {
            const slackUrl = parseSlackUrl(r.slack_url);
            if (!slackUrl) return null;
            return (
              <div>
                <div style={modal.blockLabel}>Slack Notification</div>
                <a href={slackUrl} target="_blank" rel="noopener noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 8, background: "#4A154B", color: "#fff", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
                  <span>💬</span> View in Slack ↗
                </a>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

function InfoItem({ label, value, isDark = false }: { label: string; value: string; isDark?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: isDark ? "#64748b" : "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: isDark ? "#f1f5f9" : "#0f172a" }}>{value}</div>
    </div>
  );
}

function makeModal(isDark: boolean): Record<string, React.CSSProperties> {
  const innerBg = isDark ? "#0f172a" : "#f8fafc";
  const border = isDark ? "#334155" : "#e2e8f0";
  return {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 },
  box: { background: isDark ? "#1e293b" : "#fff", borderRadius: 16, width: "100%", maxWidth: 740, maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.45)", overflow: "hidden" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: `1px solid ${border}` },
  qLabel: { fontSize: 11, fontWeight: 600, color: isDark ? "#64748b" : "#94a3b8" },
  body: { overflowY: "auto", padding: 20, flex: 1 },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 24px", marginBottom: 20, padding: 14, background: innerBg, borderRadius: 8 },
  blockLabel: { fontSize: 12, fontWeight: 700, color: isDark ? "#cbd5e1" : "#334155", marginBottom: 4 },
  blockText: { fontSize: 13, color: isDark ? "#cbd5e1" : "#475569", background: innerBg, padding: "10px 12px", borderRadius: 6, whiteSpace: "pre-wrap", lineHeight: 1.6 },
  };
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ title, value, icon, loading, accent = "#6366f1", styles }: { title: string; value: string | number; icon: string; loading: boolean; accent?: string; styles: Record<string, React.CSSProperties> }) {
  return (
    <div style={styles.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <span style={styles.cardLabel}>{title}</span>
        <span style={{ ...styles.iconBadge, background: accent + "18", color: accent }}>{icon}</span>
      </div>
      <div style={styles.cardValue}>{loading ? <span style={styles.skeleton} /> : value}</div>
    </div>
  );
}

function PanelStatusCard({ status, count, total, loading, styles, isDark }: { status: string; count: number; total: number; loading?: boolean; styles: Record<string, React.CSSProperties>; isDark: boolean }) {
  const cfg = STATUS_CONFIG[status] ?? { color: "#64748b", bg: isDark ? "#1e293b" : "#f8fafc" };
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div style={{ ...styles.card, borderTop: `3px solid ${cfg.color}` }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={styles.cardLabel}>{status}</span>
        <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: isDark ? cfg.color + "26" : cfg.bg, color: cfg.color }}>{loading ? "…" : `${pct}%`}</span>
      </div>
      <div style={styles.cardValue}>{loading ? <span style={styles.skeleton} /> : count}</div>
      <div style={{ marginTop: 12, height: 4, borderRadius: 2, background: isDark ? "#334155" : "#e2e8f0" }}>
        <div style={{ height: "100%", borderRadius: 2, background: cfg.color, width: loading ? "0%" : `${pct}%`, transition: "width 0.6s ease" }} />
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user } = useAuth();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(isDark), [isDark]);
  const role = user?.role as 'admin' | 'sqm' | undefined;
  const displayName = user?.name && user.name !== "Admin User" ? user.name : null;
  const [timeFilter, setTimeFilter] = useState("all_time");
  const [meetingMode, setMeetingMode] = useState(false);
  const [incStatusFilter, setIncStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Metrics
  const [totalVisits,    setTotalVisits]    = useState(0);
  const [totalHours,     setTotalHours]     = useState(0);
  const [totalBarrels,   setTotalBarrels]   = useState(0);
  const [totalStages,    setTotalStages]    = useState(0);
  const [panelTotal,     setPanelTotal]     = useState(0);
  const [panelStatuses,  setPanelStatuses]  = useState<{ status: string; count: number; total: number }[]>([]);

  // Incidents review
  const [incidents,      setIncidents]      = useState<any[]>([]);
  // ALL incidents in the period (any fault) — only loaded in Monday Meeting mode.
  const [allIncidents,   setAllIncidents]   = useState<any[]>([]);
  const [customerMap,    setCustomerMap]    = useState<Record<string, string>>({});
  const [districtMap,    setDistrictMap]    = useState<Record<string, string>>({});
  const [listMap,        setListMap]        = useState<Record<string, any>>({});
  const [componentsMap,  setComponentsMap]  = useState<Record<string, { failed_component: string }>>({});
  const [vendorMap,      setVendorMap]      = useState<Record<string, string>>({});

  // Modal
  const [modalIncident,  setModalIncident]  = useState<any | null>(null);

  // ── Enrich incidents with resolved names ────────────────────────────────────
  const enriched = useMemo(() => incidents
    .filter(inc => {
      if (incStatusFilter === "all") return true;
      const n = normalizeStatus(inc.incident_status);
      return n === incStatusFilter;
    })
    .map(inc => ({
      ...inc,
      customerName: customerMap[inc.customer]          || inc.customer          || "-",
      districtName: districtMap[inc.customer_district] || inc.customer_district || "-",
    })), [incidents, customerMap, districtMap, incStatusFilter]);

  // ── Inline update handler (optimistic) ─────────────────────────────────────
  const handleUpdated = useCallback((rowId: string, field: string, value: string) => {
    setIncidents(prev => prev.map(i => i.row_id === rowId ? { ...i, [field]: value } : i));
    if (modalIncident?.row_id === rowId) setModalIncident((prev: any) => ({ ...prev, [field]: value }));
  }, [modalIncident]);

  // ── Director review: one-click acknowledge ─────────────────────────────────
  // Stamps reviewed_by + reviewed_at so the incident leaves the review queue
  // and becomes eligible for Closed. Admin-only.
  const handleMarkReviewed = useCallback(async (inc: any) => {
    if (role !== "admin") {
      toast.error("Only the director/admin can mark an incident reviewed.");
      return;
    }
    const reviewer = user?.name || user?.email || "Director";
    const reviewedAt = new Date().toISOString();
    const { error } = await supabase
      .from("incidents")
      .update({ reviewed_by: reviewer, reviewed_at: reviewedAt })
      .eq("row_id", inc.row_id);
    if (error) { toast.error(error.message || "Failed to mark reviewed"); return; }
    setIncidents(prev => prev.map(i =>
      i.row_id === inc.row_id ? { ...i, reviewed_by: reviewer, reviewed_at: reviewedAt } : i
    ));
    // Log to the incident timeline (best-effort — don't block on failure).
    supabase.from("incident_updates").insert({
      event_id: inc.event_id ?? null,
      incident_id: inc.row_id ?? null,
      update_type: "review",
      note: `Reviewed by ${reviewer}`,
      created_by: reviewer,
    }).then(({ error: e }) => { if (e) console.warn("timeline log failed", e.message); });
    toast.success("Marked as reviewed");
  }, [role, user]);

  // Incidents awaiting director review (XC-caused / Critical, unreviewed, open).
  const reviewQueue = useMemo(
    () => enriched.filter(needsReview)
      .sort((a, b) => String(a.date_incident || "").localeCompare(String(b.date_incident || ""))),
    [enriched]
  );

  // ── Load reference tables once ──────────────────────────────────────────────
  useEffect(() => {
    async function loadRefs() {
      const [
        { data: custs },
        { data: dists },
        { data: lists },
        { data: vends },
        { data: comps },
      ] = await Promise.all([
        supabase.from("customers").select("row_id,customer"),
        supabase.from("districts").select("row_id,customer_district"),
        supabase.from("lists").select("row_id,failed_component,failure_type"),
        supabase.from("vendors").select("row_id,vendor"),
        supabase.from("components").select("row_id,failed_component"),
      ]);
      const cm: Record<string, string> = {};
      (custs || []).forEach((c: any) => { cm[c.row_id] = c.customer; });
      setCustomerMap(cm);
      const dm: Record<string, string> = {};
      (dists || []).forEach((d: any) => { dm[d.row_id] = d.customer_district; });
      setDistrictMap(dm);
      const lm: Record<string, any> = {};
      (lists || []).forEach((l: any) => { lm[l.row_id] = l; });
      setListMap(lm);
      const cmComp: Record<string, { failed_component: string }> = {};
      (comps || []).forEach((c: any) => {
        if (c.row_id) cmComp[c.row_id] = { failed_component: c.failed_component || '' };
      });
      setComponentsMap(cmComp);
      const vm: Record<string, string> = {};
      (vends || []).forEach((v: any) => { vm[v.row_id] = v.vendor; });
      setVendorMap(vm);
    }
    loadRefs();
  }, []);

  // ── Load time-filtered data ─────────────────────────────────────────────────
  useEffect(() => {
    async function fetchAll() {
      try {
        setLoading(true);
        const { start, end } = getDateRange(timeFilter);
        const applyDates = (q: any, col: string) => {
          if (start) q = q.gte(col, start);
          if (end)   q = q.lte(col, end);
          return q;
        };

        // Metrics
        const { count: visits } = await applyDates(supabase.from("fieldvisits").select("*", { count: "exact", head: true }), "arrival_date");
        const visitsRaw = await fetchAllPages(applyDates(supabase.from("fieldvisits").select("visit_duration").not("visit_duration", "is", null), "arrival_date"));
        const hours = visitsRaw.reduce((s, r) => s + parseHHMMSS(r.visit_duration), 0);

        // Unified sales_volume view replaces the two separate barrels_sold /
        // stages fetches. One round-trip, split by metric_type in the browser.
        // (The `date` column in the view is a real DATE cast, so range filters
        // work correctly instead of comparing text.)
        const salesRaw = await fetchAllPages(
          applyDates(supabase.from("sales_volume").select("metric_type,quantity"), "date")
        );
        let barrels = 0;
        let stages = 0;
        for (const r of salesRaw) {
          const q = parseFloat(r.quantity) || 0;
          if (r.metric_type === "barrels") barrels += q;
          else if (r.metric_type === "stages") stages += q;
        }

        setTotalVisits(visits ?? 0);
        setTotalHours(Math.round(hours * 10) / 10);
        setTotalBarrels(Math.round(barrels));
        setTotalStages(Math.round(stages));

        // Panels
        const panelsRaw = await fetchAllPages(supabase.from("panels").select("panel_status").eq("verified", "Y"));
        const sm: Record<string, number> = {};
        let pt = 0;
        for (const r of panelsRaw) { const k = r.panel_status ?? "Unknown"; sm[k] = (sm[k] ?? 0) + 1; pt++; }
        setPanelTotal(pt);
        const order = ["At Facility", "Leased", "In Repair", "Loaned", "Sold"];
        const sorted = Object.entries(sm).sort(([a], [b]) => {
          const ai = order.indexOf(a); const bi = order.indexOf(b);
          if (ai !== -1 && bi !== -1) return ai - bi;
          if (ai !== -1) return -1; if (bi !== -1) return 1;
          return a.localeCompare(b);
        });
        setPanelStatuses(sorted.map(([status, count]) => ({ status, count, total: pt })));

        // Incidents for review table — all matching filter, ordered by date desc
        // Note: select("*") is required because column names stage# and so#
        // contain # which breaks PostgREST's select parameter parser.
        const incQuery = applyDates(
          supabase.from("incidents").select("*")
            .in("xc_caused", ["Yes", "Inconclusive"])
            .order("date_incident", { ascending: false }),
          "date_incident"
        );
        const incData = await fetchAllPages(incQuery);
        setIncidents(incData || []);

        // ALL incidents in the period (any fault), for Monday Meeting mode.
        // Only fetched when meeting mode is on — avoids extra load otherwise.
        if (meetingMode) {
          const allIncQuery = applyDates(
            supabase.from("incidents").select("*")
              .order("date_incident", { ascending: false }),
            "date_incident"
          );
          const allIncData = await fetchAllPages(allIncQuery);
          setAllIncidents(allIncData || []);
        } else {
          setAllIncidents([]);
        }

      } catch (err: any) {
        console.error("Dashboard Error:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchAll();
  }, [timeFilter, meetingMode]);

  // ── Search across the Incident Review list ──────────────────────────────────
  // Matches event id, customer, district, category, severity, status, and the
  // notes/description/investigation text.
  const visibleIncidents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return enriched;
    return enriched.filter((inc) => {
      const hay = [
        inc.event_id,
        inc.customerName,
        inc.districtName,
        inc.event_category,
        inc.incident_severity,
        normalizeStatus(inc.incident_status),
        inc.xc_caused,
        inc.notes,
        inc.incident_description,
        inc.investigation,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [enriched, search]);

  const totalIncidents = enriched.length;

  // ── All-incidents (any fault) for the Monday Meeting view ───────────────────
  // Enriched with resolved names and sorted newest-first. Critical floats to
  // the top within the same date so the most serious items lead the review.
  const SEV_RANK: Record<string, number> = { Critical: 0, Moderate: 1, Low: 2 };
  const allEnriched = useMemo(() => allIncidents
    .map(inc => ({
      ...inc,
      customerName: customerMap[inc.customer]          || inc.customer          || "-",
      districtName: districtMap[inc.customer_district] || inc.customer_district || "-",
    }))
    .sort((a, b) => {
      const d = String(b.date_incident || "").localeCompare(String(a.date_incident || ""));
      if (d !== 0) return d;
      return (SEV_RANK[a.incident_severity] ?? 9) - (SEV_RANK[b.incident_severity] ?? 9);
    }), [allIncidents, customerMap, districtMap]);

  const periodLabel = TIME_FILTER_LABELS[timeFilter] ?? "this period";

  return (
    <div style={styles.page}>
      {error && <div style={styles.errorBanner}>⚠ Error loading data: {error}</div>}

      {/* ── Header ── */}
      <div style={styles.headerRow}>
        <div>
          <h1 style={styles.heading}>{displayName ? `Welcome back, ${displayName}!` : "Welcome back!"}</h1>
          <p style={styles.subheading}>Here's an overview of your company's performance</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => {
              const next = !meetingMode;
              setMeetingMode(next);
              // Entering meeting mode frames the review on last week in one click.
              if (next && timeFilter !== "last_week") setTimeFilter("last_week");
            }}
            disabled={loading}
            title="Frame the dashboard for your Monday team meeting: last week's KPIs, all incidents, and panel inventory"
            style={{
              padding: "10px 16px", borderRadius: 8, border: "1px solid",
              borderColor: meetingMode ? "#4f46e5" : (isDark ? "#475569" : "#cbd5e1"),
              background: meetingMode ? "#4f46e5" : (isDark ? "#1e293b" : "#fff"),
              color: meetingMode ? "#fff" : (isDark ? "#cbd5e1" : "#334155"),
              fontSize: 14, fontWeight: 600, cursor: loading ? "wait" : "pointer",
              fontFamily: "inherit", whiteSpace: "nowrap",
            }}
          >
            📅 Monday Meeting{meetingMode ? " · On" : ""}
          </button>
          <select style={styles.filterSelect} value={timeFilter} onChange={e => setTimeFilter(e.target.value)} disabled={loading}>
            <option value="this_week">This Week</option>
            <option value="last_week">Last Week</option>
            <option value="this_month">This Month</option>
            <option value="last_month">Last Month</option>
            <option value="this_quarter">This Quarter</option>
            <option value="this_year">This Year</option>
            <option value="all_time">All Time</option>
          </select>
        </div>
      </div>

      {/* ── Monday Meeting agenda banner ── */}
      {meetingMode && (
        <div style={{ marginBottom: 24, background: isDark ? "#1e1b4b" : "#eef2ff", border: `1px solid ${isDark ? "#3730a3" : "#c7d2fe"}`, borderRadius: 12, padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 18 }}>📅</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: isDark ? "#c7d2fe" : "#3730a3" }}>Monday Meeting — reviewing {periodLabel}</span>
          </div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 13, color: isDark ? "#a5b4fc" : "#4338ca" }}>
            <span><strong>1.</strong> Prior-week KPIs ↓</span>
            <span><strong>2.</strong> All incidents {periodLabel} ↓</span>
            <span><strong>3.</strong> Panel inventory check ↓</span>
          </div>
        </div>
      )}

      {/* ── Needs My Review queue (director/admin only) ── */}
      {role === "admin" && !loading && reviewQueue.length > 0 && (
        <div style={{ marginBottom: 28, background: isDark ? "#1e293b" : "#fff", borderRadius: 12, border: `1px solid ${isDark ? "#7f1d1d" : "#fecaca"}`, overflow: "hidden", boxShadow: isDark ? "0 1px 3px rgba(0,0,0,0.4)" : "0 1px 3px rgba(0,0,0,0.06)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 20px", background: isDark ? "#450a0a" : "#fef2f2", borderBottom: `1px solid ${isDark ? "#7f1d1d" : "#fecaca"}` }}>
            <span style={{ fontSize: 16 }}>🔎</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: isDark ? "#fca5a5" : "#991b1b" }}>Needs My Review</span>
            <span style={{ fontSize: 12, fontWeight: 600, padding: "2px 10px", borderRadius: 20, background: "#dc2626", color: "#fff" }}>{reviewQueue.length}</span>
            <span style={{ fontSize: 12, color: isDark ? "#f87171" : "#b91c1c", marginLeft: 4 }}>XC-caused or Critical incidents awaiting your sign-off · oldest first</span>
          </div>
          <div>
            {reviewQueue.map((inc, idx) => {
              const sevCfg = SEVERITY_COLORS[inc.incident_severity] ?? { bg: "#f1f5f9", color: "#475569" };
              return (
                <div key={inc.row_id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", borderBottom: idx < reviewQueue.length - 1 ? `1px solid ${isDark ? "#334155" : "#f1f5f9"}` : "none" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#3b82f6", minWidth: 64 }}>#{inc.event_id}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: isDark ? "#f1f5f9" : "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{inc.customerName}</div>
                    <div style={{ fontSize: 11, color: isDark ? "#64748b" : "#94a3b8" }}>
                      {inc.districtName}
                      {inc.date_incident && <> · {new Date(inc.date_incident + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</>}
                    </div>
                  </div>
                  {inc.incident_severity && (
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: sevCfg.bg, color: sevCfg.color }}>{inc.incident_severity}</span>
                  )}
                  {inc.xc_caused && (
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: "#fee2e2", color: "#b91c1c" }}>XC: {inc.xc_caused}</span>
                  )}
                  <button onClick={() => setModalIncident(inc)} style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${isDark ? "#475569" : "#e2e8f0"}`, background: isDark ? "#334155" : "#fff", cursor: "pointer", fontSize: 11, color: isDark ? "#cbd5e1" : "#475569", fontWeight: 500 }}>View</button>
                  <button onClick={() => handleMarkReviewed(inc)} style={{ padding: "4px 12px", borderRadius: 6, border: "none", background: "#16a34a", cursor: "pointer", fontSize: 11, color: "#fff", fontWeight: 600 }}>✓ Mark Reviewed</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── KPI row ── */}
      <div style={styles.grid4}>
        <StatCard title="Field Visit Hours" value={`${fmt(totalHours)} hrs`} icon="🕐" loading={loading} accent="#10b981" styles={styles} />
        <StatCard title="Total Visits"       value={fmt(totalVisits)}         icon="📋" loading={loading} accent="#6366f1" styles={styles} />
        <StatCard title="Barrels Sold"       value={fmt(totalBarrels)}        icon="🛢️" loading={loading} accent="#f97316" styles={styles} />
        <StatCard title="Total Incidents"    value={fmt(totalIncidents)}      icon="⚠️" loading={loading} accent="#ef4444" styles={styles} />
      </div>
      <div style={{ ...styles.grid4, gridTemplateColumns: "1fr 1fr" }}>
        <StatCard title="Stages"       value={fmt(totalStages)} icon="📈" loading={loading} accent="#8b5cf6" styles={styles} />
        <StatCard title="Total Panels" value={fmt(panelTotal)}  icon="📡" loading={loading} accent="#0ea5e9" styles={styles} />
      </div>

      {/* ── Panel Status Breakdown ── */}
      <h2 style={styles.sectionTitle}>
        Panel Status Breakdown
        {!loading && <span style={styles.sectionBadge}>{panelTotal} total</span>}
      </h2>
      <div style={styles.gridAuto}>
        {loading
          ? ["At Facility", "Leased", "In Repair", "Loaned", "Sold"].map(s => <PanelStatusCard key={s} status={s} count={0} total={0} loading styles={styles} isDark={isDark} />)
          : panelStatuses.map(({ status, count, total }) => <PanelStatusCard key={status} status={status} count={count} total={total} styles={styles} isDark={isDark} />)}
      </div>


      {/* ── All Incidents This Period (Monday Meeting mode only) ── */}
      {meetingMode && (
        <div style={{ marginBottom: 28 }}>
          <h2 style={styles.sectionTitle}>
            All Incidents — {periodLabel}
            {!loading && <span style={styles.sectionBadge}>{allEnriched.length} total · any fault</span>}
          </h2>
          {loading ? (
            <div style={{ ...styles.card, padding: 0 }}>
              {[1,2,3].map(i => (
                <div key={i} style={{ padding: "12px 16px", borderBottom: `1px solid ${isDark ? "#334155" : "#f1f5f9"}` }}>
                  <span style={{ ...styles.skeleton, width: "50%", height: 14, display: "block" }} />
                </div>
              ))}
            </div>
          ) : allEnriched.length === 0 ? (
            <div style={{ background: isDark ? "#1e293b" : "#fff", borderRadius: 12, border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`, padding: "32px", textAlign: "center", color: isDark ? "#94a3b8" : "#64748b", fontSize: 14 }}>
              No incidents recorded {periodLabel}. 🎉
            </div>
          ) : (
            <div style={{ ...styles.card, padding: 0, overflow: "hidden" }}>
              {/* Column header */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: isDark ? "#0f172a" : "#f8fafc", borderBottom: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`, fontSize: 11, fontWeight: 700, color: isDark ? "#64748b" : "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                <span style={{ minWidth: 64 }}>ID</span>
                <span style={{ minWidth: 80 }}>Date</span>
                <span style={{ flex: 1 }}>Customer / District</span>
                <span style={{ minWidth: 78, textAlign: "center" }}>Severity</span>
                <span style={{ minWidth: 56, textAlign: "center" }}>XC?</span>
                <span style={{ minWidth: 100, textAlign: "center" }}>Status</span>
                <span style={{ minWidth: 44 }} />
              </div>
              {allEnriched.map((inc, idx) => {
                const sevCfg = SEVERITY_COLORS[inc.incident_severity] ?? { bg: "#f1f5f9", color: "#475569" };
                const normStatus = normalizeStatus(inc.incident_status);
                const staCfg = STATUS_COLORS[normStatus] ?? { bg: "#f1f5f9", color: "#475569" };
                const xcCfg = XC_COLORS[inc.xc_caused] ?? { bg: "#f1f5f9", color: "#475569" };
                return (
                  <div key={inc.row_id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderBottom: idx < allEnriched.length - 1 ? `1px solid ${isDark ? "#334155" : "#f1f5f9"}` : "none", fontSize: 13 }}>
                    <span style={{ minWidth: 64, fontWeight: 700, color: "#3b82f6" }}>#{inc.event_id}</span>
                    <span style={{ minWidth: 80, color: isDark ? "#94a3b8" : "#64748b", fontSize: 12 }}>
                      {inc.date_incident ? new Date(inc.date_incident + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: isDark ? "#f1f5f9" : "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{inc.customerName}</div>
                      <div style={{ fontSize: 11, color: isDark ? "#64748b" : "#94a3b8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{inc.districtName}</div>
                      {(() => {
                        const rawText = inc.notes || inc.incident_description || inc.investigation || null;
                        const sum = inc.ai_summary || rawText;
                        if (!sum) return null;
                        return (
                          <div
                            title={inc.ai_summary && rawText ? rawText : undefined}
                            style={{ fontSize: 12, color: isDark ? "#94a3b8" : "#64748b", lineHeight: 1.4, marginTop: 3,
                              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                              cursor: inc.ai_summary && rawText ? "help" : "default" }}
                          >
                            {inc.ai_summary && <span style={{ fontSize: 9.5, fontWeight: 700, color: "#6366f1", marginRight: 5, letterSpacing: "0.03em", textTransform: "uppercase" }}>✨</span>}
                            {sum}
                          </div>
                        );
                      })()}
                    </div>
                    <span style={{ minWidth: 78, textAlign: "center" }}>
                      {inc.incident_severity ? <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: sevCfg.bg, color: sevCfg.color }}>{inc.incident_severity}</span> : <span style={{ color: "#cbd5e1" }}>—</span>}
                    </span>
                    <span style={{ minWidth: 56, textAlign: "center" }}>
                      {inc.xc_caused ? <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: xcCfg.bg, color: xcCfg.color }}>{inc.xc_caused}</span> : <span style={{ color: "#cbd5e1" }}>—</span>}
                    </span>
                    <span style={{ minWidth: 100, textAlign: "center" }}>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: staCfg.bg, color: staCfg.color }}>{normStatus || "—"}</span>
                    </span>
                    <button
                      onClick={() => setModalIncident(inc)}
                      style={{ minWidth: 44, padding: "3px 10px", borderRadius: 6, border: `1px solid ${isDark ? "#475569" : "#e2e8f0"}`, background: isDark ? "#334155" : "#fff", cursor: "pointer", fontSize: 11, color: isDark ? "#cbd5e1" : "#475569", fontWeight: 500 }}
                    >
                      View
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Incident Review Table ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "28px 0 12px", flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ ...styles.sectionTitle, margin: 0 }}>
          Incident Review
          {!loading && <span style={styles.sectionBadge}>{visibleIncidents.length} of {incidents.length} incidents</span>}
        </h2>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {/* Search */}
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: isDark ? "#64748b" : "#94a3b8", pointerEvents: "none" }}>🔍</span>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search incidents…"
              style={{
                padding: "6px 28px 6px 30px",
                borderRadius: 20,
                border: `1px solid ${isDark ? "#475569" : "#e2e8f0"}`,
                background: isDark ? "#1e293b" : "#fff",
                fontSize: 12.5,
                color: isDark ? "#f1f5f9" : "#0f172a",
                outline: "none",
                minWidth: 200,
                fontFamily: "inherit",
              }}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                title="Clear search"
                style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 13, color: isDark ? "#64748b" : "#94a3b8", lineHeight: 1, padding: 0 }}
              >
                ✕
              </button>
            )}
          </div>
          {(["all", ...INCIDENT_STATUSES] as const).map(opt => {
            const active = incStatusFilter === opt;
            const c = opt !== "all" ? (STATUS_COLORS[opt] ?? { bg: "#eef2ff", color: "#4f46e5" }) : { bg: "#eef2ff", color: "#4f46e5" };
            return (
              <button key={opt} onClick={() => setIncStatusFilter(opt)} style={{
                padding: "5px 14px", borderRadius: 20, border: "1px solid",
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                borderColor: active ? c.color : (isDark ? "#475569" : "#e2e8f0"),
                background:  active ? c.bg    : (isDark ? "#1e293b" : "#fff"),
                color:       active ? c.color : (isDark ? "#94a3b8" : "#64748b"),
              }}>
                {opt === "all" ? "All" : opt}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14, marginBottom: 28 }}>
          {[1,2,3].map(i => (
            <div key={i} style={{ ...styles.card, minHeight: 160 }}>
              <span style={{ ...styles.skeleton, width: "60%", height: 14, display: "block", marginBottom: 10 }} />
              <span style={{ ...styles.skeleton, width: "40%", height: 11, display: "block", marginBottom: 16 }} />
              <span style={{ ...styles.skeleton, width: "100%", height: 40, display: "block" }} />
            </div>
          ))}
        </div>
      ) : visibleIncidents.length === 0 ? (
        <div style={{ background: isDark ? "#1e293b" : "#fff", borderRadius: 12, border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`, padding: "40px", textAlign: "center", color: isDark ? "#94a3b8" : "#64748b", fontSize: 14, marginBottom: 28 }}>
          {search.trim()
            ? `No incidents match “${search.trim()}”.`
            : "No XC-caused incidents found for this time period."}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14, marginBottom: 28 }}>
          {visibleIncidents.map(inc => {
            const sevCfg = SEVERITY_COLORS[inc.incident_severity] ?? { bg: "#f1f5f9", color: "#475569" };
            const normStatus = normalizeStatus(inc.incident_status);
            const staCfg = STATUS_COLORS[normStatus]    ?? { bg: "#f1f5f9", color: "#475569" };
            // Prefer the cached AI summary; fall back to raw text if not generated yet.
            const rawText = inc.notes || inc.incident_description || inc.investigation || null;
            const preview = inc.ai_summary || rawText || null;
            const isAiSummary = Boolean(inc.ai_summary);
            const isClosed = normStatus === CLOSED_STATUS;
            return (
              <div key={inc.row_id} style={{
                ...styles.card, padding: 0, display: "flex", flexDirection: "column",
                borderLeft: `4px solid ${isClosed ? "#94a3b8" : (staCfg.color || "#ef4444")}`,
              }}>
                {/* Card header */}
                <div style={{ padding: "14px 16px 10px", borderBottom: `1px solid ${isDark ? "#334155" : "#f1f5f9"}`, borderRadius: "12px 12px 0 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#3b82f6" }}>#{inc.event_id}</span>
                    <span style={{ fontSize: 11, color: isDark ? "#64748b" : "#94a3b8" }}>
                      {inc.date_incident ? new Date(inc.date_incident + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : ""}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: isDark ? "#f1f5f9" : "#0f172a", lineHeight: 1.3 }}>{inc.customerName}</div>
                  <div style={{ fontSize: 11, color: isDark ? "#64748b" : "#94a3b8", marginTop: 2 }}>{inc.districtName}</div>
                  {inc.event_category && (
                    <span style={{ display: "inline-block", marginTop: 6, padding: "2px 8px", borderRadius: 20, background: isDark ? "#334155" : "#f1f5f9", fontSize: 11, color: isDark ? "#cbd5e1" : "#475569" }}>
                      {inc.event_category}
                    </span>
                  )}
                </div>

                {/* Summary preview (AI summary when available, else raw text). */}
                {preview && (
                  <div
                    title={isAiSummary && rawText ? rawText : undefined}
                    style={{ padding: "10px 16px", fontSize: 12.5, color: isDark ? "#cbd5e1" : "#475569", lineHeight: 1.5, flex: 1,
                      display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
                      cursor: isAiSummary && rawText ? "help" : "default" }}
                  >
                    {isAiSummary && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#6366f1", marginRight: 6, letterSpacing: "0.03em", textTransform: "uppercase" }}>✨ Summary</span>
                    )}
                    {preview}
                  </div>
                )}

                {/* Quick-edit footer */}
                <div style={{ padding: "10px 16px", borderTop: `1px solid ${isDark ? "#334155" : "#f1f5f9"}`, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <QuickEdit value={inc.incident_severity || "—"} options={SEVERITY_OPTS} colorMap={SEVERITY_COLORS} field="incident_severity" rowId={inc.row_id} onUpdated={handleUpdated} isDark={isDark} />
                  <QuickEdit value={normStatus            || "—"} options={STATUS_OPTS}   colorMap={STATUS_COLORS}   field="incident_status"   rowId={inc.row_id} onUpdated={handleUpdated} incident={inc} role={role} isDark={isDark} />
                  <button
                    onClick={() => setModalIncident(inc)}
                    style={{ marginLeft: "auto", padding: "3px 10px", borderRadius: 6, border: `1px solid ${isDark ? "#475569" : "#e2e8f0"}`, background: isDark ? "#334155" : "#fff", cursor: "pointer", fontSize: 11, color: isDark ? "#cbd5e1" : "#475569", fontWeight: 500 }}
                  >
                    View ↗
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Incident Detail Modal ── */}
      {modalIncident && (
        <IncidentModal
          incident={enriched.find(i => i.row_id === modalIncident.row_id) ?? modalIncident}
          listMap={listMap}
          componentsMap={componentsMap}
          vendorMap={vendorMap}
          onClose={() => setModalIncident(null)}
          onUpdated={handleUpdated}
          role={role}
          isDark={isDark}
        />
      )}
    </div>
  );
}

// ── Styles (theme-aware factory) ──────────────────────────────────────────────
function makeStyles(isDark: boolean): Record<string, React.CSSProperties> {
  const cardBg = isDark ? "#1e293b" : "#fff";
  const cardBorder = isDark ? "#334155" : "#e2e8f0";
  const subtle = isDark ? "#94a3b8" : "#64748b";
  const heading = isDark ? "#f1f5f9" : "#0f172a";
  return {
  page:        { padding: "32px 40px", fontFamily: "'DM Sans','Segoe UI',sans-serif", background: isDark ? "#0f172a" : "#f8fafc", minHeight: "100vh" },
  headerRow:   { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 },
  heading:     { fontSize: 28, fontWeight: 700, color: heading, margin: "0 0 4px" },
  subheading:  { fontSize: 14, color: subtle, margin: 0 },
  filterSelect:{ padding: "10px 16px", borderRadius: 8, border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`, background: cardBg, fontSize: 14, fontWeight: 500, color: isDark ? "#cbd5e1" : "#334155", cursor: "pointer", outline: "none", minWidth: 150 },
  sectionTitle:{ fontSize: 16, fontWeight: 600, color: isDark ? "#cbd5e1" : "#334155", margin: "28px 0 16px", display: "flex", alignItems: "center", gap: 10 },
  sectionBadge:{ fontSize: 12, fontWeight: 500, padding: "2px 10px", borderRadius: 20, background: isDark ? "#334155" : "#e2e8f0", color: isDark ? "#cbd5e1" : "#475569" },
  grid4:       { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 16 },
  gridAuto:    { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 16 },
  card:        { background: cardBg, borderRadius: 12, padding: "20px 20px 16px", border: `1px solid ${cardBorder}`, boxShadow: isDark ? "0 1px 3px rgba(0,0,0,0.4)" : "0 1px 3px rgba(0,0,0,0.06)" },
  cardLabel:   { fontSize: 13, fontWeight: 500, color: subtle },
  cardValue:   { fontSize: 28, fontWeight: 700, color: heading, marginTop: 10, minHeight: 36 },
  iconBadge:   { fontSize: 16, borderRadius: 8, padding: "6px 8px" },
  skeleton:    { display: "inline-block", width: 80, height: 28, borderRadius: 6, background: isDark ? "#334155" : "#e2e8f0" },
  errorBanner: { background: isDark ? "#450a0a" : "#fef2f2", border: `1px solid ${isDark ? "#7f1d1d" : "#fecaca"}`, color: isDark ? "#fca5a5" : "#dc2626", borderRadius: 8, padding: "10px 16px", marginBottom: 20, fontSize: 13 },
  };
}
