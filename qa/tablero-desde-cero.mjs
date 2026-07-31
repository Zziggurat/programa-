/**
 * Prueba de OFICIO: monta un tablero de control desde cero como lo haría un técnico
 * (aparatos del catálogo, cableado tocando bornes) y mide la calidad del resultado:
 * cables amontonados, cables fantasma, verificación eléctrica y documentación.
 *
 *   node qa/tablero-desde-cero.mjs
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
const url = `http://127.0.0.1:${server.address().port}/?qa=1&inicio=0`;

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
const LIBRE = { x0: 320, x1: 966, y0: 60, y1: 782 };
const enZona = (p) => p && p.x > LIBRE.x0 && p.x < LIBRE.x1 && p.y > LIBRE.y0 && p.y < LIBRE.y1;

await page.goto(url, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
await jsClick('btn-cerrar-ayuda'); await page.waitForTimeout(120);

console.log('\n=== MONTAJE DE UN TABLERO DE CONTROL, PASO A PASO ===');

console.log('\n--- 1. Empezar el proyecto en blanco ---');
await jsClick('btn-empezar-blanco'); await page.waitForTimeout(250);
must('la placa arranca vacía y en modo Editor', (await proyecto()).dispositivos.length === 0
	&& !(await page.evaluate(() => document.body.classList.contains('modo-trabajo'))));

console.log('\n--- 2. Montar los aparatos del catálogo ---');
// Se eligen por su texto, como haría el técnico buscando en el catálogo.
const aparatos = ['Disyuntor 2P C6', 'Diferencial 2P 40A', 'Contactor 3P 9A', 'Relé auxiliar 24 V',
	'Fuente 24 V 2.5 A', 'PLC 8E/4S', 'Bornero 12 bornas 2.5 mm²'];
for (const nombre of aparatos) {
	const b = page.locator('#catalogo button', { hasText: nombre }).first();
	if (await b.count()) { await b.click({ force: true }); await page.waitForTimeout(220); }
	else console.log(`     (no está en el catálogo: ${nombre})`);
}
const p2 = await proyecto();
must('se montaron los aparatos', p2.dispositivos.length >= 6, `${p2.dispositivos.length}`);
must('todos quedaron sobre un riel', p2.gabinete.colocaciones.every((c) => !!c.rielId));
const solapan = p2.gabinete.colocaciones.some((a, i) => p2.gabinete.colocaciones.some((b, j) =>
	i !== j && a.x < b.x + b.ancho && a.x + a.ancho > b.x && a.y < b.y + b.alto && a.y + a.alto > b.y));
must('ninguno quedó encimado con otro', !solapan);
must('todos caben dentro de la placa', p2.gabinete.colocaciones.every((c) =>
	c.x >= -1 && c.y >= -1 && c.x + c.ancho <= p2.gabinete.ancho + 1 && c.y + c.alto <= p2.gabinete.alto + 1));

console.log('\n--- 3. Cablear tocando los bornes ---');
await jsClick('modo-trabajo'); await page.waitForTimeout(350);
await jsClick('btn-centrar'); await page.waitForTimeout(400);
const bornes = (await qa('bornes')).filter(enZona);
must('los bornes se ven y se pueden tocar', bornes.length > 10, `${bornes.length} accesibles`);

// Se conectan pares de bornes de aparatos distintos, como al cablear de verdad.
let conectados = 0;
const usados = new Set();
for (const b of bornes) {
	if (conectados >= 10) break;
	if (usados.has(`${b.dispositivo}:${b.borne}`)) continue;
	const otro = bornes.find((o) => o.dispositivo !== b.dispositivo
		&& !usados.has(`${o.dispositivo}:${o.borne}`)
		&& Math.hypot(o.x - b.x, o.y - b.y) > 60);
	if (!otro) continue;
	const antes = (await proyecto()).conductores.length;
	await page.mouse.click(b.x, b.y); await page.waitForTimeout(130);
	await page.mouse.click(otro.x, otro.y); await page.waitForTimeout(190);
	if ((await proyecto()).conductores.length > antes) {
		conectados++;
		usados.add(`${b.dispositivo}:${b.borne}`); usados.add(`${otro.dispositivo}:${otro.borne}`);
	}
}
must('se cablea tocando dos bornes, sin formularios', conectados >= 8, `${conectados} cables tendidos`);

console.log('\n--- 4. Calidad del cableado resultante ---');
const p4 = await proyecto();
must('ningún cable queda invisible (sin fantasmas)', (await qa('cablesDibujados')) === p4.conductores.length,
	`${await qa('cablesDibujados')}/${p4.conductores.length}`);
const amont = await qa('amontonamiento');
console.log(`     amontonamiento: ${amont.totalMm} mm en ${amont.pares} pares de ${amont.cables} cables`);
const mmPorCable = amont.cables ? amont.totalMm / amont.cables : 0;
must('los cables no se amontonan unos sobre otros', mmPorCable < 40, `${Math.round(mmPorCable)} mm/cable`);

console.log('\n--- 5. Verificación y documentación (lo que se entrega) ---');
const drc = await page.textContent('#chip-drc-texto');
console.log(`     DRC: ${drc.trim()}`);
must('la verificación eléctrica responde', !!drc.trim());
const bajar = async (id, patron) => {
	const esperado = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
	await jsClick(id);
	const d = await esperado;
	return d && patron.test(d.suggestedFilename());
};
must('se exporta el PDF con la lista de materiales', await bajar('btn-pdf', /\.pdf$/i));
must('se guarda el proyecto', await bajar('btn-guardar', /\.tablero\.json$/i));

console.log('\n--- 6. Estado final ---');
await page.screenshot({ path: join(AQUI, '_tablero.png') });
must('sin errores de JavaScript en todo el montaje', errs.length === 0, errs.join(' | '));

await browser.close(); server.close();
console.log(`\n=== ${fallos === 0 ? 'TODO OK ✔' : fallos + ' FALLO(S)'} ===`);
process.exit(fallos === 0 ? 0 : 1);
