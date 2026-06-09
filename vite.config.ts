import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
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
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src-sw',
      filename: 'sw.ts',
      // "prompt" + onNeedRefresh handled in index.tsx → calls updateSW(true)
      // to auto-apply updates without user interaction. Combined with
      // skipWaiting/clientsClaim in sw.ts, this forces clients to update to
      // the latest version on the next check (no manual hard refresh needed).
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
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  };
});
