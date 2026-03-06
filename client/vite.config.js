import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    server: {
        port: 5173,
        host: '127.0.0.1',
        strictPort: false,
        cors: true,
        hmr: {
            host: 'localhost',
            port: 5173,
            protocol: 'ws',
        },
        proxy: {
            '/api': {
                target: 'http://localhost:3000',
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
                    if (!id.includes('node_modules'))
                        return;
                    if (id.includes('/react-pdf') || id.includes('/pdfjs-dist'))
                        return 'vendor-pdf';
                    if (id.includes('/react-markdown') || id.includes('/marked') || id.includes('/remark-') || id.includes('/rehype-') || id.includes('/micromark') || id.includes('/mdast-') || id.includes('/unist-') || id.includes('/hast-util'))
                        return 'vendor-markdown';
                    if (id.includes('/react-dom') || id.includes('/react-router'))
                        return 'vendor-react';
                    if (id.includes('/lucide-react') || id.includes('/react-resizable-panels') || id.includes('/@radix-ui/'))
                        return 'vendor-ui';
                    if (id.includes('/zustand'))
                        return 'vendor-state';
                },
            },
        },
    },
});
//# sourceMappingURL=vite.config.js.map