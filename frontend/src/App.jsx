import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { AuthProvider, RequireAuth } from './auth.jsx';
import { ToastProvider } from './components/Toast.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Products from './pages/Products.jsx';
import Coupons from './pages/Coupons.jsx';
import Agents from './pages/Agents.jsx';
import LoginStatus from './pages/LoginStatus.jsx';
import Analytics from './pages/Analytics.jsx';
import Orders from './pages/Orders.jsx';
import { Loading } from './components/ui.jsx';
import Wallet from './pages/Wallet.jsx';
import Referrals from './pages/Referrals.jsx';
import RiderApplications from './pages/RiderApplications.jsx';
import RefundRequests from './pages/RefundRequests.jsx';
import HeldPayments from './pages/HeldPayments.jsx';
import NotFound from './pages/NotFound.jsx';

// The map library is large, so the Live map page loads only when it's opened.
const LiveMap = lazy(() => import('./pages/LiveMap.jsx'));

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<RequireAuth><Layout /></RequireAuth>}>
            <Route index element={<Dashboard />} />
            <Route path="orders" element={<Orders />} />
            <Route path="live" element={<Suspense fallback={<Loading />}><LiveMap /></Suspense>} />
            <Route path="products" element={<Products />} />
            <Route path="coupons" element={<Coupons />} />
            <Route path="wallet" element={<Wallet />} />
            <Route path="referrals" element={<Referrals />} />
            <Route path="agents" element={<Agents />} />
            <Route path="rider-applications" element={<RiderApplications />} />
            <Route path="refund-requests" element={<RefundRequests />} />
            <Route path="payments-without-order" element={<HeldPayments />} />
            <Route path="logins" element={<LoginStatus />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}
