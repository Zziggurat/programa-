/**
 * DE DÓNDE SALEN EL NAVEGADOR, PYTHON Y LA RAÍZ DEL REPOSITORIO.
 *
 * Segunda auditoría, TS2-P2-08. Las 34 suites llevaban clavado
 * `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, dos de ellas llamaban a `python3` por su
 * nombre exacto y una servía archivos desde `/workspace/programa-`. Todo eso es la ruta de ESTA
 * máquina: en un Windows limpio, `npm run qa` no arranca ni la primera suite.
 *
 * Y no es un detalle de comodidad. La auditoría encontró el cajetín solapado precisamente porque
 * la corrió en Windows, con otra fuente. Una batería que solo se puede ejecutar en un sitio deja
 * de ver todo lo que depende del sistema, que es justo lo que más cuesta encontrar leyendo código.
 *
 * Aquí se resuelve una vez y en un solo sitio, con el orden de siempre: lo que diga la variable de
 * entorno manda; si no, lo que traiga Playwright; si no, se busca donde suele estar.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** La raíz del repositorio, subiendo desde este archivo. Nunca una ruta absoluta escrita a mano. */
export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Argumentos del navegador. SwiftShader es lo que hace que haya WebGL sin tarjeta gráfica. */
export const ARGS_NAVEGADOR = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'];

/**
 * El ejecutable de Chromium. `undefined` significa «el que Playwright encuentre solo», que es lo
 * correcto en una instalación normal con `npx playwright install`.
 */
export function ejecutableNavegador() {
	if (process.env.PW_CHROME) return process.env.PW_CHROME;
	const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
	if (!base || !existsSync(base)) return undefined;
	// Dentro hay una carpeta por versión: `chromium-1194`, `chromium-1220`… se coge la más nueva.
	const dirs = readdirSync(base).filter((d) => d.startsWith('chromium')).sort();
	for (const d of dirs.reverse()) {
		for (const rel of [
			['chrome-linux', 'chrome'],
			['chrome-win', 'chrome.exe'],
			['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
		]) {
			const f = join(base, d, ...rel);
			if (existsSync(f)) return f;
		}
	}
	return undefined;
}

/** Abre el navegador como lo abren todas las suites. */
export async function abrirNavegador(chromium) {
	const executablePath = ejecutableNavegador();
	return chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ARGS_NAVEGADOR });
}

/**
 * Cómo se llama Python aquí. En Windows el binario es `python`; en Linux y macOS, `python3`.
 * `PYTHON` lo deja elegir a mano si hay varios.
 */
export function ejecutablePython() {
	return process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
}
