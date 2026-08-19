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

const codo = await qa('radioCodoDe', cable);

/*
 * TRES NÚMEROS, Y CADA UNO CONTESTA UNA PREGUNTA DISTINTA:
 *
 *   guardado      ¿el programa ha cambiado la coordenada que se le pidió? Si cambia sin que lo
 *                 diga la barra de estado, es una reescritura silenciosa: eso es el defecto.
 *   guardado(Alt) ¿y con las ayudas desactivadas? Aquí tiene que salir CERO siempre: sin ayudas
 *                 no hay nada que pueda mover un punto.
 *   dibujado      ¿por dónde pasa el cable de verdad? En una esquina nunca llega al vértice: lo
 *                 recorta el radio de curvatura, que para este cable es de ${codo} mm. Por debajo
 *                 de ese radio la diferencia es geometría, no desobediencia.
 */
console.log(`radio de curvatura de ${cable}: ${codo.toFixed(1)} mm\n`);
console.log('caso                             pedido            guardado          dibujado          desvío');
let peor = 0;
let peorGuardado = 0;
let peorSinAyudas = 0;
for (const [nombre, q] of sitios) {
	const r = await qa('moverPuntoCable', cable, idx, q.x, q.y, q.z);
	const wp = (await qa('trazadoDe', cable))[idx];
	const ruta = await qa('rutaDe', cable);
	let mejor, md = Infinity;
	for (const p of ruta) {
		const d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
		if (d < md) { md = d; mejor = p; }
	}
	// Y otra vez sin ayudas: con Alt no puede quedar ni un milímetro de diferencia.
	await qa('moverPuntoCable', cable, idx, q.x, q.y, q.z, false);
	const wpAlt = (await qa('trazadoDe', cable))[idx];
	const dGuardado = Math.hypot(wp.x - q.x, wp.y - q.y, (wp.z ?? 0) - q.z);
	const dAlt = Math.hypot(wpAlt.x - q.x, wpAlt.y - q.y, (wpAlt.z ?? 0) - q.z);
	const dDibujado = md;
	peor = Math.max(peor, dDibujado);
	peorGuardado = Math.max(peorGuardado, dGuardado);
	peorSinAyudas = Math.max(peorSinAyudas, dAlt);
	const ayuda = (r?.pista?.canaleta ? `encaje en canaleta ${r.pista.canaleta}` : (r?.pista?.alineado ? 'alineado con el vecino' : ''));
	const f = (o) => `${String(o.x).padStart(3)},${String(o.y).padStart(3)},${String(o.z ?? '—').padStart(3)}`;
	console.log(`${nombre.padEnd(32)} ${f(q)}   ${f(wp)}   ${f(mejor)}   guardado ${dGuardado.toFixed(1)} · Alt ${dAlt.toFixed(1)} · dibujado ${dDibujado.toFixed(1)} mm${ayuda ? `  ← ${ayuda}` : ''}`);
	// Se deja el punto donde lo dejó la pasada con ayudas, para no falsear el caso siguiente.
	await qa('moverPuntoCable', cable, idx, q.x, q.y, q.z);
}
console.log(`\npeor desvío de lo GUARDADO respecto a lo pedido: ${peorGuardado.toFixed(1)} mm (con ayudas, y anunciadas)`);
console.log(`peor desvío de lo GUARDADO con las ayudas desactivadas: ${peorSinAyudas.toFixed(1)} mm`);
console.log(`peor desvío de lo DIBUJADO respecto a lo pedido: ${peor.toFixed(1)} mm (radio de curvatura: ${codo.toFixed(1)} mm)`);
console.log(er.length ? `ERRORES: ${er.slice(0, 2).join(' | ')}` : 'sin errores de JavaScript');
await b.close(); sv.close();
