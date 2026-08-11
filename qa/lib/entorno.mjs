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

/**
 * UN SERVIDOR DE PRUEBAS QUE NO SIRVE NADA DE FUERA DE `app/dist`.
 *
 * Tercera auditoría, TS3-P2-06. Las 35 suites levantaban su propio servidor con la misma línea
 * copiada, y esa línea componía la ruta pedida con `join(ROOT, p)`. En Windows:
 *
 *     path.join('C:\\repo\\app\\dist', '/../../secret') -> C:\\repo\\secret
 *
 * Son herramientas locales, no el producto que se entrega, así que la gravedad es la que es. Pero
 * corren en CI y en equipos compartidos, y un servidor que sirve el repositorio entero no tiene
 * defensa posible si algún día alguien le pide una ruta que no debería. Además escuchaban sin
 * fijar host, o sea en todas las interfaces de la máquina.
 *
 * Aquí se resuelve la ruta y se comprueba que el resultado SIGUE debajo de la raíz —que es la
 * única comprobación que funciona, porque `..` puede llegar codificado de varias formas— y se
 * escucha solo en `127.0.0.1`.
 */
export async function servidorDeQA(raizServida = join(RAIZ, 'app', 'dist')) {
	const { createServer } = await import('node:http');
	const { resolve, sep, extname: ext } = await import('node:path');
	const { existsSync, readFileSync, statSync } = await import('node:fs');
	const base = resolve(raizServida);
	const MIME = {
		'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
		'.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
		'.woff2': 'font/woff2', '.map': 'application/json',
	};
	const s = createServer((q, r) => {
		let u;
		try { u = decodeURIComponent(q.url.split('?')[0]); } catch { r.statusCode = 400; r.end(''); return; }
		if (u === '/') u = '/index.html';
		const f = resolve(base, `.${u}`);
		// La comprobación que de verdad importa: el archivo resuelto tiene que seguir dentro.
		if (f !== base && !f.startsWith(base + sep)) { r.statusCode = 403; r.end(''); return; }
		if (!existsSync(f) || !statSync(f).isFile()) { r.statusCode = 404; r.end(''); return; }
		r.setHeader('Content-Type', MIME[ext(f)] ?? 'application/octet-stream');
		r.end(readFileSync(f));
	});
	await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
	return { servidor: s, url: `http://127.0.0.1:${s.address().port}` };
}
