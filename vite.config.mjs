import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

// Build stamp shown in the settings footer so we can tell what's running
let gitHash = 'dev';
try { gitHash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { /* no git */ }
const BUILD = `${gitHash}-${Date.now().toString(36)}`;

export default defineConfig({
  root: 'src/client',
  publicDir: 'static',           // models, sounds and music, copied as-is
  envDir: '../..',               // read .env from the repo root (VITE_* vars)
  base: './',                    // relative URLs work on Express and Vercel alike
  define: { __BUILD__: JSON.stringify(BUILD) },
  build: {
    outDir: '../../public',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2020',
    chunkSizeWarningLimit: 2500,
  },
  server: {
    port: 5173,
    // `npm run dev:client` talks to the game server from `npm run dev`
    proxy: { '/api/socket-io': { target: 'http://localhost:5000', ws: true } },
  },
});
