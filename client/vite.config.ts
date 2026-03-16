import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

function getCommitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
}

function licensesPlugin(): Plugin {
  const virtualModuleId = 'virtual:licenses';
  const resolvedVirtualModuleId = '\0' + virtualModuleId;

  const root = path.resolve(__dirname, '..');
  const pkgFiles = [
    path.join(__dirname, 'package.json'),
    path.join(root, 'server/package.json'),
    path.join(root, 'shared/package.json'),
  ];
  const nodeModulesPaths = [
    path.join(root, 'node_modules'),
    path.join(__dirname, 'node_modules'),
  ];

  const SKIP = new Set([
    '@local-agent/client', '@local-agent/server', '@local-agent/shared',
    'bun-types', 'jsdom', 'vitest', '@vitejs/plugin-react',
    '@testing-library/jest-dom', '@testing-library/react', '@testing-library/user-event',
    'autoprefixer', 'postcss',
  ]);

  return {
    name: 'licenses-plugin',
    resolveId(id) {
      if (id === virtualModuleId) return resolvedVirtualModuleId;
    },
    load(id) {
      if (id !== resolvedVirtualModuleId) return;

      const allDeps = new Set<string>();
      for (const pkgFile of pkgFiles) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf-8'));
          for (const dep of Object.keys(pkg.dependencies ?? {})) allDeps.add(dep);
          for (const dep of Object.keys(pkg.devDependencies ?? {})) allDeps.add(dep);
        } catch {}
      }

      const licenses: Array<{ name: string; license: string; author: string }> = [];

      for (const dep of allDeps) {
        if (SKIP.has(dep) || dep.startsWith('@local-agent/') || dep.startsWith('@types/')) continue;

        let pkgJson: Record<string, unknown> | null = null;
        for (const nmPath of nodeModulesPaths) {
          const pkgPath = path.join(nmPath, dep, 'package.json');
          if (fs.existsSync(pkgPath)) {
            try { pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')); break; } catch {}
          }
        }
        if (!pkgJson) continue;

        const license =
          (typeof pkgJson.license === 'string' ? pkgJson.license : null) ??
          (Array.isArray(pkgJson.licenses) ? (pkgJson.licenses as {type:string}[])[0]?.type : null) ??
          'Unknown';

        let author = '';
        if (typeof pkgJson.author === 'string') {
          author = pkgJson.author.replace(/ <[^>]+>/, '').replace(/ \([^)]+\)/, '').trim();
        } else if (pkgJson.author && typeof pkgJson.author === 'object' && 'name' in pkgJson.author) {
          author = String((pkgJson.author as {name:string}).name);
        } else if (Array.isArray(pkgJson.contributors) && pkgJson.contributors.length > 0) {
          const c = pkgJson.contributors[0];
          author = typeof c === 'string'
            ? c.replace(/ <[^>]+>/, '').trim()
            : String((c as {name:string}).name ?? '');
        }

        licenses.push({ name: dep, license: String(license), author });
      }

      licenses.sort((a, b) => a.name.localeCompare(b.name));
      return `export const licenses = ${JSON.stringify(licenses, null, 2)};`;
    },
  };
}

export default defineConfig({
  plugins: [react(), licensesPlugin()],
  define: {
    'import.meta.env.COMMIT_HASH': JSON.stringify(getCommitHash()),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: parseInt(process.env.E2E_CLIENT_PORT || '5173', 10),
    host: '127.0.0.1',
    strictPort: !!process.env.E2E_CLIENT_PORT,
    cors: true,
    hmr: {
      host: 'localhost',
      port: parseInt(process.env.E2E_CLIENT_PORT || '5173', 10),
      protocol: 'ws',
    },
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.E2E_SERVER_PORT || '3000'}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('/react-pdf') || id.includes('/pdfjs-dist')) return 'vendor-pdf';
          if (id.includes('/react-markdown') || id.includes('/marked') || id.includes('/remark-') || id.includes('/rehype-') || id.includes('/micromark') || id.includes('/mdast-') || id.includes('/unist-') || id.includes('/hast-util')) return 'vendor-markdown';
          if (id.includes('/react-dom') || id.includes('/react-router')) return 'vendor-react';
          if (id.includes('/lucide-react') || id.includes('/react-resizable-panels') || id.includes('/@radix-ui/')) return 'vendor-ui';
          if (id.includes('/zustand')) return 'vendor-state';
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/__tests__/**', 'src/test-setup.ts'],
    },
  },
});