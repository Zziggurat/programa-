import { defineConfig } from 'vite';

// Un solo bundle JS (sin code-splitting) para que la app funcione como un único archivo
// autocontenido — necesario tanto para el Artifact como para el instalador offline.
export default defineConfig({
	base: './',
	// La sonda de pruebas (`window.qa`) solo entra en el bundle cuando se construye con QA=1.
	// En el build que se entrega, __QA__ es `false`, el minificador borra el bloque entero y la
	// aplicación no lleva dentro el andamiaje de las pruebas.
	define: { __QA__: JSON.stringify(process.env.QA === '1') },
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
