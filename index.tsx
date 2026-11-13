import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppAlertHost } from './components/AppAlertHost';
import { registrarServiceWorker } from './lib/version/serviceWorker';

// PWA: cómo se aplica una versión nueva está en lib/version/serviceWorker.ts.
registrarServiceWorker();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
    <AppAlertHost />
  </React.StrictMode>
);