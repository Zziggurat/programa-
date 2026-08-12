/**
 * QA del vínculo RIEL ↔ APARATOS: al mover un riel sus aparatos van con él, y si el
 * movimiento los hace chocar con otros o salirse de la placa, TODO vuelve a su sitio.
 *
 *   node qa/riel.mjs
 */
import { chromium } from 'playwright-core';

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirNavegador, servidorDeQA, trabajarSobreCopia } from './lib/entorno.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const { servidor: server } = await servidorDeQA();
const url = `http://127.0.0.1:${server.address().port}/?qa=1&inicio=0`;

const browser = await abrirNavegador(chromium);
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|Not Found/i.test(m.text())) errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

let fallos = 0;
const must = (n, c, extra = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${extra ? ' → ' + extra : ''}`); };
const jsClick = (id) => page.evaluate((i) => document.getElementById(i)?.click(), id);
const qa = (fn, ...a) => page.evaluate(([f, args]) => window.qa[f](...args), [fn, a]);
const proyecto = () => qa('proyecto');
const estado = async (rielId) => {
	const p = await proyecto();
	const r = p.gabinete.rieles.find((x) => x.id === rielId);
	return {
		riel: { x: r.x, y: r.y },
		aparatos: p.gabinete.colocaciones.filter((c) => c.rielId === rielId)
			.map((c) => ({ id: c.dispositivoId, x: c.x, y: c.y })).sort((a, b) => a.id.localeCompare(b.id)),
	};
};
/** Arrastra desde un punto de pantalla un desplazamiento dado. */
async function arrastrar(p, dx, dy, pasos = 6) {
	await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(40);
	for (let k = 1; k <= pasos; k++) { await page.mouse.move(p.x + (dx * k) / pasos, p.y + (dy * k) / pasos); await page.waitForTimeout(30); }
	await page.mouse.up(); await page.waitForTimeout(350);
}

await page.goto(url, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
await jsClick('btn-cerrar-ayuda'); await page.waitForTimeout(120);
await jsClick('btn-empezar-ejemplo'); await page.waitForTimeout(300);
await page.locator('.tarjeta-ejemplo button').first().click(); await page.waitForTimeout(700);
if (await page.isVisible('#modal-dialogo')) { await page.evaluate(() => document.getElementById('dialogo-ok')?.click()); await page.waitForTimeout(300); }
await jsClick('btn-cerrar-explicacion'); await trabajarSobreCopia(page);
await jsClick('modo-editor'); await page.waitForTimeout(300);
await jsClick('btn-centrar'); await page.waitForTimeout(500);

const p0 = await proyecto();
const riel = p0.gabinete.rieles.find((r) => p0.gabinete.colocaciones.filter((c) => c.rielId === r.id).length >= 2);
must('hay un riel con varios aparatos anclados', !!riel);
const antes = await estado(riel.id);
console.log(`     riel ${riel.id} en y=${antes.riel.y} con ${antes.aparatos.length} aparatos`);

console.log('\n--- 1. Al mover el riel, sus aparatos lo acompañan ---');
const pt = await qa('puntoDeEstructura', 'riel', riel.id);
must('se localiza el riel en pantalla', !!pt);
await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(250);
must('el riel se selecciona al pincharlo', (await qa('seleccion'))?.id === riel.id, JSON.stringify(await qa('seleccion')));

const pt2 = await qa('puntoDeEstructura', 'riel', riel.id);
await arrastrar(pt2, 0, 26); // bajarlo un poco, a una zona libre
const despues = await estado(riel.id);
const dyRiel = despues.riel.y - antes.riel.y;
console.log(`     el riel se movió ${dyRiel} mm en Y`);
must('el riel se movió', Math.abs(dyRiel) > 0, `${dyRiel} mm`);
const todosSiguen = despues.aparatos.every((a, i) => (a.y - antes.aparatos[i].y) === dyRiel
	&& (a.x - antes.aparatos[i].x) === (despues.riel.x - antes.riel.x));
must('TODOS sus aparatos se movieron exactamente igual que el riel', todosSiguen,
	despues.aparatos.map((a, i) => `${a.id}:${a.y - antes.aparatos[i].y}`).join(' '));

console.log('\n--- 2. Si al moverlo choca, vuelve todo a su sitio ---');
const antesChoque = await estado(riel.id);
// Se busca otro riel con aparatos para estrellar el nuestro contra él.
const p2 = await proyecto();
const otro = p2.gabinete.rieles.find((r) => r.id !== riel.id
	&& p2.gabinete.colocaciones.some((c) => c.rielId === r.id));
must('hay otro riel con aparatos contra el que chocar', !!otro);
if (otro) {
	// Cuántos mm hay que bajar para quedar encima del otro riel, y cuántos píxeles son.
	const dyMm = otro.y - antesChoque.riel.y;
	const escala = await qa('escalaPantalla'); // píxeles por mm en la vista actual
	const dyPx = dyMm * escala.porMmY;
	console.log(`     empujando el riel ${dyMm} mm (${Math.round(dyPx)} px) encima de ${otro.id}`);
	const pA = await qa('puntoDeEstructura', 'riel', riel.id);
	await page.mouse.click(pA.x, pA.y); await page.waitForTimeout(200);
	const pA2 = await qa('puntoDeEstructura', 'riel', riel.id);
	await arrastrar(pA2, 0, dyPx, 8);
	const tras = await estado(riel.id);
	const volvio = tras.riel.y === antesChoque.riel.y && tras.riel.x === antesChoque.riel.x
		&& tras.aparatos.every((a, i) => a.x === antesChoque.aparatos[i].x && a.y === antesChoque.aparatos[i].y);
	must('el riel y sus aparatos volvieron a su posición inicial', volvio,
		`riel y: ${antesChoque.riel.y} → ${tras.riel.y}`);
	const p3 = await proyecto();
	const cols = p3.gabinete.colocaciones;
	const hayEncimados = cols.some((a, i) => cols.some((b, j) => i !== j
		&& a.x < b.x + b.ancho && a.x + a.ancho > b.x && a.y < b.y + b.alto && a.y + a.alto > b.y));
	must('no quedó ningún aparato encimado con otro', !hayEncimados);
}

console.log('\n--- 3. Coherencia ---');
must('sin cables fantasma', (await qa('cablesDibujados')) === (await proyecto()).conductores.length);
must('sin errores de JavaScript', errs.length === 0, errs.join(' | '));

await browser.close(); server.close();
console.log(`\n=== ${fallos === 0 ? 'TODO OK ✔' : fallos + ' FALLO(S)'} ===`);
process.exit(fallos === 0 ? 0 : 1);
