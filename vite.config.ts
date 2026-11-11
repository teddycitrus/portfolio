import { defineConfig, type HtmlTagDescriptor, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * The entry only waits for the launch (src/main.tsx); the app itself is a
 * dynamic import. This lists every other script, stylesheet and Latin or runic
 * font file as a low-priority prefetch, so they download while the terminal
 * runs without being parsed or run, and the launch finds them in the cache.
 * (main.tsx turns them into preloads where prefetch is not supported.)
 */
const prefetchApp = (): Plugin => ({
  name: 'prefetch-app',
  apply: 'build',
  enforce: 'post',
  transformIndexHtml: {
    order: 'post',
    handler: (_html, ctx) => {
      const bundle = ctx.bundle;
      if (!bundle) return [];
      const tags: HtmlTagDescriptor[] = [];
      for (const [file, out] of Object.entries(bundle)) {
        const wanted =
          out.type === 'chunk'
            ? !out.isEntry
            : file.endsWith('.css') || (file.endsWith('.woff2') && /-(latin|runic)-/.test(file) && !/-latin-ext-/.test(file));
        if (!wanted) continue;
        tags.push({
          tag: 'link',
          attrs: { rel: 'prefetch', href: `./${file}`, crossorigin: '', 'data-app': '' },
          injectTo: 'head',
        });
      }
      return tags;
    },
  },
});

export default defineConfig({
  plugins: [react(), prefetchApp()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // vendor code in a few stable chunks that stay cached across deploys of the site's own code
        manualChunks: (id) => {
          // Vite's import helper on its own, or it lands in a vendor chunk and the tiny entry drags that in
          if (id.includes('vite/preload-helper') || id.includes('commonjsHelpers')) return 'helpers';
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/]three[\\/]/.test(id)) return 'three';
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (/[\\/]node_modules[\\/](@react-three|postprocessing|zustand|its-fine|react-reconciler|suspend-react)[\\/]/.test(id)) return 'r3f';
          return undefined;
        },
      },
    },
  },
});
