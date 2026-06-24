import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme-context";
import { generateExecutiveOverviewPDF } from "../lib/generateExecutiveOverviewPDF";
import {
  TrendingUp,
  AlertTriangle,
  ShieldAlert,
  Clock,
  Building2,
  Download,
  ExternalLink,
  Filter,
  Search,
  X,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────
type Summary = {
  total_visits: number;
  total_visit_hours: number;
  total_incidents: number;
  open_incidents: number;
  total_xfire_panels: number;
  leased_xfire_panels: number;
  total_barrels: number;
  total_stages: number;
};

type TrendRow = {
  month: string;
  total_incidents: number;
  xc_caused_incidents: number;
  critical_incidents: number;
  closed_incidents: number;
  open_incidents: number;
};

type AgingRow = {
  age_bucket: string;
  bucket_order: number;
  open_count: number;
  xc_caused_count: number;
  critical_count: number;
  unreviewed_count: number;
};

type CustomerRow = {
  customer_id: string;
  customer_name: string;
  total_incidents: number;
  xc_caused_incidents: number;
  total_stages: number;
};

type DistrictRow = {
  district_id: string;
  customer_district: string;
  customer_name: string;
  total_incidents: number;
  xc_caused_incidents: number;
  stages_per_xc_incident: number;
};

// Raw incident row used to recompute incident-derived metrics client-side so the
// Customer / District / Date-range filters can re-slice the data without new views.
type IncidentRow = {
  event_id: string | null;
  date_incident: string | null;
  incident_status: string | null;
  incident_severity: string | null;
  xc_caused: string | null;
  customer: string | null;
  customer_district: string | null;
  stage_number: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1) + "K";
  return v.toLocaleString();
}

function pct(part: number, whole: number): string {
  if (!whole) return "0%";
  return Math.round((part / whole) * 100) + "%";
}

function monthLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

// Shared input styling for the filter bar controls. Factory functions so the
// controls respond to dark mode (see Executive() → useTheme()).
function makeSelectStyle(isDark: boolean): React.CSSProperties {
  return {
    appearance: "none",
    background: isDark ? "#0f172a" : "#fff",
    border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
    borderRadius: 9,
    padding: "9px 12px",
    fontSize: 13.5,
    color: isDark ? "#f1f5f9" : "#0f172a",
    fontWeight: 600,
    minWidth: 170,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}

function makeInputStyle(isDark: boolean): React.CSSProperties {
  return {
    background: isDark ? "#0f172a" : "#fff",
    border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
    borderRadius: 9,
    padding: "8px 11px",
    fontSize: 13.5,
    color: isDark ? "#f1f5f9" : "#0f172a",
    fontWeight: 600,
    fontFamily: "inherit",
  };
}

// ── Small UI primitives ────────────────────────────────────────────────────────
function KpiCard({
  icon,
  label,
  value,
  sub,
  accent,
  isDark,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent: string;
  isDark: boolean;
}) {
  return (
    <div
      style={{
        background: isDark ? "#1e293b" : "#fff",
        border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
        borderRadius: 14,
        padding: "20px 22px",
        boxShadow: isDark ? "0 1px 3px rgba(0,0,0,0.4)" : "0 1px 3px rgba(0,0,0,0.05)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 34,
            height: 34,
            borderRadius: 9,
            background: accent + "1a",
            color: accent,
          }}
        >
          {icon}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: isDark ? "#94a3b8" : "#64748b" }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 30, fontWeight: 700, color: isDark ? "#f1f5f9" : "#0f172a", lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 12.5, color: isDark ? "#94a3b8" : "#94a3b8" }}>{sub}</div>}
    </div>
  );
}

