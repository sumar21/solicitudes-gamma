import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  // ENTORNO: la MISMA variable que usa el backend. Se lee de .env.local (loadEnv con
  // prefijo '' = todas las vars) y, en build de Vercel, de process.env. Se inyecta al
  // cliente como `__APP_ENTORNO__` (ver lib/env.ts) para diferenciar visualmente el
  // entorno de prueba. Producción intacta si ENTORNO !== 'TESTING'.
  const env = loadEnv(mode, process.cwd(), '');
  const ENTORNO = env.ENTORNO ?? process.env.ENTORNO ?? '';

  return {
  define: {
    __APP_ENTORNO__: JSON.stringify(ENTORNO),
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src-sw',
      filename: 'sw.ts',
      // "prompt": el SW nuevo espera. Con sesión se aplica desde el aviso de versión nueva;
      // sin sesión, solo (lib/version/serviceWorker.ts). Con skipWaiting/clientsClaim de sw.ts
      // nadie tiene que cerrar pestañas ni hacer un hard refresh.
      registerType: 'prompt',
      includeAssets: ['logo.svg'],
      manifest: {
        name: 'Grupo Gamma - Gestión de Traslados',
        short_name: 'MediFlow',
        description: 'Sistema de gestión de traslados hospitalarios',
        theme_color: '#022C22',
        background_color: '#022C22',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Librerías pesadas en chunks propios: el bundle principal pasaba los 2 MiB que precachea el
        // service worker (injectManifest) y el build fallaba. El SW sigue precacheando todos los chunks.
        manualChunks: {
          radix: ['radix-ui', 'cmdk', 'react-day-picker'],
          supabase: ['@supabase/supabase-js'],
          pdf: ['jspdf', 'jspdf-autotable'],
          xlsx: ['xlsx'],
          charts: ['recharts'],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  };
});
