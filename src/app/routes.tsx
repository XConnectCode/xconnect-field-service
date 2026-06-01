import { createBrowserRouter, Navigate } from "react-router";
import Root from "./Root";
import Dashboard from "./pages/Dashboard";
import SQMDashboard from "./pages/SQMDashboard";
import { useAuth } from "./lib/auth-context";
import Customers from "./pages/Customers";
import FieldVisitsNew from "./pages/FieldVisitsNew";
import IncidentsNew from "./pages/IncidentsNew";
import PanelsNew from "./pages/PanelsNew";
import Sales from "./pages/Sales";
import Reports from "./pages/Reports";
import DiagnosticsPage from "./pages/DiagnosticsPage";
import Debug from "./pages/Debug";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import NotFound from "./pages/NotFound";
import FieldVisitDetail from "./pages/FieldVisitDetail";
import IncidentDetail from "./pages/IncidentDetail";
import PanelDetail from "./pages/PanelDetail";
import CustomerDetail from "./pages/CustomerDetail";
import DistrictDetail from "./pages/DistrictDetail";
import FieldVisitMap from './pages/FieldVisitMap';
import TechnicalBulletin from './pages/TechnicalBulletin';
import TechnicalBulletins from './pages/TechnicalBulletins';
import TechnicalBulletinSetup from './pages/TechnicalBulletinSetup';
import Executive from './pages/Executive';
import DriverLoads from './pages/DriverLoads';
import DriverLoadDetail from './pages/DriverLoadDetail';
import QcPallets from './pages/QcPallets';
import QcPalletDetail from './pages/QcPalletDetail';

type Role = 'admin' | 'sqm' | 'ops';

function DashboardSwitch() {
  const { user } = useAuth();
  // 'ops' users (Driver + QC) have no dashboard — send them to their area.
  if (user?.role === 'ops') return <Navigate to="/driver" replace />;
  return user?.role === 'sqm' ? <SQMDashboard /> : <Dashboard />;
}

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') {
    return <Navigate to="/technical-bulletins" replace />;
  }
  return <>{children}</>;
}

// Generalized role guard. Redirects unauthorized users to a sensible home for
// their role ('ops' -> /driver, everyone else -> /).
function RequireRole({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) {
    return <Navigate to={user?.role === 'ops' ? '/driver' : '/'} replace />;
  }
  return <>{children}</>;
}

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    children: [
      { index: true, Component: DashboardSwitch },
      { path: "customers", Component: Customers },
      { path: "customers/:id", Component: CustomerDetail },
      { path: "districts/:id", Component: DistrictDetail },
      { path: "field-visits", Component: FieldVisitsNew },
      { path: "field-visits/:id", Component: FieldVisitDetail },
      { path: "field-visit-map", Component: FieldVisitMap }, // <-- Added here
      { path: "incidents", Component: IncidentsNew },
      { path: "incidents/:id", Component: IncidentDetail },
      { path: "panels", Component: PanelsNew },
      { path: "panels/:id", Component: PanelDetail },
      { path: "sales", Component: Sales },
      { path: "reports", Component: Reports },
      { path: "executive", element: <AdminOnly><Executive /></AdminOnly> },
      { path: "technical-bulletins", Component: TechnicalBulletins },
      { path: "technical-bulletin/:id", element: <AdminOnly><TechnicalBulletin /></AdminOnly> },
      { path: "technical-bulletin-setup", element: <AdminOnly><TechnicalBulletinSetup /></AdminOnly> },
      { path: "diagnostics", element: <AdminOnly><DiagnosticsPage /></AdminOnly> },
      { path: "debug", element: <AdminOnly><Debug /></AdminOnly> },
      { path: "driver",     element: <RequireRole roles={['admin','ops']}><DriverLoads /></RequireRole> },
      { path: "driver/:id", element: <RequireRole roles={['admin','ops']}><DriverLoadDetail /></RequireRole> },
      { path: "qc",         element: <RequireRole roles={['admin','ops']}><QcPallets /></RequireRole> },
      { path: "qc/:id",     element: <RequireRole roles={['admin','ops']}><QcPalletDetail /></RequireRole> },
      { path: "*", Component: NotFound },
    ],
  },
  {
    path: "/login",
    Component: Login,
  },
  {
    path: "/setup",
    Component: Setup,
  },
]);