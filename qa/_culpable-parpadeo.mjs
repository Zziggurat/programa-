/**
 * QUÉ MALLA ES LA QUE PARPADEA, apagándolas de una en una.
 *
 * El barrido anterior dejó claro de dónde NO viene el moteado: mover el sesgo del mapa de sombras
 * de 0,22 a 3,00 mm no lo cambia, y esconder todos los planos de serigrafía tampoco. Con la cámara
 * quieta el contador da cero, así que lo que mide es cambio de verdad. Queda la geometría.
 *
 * Aquí se apaga una malla del aparato, se vuelve a medir el MISMO recorrido de cámara y se compara.
 * La que al desaparecer se lleva el parpadeo consigo es la culpable.
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

const mallas = await qa('mallasDe', APARATO);
const base = (await qa('medirMoteado', cams)).porMillon;
console.log(`${APARATO}: ${mallas.length} mallas · moteado de partida ${base} por millón\n`);
const culpables = [];
for (const m of mallas) {
	await qa('verMalla', APARATO, m.i, false);
	const sin = (await qa('medirMoteado', cams)).porMillon;
	await qa('verMalla', APARATO, m.i, true);
	const baja = base - sin;
	if (baja > base * 0.15) culpables.push({ ...m, sin, baja });
	console.log(`  [${String(m.i).padStart(2)}] ${String(m.pieza).padEnd(14)} ${String(m.vertices).padStart(5)} vert · sin ella ${String(sin).padStart(6)} (${baja >= 0 ? '-' : '+'}${Math.abs(baja)})`);
}
console.log('\nlas que se llevan el parpadeo al desaparecer:');
for (const c2 of culpables.sort((a, b) => b.baja - a.baja)) console.log(`  [${c2.i}] ${c2.pieza}: ${base} → ${c2.sin}`);
if (!culpables.length) console.log('  ninguna sola: el parpadeo no está en una malla suelta');
console.log(er.length ? `ERRORES: ${er.slice(0, 2).join(' | ')}` : 'sin errores de JavaScript');
await b.close(); sv.close();
