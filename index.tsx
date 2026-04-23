import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';

// ── PWA auto-update ──────────────────────────────────────────────────────────
// Registers the service worker and applies any new version automatically.
// The browser checks for updates on each page load and every 60 minutes while
// the tab is open. When one is found we call updateSW(true) which:
//   1. Messages the new SW to skipWaiting
//   2. Waits for the 'controllerchange' event
//   3. Reloads the page with the new version
// This means the end user never has to do a hard refresh to get new features.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    // Apply update and reload. No prompt — target audience is non-technical.
    updateSW(true);
  },
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    // Also poll the SW for updates every 30 minutes (default only checks on
    // navigation). This way tabs that stay open all day still get the update.
    setInterval(() => {
      registration.update().catch(() => { /* network flake — try again later */ });
    }, 30 * 60 * 1000);
  },
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);