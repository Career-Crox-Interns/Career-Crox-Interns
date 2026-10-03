import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const localHealth = {
  name: 'career-crox-cc474-local-health',
  configureServer(server) {
    server.middlewares.use('/__cc474_local_health', (req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ ok: true, service: 'career-crox-vite', version: 'CC26_474' }));
    });
  },
};

export default defineConfig({
  plugins: [react(), localHealth],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/generated': 'http://127.0.0.1:8787'
    }
  }
});
