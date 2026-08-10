import { defineConfig } from 'vite';

// Un solo bundle JS (sin code-splitting) para que la app funcione como un único archivo
// autocontenido — necesario tanto para el Artifact como para el instalador offline.
export default defineConfig({
	base: './',
	/*
	 * La sonda de pruebas (`window.qa`) solo entra en el bundle cuando se construye para QA. En el
	 * build que se entrega, `__QA__` es `false`, el minificador borra el bloque entero y la
	 * aplicación no lleva dentro el andamiaje de las pruebas.
	 *
	 * Se mira el MODO de Vite (`--mode qa`) además de la variable de entorno. Segunda auditoría,
	 * TS2-P2-08: `QA=1 vite build app` es sintaxis de shell POSIX y en un `cmd` de Windows no
	 * pone ninguna variable, así que allí `npm run qa` construía SIN sonda y las 34 suites
	 * fallaban a la vez con «window.qa is undefined». `--mode` es un argumento normal y funciona
	 * igual en los tres sistemas; la variable se deja por si alguien ya la tenía en su guion.
	 */
	define: { __QA__: JSON.stringify(process.env.QA === '1' || process.argv.includes('qa')) },
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
