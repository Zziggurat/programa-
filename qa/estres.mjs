/**
 * Prueba de ESTRÉS del cableado: ejecuta decenas de operaciones al azar (conectar, poner
 * uniones, arrastrar, borrar, deshacer/rehacer, cambiar de modo) y verifica tras CADA una
 * los invariantes del programa. Sirve para cazar bugs de casos límite.
 *
 *   node qa/estres.mjs [nº de operaciones]
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OPS = Number(process.argv[2] ?? 45);
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

const jsClick = (id) => page.evaluate((i) => document.getElementById(i)?.click(), id);
const qa = (fn, ...a) => page.evaluate(([f, args]) => window.qa[f](...args), [fn, a]);
const LIBRE = { x0: 316, x1: 970, y0: 60, y1: 780 };
const enZona = (p) => p && p.x > LIBRE.x0 && p.x < LIBRE.x1 && p.y > LIBRE.y0 && p.y < LIBRE.y1;
// Aleatorio reproducible (misma semilla → misma secuencia, para poder repetir un fallo).
let semilla = Number(process.argv[3] ?? 12345);
const rnd = () => (semilla = (semilla * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const elige = (arr) => arr[Math.floor(rnd() * arr.length)];

await page.goto(url, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
await jsClick('btn-cerrar-ayuda'); await page.waitForTimeout(120);
await jsClick('btn-empezar-ejemplo'); await page.waitForTimeout(400);
await jsClick('modo-trabajo'); await page.waitForTimeout(350);

const problemas = [];
async function verificarInvariantes(paso, op) {
	const p = await qa('proyecto');
	const dibujados = await qa('cablesDibujados');
	const ids = new Set(p.dispositivos.map((d) => d.id));
	if (dibujados !== p.conductores.length) {
		problemas.push(`paso ${paso} (${op}): ${p.conductores.length - dibujados} cable(s) fantasma`);
	}
	const colgando = p.conductores.filter((c) => !ids.has(c.de.dispositivoId) || !ids.has(c.a.dispositivoId));
	if (colgando.length) problemas.push(`paso ${paso} (${op}): ${colgando.length} cable(s) a un aparato inexistente`);
	const malTrazado = p.conductores.filter((c) => c.trazado?.some((w) => !Number.isFinite(w.x) || !Number.isFinite(w.y)));
	if (malTrazado.length) problemas.push(`paso ${paso} (${op}): ${malTrazado.length} cable(s) con puntos inválidos`);
	if (errs.length) { problemas.push(`paso ${paso} (${op}): error JS → ${errs.join(' | ')}`); errs.length = 0; }
}

const acciones = ['conectar', 'union', 'arrastrar', 'borrar', 'deshacer', 'rehacer', 'modo', 'autoordenar', 'dobleclic'];
const cuenta = {};
for (let paso = 1; paso <= OPS; paso++) {
	const op = elige(acciones);
	cuenta[op] = (cuenta[op] ?? 0) + 1;
	const p = await qa('proyecto');
	try {
		if (op === 'conectar') {
			const bs = (await qa('bornes')).filter(enZona);
			if (bs.length > 3) {
				const a = elige(bs); const b = elige(bs);
				await page.mouse.click(a.x, a.y); await page.waitForTimeout(90);
				if (rnd() < 0.4) { await page.mouse.click((a.x + b.x) / 2, (a.y + b.y) / 2 + 40); await page.waitForTimeout(80); }
				await page.mouse.click(b.x, b.y); await page.waitForTimeout(150);
			}
		} else if (op === 'union' || op === 'arrastrar' || op === 'borrar' || op === 'dobleclic') {
			if (p.conductores.length === 0) continue;
			const c = elige(p.conductores);
			const pt = (await qa('puntosDeCable', c.id)).find(enZona);
			if (!pt) continue;
			await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(120); // seleccionar
			if (op === 'union') { await page.mouse.click(pt.x, pt.y, { button: 'right' }); await page.waitForTimeout(150); }
			else if (op === 'dobleclic') { await page.mouse.dblclick(pt.x, pt.y); await page.waitForTimeout(150); }
			else if (op === 'borrar') { await page.keyboard.press('Delete'); await page.waitForTimeout(150); }
			else {
				await page.mouse.move(pt.x, pt.y); await page.mouse.down(); await page.waitForTimeout(25);
				for (let k = 1; k <= 3; k++) { await page.mouse.move(pt.x + 18 * k * (rnd() < 0.5 ? 1 : -1), pt.y + 14 * k); await page.waitForTimeout(20); }
				await page.mouse.up(); await page.waitForTimeout(140);
			}
		} else if (op === 'deshacer') { await page.keyboard.press('Control+z'); await page.waitForTimeout(160); }
		else if (op === 'rehacer') { await page.keyboard.press('Control+y'); await page.waitForTimeout(160); }
		else if (op === 'autoordenar') { await jsClick('btn-ordenar-cables'); await page.waitForTimeout(200); }
		else if (op === 'modo') {
			await jsClick('modo-editor'); await page.waitForTimeout(150);
			await jsClick('modo-trabajo'); await page.waitForTimeout(200);
		}
	} catch (e) {
		problemas.push(`paso ${paso} (${op}): excepción ${e.message}`);
	}
	await verificarInvariantes(paso, op);
}

const fin = await qa('proyecto');
console.log(`Operaciones: ${OPS} →`, Object.entries(cuenta).map(([k, v]) => `${k}:${v}`).join(' '));
console.log(`Estado final: ${fin.conductores.length} cables · ${await qa('cablesDibujados')} dibujados`);
if (problemas.length) { console.log('\nPROBLEMAS:'); for (const p of problemas.slice(0, 25)) console.log(' -', p); }
await browser.close(); server.close();
console.log(`\n=== ${problemas.length === 0 ? 'SIN PROBLEMAS ✔' : problemas.length + ' PROBLEMA(S)'} ===`);
process.exit(problemas.length === 0 ? 0 : 1);
