import { defineConfig } from 'vite';

// Base './' keeps relative asset paths working on GitHub Pages, Netlify, Vercel, or itch.io
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
  },
});
