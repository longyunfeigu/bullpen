import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { reportClientError } from './store/appStore.js';
import './styles/theme.css';
import './styles/workbench.css';

window.addEventListener('error', (event) => {
  void reportClientError('RENDERER_ERROR', String(event.message ?? 'unknown'), event.error?.stack);
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason as { message?: string; stack?: string } | undefined;
  void reportClientError(
    'RENDERER_UNHANDLED_REJECTION',
    String(reason?.message ?? event.reason ?? 'unknown'),
    reason?.stack,
  );
});

const container = document.getElementById('root');
if (!container) throw new Error('missing #root');
createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
