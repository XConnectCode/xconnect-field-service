import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { supabase } from "../lib/supabase";
import {
  TrendingUp,
  AlertTriangle,
  ShieldAlert,
  Clock,
  Building2,
  Printer,
  ExternalLink,
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

// ── Small UI primitives ────────────────────────────────────────────────────────
function KpiCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent: string;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 14,
        padding: "20px 22px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
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
        <span style={{ fontSize: 13, fontWeight: 600, color: "#64748b" }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 30, fontWeight: 700, color: "#0f172a", lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 12.5, color: "#94a3b8" }}>{sub}</div>}
    </div>
  );
}

function SectionCard({
  title,
  children,
  right,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 14,
        padding: 22,
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
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
        <h3 style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", margin: 0 }}>
          {title}
        </h3>
        {right}
      </div>
      {children}
    </div>
  );
}

// Lightweight inline bar chart for the monthly trend (no chart dependency).
function TrendChart({ rows }: { rows: TrendRow[] }) {
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
                background: "#e2e8f0",
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
            <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
              {monthLabel(r.month)}
            </span>
            <span style={{ fontSize: 11, color: "#0f172a", fontWeight: 700 }}>
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trend, setTrend] = useState<TrendRow[]>([]);
  const [aging, setAging] = useState<AgingRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [districts, setDistricts] = useState<DistrictRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [s, t, a, c, d] = await Promise.all([
          supabase.from("v_dashboard_summary").select("*").maybeSingle(),
          supabase
            .from("v_incident_trend_monthly")
            .select("*")
            .order("month", { ascending: true }),
          supabase
            .from("v_incident_open_aging")
            .select("*")
            .order("bucket_order", { ascending: true }),
          supabase
            .from("v_exec_customer_incidents")
            .select("customer_id,customer_name,total_incidents,xc_caused_incidents,total_stages")
            .order("xc_caused_incidents", { ascending: false, nullsFirst: false })
            .limit(8),
          supabase
            .from("v_exec_district_incidents")
            .select(
              "district_id,customer_district,customer_name,total_incidents,xc_caused_incidents,stages_per_xc_incident"
            )
            .order("xc_caused_incidents", { ascending: false, nullsFirst: false })
            .limit(8),
        ]);

        if (cancelled) return;
        if (s.error) throw s.error;
        if (t.error) throw t.error;
        if (a.error) throw a.error;
        if (c.error) throw c.error;
        if (d.error) throw d.error;

        setSummary((s.data as Summary) || null);
        // Show only the last 12 months of trend.
        setTrend(((t.data as TrendRow[]) || []).slice(-12));
        setAging((a.data as AgingRow[]) || []);
        setCustomers((c.data as CustomerRow[]) || []);
        setDistricts((d.data as DistrictRow[]) || []);
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

  const xcRate = useMemo(() => {
    if (!trend.length) return null;
    const totXc = trend.reduce((s, r) => s + r.xc_caused_incidents, 0);
    const tot = trend.reduce((s, r) => s + r.total_incidents, 0);
    return { totXc, tot };
  }, [trend]);

  const totalOpen = useMemo(
    () => aging.reduce((s, r) => s + r.open_count, 0),
    [aging]
  );
  const aged90 = useMemo(
    () => aging.find((r) => r.age_bucket === "90+ days")?.open_count || 0,
    [aging]
  );

  if (loading) {
    return (
      <div style={{ padding: 32, fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>
        <div style={{ fontSize: 16, color: "#64748b" }}>Loading executive overview…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 32, fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#b91c1c",
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
        background: "#f8fafc",
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
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "#0f172a", margin: 0 }}>
            Executive Overview
          </h1>
          <p style={{ fontSize: 14, color: "#64748b", margin: "6px 0 0" }}>
            Read-only summary across all customers and districts.
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="exec-print-btn"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: "#0f172a",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            padding: "10px 16px",
            fontSize: 13.5,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <Printer size={16} /> Print / Save PDF
        </button>
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
          label="Total Incidents"
          value={fmt(summary?.total_incidents)}
          sub={`${fmt(summary?.open_incidents)} currently open`}
          accent="#0ea5e9"
        />
        <KpiCard
          icon={<ShieldAlert size={18} />}
          label="XC-Caused Rate"
          value={xcRate ? pct(xcRate.totXc, xcRate.tot) : "—"}
          sub={xcRate ? `${xcRate.totXc} of ${xcRate.tot} (trailing)` : undefined}
          accent="#dc2626"
        />
        <KpiCard
          icon={<Clock size={18} />}
          label="Aged Open (90+ d)"
          value={fmt(aged90)}
          sub={`of ${fmt(totalOpen)} open`}
          accent="#f59e0b"
        />
        <KpiCard
          icon={<TrendingUp size={18} />}
          label="Total Stages"
          value={fmt(summary?.total_stages)}
          sub={`${fmt(summary?.total_barrels)} barrels`}
          accent="#16a34a"
        />
        <KpiCard
          icon={<Building2 size={18} />}
          label="XFire Panels"
          value={fmt(summary?.total_xfire_panels)}
          sub={`${fmt(summary?.leased_xfire_panels)} leased`}
          accent="#7c3aed"
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
          title="Incident Trend (last 12 months)"
          right={
            <div style={{ display: "flex", gap: 14, fontSize: 12, color: "#64748b" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 11, height: 11, borderRadius: 3, background: "#e2e8f0", display: "inline-block" }} />
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
            <TrendChart rows={trend} />
          ) : (
            <div style={{ color: "#94a3b8", fontSize: 13 }}>No incident data.</div>
          )}
        </SectionCard>

        <SectionCard title="Open Incident Aging">
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
                    <span style={{ color: "#475569", fontWeight: 600 }}>{r.age_bucket}</span>
                    <span style={{ color: "#0f172a", fontWeight: 700 }}>
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
                      background: "#f1f5f9",
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
        <SectionCard title="Top Customers by XC-Caused Incidents">
          <Table
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

        <SectionCard title="Districts — Stages per XC Incident">
          <Table
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
          color: "#64748b",
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
}: {
  headers: string[];
  rows: React.ReactNode[][];
  empty: string;
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
                borderBottom: "1px solid #e2e8f0",
                color: "#64748b",
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
                  borderBottom: "1px solid #f1f5f9",
                  color: "#0f172a",
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
