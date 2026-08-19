/**
 * BISECCIÓN: qué parte del aparato parpadea.
 *
 * Tres hipótesis descartadas con números (sombras, serigrafía, mapa de rugosidad), así que toca
 * buscarlo por eliminación en vez de por corazonada. Se esconde la mitad de las mallas, se mide, y
 * se sigue por la mitad que se lleva el parpadeo consigo.
 *
 * Antes de nada se COMPRUEBA QUE LAS PALANCAS FUNCIONAN: si esconder el aparato entero no baja el
 * contador, es que el contador no está midiendo el aparato y todo lo que venga después es ruido.
 * En la pasada anterior tres configuraciones dieron el mismo número hasta el dígito, que es
 * justamente lo que pasa cuando la sonda no toca nada.
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const RAIZ = '/workspace/programa-/app/dist';
const APARATO = process.argv[2] ?? 'f2';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const sv = http.createServer((q, r) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u === '/') u = '/index.html'; const f = join(RAIZ, u); if (!existsSync(f)) { r.statusCode = 404; r.end(''); return; } r.setHeader('Content-Type', MIME[extname(f)] ?? 'application/octet-stream'); r.end(readFileSync(f)); });
await new Promise((r) => sv.listen(0, r));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1100, height: 760 } });
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
await p.evaluate(() => document.getElementById('modo-trabajo')?.click()); await p.waitForTimeout(600);

const c = await qa('bulto', APARATO);
const radio = Math.max(90, c.radio * 3.2);
const cams = Array.from({ length: 6 }, (_, i) => {
	const g = 0.34 + i * 0.0004, a = 0.20 + i * 0.00016;
	return { x: c.x + Math.sin(g) * radio, y: c.y + Math.sin(a) * radio, z: c.z + Math.cos(g) * Math.cos(a) * radio, tx: c.x, ty: c.y, tz: c.z };
});
const medir = async () => (await qa('medirMoteado', cams)).porMillon;
const ver = async (desde, hasta, visible) => {
	for (let i = desde; i < hasta; i++) await qa('verMalla', APARATO, i, visible);
};

const mallas = await qa('mallasDe', APARATO);
const base = await medir();
console.log(`${APARATO}: ${mallas.length} mallas · moteado ${base} por millón`);

// --- Comprobar que la palanca hace algo, antes de fiarse de nada ---
await ver(0, mallas.length, false);
const sinNada = await medir();
await ver(0, mallas.length, true);
const otraVez = await medir();
console.log(`control: con el aparato entero escondido ${sinNada} · al devolverlo ${otraVez}`);
if (sinNada >= base * 0.5) {
	console.log('\nLA PALANCA NO MANDA: esconder el aparato no se lleva el parpadeo.');
	console.log('O sea que el moteado NO está en las mallas del aparato, sino en lo que hay detrás.');
	await b.close(); sv.close();
	process.exit(0);
}

// --- Bisección ---
let lo = 0, hi = mallas.length;
while (hi - lo > 1) {
	const medio = Math.floor((lo + hi) / 2);
	await ver(lo, medio, false);
	const sinPrimera = await medir();
	await ver(lo, medio, true);
	console.log(`  escondiendo [${lo},${medio}) → ${sinPrimera} (de ${base})`);
	if (sinPrimera < base * 0.5) hi = medio; else lo = medio;
}
console.log(`\nla culpable es la malla ${lo}: ${JSON.stringify(mallas[lo])}`);
console.log(er.length ? `ERRORES: ${er.slice(0, 2).join(' | ')}` : 'sin errores de JavaScript');
await b.close(); sv.close();
