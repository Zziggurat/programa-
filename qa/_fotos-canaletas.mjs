/**
 * LAS FOTOS DEL TABLERO, DESDE ÁNGULOS FIJOS Y REPETIBLES.
 *
 * No es una prueba: es el material para mirar el resultado con los ojos, que es lo único que
 * decide si el cableado «parece un tablero». Los giros son siempre los mismos, así que dos
 * carpetas sacadas antes y después de un cambio se pueden poner una al lado de la otra.
 *
 *   node qa/_fotos-canaletas.mjs <carpeta> [indice-del-ejemplo]
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const RAIZ = '/workspace/programa-/app/dist';
const SALIDA = process.argv[2] ?? '/tmp/fotos-tablero';
const EJEMPLO = Number(process.argv[3] ?? 2);
mkdirSync(SALIDA, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const servidor = http.createServer((req, res) => {
	let ruta = decodeURIComponent(req.url.split('?')[0]);
	if (ruta === '/') ruta = '/index.html';
	const f = join(RAIZ, ruta);
	if (!existsSync(f)) { res.statusCode = 404; res.end(''); return; }
	res.setHeader('Content-Type', MIME[extname(f)] ?? 'application/octet-stream');
	res.end(readFileSync(f));
});
await new Promise((r) => servidor.listen(0, r));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errores = [];
p.on('pageerror', (e) => errores.push(e.message));
const qa = (fn, ...a) => p.evaluate(([f, args]) => window.qa[f](...args), [fn, a]);

await p.goto(`http://127.0.0.1:${servidor.address().port}/?qa=1&inicio=0`);
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
await p.locator('.tarjeta-ejemplo button').nth(EJEMPLO).click({ timeout: 120_000 });
await p.waitForTimeout(2000);
for (const [modal, boton] of [['#modal-dialogo', 'dialogo-ok'], ['#modal-explicacion', 'btn-cerrar-explicacion']]) {
	if (await p.isVisible(modal)) {
		await p.evaluate((id) => document.getElementById(id)?.click(), boton);
		await p.waitForTimeout(700);
	}
}
await p.evaluate(() => document.getElementById('modo-trabajo')?.click());
await p.waitForTimeout(600);
await p.evaluate(() => document.getElementById('btn-centrar')?.click());

const lienzo = await p.locator('#escena').boundingBox();
const quieta = async () => {
	let antes = await qa('camara');
	for (let i = 0; i < 40; i++) {
		await p.waitForTimeout(120);
		const ahora = await qa('camara');
		if (Math.abs(ahora.x - antes.x) < 0.4 && Math.abs(ahora.y - antes.y) < 0.4 && Math.abs(ahora.z - antes.z) < 0.4) return;
		antes = ahora;
	}
};
await quieta();
async function girar(dx, dy) {
	const x = lienzo.x + lienzo.width * 0.72;
	const y = lienzo.y + lienzo.height * 0.3;
	await p.mouse.move(x, y);
	await p.mouse.down();
	for (let k = 1; k <= 6; k++) { await p.mouse.move(x + (dx * k) / 6, y + (dy * k) / 6); await p.waitForTimeout(25); }
	await p.mouse.up();
	await quieta();
}
async function acercar(pasos) {
	await p.mouse.move(lienzo.x + lienzo.width / 2, lienzo.y + lienzo.height / 2);
	for (let i = 0; i < Math.abs(pasos); i++) { await p.mouse.wheel(0, pasos > 0 ? -220 : 220); await p.waitForTimeout(60); }
	await quieta();
}
const tapas = async (v) => {
	await p.evaluate((val) => {
		const c = document.getElementById('ver-tapas');
		if (c && c.checked !== val) c.click();
	}, v);
	await p.waitForTimeout(700);
};
const foto = async (n) => { await p.screenshot({ path: join(SALIDA, `${n}.png`) }); console.log('  ->', `${n}.png`); };

await tapas(false); await foto('01-frente-sin-tapa');
await tapas(true); await foto('02-frente-con-tapa');
await tapas(false);
await girar(-150, 60); await foto('03-diagonal-izquierda');
await girar(300, 0); await foto('04-diagonal-derecha');
await girar(-450, 0); await foto('05-lateral');
await girar(300, -150); await foto('06-superior');
await girar(150, 130); await acercar(6); await foto('07-espinazo-vertical-de-cerca');
await girar(-120, 0); await foto('08-cruce-horizontal-vertical');
await acercar(-6); await girar(120, 0);
await tapas(true); await foto('09-conjunto-con-tapa');
await tapas(false); await foto('10-conjunto-sin-tapa');

console.log(errores.length ? `ERRORES: ${errores.slice(0, 3).join(' | ')}` : 'sin errores de JavaScript');
await b.close();
servidor.close();
