/**
 * Sidebar.tsx
 * Drop in: src/app/components/ui/sidebar.tsx
 *
 * Replace your existing sidebar in App.tsx with:
 * import Sidebar from './components/ui/sidebar';
 * ...
 * <Sidebar />
 *
 * Requires ThemeProvider wrapping the app.
 */

import { Link, useLocation } from 'react-router';
// Notice the double dots here! ../../
import { useAuth } from '../../lib/auth-context';
import { useTheme } from '../../lib/theme-context';
import { XCONNECT_LOGO_B64, XCONNECT_LOGO_UI_DARK_B64 } from '../../lib/brandAssets';
import {
  LayoutDashboard, Users, ClipboardList, AlertTriangle,
  Cpu, TrendingUp, FileBarChart,
  Sun, Moon, LogOut, Map, FileText, BarChart3,
  Truck, ClipboardCheck, ListChecks,
} from 'lucide-react';

type Role = 'admin' | 'sqm' | 'ops';

// ── Nav structure ─────────────────────────────────────────────────────────────
const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { path: '/',          label: 'Dashboard',    icon: LayoutDashboard, roles: ['admin', 'sqm'] as Role[] },
      { path: '/executive',  label: 'Executive',    icon: BarChart3,       roles: ['admin'] as Role[] },
    ],
  },
  {
    label: 'Operations',
    items: [
      { path: '/field-visits',    label: 'Field Visits',  icon: ClipboardList,   roles: ['admin', 'sqm'] as Role[] },
      { path: '/field-visit-map', label: 'Visit Map',     icon: Map,             roles: ['admin', 'sqm'] as Role[] },
      { path: '/incidents',       label: 'Incidents',     icon: AlertTriangle,   roles: ['admin', 'sqm'] as Role[] },
      { path: '/panels',          label: 'XFire Panels',  icon: Cpu,             roles: ['admin', 'sqm'] as Role[] },
    ],
  },
  {
    label: 'Customer',
    items: [
      { path: '/customers',           label: 'Customers',      icon: Users,        roles: ['admin'] as Role[] },
      { path: '/sales',               label: 'Sales',          icon: TrendingUp,   roles: ['admin'] as Role[] },
      { path: '/reports',             label: 'Reports',        icon: FileBarChart, roles: ['admin'] as Role[] },
      { path: '/technical-bulletins', label: 'Tech Bulletins', icon: FileText,     roles: ['admin', 'sqm'] as Role[] },
    ],
  },
  {
    label: 'Production',
    items: [
      { path: '/driver', label: 'Driver Loads', icon: Truck,           roles: ['admin', 'ops'] as Role[] },
      { path: '/qc',     label: 'QC',           icon: ClipboardCheck,  roles: ['admin', 'ops'] as Role[] },
    ],
  },
  {
    label: 'Settings',
    items: [
      { path: '/users',        label: 'Users',        icon: Users,      roles: ['admin'] as Role[] },
      { path: '/manage-lists', label: 'Manage Lists', icon: ListChecks, roles: ['admin'] as Role[] },
    ],
  },
];

