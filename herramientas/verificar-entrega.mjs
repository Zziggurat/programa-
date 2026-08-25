/** Comprueba la frescura del HTML entregado sin modificar ningún archivo del worktree. */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { empaquetar } from '../app/empaquetar.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const temporal = mkdtempSync(join(tmpdir(), 'tablerostudio-entrega-'));

try {
	const distTemporal = join(temporal, 'app-dist');
	const vite = join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js');
	const compilacion = spawnSync(process.execPath, [vite, 'build', join(RAIZ, 'app'),
		'--outDir', distTemporal, '--emptyOutDir'], {
		cwd: RAIZ, stdio: 'inherit', env: process.env,
	});
	if (compilacion.status !== 0) process.exit(compilacion.status ?? 1);

	const esperadoWeb = join(temporal, 'TableroStudio.html');
	const esperadoDesktop = join(temporal, 'desktop-app.html');
	const { buildId } = empaquetar({
		distApp: distTemporal, destino: esperadoWeb, desktop: esperadoDesktop, silencioso: true,
	});
	const objetivos = [
		[join(RAIZ, 'dist-final', 'TableroStudio.html'), esperadoWeb],
		[join(RAIZ, 'desktop', 'app.html'), esperadoDesktop],
	];
	let obsoletos = 0;
	for (const [actual, esperado] of objetivos) {
		if (!existsSync(actual)) {
			console.error(`FAIL  Falta ${actual}`);
			obsoletos++;
			continue;
		}
		const iguales = readFileSync(actual).equals(readFileSync(esperado));
		console.log(`${iguales ? 'OK  ' : 'FAIL'}  ${actual} ${iguales ? 'está actualizado' : 'está obsoleto'}`);
		if (!iguales) obsoletos++;
	}
	if (obsoletos) {
		console.error(`\n${obsoletos} entregable(s) obsoleto(s). Ejecuta: npm run empaquetar`);
		process.exitCode = 1;
	} else {
		console.log(`\nEntrega reproducible y actual · Build ${buildId}`);
	}
} finally {
	// `temporal` viene directamente de mkdtemp dentro del directorio temporal del sistema.
	if (resolve(temporal).startsWith(resolve(tmpdir()))) rmSync(temporal, { recursive: true, force: true });
}
