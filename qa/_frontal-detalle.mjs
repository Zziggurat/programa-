/** Detalles del frontal de cerca: contacto de los mandos con la chapa, marco, bisagra y cierre. */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
const RAIZ = '/workspace/programa-/app/dist';
const SALIDA = '/workspace/programa-/qa/capturas';
mkdirSync(SALIDA, { recursive: true });
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
await p.locator('.tarjeta-ejemplo button').nth(2).click({ timeout: 120_000 }); await p.waitForTimeout(2200);
for (const [m, bt] of [['#modal-dialogo', 'dialogo-ok'], ['#modal-explicacion', 'btn-cerrar-explicacion']]) { if (await p.isVisible(m)) { await p.evaluate((i) => document.getElementById(i)?.click(), bt); await p.waitForTimeout(700); } }
await p.evaluate(() => document.getElementById('btn-energizar')?.click()); await p.waitForTimeout(900);
await p.evaluate(() => document.getElementById('esp-frontal')?.click()); await p.waitForTimeout(1400);

const donde = await qa('puntoEnPantallaDeFrontal', 'aparato', 'hs');
const mundo = (await qa('componentesDePuerta')).find((c) => c.id === 'hs').mundo;
const tomas = [
	['pilotos', { x: mundo.x, y: mundo.y, z: mundo.z + 230, tx: mundo.x, ty: mundo.y, tz: mundo.z }],
	['pilotos-sesgado', { x: mundo.x + 160, y: mundo.y + 90, z: mundo.z + 190, tx: mundo.x, ty: mundo.y, tz: mundo.z }],
	['cierre', { x: 470, y: 0, z: 330, tx: 320, ty: 0, tz: 170 }],
	['bisagra', { x: -420, y: 180, z: 330, tx: -330, ty: 180, tz: 170 }],
	['esquina-marco', { x: -420, y: 400, z: 330, tx: -330, ty: 330, tz: 170 }],
	['aviso', { x: 0, y: -215, z: 300, tx: 0, ty: -215, tz: 170 }],
];
for (const [n, cam] of tomas) {
	await qa('verDesde', cam); await p.waitForTimeout(280);
	await p.screenshot({ path: join(SALIDA, `det-${n}.png`) });
}
console.log('pilotos en pantalla:', donde && `${Math.round(donde.x)},${Math.round(donde.y)}`);
console.log(er.length ? `ERRORES: ${er.slice(0, 2).join(' | ')}` : 'sin errores de JavaScript');
await b.close(); sv.close();
