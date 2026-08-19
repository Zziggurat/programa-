/**
 * ¿RESPETA EL PROGRAMA LO QUE COLOCA EL USUARIO? Medido, punto por punto.
 *
 * Se pide una posición exacta, y se comparan tres cosas: lo que se pidió, lo que se GUARDÓ en el
 * peinado y dónde acaba el cable DIBUJADO en ese punto. Cualquier diferencia es el programa
 * moviendo algo que el usuario ya había decidido.
 *
 * Se prueban sitios a propósito incómodos: encima de un aparato, junto a una canaleta, dentro de
 * ella y en medio de otros cables. Son los sitios donde antes «peleaba».
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const RAIZ = '/workspace/programa-/app/dist';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const sv = http.createServer((q, r) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u === '/') u = '/index.html'; const f = join(RAIZ, u); if (!existsSync(f)) { r.statusCode = 404; r.end(''); return; } r.setHeader('Content-Type', MIME[extname(f)] ?? 'application/octet-stream'); r.end(readFileSync(f)); });
await new Promise((r) => sv.listen(0, r));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.setDefaultTimeout(60_000);
const er = []; p.on('pageerror', (e) => er.push(e.message));
const qa = (fn, ...a) => p.evaluate(([f, ar]) => window.qa[f](...ar), [fn, a]);

await p.goto(`http://127.0.0.1:${sv.address().port}/?qa=1&inicio=0`);
await p.waitForFunction(() => !!window.qa?.proyecto, null, { timeout: 60_000 });
await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click()); await p.waitForTimeout(400);
await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click()); await p.waitForTimeout(600);
if (await p.isVisible('#modal-dialogo')) { await p.evaluate(() => document.getElementById('dialogo-ok')?.click()); await p.waitForTimeout(500); await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click()); await p.waitForTimeout(600); }
await p.locator('.tarjeta-ejemplo button').nth(2).click({ timeout: 120_000 }); await p.waitForTimeout(2000);
for (const [m, bt] of [['#modal-dialogo', 'dialogo-ok'], ['#modal-explicacion', 'btn-cerrar-explicacion']]) { if (await p.isVisible(m)) { await p.evaluate((i) => document.getElementById(i)?.click(), bt); await p.waitForTimeout(700); } }
await p.evaluate(() => document.getElementById('modo-trabajo')?.click()); await p.waitForTimeout(500);
await p.evaluate(() => document.getElementById('btn-copiar-ejemplo')?.click()); await p.waitForTimeout(800);

const g = await p.evaluate(() => window.qa.proyecto().gabinete);
const can = g.canaletas.find((c) => c.orientacion === 'h');
const col = g.colocaciones[0];
const cable = await p.evaluate(() => window.qa.proyecto().conductores[0].id);
const ruta0 = await qa('rutaDe', cable);
const medio = ruta0[Math.floor(ruta0.length / 2)];
const idx = await qa('crearPuntoCable', cable, medio.x, medio.y);

const sitios = [
	['sitio despejado', { x: Math.round(g.ancho * 0.5), y: Math.round(g.alto * 0.62), z: 60 }],
	['encima de un aparato', { x: Math.round(col.x + col.ancho / 2), y: Math.round(col.y + col.alto / 2), z: 70 }],
	['justo al lado de la canaleta', { x: Math.round(can.x + can.largo * 0.4), y: Math.round(can.y - can.ancho / 2 - 14), z: 60 }],
	['dentro de la canaleta', { x: Math.round(can.x + can.largo * 0.4), y: Math.round(can.y), z: Math.round(can.alto * 0.5) }],
	['profundidad rara (z=15)', { x: Math.round(g.ancho * 0.35), y: Math.round(g.alto * 0.7), z: 15 }],
];

console.log('caso                             pedido            guardado          dibujado          desvío');
let peor = 0;
for (const [nombre, q] of sitios) {
	await qa('moverPuntoCable', cable, idx, q.x, q.y, q.z);
	const wp = (await qa('trazadoDe', cable))[idx];
	const ruta = await qa('rutaDe', cable);
	// El punto del recorrido dibujado más cercano en XY al que se pidió.
	let mejor, md = Infinity;
	for (const r of ruta) {
		const d = Math.hypot(r.x - q.x, r.y - q.y);
		if (d < md) { md = d; mejor = r; }
	}
	const dGuardado = Math.hypot((wp?.x ?? 0) - q.x, (wp?.y ?? 0) - q.y, (wp?.z ?? 0) - q.z);
	const dDibujado = Math.hypot(mejor.x - q.x, mejor.y - q.y, mejor.z - q.z);
	peor = Math.max(peor, dDibujado);
	const f = (o) => `${String(o.x).padStart(3)},${String(o.y).padStart(3)},${String(o.z ?? '—').padStart(3)}`;
	console.log(`${nombre.padEnd(32)} ${f(q)}   ${f(wp ?? {})}   ${f(mejor)}   guardado ${dGuardado.toFixed(1)} · dibujado ${dDibujado.toFixed(1)} mm`);
}
console.log(`\npeor desvío entre lo pedido y lo dibujado: ${peor.toFixed(1)} mm`);
console.log(er.length ? `ERRORES: ${er.slice(0, 2).join(' | ')}` : 'sin errores de JavaScript');
await b.close(); sv.close();
