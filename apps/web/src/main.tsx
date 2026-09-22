import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import { initializeMonitoring } from './monitoring';
import 'katex/dist/katex.min.css';
import './styles/global.css';

initializeMonitoring({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.VITE_APP_ENV || 'local',
});

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('缺少应用挂载节点 #root');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
