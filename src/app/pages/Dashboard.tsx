import React, { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth-context";
import { toast } from "sonner";
import {
  INCIDENT_STATUSES,
  STATUS_COLORS as WORKFLOW_STATUS_COLORS,
  normalizeStatus,
  validateForStatus,
  statusOptionsForRole,
  isGatedStatus,
  CLOSED_STATUS,
} from "../lib/incidentWorkflow";

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
function QuickEdit({ value, options, colorMap, field, rowId, onUpdated, incident, role }: {
  value: string; options: string[];
  colorMap: Record<string, { bg: string; color: string }>;
  field: string; rowId: string;
  onUpdated: (rowId: string, field: string, value: string) => void;
  incident?: Record<string, any>;
  role?: 'admin' | 'sqm';
}) {
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const cur = colorMap[value] ?? { bg: "#f1f5f9", color: "#475569" };

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
    const { error } = await supabase.from("incidents").update({ [field]: opt }).eq("row_id", rowId);
    if (!error) onUpdated(rowId, field, opt);
    else toast.error(error.message || "Failed to update");
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
          background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8,
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)", minWidth: 140, overflow: "hidden",
        }}>
          {effectiveOptions.map(opt => {
            const c = colorMap[opt] ?? { bg: "#f8fafc", color: "#475569" };
            return (
              <button key={opt} onClick={() => handleSelect(opt)} style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "8px 12px", border: "none", cursor: "pointer",
                fontSize: 12, fontWeight: opt === value ? 700 : 400,
                background: opt === value ? "#f8fafc" : "#fff", color: "#0f172a",
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
function IncidentModal({ incident, listMap, vendorMap, onClose, onUpdated, role }: {
  incident: any; listMap: Record<string, any>; vendorMap: Record<string, string>;
  onClose: () => void; onUpdated: (rowId: string, field: string, value: string) => void;
  role?: 'admin' | 'sqm';
}) {
  const r = incident;
  const failedComp  = listMap[r.failed_component]?.failed_component || r.failed_component || null;
  const failureType = listMap[r.failure_type]?.failure_type          || r.failure_type     || null;
  const vendorName  = vendorMap[r.vendor]                            || r.vendor           || null;

  return (
    <div style={modal.overlay} onClick={onClose}>
      <div style={modal.box} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={modal.header}>
          <div>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#0f172a" }}>Incident #{r.event_id}</span>
            <span style={{ marginLeft: 10, fontSize: 13, color: "#64748b" }}>{r.date_incident ? new Date(r.date_incident + "T00:00:00").toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" }) : ""}</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#64748b", lineHeight: 1 }}>✕</button>
        </div>

        {/* Quick-edit row */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "12px 20px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={modal.qLabel}>XC Caused</span>
            <QuickEdit value={r.xc_caused || "—"} options={XC_CAUSED_OPTS} colorMap={XC_COLORS} field="xc_caused" rowId={r.row_id} onUpdated={onUpdated} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={modal.qLabel}>Severity</span>
            <QuickEdit value={r.incident_severity || "—"} options={SEVERITY_OPTS} colorMap={SEVERITY_COLORS} field="incident_severity" rowId={r.row_id} onUpdated={onUpdated} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={modal.qLabel}>Status</span>
            <QuickEdit value={normalizeStatus(r.incident_status) || "—"} options={STATUS_OPTS} colorMap={STATUS_COLORS} field="incident_status" rowId={r.row_id} onUpdated={onUpdated} incident={r} role={role} />
          </div>
          {r.vendor_caused !== null && r.vendor_caused !== undefined && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={modal.qLabel}>Vendor Caused</span>
              <QuickEdit value={r.vendor_caused || "—"} options={VENDOR_CAUSED_OPTS} colorMap={{ Yes: { bg: "#dc2626", color: "#fff" }, No: { bg: "#f1f5f9", color: "#475569" }, "Pending Investigation": { bg: "#fef9c3", color: "#854d0e" } }} field="vendor_caused" rowId={r.row_id} onUpdated={onUpdated} />
            </div>
          )}
        </div>

        {/* Scrollable content */}
        <div style={modal.body}>
          {/* Info grid */}
          <div style={modal.grid}>
            {r.customerName  && <InfoItem label="Customer"        value={r.customerName} />}
            {r.districtName  && <InfoItem label="District"        value={r.districtName} />}
            {r.xc_rep        && <InfoItem label="XC Rep"          value={r.xc_rep} />}
            {r.customer_rep  && <InfoItem label="Customer Rep"    value={r.customer_rep} />}
            {r.ep_rep        && <InfoItem label="EP Rep"          value={r.ep_rep} />}
            {r.event_category && <InfoItem label="Category"       value={r.event_category} />}
            {r.product_line  && <InfoItem label="Product Line"    value={r.product_line} />}
            {r.firing_system && <InfoItem label="Firing System"   value={r.firing_system} />}
            {r.field_facility && <InfoItem label="Field/Facility" value={r.field_facility} />}
            {r.well_name     && <InfoItem label="Well Name"       value={r.well_name} />}
            {r['stage#']     && <InfoItem label="Stage #"         value={r['stage#']} />}
            {r['so#']        && <InfoItem label="SO #"            value={r['so#']} />}
            {failedComp      && <InfoItem label="Failed Component" value={failedComp} />}
            {failureType     && <InfoItem label="Failure Type"    value={failureType} />}
            {vendorName      && <InfoItem label="Vendor"          value={vendorName} />}
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

          {/* Images */}
          {(r.image1 || r.image2) && (
            <div style={{ marginBottom: 14 }}>
              <div style={modal.blockLabel}>Evidence Images</div>
              <div style={{ display: "flex", gap: 10 }}>
                {[r.image1, r.image2].filter(Boolean).map((url: string, i: number) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{ display: "block", flex: 1, borderRadius: 8, overflow: "hidden", border: "1px solid #e2e8f0" }}>
                    <img src={url} alt={`Evidence ${i+1}`} style={{ width: "100%", height: 160, objectFit: "cover", display: "block" }}
                      onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Slack */}
          {r.slack_url && (
            <div>
              <div style={modal.blockLabel}>Slack Notification</div>
              <a href={r.slack_url} target="_blank" rel="noopener noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 8, background: "#4A154B", color: "#fff", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
                <span>💬</span> View in Slack ↗
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: "#0f172a" }}>{value}</div>
    </div>
  );
}

const modal: Record<string, React.CSSProperties> = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 },
  box: { background: "#fff", borderRadius: 16, width: "100%", maxWidth: 740, maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.25)", overflow: "hidden" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid #e2e8f0" },
  qLabel: { fontSize: 11, fontWeight: 600, color: "#94a3b8" },
  body: { overflowY: "auto", padding: 20, flex: 1 },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 24px", marginBottom: 20, padding: 14, background: "#f8fafc", borderRadius: 8 },
  blockLabel: { fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 },
  blockText: { fontSize: 13, color: "#475569", background: "#f8fafc", padding: "10px 12px", borderRadius: 6, whiteSpace: "pre-wrap", lineHeight: 1.6 },
};

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ title, value, icon, loading, accent = "#6366f1" }: { title: string; value: string | number; icon: string; loading: boolean; accent?: string }) {
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

function PanelStatusCard({ status, count, total, loading }: { status: string; count: number; total: number; loading?: boolean }) {
  const cfg = STATUS_CONFIG[status] ?? { color: "#64748b", bg: "#f8fafc" };
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div style={{ ...styles.card, borderTop: `3px solid ${cfg.color}` }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={styles.cardLabel}>{status}</span>
        <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: cfg.bg, color: cfg.color }}>{loading ? "…" : `${pct}%`}</span>
      </div>
      <div style={styles.cardValue}>{loading ? <span style={styles.skeleton} /> : count}</div>
      <div style={{ marginTop: 12, height: 4, borderRadius: 2, background: "#e2e8f0" }}>
        <div style={{ height: "100%", borderRadius: 2, background: cfg.color, width: loading ? "0%" : `${pct}%`, transition: "width 0.6s ease" }} />
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user } = useAuth();
  const role = user?.role as 'admin' | 'sqm' | undefined;
  const displayName = user?.name && user.name !== "Admin User" ? user.name : null;
  const [timeFilter, setTimeFilter] = useState("all_time");
  const [incStatusFilter, setIncStatusFilter] = useState("all");
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
  const [customerMap,    setCustomerMap]    = useState<Record<string, string>>({});
  const [districtMap,    setDistrictMap]    = useState<Record<string, string>>({});
  const [listMap,        setListMap]        = useState<Record<string, any>>({});
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

  // ── Load reference tables once ──────────────────────────────────────────────
  useEffect(() => {
    async function loadRefs() {
      const [
        { data: custs },
        { data: dists },
        { data: lists },
        { data: vends },
      ] = await Promise.all([
        supabase.from("customers").select("row_id,customer"),
        supabase.from("districts").select("row_id,customer_district"),
        supabase.from("lists").select("row_id,failed_component,failure_type"),
        supabase.from("vendors").select("row_id,vendor"),
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

        const barrelsRaw = await fetchAllPages(applyDates(supabase.from("barrels_sold").select("quantity"), "date"));
        const barrels = barrelsRaw.reduce((s, r) => s + (parseFloat(r.quantity) || 0), 0);

        const stagesRaw = await fetchAllPages(applyDates(supabase.from("stages").select("quantity"), "date"));
        const stages = stagesRaw.reduce((s, r) => s + (parseFloat(r.quantity) || 0), 0);

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

      } catch (err: any) {
        console.error("Dashboard Error:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchAll();
  }, [timeFilter]);

  const totalIncidents = enriched.length;

  return (
    <div style={styles.page}>
      {error && <div style={styles.errorBanner}>⚠ Error loading data: {error}</div>}

      {/* ── Header ── */}
      <div style={styles.headerRow}>
        <div>
          <h1 style={styles.heading}>{displayName ? `Welcome back, ${displayName}!` : "Welcome back!"}</h1>
          <p style={styles.subheading}>Here's an overview of your company's performance</p>
        </div>
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

      {/* ── KPI row ── */}
      <div style={styles.grid4}>
        <StatCard title="Field Visit Hours" value={`${fmt(totalHours)} hrs`} icon="🕐" loading={loading} accent="#10b981" />
        <StatCard title="Total Visits"       value={fmt(totalVisits)}         icon="📋" loading={loading} accent="#6366f1" />
        <StatCard title="Barrels Sold"       value={fmt(totalBarrels)}        icon="🛢️" loading={loading} accent="#f97316" />
        <StatCard title="Total Incidents"    value={fmt(totalIncidents)}      icon="⚠️" loading={loading} accent="#ef4444" />
      </div>
      <div style={{ ...styles.grid4, gridTemplateColumns: "1fr 1fr" }}>
        <StatCard title="Stages"       value={fmt(totalStages)} icon="📈" loading={loading} accent="#8b5cf6" />
        <StatCard title="Total Panels" value={fmt(panelTotal)}  icon="📡" loading={loading} accent="#0ea5e9" />
      </div>

      {/* ── Panel Status Breakdown ── */}
      <h2 style={styles.sectionTitle}>
        Panel Status Breakdown
        {!loading && <span style={styles.sectionBadge}>{panelTotal} total</span>}
      </h2>
      <div style={styles.gridAuto}>
        {loading
          ? ["At Facility", "Leased", "In Repair", "Loaned", "Sold"].map(s => <PanelStatusCard key={s} status={s} count={0} total={0} loading />)
          : panelStatuses.map(({ status, count, total }) => <PanelStatusCard key={status} status={status} count={count} total={total} />)}
      </div>


      {/* ── Incident Review Table ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "28px 0 12px", flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ ...styles.sectionTitle, margin: 0 }}>
          Incident Review
          {!loading && <span style={styles.sectionBadge}>{enriched.length} of {incidents.length} incidents</span>}
        </h2>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(["all", ...INCIDENT_STATUSES] as const).map(opt => {
            const active = incStatusFilter === opt;
            const c = opt !== "all" ? (STATUS_COLORS[opt] ?? { bg: "#eef2ff", color: "#4f46e5" }) : { bg: "#eef2ff", color: "#4f46e5" };
            return (
              <button key={opt} onClick={() => setIncStatusFilter(opt)} style={{
                padding: "5px 14px", borderRadius: 20, border: "1px solid",
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                borderColor: active ? c.color : "#e2e8f0",
                background:  active ? c.bg    : "#fff",
                color:       active ? c.color : "#64748b",
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
      ) : enriched.length === 0 ? (
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: "40px", textAlign: "center", color: "#64748b", fontSize: 14, marginBottom: 28 }}>
          No XC-caused incidents found for this time period.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14, marginBottom: 28 }}>
          {enriched.map(inc => {
            const sevCfg = SEVERITY_COLORS[inc.incident_severity] ?? { bg: "#f1f5f9", color: "#475569" };
            const normStatus = normalizeStatus(inc.incident_status);
            const staCfg = STATUS_COLORS[normStatus]    ?? { bg: "#f1f5f9", color: "#475569" };
            const preview = inc.notes || inc.incident_description || inc.investigation || null;
            const isClosed = normStatus === CLOSED_STATUS;
            return (
              <div key={inc.row_id} style={{
                ...styles.card, padding: 0, display: "flex", flexDirection: "column",
                borderLeft: `4px solid ${isClosed ? "#94a3b8" : (staCfg.color || "#ef4444")}`,
              }}>
                {/* Card header */}
                <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid #f1f5f9", borderRadius: "12px 12px 0 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#3b82f6" }}>#{inc.event_id}</span>
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>
                      {inc.date_incident ? new Date(inc.date_incident + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : ""}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", lineHeight: 1.3 }}>{inc.customerName}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{inc.districtName}</div>
                  {inc.event_category && (
                    <span style={{ display: "inline-block", marginTop: 6, padding: "2px 8px", borderRadius: 20, background: "#f1f5f9", fontSize: 11, color: "#475569" }}>
                      {inc.event_category}
                    </span>
                  )}
                </div>

                {/* Notes preview */}
                {preview && (
                  <div style={{ padding: "10px 16px", fontSize: 12, color: "#64748b", lineHeight: 1.5, flex: 1,
                    display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {preview}
                  </div>
                )}

                {/* Quick-edit footer */}
                <div style={{ padding: "10px 16px", borderTop: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <QuickEdit value={inc.incident_severity || "—"} options={SEVERITY_OPTS} colorMap={SEVERITY_COLORS} field="incident_severity" rowId={inc.row_id} onUpdated={handleUpdated} />
                  <QuickEdit value={normStatus            || "—"} options={STATUS_OPTS}   colorMap={STATUS_COLORS}   field="incident_status"   rowId={inc.row_id} onUpdated={handleUpdated} incident={inc} role={role} />
                  <button
                    onClick={() => setModalIncident(inc)}
                    style={{ marginLeft: "auto", padding: "3px 10px", borderRadius: 6, border: "1px solid #e2e8f0", background: "#fff", cursor: "pointer", fontSize: 11, color: "#475569", fontWeight: 500 }}
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
          vendorMap={vendorMap}
          onClose={() => setModalIncident(null)}
          onUpdated={handleUpdated}
          role={role}
        />
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  page:        { padding: "32px 40px", fontFamily: "'DM Sans','Segoe UI',sans-serif", background: "#f8fafc", minHeight: "100vh" },
  headerRow:   { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 },
  heading:     { fontSize: 28, fontWeight: 700, color: "#0f172a", margin: "0 0 4px" },
  subheading:  { fontSize: 14, color: "#64748b", margin: 0 },
  filterSelect:{ padding: "10px 16px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", fontSize: 14, fontWeight: 500, color: "#334155", cursor: "pointer", outline: "none", minWidth: 150 },
  sectionTitle:{ fontSize: 16, fontWeight: 600, color: "#334155", margin: "28px 0 16px", display: "flex", alignItems: "center", gap: 10 },
  sectionBadge:{ fontSize: 12, fontWeight: 500, padding: "2px 10px", borderRadius: 20, background: "#e2e8f0", color: "#475569" },
  grid4:       { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 16 },
  gridAuto:    { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 16 },
  card:        { background: "#fff", borderRadius: 12, padding: "20px 20px 16px", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" },
  cardLabel:   { fontSize: 13, fontWeight: 500, color: "#64748b" },
  cardValue:   { fontSize: 28, fontWeight: 700, color: "#0f172a", marginTop: 10, minHeight: 36 },
  iconBadge:   { fontSize: 16, borderRadius: 8, padding: "6px 8px" },
  skeleton:    { display: "inline-block", width: 80, height: 28, borderRadius: 6, background: "#e2e8f0" },
  errorBanner: { background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", borderRadius: 8, padding: "10px 16px", marginBottom: 20, fontSize: 13 },
};
