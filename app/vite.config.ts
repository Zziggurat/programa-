import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * QUÉ VERSIÓN ES ESTA. Tercera auditoría, TS3-P3-03.
 *
 * El programa se entrega como un archivo HTML suelto que la gente se pasa por correo y por
 * WhatsApp. Cuando el compañero dice «me falla esto» no hay forma de saber qué copia tiene
 * delante: puede ser la de hoy o una de hace tres semanas. Con la versión, el commit y la fecha
 * a la vista, el aviso empieza por un dato en vez de por una adivinanza.
 *
 * El commit se saca de git, que es donde está. Si no hay git —un `.zip` descargado, un `npm pack`,
 * una máquina de construcción sin el repositorio— se pone «sin-git» y se sigue: quedarse sin
 * construir por no poder poner una etiqueta sería peor que la etiqueta.
 */
function commitDeGit(): string {
	try {
		return execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: RAIZ, stdio: ['ignore', 'pipe', 'ignore'] })
			.toString().trim() || 'sin-git';
	} catch {
		return 'sin-git';
	}
}

const version = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')).version as string;

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
	define: {
		__QA__: JSON.stringify(process.env.QA === '1' || process.argv.includes('qa')),
		__VERSION__: JSON.stringify(version),
		__COMMIT__: JSON.stringify(commitDeGit()),
		// Solo la fecha, sin hora: lo que se quiere saber es «de qué día es esta copia».
		__FECHA_BUILD__: JSON.stringify(new Date().toISOString().slice(0, 10)),
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
