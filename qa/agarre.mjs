/**
 * QA del AGARRE de cables: comprueba que cualquier cable se puede agarrar y mover pinchando
 * en cualquier punto de su recorrido, incluso con la cámara girada (donde antes fallaba por
 * el desfase de perspectiva) y aunque el cable cruce por delante de un aparato.
 *
 *   node qa/agarre.mjs
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
	let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
	const f = join(ROOT, p); if (!existsSync(f)) { res.statusCode = 404; res.end(''); return; }
	res.setHeader('Content-Type', MIME[extname(f)] ?? 'application/octet-stream'); res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/?qa=1`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|Not Found/i.test(m.text())) errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

let fallos = 0;
const must = (n, c, extra = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${extra ? ' → ' + extra : ''}`); };
const jsClick = (id) => page.evaluate((i) => document.getElementById(i)?.click(), id);
const qa = (fn, ...a) => page.evaluate(([f, args]) => window.qa[f](...args), [fn, a]);
const proyecto = () => qa('proyecto');
const LIBRE = { x0: 320, x1: 966, y0: 60, y1: 782 };
const enZona = (p) => p && p.x > LIBRE.x0 && p.x < LIBRE.x1 && p.y > LIBRE.y0 && p.y < LIBRE.y1;
const trazadoDe = async (id) => JSON.stringify((await proyecto()).conductores.find((c) => c.id === id)?.trazado ?? null);

/** Gira la cámara arrastrando con el botón izquierdo sobre una zona vacía del lienzo. */
async function girarCamara(dx, dy) {
	const x = LIBRE.x1 - 30, y = LIBRE.y0 + 30; // esquina superior derecha del lienzo: sin aparatos
	await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(30);
	for (let k = 1; k <= 5; k++) { await page.mouse.move(x + (dx * k) / 5, y + (dy * k) / 5); await page.waitForTimeout(25); }
	await page.mouse.up(); await page.waitForTimeout(250);
}

/**
 * Intenta agarrar el cable `id` por un punto visible de su recorrido y moverlo.
 * Si el píxel elegido lo ocupa OTRO cable montado encima (cosa que pasa cuando la prueba ya
 * ha movido muchos), se marca `otro` y no cuenta: no es un fallo de agarre.
 */
async function intentarAgarrar(id) {
	const antes = await trazadoDe(id);
	const puntos = (await qa('puntosVisiblesDeCable', id)).filter(enZona);
	if (puntos.length === 0) return { movido: false, sinPuntos: true };
	const p = puntos[Math.floor(puntos.length / 2)];
	await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(40);
	const sel = await qa('seleccion');
	if (sel?.id !== id) { await page.mouse.up(); await page.waitForTimeout(80); return { movido: false, otro: true }; }
	for (let k = 1; k <= 5; k++) { await page.mouse.move(p.x + 9 * k, p.y + 7 * k); await page.waitForTimeout(25); }
	await page.mouse.up(); await page.waitForTimeout(200);
	return { movido: (await trazadoDe(id)) !== antes, sinPuntos: false };
}

/** Deja el ejemplo recién cargado en modo Trabajo (cada bloque parte de un tablero limpio,
 *  para medir la capacidad real de agarre y no el enredo que dejó la prueba anterior). */
async function tableroLimpio() {
	await jsClick('btn-empezar-ejemplo'); await page.waitForTimeout(400);
	await jsClick('modo-trabajo'); await page.waitForTimeout(300);
	await jsClick('btn-centrar'); await page.waitForTimeout(400);
}

await page.goto(url, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
await jsClick('btn-cerrar-ayuda'); await page.waitForTimeout(120);
await tableroLimpio();

console.log('\n--- 1. Agarrar un cable «directo» (sin uniones) a la primera ---');
const id0 = (await proyecto()).conductores[0].id;
must('un cable recién creado no tiene uniones', (await trazadoDe(id0)) === 'null');
const r0 = await intentarAgarrar(id0);
must('se agarra y se mueve sin tener que crear antes una unión', r0.movido);

console.log('\n--- 2. Un simple clic NO deja uniones sueltas ---');
const id1 = (await proyecto()).conductores[3].id;
const antes1 = await trazadoDe(id1);
const p1 = (await qa('puntosDeCable', id1)).filter(enZona)[1];
if (p1) { await page.mouse.click(p1.x, p1.y); await page.waitForTimeout(250); }
must('clic sin arrastrar solo selecciona (no crea unión)', (await trazadoDe(id1)) === antes1);
must('y el cable queda seleccionado', /Cable/.test(await page.textContent('#panel-der')));

console.log('\n--- 3. Con la cámara girada (donde antes fallaba por la perspectiva) ---');
for (const [dx, dy, nombre] of [[140, 0, 'girado a la derecha'], [-260, 90, 'girado a la izquierda y arriba']]) {
	await tableroLimpio();       // tablero limpio para cada ángulo
	await girarCamara(dx, dy);
	const cs = (await proyecto()).conductores;
	let probados = 0; let movidos = 0;
	const fallan = [];
	for (const c of cs.slice(0, 8)) {
		const r = await intentarAgarrar(c.id);
		if (r.sinPuntos || r.otro) continue;
		probados++;
		if (r.movido) movidos++; else fallan.push(c.numero ?? c.id);
	}
	must(`se agarran los cables con la cámara ${nombre}`, probados > 0 && movidos === probados,
		`${movidos}/${probados}${fallan.length ? ' · fallan: ' + fallan.join(',') : ''}`);
}

console.log('\n--- 4. Barrido: TODOS los cables visibles deben poder agarrarse ---');
await tableroLimpio();
const todos = (await proyecto()).conductores;
let probados = 0; let movidos = 0; const fallidos = [];
for (const c of todos) {
	const r = await intentarAgarrar(c.id);
	if (r.sinPuntos || r.otro) continue;
	probados++;
	if (r.movido) movidos++; else fallidos.push(c.numero ?? c.id);
}
must('todos los cables visibles se pueden agarrar', movidos === probados,
	`${movidos}/${probados}${fallidos.length ? ' · fallan: ' + fallidos.join(',') : ''}`);

console.log('\n--- 5. Coherencia ---');
must('sin cables fantasma', (await qa('cablesDibujados')) === (await proyecto()).conductores.length);
must('sin errores de JavaScript', errs.length === 0, errs.join(' | '));

await browser.close(); server.close();
console.log(`\n=== ${fallos === 0 ? 'TODO OK ✔' : fallos + ' FALLO(S)'} ===`);
process.exit(fallos === 0 ? 0 : 1);
