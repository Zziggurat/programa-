import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * QUÉ VERSIÓN ES ESTA.
 *
 * El programa se entrega como un archivo HTML suelto que la gente se pasa por correo y por
 * WhatsApp. Cuando el compañero dice «me falla esto» no hay forma de saber qué copia tiene
 * delante: puede ser la de hoy o una de hace tres semanas. Con la versión, el commit y la fecha
 * a la vista, el aviso empieza por un dato en vez de por una adivinanza.
 *
 * El empaquetador añade después un Build ID derivado del bundle. Git NO puede formar parte del
 * bundle reproducible: al incluir el HTML generado en un commit, ese mismo commit cambiaría el
 * bundle y obligaría a otro commit sin punto fijo. La versión de producto sí vive aquí.
 */
const version = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')).version as string;

const saltosCanonicos = {
	name: 'tablerostudio-saltos-canonicos',
	enforce: 'pre' as const,
	transform(codigo: string, id: string) {
		if (id.includes('\0') || !/\.(?:[cm]?[jt]sx?|json|css)(?:\?|$)/i.test(id)) return null;
		const canonico = codigo.replace(/\r\n?/g, '\n');
		return canonico === codigo ? null : { code: canonico, map: null };
	},
};

// Un solo bundle JS (sin code-splitting) para que la app funcione como un único archivo
// autocontenido — necesario tanto para el Artifact como para el instalador offline.
export default defineConfig({
	base: './',
	plugins: [saltosCanonicos],
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
	define: {
		__QA__: JSON.stringify(process.env.QA === '1' || process.argv.includes('qa')),
		__VERSION__: JSON.stringify(version),
	},
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
