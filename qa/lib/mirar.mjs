/**
 * MIRAR DE VERDAD: arrancar la aplicación, ponerse delante y hacer LÁMINAS DE CONTACTO.
 *
 * Una corroboración visual con nueve cámaras, tres tamaños y tres aperturas son ochenta y una
 * capturas por tablero. Mirarlas de una en una no es mirar: es hojear. Así que la escena se
 * fotografía desde cada cámara y las fotos se pegan en UNA sola lámina con su rótulo debajo,
 * como una hoja de contactos de laboratorio. En una lámina se comparan de un vistazo
 * proporciones, espesores y sombras, que es exactamente lo que se está juzgando.
 *
 * El pegado se hace DENTRO del navegador, sobre un lienzo 2D, porque el lienzo 3D se lee con
 * `toDataURL()` gracias a `preserveDrawingBuffer`. Nada de librerías de imagen en Node.
 */
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SALIDA = join(RAIZ, 'qa', 'capturas');
mkdirSync(SALIDA, { recursive: true });

const MIME = {
	'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
	'.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml',
};

export async function servir() {
	const base = join(RAIZ, 'app', 'dist');
	const sv = http.createServer((q, r) => {
		let u = decodeURIComponent(q.url.split('?')[0]);
		if (u === '/') u = '/index.html';
		const f = join(base, u);
		if (!existsSync(f)) { r.statusCode = 404; r.end(''); return; }
		r.setHeader('Content-Type', MIME[extname(f)] ?? 'application/octet-stream');
		r.end(readFileSync(f));
	});
	await new Promise((r) => sv.listen(0, r));
	return sv;
}

/** El Chromium que haya: la variable manda, luego el de Playwright, luego el que encuentre. */
export function navegadorDelSistema() {
	if (process.env.PW_CHROME) return process.env.PW_CHROME;
	const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
	if (!base || !existsSync(base)) return undefined;
	for (const d of readdirSync(base).filter((x) => x.startsWith('chromium')).sort().reverse()) {
		for (const rel of [['chrome-linux', 'chrome'], ['chrome-win', 'chrome.exe']]) {
			const f = join(base, d, ...rel);
			if (existsSync(f)) return f;
		}
	}
	return undefined;
}

/** Abre el ejemplo `n` de la biblioteca y deja la aplicación en modo trabajo, lista para mirar. */
export async function abrirEjemplo(p, puerto, n) {
	await p.goto(`http://127.0.0.1:${puerto}/?qa=1&inicio=0`);
	await p.waitForFunction(() => !!window.qa?.proyecto, null, { timeout: 60_000 });
	await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click());
	await p.waitForTimeout(400);
	await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click());
	await p.waitForTimeout(600);
	if (await p.isVisible('#modal-dialogo')) {
		await p.evaluate(() => document.getElementById('dialogo-ok')?.click());
		await p.waitForTimeout(500);
		await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click());
		await p.waitForTimeout(600);
	}
	await p.locator('.tarjeta-ejemplo button').nth(n).click({ timeout: 120_000 });
	await p.waitForTimeout(2400);
	for (const [m, bt] of [['#modal-dialogo', 'dialogo-ok'], ['#modal-explicacion', 'btn-cerrar-explicacion']]) {
		if (await p.isVisible(m)) {
			await p.evaluate((i) => document.getElementById(i)?.click(), bt);
			await p.waitForTimeout(700);
		}
	}
	// Los ejemplos de la biblioteca son de solo lectura: para poder EDITARLOS hay que hacer antes
	// lo que haría el usuario, pulsar «Hacer una copia para trabajar». Sin esto, cambiar la medida
	// de la caja no hace nada y la prueba mira un armario que no es el que cree.
	if (await p.evaluate(() => document.getElementById('chip-ejemplo')?.hidden === false)) {
		await p.evaluate(() => document.getElementById('btn-copiar-ejemplo')?.click());
		await p.waitForFunction(() => document.getElementById('chip-ejemplo')?.hidden !== false,
			null, { timeout: 30_000 });
		await p.waitForTimeout(600);
	}
	await p.evaluate(() => document.getElementById('modo-trabajo')?.click());
	await p.waitForTimeout(700);
	return p.evaluate(() => window.qa.proyecto().nombre);
}

/**
 * Fotografía la escena desde cada cámara y devuelve UNA lámina de contactos en PNG.
 *
 * `camaras` es una lista de `[rótulo, {x,y,z,tx,ty,tz}]`. `columnas` decide la retícula.
 */
export async function lamina(p, camaras, { columnas = 3, celda = 460, archivo }) {
	const tomas = [];
	for (const [rotulo, cam] of camaras) {
		await p.evaluate((c) => window.qa.verDesde(c), cam);
		await p.waitForTimeout(160);
		const datos = await p.evaluate(() => {
			const lienzo = document.querySelector('canvas');
			return lienzo.toDataURL('image/png');
		});
		tomas.push([rotulo, datos]);
	}
	const png = await p.evaluate(async ([tomas, columnas, celda]) => {
		const filas = Math.ceil(tomas.length / columnas);
		const alto = Math.round(celda * 0.68);
		const pie = 22;
		const hoja = document.createElement('canvas');
		hoja.width = columnas * celda;
		hoja.height = filas * (alto + pie);
		const c = hoja.getContext('2d');
		c.fillStyle = '#101214';
		c.fillRect(0, 0, hoja.width, hoja.height);
		for (let i = 0; i < tomas.length; i++) {
			const [rotulo, datos] = tomas[i];
			const img = new Image();
			await new Promise((ok) => { img.onload = ok; img.src = datos; });
			const cx = (i % columnas) * celda;
			const cy = Math.floor(i / columnas) * (alto + pie);
			c.drawImage(img, cx, cy, celda, alto);
			c.strokeStyle = '#2a2e33';
			c.strokeRect(cx + 0.5, cy + 0.5, celda - 1, alto - 1);
			c.fillStyle = '#cfd4d9';
			c.font = '13px monospace';
			c.fillText(rotulo, cx + 8, cy + alto + 15);
		}
		return hoja.toDataURL('image/png');
	}, [tomas, columnas, celda]);
	const ruta = join(SALIDA, archivo);
	writeFileSync(ruta, Buffer.from(png.split(',')[1], 'base64'));
	return ruta;
}

/** Deja la puerta en un ángulo exacto y espera a que la escena se haya redibujado. */
export async function puerta(p, t) {
	await p.evaluate((v) => window.qa.ponerPuerta(v), t);
	await p.waitForTimeout(140);
}
