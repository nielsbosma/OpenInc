import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';
// Everything the server answers: the API, MCP, and the OAuth endpoints the MCP SDK mounts at the root.
const proxied = ['/api', '/mcp', '/.well-known', '/authorize', '/token', '/register', '/revoke'];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    strictPort: true,
    host: process.env.VITE_HOST ?? 'localhost',
    proxy: Object.fromEntries(proxied.map((path) => [path, { target: api, xfwd: true }])),
  },
  build: { sourcemap: true, chunkSizeWarningLimit: 1500 },
});
