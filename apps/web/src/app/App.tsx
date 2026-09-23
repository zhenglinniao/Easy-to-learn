import * as Sentry from '@sentry/react';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../features/auth';

const LandingPage = lazy(() => import('../pages/LandingPage'));
const LoginPage = lazy(() => import('../pages/LoginPage'));
const BoardsPage = lazy(() => import('../pages/BoardsPage'));
const AuthCallbackPage = lazy(() => import('../pages/AuthCallbackPage'));
const ResetPasswordPage = lazy(() => import('../pages/ResetPasswordPage'));
const LegalPage = lazy(() => import('../pages/LegalPage'));
const CanvasSpikePage = lazy(() => import('../spikes/CanvasSpikePage'));
const CanvasPage = lazy(() => import('../features/canvas/CanvasPage'));
const TutorBoardSpikePage = lazy(() => import('../spikes/TutorBoardSpikePage'));

export function App() {
  return (
    <Sentry.ErrorBoundary
      fallback={
        <main className="fatal-error" role="alert">
          <p>页面暂时没有正常打开。</p>
          <button type="button" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </main>
      }
    >
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<p className="route-loading">正在打开你的学习空间…</p>}>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/auth/callback" element={<AuthCallbackPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/privacy" element={<LegalPage kind="privacy" />} />
              <Route path="/terms" element={<LegalPage kind="terms" />} />
              <Route path="/boards" element={<BoardsPage />} />
              <Route path="/canvas" element={<CanvasPage />} />
              <Route path="/canvas/:boardId" element={<CanvasPage />} />
              <Route path="/spikes/excalidraw" element={<CanvasSpikePage />} />
              <Route path="/spikes/tutor-board" element={<TutorBoardSpikePage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </Sentry.ErrorBoundary>
  );
}
