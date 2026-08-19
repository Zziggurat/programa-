/** Dónde están los píxeles que aún parpadean, y qué hay en ellos. */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
const RAIZ = '/workspace/programa-/app/dist';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const sv = http.createServer((q, r) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u === '/') u = '/index.html'; const f = join(RAIZ, u); if (!existsSync(f)) { r.statusCode = 404; r.end(''); return; } r.setHeader('Content-Type', MIME[extname(f)] ?? 'application/octet-stream'); r.end(readFileSync(f)); });
await new Promise((r) => sv.listen(0, r));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1100, height: 760 } });
p.setDefaultTimeout(60_000);
const qa = (fn, ...a) => p.evaluate(([f, ar]) => window.qa[f](...ar), [fn, a]);
await p.goto(`http://127.0.0.1:${sv.address().port}/?qa=1&inicio=0`);
await p.waitForFunction(() => !!window.qa?.proyecto, null, { timeout: 60_000 });
await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click()); await p.waitForTimeout(400);
await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click()); await p.waitForTimeout(600);
if (await p.isVisible('#modal-dialogo')) { await p.evaluate(() => document.getElementById('dialogo-ok')?.click()); await p.waitForTimeout(500); await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click()); await p.waitForTimeout(600); }
await p.locator('.tarjeta-ejemplo button').nth(2).click({ timeout: 120_000 }); await p.waitForTimeout(2000);
for (const [m, bt] of [['#modal-dialogo', 'dialogo-ok'], ['#modal-explicacion', 'btn-cerrar-explicacion']]) { if (await p.isVisible(m)) { await p.evaluate((i) => document.getElementById(i)?.click(), bt); await p.waitForTimeout(700); } }
await p.evaluate(() => document.getElementById('modo-trabajo')?.click()); await p.waitForTimeout(600);
const c = await qa('bulto', 'q1');
const radio = Math.max(90, c.radio * 3.2);
const cams = Array.from({ length: 6 }, (_, i) => {
	const g = 0.34 + i * 0.0004, a = 0.20 + i * 0.00016;
	return { x: c.x + Math.sin(g) * radio, y: c.y + Math.sin(a) * radio, z: c.z + Math.cos(g) * Math.cos(a) * radio, tx: c.x, ty: c.y, tz: c.z };
});
const r = await qa('medirMoteado', cams);
console.log(`resto: ${r.porMillon} por millón · ${r.donde.length} focos muestreados`);
// El lienzo ocupa toda la ventana, así que las coordenadas del framebuffer son las de pantalla.
for (const d of r.donde.slice(0, 14)) {
	const q = await qa('diagnosticoPixel', d.x, d.y).catch(() => 'sin dato');
	console.log(`  (${String(d.x).padStart(4)},${String(d.y).padStart(4)}) → ${JSON.stringify(q)}`);
}
await b.close(); sv.close();
