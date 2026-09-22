import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { SessionProvider, useSession } from "./lib/session";
import { canAccess, HOME } from "./lib/nav";
import { Shell } from "./app/Shell";
import { Spinner } from "./components/ui";

import { LoginScreen } from "./screens/Login";
import { DashboardScreen } from "./screens/Dashboard";
import { BillingScreen } from "./screens/Billing";
import { CafeScreen } from "./screens/Cafe";
import { QrOrdersScreen } from "./screens/QrOrders";
import { WebsiteOrdersScreen } from "./screens/WebsiteOrders";
import { KitchenScreen } from "./screens/Kitchen";
import { OrdersScreen } from "./screens/Orders";
import { CatalogScreen } from "./screens/Catalog";
import { TablesScreen } from "./screens/Tables";
import { StaffScreen } from "./screens/Staff";
import { AuditScreen } from "./screens/Audit";
import { GuestMenuScreen } from "./screens/GuestMenu";

import "./styles/tokens.css";

/**
 * Gate a screen on the signed-in role.
 *
 * A role that cannot open a screen is redirected to its own home rather than
 * shown a dead end — a cook who taps a stale bookmark lands on the kitchen
 * screen, which is where they were going anyway. The server enforces the same
 * matrix, so this is wayfinding, not security.
 */
function Guarded({ children }: { children: React.ReactNode }) {
  const { user, role, loading } = useSession();
  const location = useLocation();

  if (loading) return <Spinner label="Signing in" />;
  if (!user || !role) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!canAccess(role, location.pathname)) return <Navigate to={HOME[role]} replace />;
  return <>{children}</>;
}

/** Signed-in users never sit on the login screen. */
function LoginRoute() {
  const { user, role, loading } = useSession();
  if (loading) return <Spinner label="Checking your session" />;
  if (user && role) return <Navigate to={HOME[role]} replace />;
  return <LoginScreen />;
}

function RootRedirect() {
  const { user, role, loading } = useSession();
  if (loading) return <Spinner label="Starting" />;
  if (!user || !role) return <Navigate to="/login" replace />;
  return <Navigate to={HOME[role]} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <Routes>
          {/* public */}
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/menu/:token" element={<GuestMenuScreen />} />

          {/* the kitchen display is full-bleed and dark — no shell */}
          <Route
            path="/kitchen"
            element={
              <Guarded>
                <KitchenScreen />
              </Guarded>
            }
          />

          {/* everything else lives in the shell */}
          <Route
            element={
              <Guarded>
                <Shell />
              </Guarded>
            }
          >
            <Route path="/dashboard" element={<DashboardScreen />} />
            <Route path="/billing" element={<BillingScreen kind="food" />} />
            <Route path="/alcohol" element={<BillingScreen kind="alcohol" />} />
            <Route path="/cafe" element={<CafeScreen />} />
            <Route path="/qr-orders" element={<QrOrdersScreen />} />
            <Route path="/website-orders" element={<WebsiteOrdersScreen />} />
            <Route path="/orders" element={<OrdersScreen />} />
            <Route path="/menu" element={<CatalogScreen />} />
            <Route path="/tables" element={<TablesScreen />} />
            <Route path="/staff" element={<StaffScreen />} />
            <Route path="/audit" element={<AuditScreen />} />
          </Route>

          <Route path="/" element={<RootRedirect />} />
          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </SessionProvider>
    </BrowserRouter>
  );
}
