import { defineConfig } from 'vite';

// Un solo bundle JS (sin code-splitting) para que la app funcione como un único archivo
// autocontenido — necesario tanto para el Artifact como para el instalador offline.
export default defineConfig({
	base: './',
	build: {
		outDir: 'dist',
		chunkSizeWarningLimit: 4000,
		rollupOptions: {
			output: {
				inlineDynamicImports: true,
				manualChunks: undefined,
			},
		},
	},
});
