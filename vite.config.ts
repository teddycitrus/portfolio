import { defineConfig, type HtmlTagDescriptor, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

const BAKED_DIR = path.resolve(__dirname, 'public/baked');
const BAKED_MANIFEST = path.resolve(__dirname, 'src/data/baked.json');

interface BakedEntry {
  hash: string;
  file: string;
  w: number;
  h: number;
  layers: number;
  touch: boolean;
}

const readManifest = (): Record<string, BakedEntry> => {
  try {
    return JSON.parse(fs.readFileSync(BAKED_MANIFEST, 'utf8'));
  } catch {
    return {};
  }
};

/**
 * Development only: takes the sky and planet maps the app bakes live when it
 * finds no matching image (see src/scenes/overworld/bakedMaps.ts), writes
 * them to public/baked and lists them in src/data/baked.json, replacing the
 * image they supersede. The manifest is written once a batch has come in, so
 * the page reloads once.
 */
const bakedMaps = (): Plugin => ({
  name: 'baked-maps',
  apply: 'serve',
  configureServer: (server) => {
    const pending: Record<string, BakedEntry> = {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      const manifest = readManifest();
      for (const [name, entry] of Object.entries(pending)) {
        const old = manifest[name];
        if (old && old.file !== entry.file) fs.rmSync(path.join(BAKED_DIR, old.file), { force: true });
        manifest[name] = entry;
        delete pending[name];
      }
      const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
      fs.writeFileSync(BAKED_MANIFEST, `${JSON.stringify(sorted, null, 2)}
`);
      server.config.logger.info(`baked maps saved: ${Object.keys(sorted).length} images`);
    };
    server.middlewares.use('/__baked', (req, res) => {
      const q = new URL(req.url ?? '', 'http://dev').searchParams;
      const name = q.get('name') ?? '';
      const hash = q.get('hash') ?? '';
      if (req.method !== 'POST' || !/^[\w-]+$/.test(name) || !/^[a-z0-9]+$/.test(hash)) {
        res.statusCode = 400;
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const file = `${name}-${hash}.webp`;
        fs.mkdirSync(BAKED_DIR, { recursive: true });
        fs.writeFileSync(path.join(BAKED_DIR, file), Buffer.concat(chunks));
        pending[name] = { hash, file, w: +(q.get('w') ?? 0), h: +(q.get('h') ?? 0), layers: +(q.get('layers') ?? 1), touch: q.get('touch') === 'true' };
        clearTimeout(timer);
        timer = setTimeout(flush, 1500);
        res.end('ok');
      });
    });
  },
});

/**
 * The entry only waits for the launch (src/main.tsx); the app itself is a
 * dynamic import. This lists every other script, stylesheet and Latin or runic
 * font file as a low-priority prefetch, so they download while the terminal
 * runs without being parsed or run, and the launch finds them in the cache.
 * The shipped sky and planet maps (desktop sizes) are prefetched the same way.
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
      // the desktop sky and planet maps (touch devices fetch their smaller ones on start)
      for (const entry of Object.values(readManifest())) {
        if (entry.touch) continue;
        tags.push({ tag: 'link', attrs: { rel: 'prefetch', href: `./baked/${entry.file}`, 'data-app': '' }, injectTo: 'head' });
      }
      return tags;
    },
  },
});

export default defineConfig({
  plugins: [react(), prefetchApp(), bakedMaps()],
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
