/**
 * TODAS LAS CARAS COPLANARES DEL TABLERO, de una vez y sin renderizar.
 *
 * Bisecar aparato por aparato encuentra una culpable cada vez y cuesta veinte minutos por aparato.
 * Esto recorre los cinco tableros y saca la lista entera: cada par de superficies que se solapan y
 * cuyas caras frontales están a menos de un pelo. Todas son z-fighting en potencia.
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
let total = 0;
for (let ej = 0; ej < 5; ej++) {
	const p = await b.newPage({ viewport: { width: 900, height: 650 } });
	p.setDefaultTimeout(60_000);
	const qa = (fn, ...a) => p.evaluate(([f, ar]) => window.qa[f](...ar), [fn, a]);
	await p.goto(`http://127.0.0.1:${sv.address().port}/?qa=1&inicio=0`);
	await p.waitForFunction(() => !!window.qa?.proyecto, null, { timeout: 60_000 });
	await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click()); await p.waitForTimeout(300);
	await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click()); await p.waitForTimeout(500);
	if (await p.isVisible('#modal-dialogo')) { await p.evaluate(() => document.getElementById('dialogo-ok')?.click()); await p.waitForTimeout(400); await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click()); await p.waitForTimeout(500); }
	const n = await p.locator('.tarjeta-ejemplo button').count();
	if (ej >= n) { await p.close(); continue; }
	await p.locator('.tarjeta-ejemplo button').nth(ej).click({ timeout: 120_000 }); await p.waitForTimeout(1800);
	for (const [m, bt] of [['#modal-dialogo', 'dialogo-ok'], ['#modal-explicacion', 'btn-cerrar-explicacion']]) { if (await p.isVisible(m)) { await p.evaluate((i) => document.getElementById(i)?.click(), bt); await p.waitForTimeout(600); } }
	const nombre = await p.evaluate(() => window.qa.proyecto().nombre);
	const disp = await p.evaluate(() => window.qa.proyecto().dispositivos.map((d) => ({ id: d.id, tipo: d.tipo })));
	console.log(`\n=== ${nombre} ===`);
	const porTipo = new Map();
	for (const d of disp) {
		const pares = await qa('coplanares', d.id, 0.25);
		if (!pares.length) continue;
		total += pares.length;
		if (porTipo.has(d.tipo)) continue;   // el mismo modelo repetido da la misma lista
		porTipo.set(d.tipo, true);
		console.log(`  ${d.id} (${d.tipo}): ${pares.length} par(es)`);
		for (const q of pares.slice(0, 4)) console.log(`      mallas ${q.a}+${q.b} · separación ${q.separacion} mm · solape ${q.solape} mm² · ${q.colores}`);
	}
	if (!porTipo.size) console.log('  ninguna cara coplanar');
	await p.close();
}
console.log(`\ntotal de pares coplanares en los cinco tableros: ${total}`);
await b.close(); sv.close();
