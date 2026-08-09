import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    host: '127.0.0.1'
  },
  preview: {
    host: '127.0.0.1'
  },
  build: {
    // maplibre-gl is a single large (legitimate) chunk; silence the default nag.
    chunkSizeWarningLimit: 1600
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js', 'data-pipeline/**/*.test.mjs']
  }
});
