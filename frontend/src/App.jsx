import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import { LogoMark } from './components/Logo';
import { StoreProvider, useStore } from './state/store';

import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Report from './pages/Report';
import Settings from './pages/Settings';
import VehicleDetail from './pages/VehicleDetail';
import Vehicles from './pages/Vehicles';

const Analytics = lazy(() => import('./pages/Analytics'));

function Splash() {
  return <div className="flex min-h-screen items-center justify-center"><div className="animate-float"><LogoMark size={56} /></div></div>;
}

function Protected() {
  const { ready, user } = useStore();
  if (!ready) return <Splash />;
  if (!user) return <Navigate to="/login" replace />;
  return <Shell />;
}

export default function App() {
  return (
    <StoreProvider>
      <BrowserRouter>
        <Suspense fallback={<Splash />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<Protected />}>
              <Route index element={<Dashboard />} />
              <Route path="vehicles" element={<Vehicles />} />
              <Route path="vehicles/:id" element={<VehicleDetail />} />
              <Route path="scans/:id" element={<Report />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </StoreProvider>
  );
}
