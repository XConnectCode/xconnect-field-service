import React from "react";
import { Link } from "react-router";
import { useAuth } from "../lib/auth-context";
import { ClipboardList, AlertTriangle, Cpu, Map, ExternalLink } from "lucide-react";

type TileProps = {
  to: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  accent: string;
};

function PrimaryTile({ to, title, subtitle, icon, accent }: TileProps) {
  return (
    <Link
      to={to}
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 16,
        padding: "28px 24px",
        borderRadius: 16,
        background: "#fff",
        border: "1px solid #e2e8f0",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        textDecoration: "none",
        color: "#0f172a",
        minHeight: 180,
        transition: "transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
        (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 24px rgba(0,0,0,0.08)";
        (e.currentTarget as HTMLElement).style.borderColor = accent;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
        (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)";
        (e.currentTarget as HTMLElement).style.borderColor = "#e2e8f0";
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 12,
          background: `${accent}18`,
          color: accent,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 13, color: "#64748b" }}>{subtitle}</div>
      </div>
    </Link>
  );
}

function SecondaryLink({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      to={to}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 14px",
        borderRadius: 10,
        background: "#fff",
        border: "1px solid #e2e8f0",
        textDecoration: "none",
        color: "#334155",
        fontSize: 13,
        fontWeight: 500,
        transition: "background 0.15s, border-color 0.15s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = "#f8fafc";
        (e.currentTarget as HTMLElement).style.borderColor = "#cbd5e1";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "#fff";
        (e.currentTarget as HTMLElement).style.borderColor = "#e2e8f0";
      }}
    >
      {icon}
      {label}
      <ExternalLink size={12} style={{ opacity: 0.5 }} />
    </Link>
  );
}

export default function SQMDashboard() {
  const { user } = useAuth();
  const displayName = user?.name && user.name !== "Admin User" ? user.name : null;

  return (
    <div
      style={{
        padding: "32px 40px",
        fontFamily: "'DM Sans','Segoe UI',sans-serif",
        background: "#f8fafc",
        minHeight: "100vh",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "#0f172a", margin: "0 0 4px" }}>
          {displayName ? `Welcome back, ${displayName}` : "Welcome back"}
        </h1>
        <p style={{ fontSize: 14, color: "#64748b", margin: 0 }}>
          Log field activity and check on panels and incidents.
        </p>
      </div>

      {/* Primary action tiles */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 20,
          marginBottom: 36,
        }}
      >
        <PrimaryTile
          to="/field-visits?new=1"
          title="Add Field Visit"
          subtitle="Log a new field visit"
          icon={<ClipboardList size={24} strokeWidth={2} />}
          accent="#10b981"
        />
        <PrimaryTile
          to="/incidents?new=1"
          title="Add Incident"
          subtitle="Report a new incident"
          icon={<AlertTriangle size={24} strokeWidth={2} />}
          accent="#ef4444"
        />
        <PrimaryTile
          to="/panels"
          title="View / Add Panel"
          subtitle="Browse or register a panel"
          icon={<Cpu size={24} strokeWidth={2} />}
          accent="#0ea5e9"
        />
      </div>

      {/* Secondary quick-links */}
      <div style={{ marginBottom: 12, fontSize: 12, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        Quick Links
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <SecondaryLink to="/field-visits" label="View Field Visits" icon={<ClipboardList size={14} />} />
        <SecondaryLink to="/incidents" label="View Incidents" icon={<AlertTriangle size={14} />} />
        <SecondaryLink to="/panels" label="View Panels" icon={<Cpu size={14} />} />
        <SecondaryLink to="/field-visit-map" label="Visit Map" icon={<Map size={14} />} />
      </div>
    </div>
  );
}
