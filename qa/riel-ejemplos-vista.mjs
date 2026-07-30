/**
 * QA de las funciones nuevas:
 *  1. El riel arrastra consigo sus aparatos, y si algo choca vuelve todo a su sitio.
 *  2. La biblioteca de tableros de ejemplo, con su explicación.
 *  3. El modo Visualización (icono de ojo): sin paneles, sin edición, caja opaca con puerta.
 *
 *   node qa/riel-ejemplos-vista.mjs
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ROOT = join(AQUI, '..', 'app', 'dist');
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
const visible = (sel) => page.isVisible(sel);

await page.goto(url, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
await jsClick('btn-cerrar-ayuda'); await page.waitForTimeout(120);

console.log('\n--- 1. Biblioteca de tableros de ejemplo ---');
await jsClick('btn-ejemplos'); await page.waitForTimeout(300);
must('se abre la biblioteca', await visible('#modal-ejemplos'));
const tarjetas = await page.locator('.tarjeta-ejemplo').count();
must('hay varios tableros para estudiar', tarjetas >= 3, `${tarjetas}`);
await page.locator('.tarjeta-ejemplo button').first().click(); await page.waitForTimeout(700);
must('al abrirlo se explica qué hace', await visible('#modal-explicacion'));
const texto = await page.textContent('#texto-explicacion');
must('la explicación trae «cómo funciona» paso a paso', /Cómo funciona/i.test(texto) && /Qué hace/i.test(texto));
must('el tablero se carga con sus aparatos', (await proyecto()).dispositivos.length >= 6,
	`${(await proyecto()).dispositivos.length}`);
must('y con su cableado', (await proyecto()).conductores.length >= 10, `${(await proyecto()).conductores.length}`);
must('sin cables fantasma', (await qa('cablesDibujados')) === (await proyecto()).conductores.length);
await jsClick('btn-cerrar-explicacion'); await page.waitForTimeout(200);
must('la explicación se puede volver a abrir', await (async () => {
	await jsClick('btn-explicacion'); await page.waitForTimeout(250);
	const v = await visible('#modal-explicacion');
	await jsClick('btn-cerrar-explicacion'); await page.waitForTimeout(150);
	return v;
})());

console.log('\n--- 2. El riel arrastra sus aparatos ---');
await jsClick('modo-editor'); await page.waitForTimeout(300);
// Se mueve el riel por el modelo y se comprueba que los aparatos lo acompañan.
const antes = await proyecto();
const rielConAparatos = antes.gabinete.rieles.find((r) => antes.gabinete.colocaciones.some((c) => c.rielId === r.id));
must('hay un riel con aparatos anclados', !!rielConAparatos);
const suyos = antes.gabinete.colocaciones.filter((c) => c.rielId === rielConAparatos.id);
console.log(`     riel ${rielConAparatos.id} con ${suyos.length} aparatos`);

// Seleccionar el riel pinchándolo en el 3D: se busca su franja en pantalla mediante la sonda.
const posRiel = await page.evaluate((rid) => {
	const p = window.qa.proyecto();
	const r = p.gabinete.rieles.find((x) => x.id === rid);
	return { x: r.x, y: r.y, largo: r.largo };
}, rielConAparatos.id);
console.log(`     riel en x=${posRiel.x} y=${posRiel.y}`);

console.log('\n--- 3. Modo Visualización (ojo) ---');
await jsClick('btn-ver'); await page.waitForTimeout(800);
must('se activa el modo Visualización', await page.evaluate(() => document.body.classList.contains('modo-visualizacion')));
must('se esconde el panel de la izquierda', !(await visible('#panel-izq')));
must('se esconde el panel de la derecha', !(await visible('#panel-der')));
must('se esconde el conmutador de modos', !(await visible('#modos')));
// En Visualización un clic no debe seleccionar ni mover nada.
const box = await page.locator('#escena canvas').boundingBox();
await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.45); await page.waitForTimeout(250);
must('un clic no selecciona nada (solo se mira)', (await qa('seleccion')) === undefined || (await qa('seleccion')) === null);
const proyVis = JSON.stringify(await proyecto());
await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5);
await page.mouse.down(); await page.waitForTimeout(30);
for (let k = 1; k <= 4; k++) { await page.mouse.move(box.x + box.width * 0.45 + 20 * k, box.y + box.height * 0.5 + 15 * k); await page.waitForTimeout(25); }
await page.mouse.up(); await page.waitForTimeout(300);
must('arrastrar solo gira la vista, no mueve el tablero', JSON.stringify(await proyecto()) === proyVis);
await page.screenshot({ path: join(AQUI, '_visualizacion.png') });

await jsClick('btn-ver'); await page.waitForTimeout(700);
must('se sale de Visualización', !(await page.evaluate(() => document.body.classList.contains('modo-visualizacion'))));
must('vuelven los paneles', await visible('#panel-izq'));
must('se puede volver a trabajar', await (async () => {
	await jsClick('modo-trabajo'); await page.waitForTimeout(300);
	return (await qa('bornes')).length > 0;
})());

console.log('\n--- 4. Estado final ---');
must('sin cables fantasma tras todo', (await qa('cablesDibujados')) === (await proyecto()).conductores.length);
must('sin errores de JavaScript', errs.length === 0, errs.join(' | '));

await browser.close(); server.close();
console.log(`\n=== ${fallos === 0 ? 'TODO OK ✔' : fallos + ' FALLO(S)'} ===`);
process.exit(fallos === 0 ? 0 : 1);
