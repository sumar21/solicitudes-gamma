import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { AppAlertHost } from './components/AppAlertHost';
import { registrarServiceWorker } from './lib/version/serviceWorker';
import { IS_TESTING } from './lib/env';

// Entorno de prueba: la sidebar pasa a gris pizarra (tokens en index.css).
if (IS_TESTING) document.documentElement.dataset.entorno = 'testing';

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