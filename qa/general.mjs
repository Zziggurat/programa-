/**
 * QA automático general de TableroStudio: comprueba el resto del programa (modos, catálogo,
 * empezar de cero, deshacer/rehacer, guardar, exportar PDF y dossier, DRC) sobre la app real.
 *
 *   node qa/general.mjs
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
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|Not Found/i.test(m.text())) errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

let fallos = 0;
const must = (n, c, extra = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${extra ? ' → ' + extra : ''}`); };
const jsClick = (id) => page.evaluate((i) => document.getElementById(i)?.click(), id);
const qa = (fn, ...a) => page.evaluate(([f, args]) => window.qa[f](...args), [fn, a]);
const proyecto = () => qa('proyecto');
const enTrabajo = () => page.evaluate(() => document.body.classList.contains('modo-trabajo'));

await page.goto(url, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
await jsClick('btn-cerrar-ayuda'); await page.waitForTimeout(120);

console.log('\n--- 1. Empezar un tablero nuevo ---');
await jsClick('btn-empezar-ejemplo'); await page.waitForTimeout(300);
await jsClick('modo-trabajo'); await page.waitForTimeout(200);
await jsClick('btn-nuevo'); await page.waitForTimeout(200);
must('pide confirmación', await page.isVisible('#modal-dialogo'));
await jsClick('dialogo-ok'); await page.waitForTimeout(300);
must('queda en modo Editor (se puede trabajar)', !(await enTrabajo()));
must('el catálogo está visible', await page.isVisible('#catalogo'));
must('la placa queda vacía', (await proyecto()).dispositivos.length === 0);
await jsClick('btn-empezar-blanco'); await page.waitForTimeout(200);
must('«Empezar en blanco» cierra la tarjeta', !(await page.isVisible('#bienvenida')));

console.log('\n--- 2. Catálogo y colocación ---');
const cat = page.locator('#catalogo button');
await cat.nth(0).click({ force: true }); await page.waitForTimeout(250);
await cat.nth(1).click({ force: true }); await page.waitForTimeout(250);
const p2 = await proyecto();
must('se añaden aparatos del catálogo', p2.dispositivos.length === 2, `${p2.dispositivos.length}`);
must('todos quedan colocados sobre un riel', p2.gabinete.colocaciones.length === 2
	&& p2.gabinete.colocaciones.every((c) => !!c.rielId));
const solapan = p2.gabinete.colocaciones.some((a, i) => p2.gabinete.colocaciones.some((b, j) =>
	i !== j && a.x < b.x + b.ancho && a.x + a.ancho > b.x && a.y < b.y + b.alto && a.y + a.alto > b.y));
must('no se solapan entre ellos', !solapan);

console.log('\n--- 3. Deshacer / rehacer ---');
await page.keyboard.press('Control+z'); await page.waitForTimeout(250);
must('Ctrl+Z quita el último aparato', (await proyecto()).dispositivos.length === 1);
await page.keyboard.press('Control+y'); await page.waitForTimeout(250);
must('Ctrl+Y lo devuelve', (await proyecto()).dispositivos.length === 2);

console.log('\n--- 4. Modos Editor / Trabajo ---');
await jsClick('modo-trabajo'); await page.waitForTimeout(250);
must('en Trabajo se oculta el catálogo', !(await page.isVisible('#catalogo')));
must('en Trabajo se ve el panel de cables', await page.isVisible('#seccion-cables'));
must('en Trabajo se ven los bornes clicables', (await qa('bornes')).length > 0);
await jsClick('modo-editor'); await page.waitForTimeout(250);
must('en Editor vuelve el catálogo', await page.isVisible('#catalogo'));

console.log('\n--- 5. Verificación eléctrica (DRC) ---');
await jsClick('btn-empezar-ejemplo'); await page.waitForTimeout(400);
must('el ejemplo pasa el DRC sin hallazgos', /sin hallazgos/i.test(await page.textContent('#chip-drc-texto')));

console.log('\n--- 6. Guardar, dossier y PDF ---');
const bajar = async (id, patron) => {
	const esperado = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
	await jsClick(id);
	const d = await esperado;
	return d && patron.test(d.suggestedFilename());
};
must('Guardar descarga el .tablero.json', await bajar('btn-guardar', /\.tablero\.json$/i));
must('Dossier HTML se descarga', await bajar('btn-dossier', /\.html?$/i));
must('Exportar PDF se descarga', await bajar('btn-pdf', /\.pdf$/i));

console.log('\n--- 7. Estado final ---');
must('sin errores de JavaScript en toda la sesión', errs.length === 0, errs.join(' | '));

await browser.close(); server.close();
console.log(`\n=== ${fallos === 0 ? 'TODO OK ✔' : fallos + ' FALLO(S)'} ===`);
process.exit(fallos === 0 ? 0 : 1);
