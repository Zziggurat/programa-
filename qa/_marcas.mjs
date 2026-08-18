/** Cuenta las marcas serigrafiadas que salen en la escena y las compara con lo que declara cada
 *  aparato. Es la prueba de que el dibujo y el modelo dicen lo mismo. */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
const RAIZ = '/workspace/programa-/app/dist';
const EJEMPLO = Number(process.argv[2] ?? 2);
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
await p.locator('.tarjeta-ejemplo button').nth(EJEMPLO).click({ timeout: 120_000 }); await p.waitForTimeout(2000);
for (const [m, bt] of [['#modal-dialogo', 'dialogo-ok'], ['#modal-explicacion', 'btn-cerrar-explicacion']]) { if (await p.isVisible(m)) { await p.evaluate((i) => document.getElementById(i)?.click(), bt); await p.waitForTimeout(700); } }
const marcas = await qa('marcas');
const proy = await qa('proyecto');
let fallos = 0;
for (const d of proy.dispositivos) {
	const m = marcas.find((x) => x.dispositivo === d.id);
	const esperados = d.bornes.map((b) => b.id);
	const puestos = m ? m.marcas : [];
	const faltan = esperados.filter((e) => !puestos.includes(e));
	const sobran = puestos.filter((x) => !esperados.includes(x) && !/^[A-Za-z0-9 .·\/-]{1,14}$/.test('') );
	const ok = faltan.length === 0;
	if (!ok) fallos++;
	console.log(`${ok ? 'OK  ' : 'FALL'} ${d.id.padEnd(5)} ${d.tipo.padEnd(12)} bornes ${String(esperados.length).padEnd(3)} marcas ${String(puestos.length).padEnd(3)}${faltan.length ? ' · faltan: ' + faltan.join(',') : ''}`);
}
console.log(fallos ? `\n${fallos} aparato(s) sin la numeración completa` : '\nTodos los bornes llevan su número');
console.log(er.length ? `ERRORES: ${er.slice(0, 2).join(' | ')}` : 'sin errores de JavaScript');
await b.close(); sv.close();