function SectionCard({
  title,
  children,
  right,
  isDark,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
  isDark: boolean;
}) {
  return (
    <div
      style={{
        background: isDark ? "#1e293b" : "#fff",
        border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
        borderRadius: 14,
        padding: 22,
        boxShadow: isDark ? "0 1px 3px rgba(0,0,0,0.4)" : "0 1px 3px rgba(0,0,0,0.05)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <h3 style={{ fontSize: 15, fontWeight: 700, color: isDark ? "#f1f5f9" : "#0f172a", margin: 0 }}>
          {title}
        </h3>
        {right}
      </div>
      {children}
    </div>
  );
}

// Lightweight inline bar chart for the monthly trend (no chart dependency).
function TrendChart({ rows, isDark }: { rows: TrendRow[]; isDark: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.total_incidents));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 200 }}>
      {rows.map((r) => {
        const totalH = (r.total_incidents / max) * 170;
        const xcH = (r.xc_caused_incidents / max) * 170;
        return (
          <div
            key={r.month}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
            }}
            title={`${monthLabel(r.month)} — ${r.total_incidents} incidents, ${r.xc_caused_incidents} XC-caused`}
          >
            <div
              style={{
                position: "relative",
                width: "100%",
                maxWidth: 38,
                height: totalH,
                background: isDark ? "#334155" : "#e2e8f0",
                borderRadius: "6px 6px 0 0",
                display: "flex",
                alignItems: "flex-end",
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: xcH,
                  background: "#dc2626",
                  borderRadius: "6px 6px 0 0",
                }}
              />
            </div>
            <span style={{ fontSize: 11, color: isDark ? "#94a3b8" : "#64748b", fontWeight: 600 }}>
              {monthLabel(r.month)}
            </span>
            <span style={{ fontSize: 11, color: isDark ? "#f1f5f9" : "#0f172a", fontWeight: 700 }}>
              {r.total_incidents}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function Executive() {
  const { isDark } = useTheme();
  const selectStyle = useMemo(() => makeSelectStyle(isDark), [isDark]);
  const inputStyle = useMemo(() => makeInputStyle(isDark), [isDark]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  // Raw incidents power the filterable, client-recomputed sections.
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  // Lookup maps: incidents store customer / district as row_ids, so we resolve
  // them to display names everywhere (filter dropdowns, top tables, search).
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({});
  const [districtNames, setDistrictNames] = useState<Record<string, string>>({});
  const custName = (id: string | null | undefined) => (id ? customerNames[id] || id : "—");
  const distName = (id: string | null | undefined) => (id ? districtNames[id] || id : "—");

  // ── Filters (Customer / District / Date range) ──────────────────────────────
  const [filterCustomer, setFilterCustomer] = useState("");
  const [filterDistrict, setFilterDistrict] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [s, inc, cust, dist] = await Promise.all([
          // Global KPIs that are NOT incident-derived (panels, barrels, stages,
          // visits) stay sourced from the summary view — they are not scoped by
          // the customer/district/date filters.
          supabase.from("v_dashboard_summary").select("*").maybeSingle(),
          // Raw incidents — recomputed client-side so filters can re-slice them.
          supabase
            .from("incidents")
            .select(
              "event_id,date_incident,incident_status,incident_severity,xc_caused,customer,customer_district,stage_number"
            ),
          // Lookup tables to resolve customer / district row_ids to names.
          supabase.from("customers").select("row_id,customer"),
          supabase.from("districts").select("row_id,customer_district"),
        ]);

        if (cancelled) return;
        if (s.error) throw s.error;
        if (inc.error) throw inc.error;
        if (cust.error) throw cust.error;
        if (dist.error) throw dist.error;

        const custMap: Record<string, string> = {};
        for (const r of (cust.data as any[]) || []) custMap[r.row_id] = r.customer;
        const distMap: Record<string, string> = {};
        for (const r of (dist.data as any[]) || []) distMap[r.row_id] = r.customer_district;

        setSummary((s.data as Summary) || null);
        setIncidents((inc.data as IncidentRow[]) || []);
        setCustomerNames(custMap);
        setDistrictNames(distMap);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load executive data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Filter option lists (from the full, unfiltered dataset) ──────────────────
  const customerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const i of incidents) if (i.customer) set.add(i.customer);
    return Array.from(set).sort((a, b) => custName(a).localeCompare(custName(b)));
  }, [incidents, customerNames]);

  // Districts available for the chosen customer (or all customers).
  const districtOptions = useMemo(() => {
    const set = new Set<string>();
    for (const i of incidents) {
      if (filterCustomer && i.customer !== filterCustomer) continue;
      if (i.customer_district) set.add(i.customer_district);
    }
    return Array.from(set).sort((a, b) => distName(a).localeCompare(distName(b)));
  }, [incidents, filterCustomer, districtNames]);

  const filtersActive = !!(filterCustomer || filterDistrict || dateFrom || dateTo || search.trim());

  function clearFilters() {
    setFilterCustomer("");
    setFilterDistrict("");
    setDateFrom("");
    setDateTo("");
    setSearch("");
  }

  // ── Apply filters + search to the raw incidents ─────────────────────────────
  // Search matches event id, customer, district, category, severity and status.
  const filteredIncidents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return incidents.filter((i) => {
      if (filterCustomer && i.customer !== filterCustomer) return false;
      if (filterDistrict && i.customer_district !== filterDistrict) return false;
      if (dateFrom && (!i.date_incident || i.date_incident < dateFrom)) return false;
      if (dateTo && (!i.date_incident || i.date_incident > dateTo)) return false;
      if (q) {
        const hay = [
          i.event_id,
          custName(i.customer),
          distName(i.customer_district),
          i.incident_severity,
          i.incident_status,
          i.xc_caused,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [incidents, filterCustomer, filterDistrict, dateFrom, dateTo, search, customerNames, districtNames]);

  // ── Recompute incident-derived metrics from the filtered set ────────────────
  // Definitions mirror the original Supabase views exactly:
  //   XC-caused      = xc_caused === 'Yes'
  //   Critical       = incident_severity === 'Critical'
  //   open (trend/aging) = incident_status !== 'Closed'
  //   open (KPI)         = incident_status === 'New'
  const isXc = (i: IncidentRow) => i.xc_caused === "Yes";
  const isOpenNotClosed = (i: IncidentRow) => i.incident_status !== "Closed";

  // Total / open KPI counts.
  const totalIncidents = filteredIncidents.length;
  const openNewCount = useMemo(
    () => filteredIncidents.filter((i) => i.incident_status === "New").length,
    [filteredIncidents]
  );

  // Monthly trend (last 12 months of the filtered set).
  const trend = useMemo<TrendRow[]>(() => {
    const byMonth = new Map<string, TrendRow>();
    for (const i of filteredIncidents) {
      if (!i.date_incident) continue;
      const month = i.date_incident.slice(0, 7) + "-01"; // YYYY-MM-01
      let r = byMonth.get(month);
      if (!r) {
        r = {
          month,
          total_incidents: 0,
          xc_caused_incidents: 0,
          critical_incidents: 0,
          closed_incidents: 0,
          open_incidents: 0,
        };
        byMonth.set(month, r);
      }
      r.total_incidents++;
      if (isXc(i)) r.xc_caused_incidents++;
      if (i.incident_severity === "Critical") r.critical_incidents++;
      if (i.incident_status === "Closed") r.closed_incidents++;
      else r.open_incidents++;
    }
    return Array.from(byMonth.values())
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-12);
  }, [filteredIncidents]);

  // Open-incident aging buckets (status <> Closed), matching v_incident_open_aging.
  const aging = useMemo<AgingRow[]>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const buckets: Record<string, AgingRow> = {
      "0-7 days": { age_bucket: "0-7 days", bucket_order: 1, open_count: 0, xc_caused_count: 0, critical_count: 0, unreviewed_count: 0 },
      "8-30 days": { age_bucket: "8-30 days", bucket_order: 2, open_count: 0, xc_caused_count: 0, critical_count: 0, unreviewed_count: 0 },
      "31-90 days": { age_bucket: "31-90 days", bucket_order: 3, open_count: 0, xc_caused_count: 0, critical_count: 0, unreviewed_count: 0 },
      "90+ days": { age_bucket: "90+ days", bucket_order: 4, open_count: 0, xc_caused_count: 0, critical_count: 0, unreviewed_count: 0 },
    };
    for (const i of filteredIncidents) {
      if (!isOpenNotClosed(i) || !i.date_incident) continue;
      const d = new Date(i.date_incident + "T00:00:00");
      const ageDays = Math.floor((today.getTime() - d.getTime()) / 86_400_000);
      const key =
        ageDays <= 7 ? "0-7 days" : ageDays <= 30 ? "8-30 days" : ageDays <= 90 ? "31-90 days" : "90+ days";
      const b = buckets[key];
      b.open_count++;
      if (isXc(i)) b.xc_caused_count++;
      if (i.incident_severity === "Critical") b.critical_count++;
    }
    return Object.values(buckets)
      .filter((b) => b.open_count > 0)
      .sort((a, b) => a.bucket_order - b.bucket_order);
  }, [filteredIncidents]);

  // Top customers by XC-caused (matches v_exec_customer_incidents shape).
  const customers = useMemo<CustomerRow[]>(() => {
    const map = new Map<string, CustomerRow>();
    for (const i of filteredIncidents) {
      const id = i.customer || "—";
      let r = map.get(id);
      if (!r) {
        r = { customer_id: id, customer_name: custName(i.customer), total_incidents: 0, xc_caused_incidents: 0, total_stages: 0 };
        map.set(id, r);
      }
      r.total_incidents++;
      if (isXc(i)) r.xc_caused_incidents++;
      const st = Number(i.stage_number);
      if (Number.isFinite(st)) r.total_stages += st;
    }
    return Array.from(map.values())
      .sort((a, b) => b.xc_caused_incidents - a.xc_caused_incidents || b.total_incidents - a.total_incidents)
      .slice(0, 8);
  }, [filteredIncidents, customerNames]);

  // Top districts (matches v_exec_district_incidents shape).
  const districts = useMemo<DistrictRow[]>(() => {
    const map = new Map<string, DistrictRow>();
    for (const i of filteredIncidents) {
      const id = i.customer_district || "—";
      let r = map.get(id);
      if (!r) {
        r = {
          district_id: id,
          customer_district: distName(i.customer_district),
          customer_name: custName(i.customer),
          total_incidents: 0,
          xc_caused_incidents: 0,
          stages_per_xc_incident: 0,
        };
        map.set(id, r);
      }
      r.total_incidents++;
      if (isXc(i)) r.xc_caused_incidents++;
      const st = Number(i.stage_number);
      if (Number.isFinite(st)) (r as any)._stages = ((r as any)._stages || 0) + st;
    }
    const rows = Array.from(map.values());
    for (const r of rows) {
      const stages = (r as any)._stages || 0;
      r.stages_per_xc_incident = r.xc_caused_incidents ? stages / r.xc_caused_incidents : 0;
    }
    return rows
      .sort((a, b) => b.xc_caused_incidents - a.xc_caused_incidents || b.total_incidents - a.total_incidents)
      .slice(0, 8);
  }, [filteredIncidents, customerNames, districtNames]);

  const xcRate = useMemo(() => {
    if (!filteredIncidents.length) return null;
    const totXc = filteredIncidents.filter(isXc).length;
    return { totXc, tot: filteredIncidents.length };
  }, [filteredIncidents]);

  const totalOpen = useMemo(() => aging.reduce((s, r) => s + r.open_count, 0), [aging]);
  const aged90 = useMemo(
    () => aging.find((r) => r.age_bucket === "90+ days")?.open_count || 0,
    [aging]
  );

  if (loading) {
    return (
      <div style={{ padding: 32, fontFamily: "'DM Sans','Segoe UI',sans-serif", background: isDark ? "#0f172a" : "#f8fafc", minHeight: "100vh" }}>
        <div style={{ fontSize: 16, color: isDark ? "#94a3b8" : "#64748b" }}>Loading executive overview…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 32, fontFamily: "'DM Sans','Segoe UI',sans-serif", background: isDark ? "#0f172a" : "#f8fafc", minHeight: "100vh" }}>
        <div
          style={{
            background: isDark ? "#3f1d1d" : "#fef2f2",
            border: `1px solid ${isDark ? "#7f1d1d" : "#fecaca"}`,
            color: isDark ? "#fca5a5" : "#b91c1c",
            borderRadius: 12,
            padding: 18,
          }}
        >
          {error}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "28px 32px 56px",
        fontFamily: "'DM Sans','Segoe UI',sans-serif",
        background: isDark ? "#0f172a" : "#f8fafc",
        minHeight: "100vh",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 24,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: isDark ? "#f1f5f9" : "#0f172a", margin: 0 }}>
            Executive Overview
          </h1>
          <p style={{ fontSize: 14, color: isDark ? "#94a3b8" : "#64748b", margin: "6px 0 0" }}>
            Read-only summary across all customers and districts.
          </p>
        </div>
        <button
          onClick={async () => {
            try {
              await generateExecutiveOverviewPDF({
                totals: {
                  totalIncidents,
                  openNewCount,
                  xcRate: xcRate ? Math.round((xcRate.totXc / xcRate.tot) * 100) : null,
                  xcCausedCount: xcRate ? xcRate.totXc : 0,
                  totalOpen,
                  aged90,
                  totalStages: summary?.total_stages ?? 0,
                  totalBarrels: summary?.total_barrels ?? 0,
                  totalXfirePanels: summary?.total_xfire_panels ?? 0,
                  leasedXfirePanels: summary?.leased_xfire_panels ?? 0,
                },
                trend,
                aging,
                customers,
                districts,
                filters: {
                  customer: filterCustomer ? custName(filterCustomer) : undefined,
                  district: filterDistrict ? distName(filterDistrict) : undefined,
                  dateFrom: dateFrom || undefined,
                  dateTo: dateTo || undefined,
                  search: search.trim() || undefined,
                },
                filtersActive,
              });
            } catch (e) {
              toast.error("PDF export failed: " + (e as Error).message);
            }
          }}
          className="exec-print-btn"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: isDark ? "#3b82f6" : "#0f172a",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            padding: "10px 16px",
            fontSize: 13.5,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <Download size={16} /> Download PDF
        </button>
      </div>

      {/* Filter bar */}
      <div
        className="exec-filter-bar"
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 14,
          flexWrap: "wrap",
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: 14,
          padding: "16px 18px",
          marginBottom: 24,
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        }}
      >
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#0f172a", fontWeight: 700, fontSize: 14, paddingBottom: 6 }}>
          <Filter size={16} /> Filters
        </div>

        {/* Search */}
        <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: "#64748b" }}>
          Search
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", pointerEvents: "none" }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Customer, district, event ID…"
              style={{ ...inputStyle, paddingLeft: 30, minWidth: 220 }}
            />
          </div>
        </label>

        {/* Customer */}
        <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: "#64748b" }}>
          Customer
          <select
            value={filterCustomer}
            onChange={(e) => {
              setFilterCustomer(e.target.value);
              setFilterDistrict(""); // reset district when customer changes
            }}
            style={selectStyle}
          >
            <option value="">All customers</option>
            {customerOptions.map((c) => (
              <option key={c} value={c}>
                {custName(c)}
              </option>
            ))}
          </select>
        </label>

        {/* District */}
        <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: "#64748b" }}>
          District
          <select
            value={filterDistrict}
            onChange={(e) => setFilterDistrict(e.target.value)}
            style={selectStyle}
          >
            <option value="">All districts</option>
            {districtOptions.map((d) => (
              <option key={d} value={d}>
                {distName(d)}
              </option>
            ))}
          </select>
        </label>

        {/* Date range */}
        <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: "#64748b" }}>
          From
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: "#64748b" }}>
          To
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={inputStyle} />
        </label>

        {filtersActive && (
          <button
            onClick={clearFilters}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: isDark ? "#0f172a" : "#f1f5f9",
              color: isDark ? "#cbd5e1" : "#475569",
              border: `1px solid ${isDark ? "#475569" : "#e2e8f0"}`,
              borderRadius: 10,
              padding: "9px 13px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <X size={14} /> Clear
          </button>
        )}

        <div style={{ marginLeft: "auto", fontSize: 12.5, color: isDark ? "#94a3b8" : "#94a3b8", paddingBottom: 6 }}>
          {filtersActive
            ? `Incident metrics reflect ${fmt(totalIncidents)} matching incidents. Panels, barrels, stages & visit KPIs are company-wide.`
            : "Showing all customers and districts."}
        </div>
      </div>

      {/* KPI row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <KpiCard
          icon={<AlertTriangle size={18} />}
          label={filtersActive ? "Incidents (filtered)" : "Total Incidents"}
          value={fmt(totalIncidents)}
          sub={`${fmt(openNewCount)} currently open (New)`}
          accent="#0ea5e9"
          isDark={isDark}
        />
        <KpiCard
          icon={<ShieldAlert size={18} />}
          label="XC-Caused Rate"
          value={xcRate ? pct(xcRate.totXc, xcRate.tot) : "—"}
          sub={xcRate ? `${xcRate.totXc} of ${xcRate.tot} (trailing)` : undefined}
          accent="#dc2626"
          isDark={isDark}
        />
        <KpiCard
          icon={<Clock size={18} />}
          label="Aged Open (90+ d)"
          value={fmt(aged90)}
          sub={`of ${fmt(totalOpen)} open`}
          accent="#f59e0b"
          isDark={isDark}
        />
        <KpiCard
          icon={<TrendingUp size={18} />}
          label="Total Stages"
          value={fmt(summary?.total_stages)}
          sub={`${fmt(summary?.total_barrels)} barrels`}
          accent="#16a34a"
          isDark={isDark}
        />
        <KpiCard
          icon={<Building2 size={18} />}
          label="XFire Panels"
          value={fmt(summary?.total_xfire_panels)}
          sub={`${fmt(summary?.leased_xfire_panels)} leased`}
          accent="#7c3aed"
          isDark={isDark}
        />
      </div>

      {/* Trend + Aging */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
          gap: 16,
          marginBottom: 24,
        }}
        className="exec-two-col"
      >
        <SectionCard
          isDark={isDark}
          title="Incident Trend (last 12 months)"
          right={
            <div style={{ display: "flex", gap: 14, fontSize: 12, color: isDark ? "#94a3b8" : "#64748b" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 11, height: 11, borderRadius: 3, background: isDark ? "#334155" : "#e2e8f0", display: "inline-block" }} />
                Total
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 11, height: 11, borderRadius: 3, background: "#dc2626", display: "inline-block" }} />
                XC-caused
              </span>
            </div>
          }
        >
          {trend.length ? (
            <TrendChart rows={trend} isDark={isDark} />
          ) : (
            <div style={{ color: "#94a3b8", fontSize: 13 }}>No incident data.</div>
          )}
        </SectionCard>

        <SectionCard title="Open Incident Aging" isDark={isDark}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {aging.map((r) => {
              const ratio = totalOpen ? r.open_count / totalOpen : 0;
              const danger = r.age_bucket === "90+ days";
              return (
                <div key={r.age_bucket}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 13,
                      marginBottom: 5,
                    }}
                  >
                    <span style={{ color: isDark ? "#cbd5e1" : "#475569", fontWeight: 600 }}>{r.age_bucket}</span>
                    <span style={{ color: isDark ? "#f1f5f9" : "#0f172a", fontWeight: 700 }}>
                      {r.open_count}
                      {r.xc_caused_count > 0 && (
                        <span style={{ color: "#dc2626", fontWeight: 600 }}>
                          {" "}
                          ({r.xc_caused_count} XC)
                        </span>
                      )}
                    </span>
                  </div>
                  <div
                    style={{
                      height: 9,
                      borderRadius: 5,
                      background: isDark ? "#0f172a" : "#f1f5f9",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.max(ratio * 100, r.open_count ? 4 : 0)}%`,
                        height: "100%",
                        background: danger ? "#dc2626" : "#0ea5e9",
                      }}
                    />
                  </div>
                </div>
              );
            })}
            {!aging.length && (
              <div style={{ color: "#94a3b8", fontSize: 13 }}>No open incidents.</div>
            )}
          </div>
        </SectionCard>
      </div>

      {/* Top customers + districts */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
          gap: 16,
        }}
      >
        <SectionCard title="Top Customers by XC-Caused Incidents" isDark={isDark}>
          <Table
            isDark={isDark}
            headers={["Customer", "XC-Caused", "Total", "Stages"]}
            rows={customers.map((c) => [
              <Link
                key={c.customer_id}
                to={`/customers/${c.customer_id}`}
                style={{ color: "#0ea5e9", textDecoration: "none", fontWeight: 600 }}
              >
                {c.customer_name || "—"}
              </Link>,
              <strong style={{ color: "#dc2626" }}>{c.xc_caused_incidents ?? 0}</strong>,
              c.total_incidents ?? 0,
              fmt(c.total_stages),
            ])}
            empty="No customer data."
          />
        </SectionCard>

        <SectionCard title="Districts — Stages per XC Incident" isDark={isDark}>
          <Table
            isDark={isDark}
            headers={["District", "XC-Caused", "Stages / XC Inc."]}
            rows={districts.map((d) => [
              <Link
                key={d.district_id}
                to={`/districts/${d.district_id}`}
                style={{ color: "#0ea5e9", textDecoration: "none", fontWeight: 600 }}
              >
                {d.customer_district || "—"}
                <span style={{ color: "#94a3b8", fontWeight: 400 }}>
                  {d.customer_name ? ` · ${d.customer_name}` : ""}
                </span>
              </Link>,
              <strong style={{ color: "#dc2626" }}>{d.xc_caused_incidents ?? 0}</strong>,
              d.stages_per_xc_incident != null
                ? Number(d.stages_per_xc_incident).toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })
                : "—",
            ])}
            empty="No district data."
          />
        </SectionCard>
      </div>

      <div
        style={{
          marginTop: 28,
          display: "flex",
          gap: 14,
          fontSize: 13,
          color: isDark ? "#94a3b8" : "#64748b",
        }}
      >
        <Link
          to="/incidents"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#0ea5e9", textDecoration: "none", fontWeight: 600 }}
        >
          View all incidents <ExternalLink size={14} />
        </Link>
        <Link
          to="/reports"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#0ea5e9", textDecoration: "none", fontWeight: 600 }}
        >
          Reports <ExternalLink size={14} />
        </Link>
      </div>

      <style>{`
        @media print {
          aside { display: none !important; }
          main { margin-left: 0 !important; }
          .exec-print-btn { display: none !important; }
          .exec-filter-bar { display: none !important; }
        }
        @media (max-width: 900px) {
          .exec-two-col { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function Table({
  headers,
  rows,
  empty,
  isDark,
}: {
  headers: string[];
  rows: React.ReactNode[][];
  empty: string;
  isDark: boolean;
}) {
  if (!rows.length) {
    return <div style={{ color: "#94a3b8", fontSize: 13 }}>{empty}</div>;
  }
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th
              key={h}
              style={{
                textAlign: i === 0 ? "left" : "right",
                padding: "8px 6px",
                borderBottom: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                color: isDark ? "#94a3b8" : "#64748b",
                fontSize: 12,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 0.4,
              }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((cells, ri) => (
          <tr key={ri}>
            {cells.map((cell, ci) => (
              <td
                key={ci}
                style={{
                  textAlign: ci === 0 ? "left" : "right",
                  padding: "10px 6px",
                  borderBottom: `1px solid ${isDark ? "#334155" : "#f1f5f9"}`,
                  color: isDark ? "#f1f5f9" : "#0f172a",
                }}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
