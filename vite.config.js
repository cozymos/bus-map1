import { defineConfig } from 'vite';
import eslint from 'vite-plugin-eslint';

const enableESLint = true;

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  server: {
    host: '0.0.0.0',
    port: 5001,
    allowedHosts: true,
    headers: {
      'Cache-Control': 'no-store', // disable caching during dev
    },
  },
  build: {
    outDir: 'dist',
  },
  plugins: [
    enableESLint &&
      eslint({
        fix: false,
        cache: false,
        include: ['src/**/*.js'],
        exclude: ['node_modules/**'],
      }),
  ],
});