export default function Sidebar() {
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { isDark, toggleTheme } = useTheme();

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  const role: Role = (user?.role as Role) || 'sqm';
  const visibleGroups = NAV_GROUPS
    .map(g => ({ ...g, items: g.items.filter(i => i.roles.includes(role)) }))
    .filter(g => g.items.length > 0);

  return (
    <aside style={{
      width: 240,
      minHeight: '100vh',
      background: isDark ? '#0f172a' : '#ffffff',
      borderRight: `1px solid ${isDark ? '#1e293b' : '#e2e8f0'}`,
      display: 'flex',
      flexDirection: 'column',
      position: 'fixed',
      top: 0,
      left: 0,
      bottom: 0,
      zIndex: 50,
      fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
    }}>

      {/* ── Logo / XConnect branding ── */}
      <div style={{
        padding: '20px 20px 16px',
        borderBottom: `1px solid ${isDark ? '#1e293b' : '#f1f5f9'}`,
      }}>
        {/* Official XConnect logo. The transparent (white X) variant reads on the
            dark sidebar; the on-white variant reads on the light sidebar. */}
        <img
          src={isDark ? XCONNECT_LOGO_UI_DARK_B64 : XCONNECT_LOGO_B64}
          alt="XConnect"
          style={{ height: 30, width: 'auto', display: 'block' }}
        />
        <div style={{ fontSize: 10.5, color: isDark ? '#64748b' : '#94a3b8', marginTop: 8, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Field Service Platform
        </div>
      </div>

      {/* ── Nav groups ── */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {visibleGroups.map(group => (
          <div key={group.label} style={{ marginBottom: 4 }}>
            <div style={{
              padding: '10px 20px 4px',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: isDark ? '#475569' : '#94a3b8',
            }}>
              {group.label}
            </div>
            {group.items.map(item => {
              const active = isActive(item.path);
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '7px 20px',
                    margin: '1px 8px',
                    borderRadius: 8,
                    textDecoration: 'none',
                    fontSize: 13,
                    fontWeight: active ? 600 : 400,
                    background: active
                      ? isDark ? '#1e3a5f' : '#eff6ff'
                      : 'transparent',
                    color: active
                      ? isDark ? '#60a5fa' : '#2563eb'
                      : isDark ? '#94a3b8' : '#475569',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={e => {
                    if (!active) {
                      (e.currentTarget as HTMLElement).style.background = isDark ? '#1e293b' : '#f8fafc';
                      (e.currentTarget as HTMLElement).style.color = isDark ? '#e2e8f0' : '#0f172a';
                    }
                  }}
                  onMouseLeave={e => {
                    if (!active) {
                      (e.currentTarget as HTMLElement).style.background = 'transparent';
                      (e.currentTarget as HTMLElement).style.color = isDark ? '#94a3b8' : '#475569';
                    }
                  }}
                >
                  <Icon size={15} strokeWidth={active ? 2.5 : 1.75} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* ── Footer ── */}
      <div style={{
        borderTop: `1px solid ${isDark ? '#1e293b' : '#f1f5f9'}`,
        padding: '12px 16px',
      }}>
        {/* User info */}
        {user && (
          <div style={{ marginBottom: 10, padding: '0 4px' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: isDark ? '#e2e8f0' : '#0f172a' }}>
              {user.name && user.name !== 'Admin User' ? user.name : 'Welcome'}
            </div>
            <div style={{ fontSize: 11, color: isDark ? '#475569' : '#94a3b8', marginTop: 1 }}>
              {user.email || ''}
            </div>
            <div style={{ fontSize: 10, color: isDark ? '#334155' : '#cbd5e1', marginTop: 1, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Role: {user.role || 'User'}
            </div>
          </div>
        )}

        {/* Dark/Light toggle + Sign out */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={toggleTheme}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '7px 0',
              borderRadius: 8,
              border: `1px solid ${isDark ? '#1e293b' : '#e2e8f0'}`,
              background: isDark ? '#1e293b' : '#f8fafc',
              color: isDark ? '#94a3b8' : '#64748b',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
              transition: 'all 0.15s',
            }}
          >
            {isDark ? <Sun size={13} /> : <Moon size={13} />}
            {isDark ? 'Light' : 'Dark'}
          </button>

          <button
            onClick={signOut}
            title="Sign out"
            aria-label="Sign out"
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '7px 10px',
              borderRadius: 8,
              border: `1px solid ${isDark ? '#1e293b' : '#e2e8f0'}`,
              background: isDark ? '#1e293b' : '#f8fafc',
              color: isDark ? '#94a3b8' : '#64748b',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
              transition: 'all 0.15s',
            }}
          >
            <LogOut size={13} />
            Sign out
          </button>
        </div>

        {/* Company attribution */}
        <div style={{
          marginTop: 10,
          textAlign: 'center',
          fontSize: 9.5,
          fontWeight: 600,
          letterSpacing: '0.04em',
          color: isDark ? '#334155' : '#cbd5e1',
        }}>
          © {new Date().getFullYear()} XConnect, LLC
        </div>
      </div>
    </aside>
  );
}