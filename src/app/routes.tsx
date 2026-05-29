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

function DashboardSwitch() {
  const { user } = useAuth();
  return user?.role === 'sqm' ? <SQMDashboard /> : <Dashboard />;
}

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') {
    return <Navigate to="/technical-bulletins" replace />;
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
      { path: "technical-bulletins", Component: TechnicalBulletins },
      { path: "technical-bulletin/:id", element: <AdminOnly><TechnicalBulletin /></AdminOnly> },
      { path: "technical-bulletin-setup", element: <AdminOnly><TechnicalBulletinSetup /></AdminOnly> },
      { path: "diagnostics", element: <AdminOnly><DiagnosticsPage /></AdminOnly> },
      { path: "debug", element: <AdminOnly><Debug /></AdminOnly> },
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