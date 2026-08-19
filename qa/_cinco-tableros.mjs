/**
 * LOS CINCO TABLEROS: sin errores de JavaScript, con el picking intacto y sin cables fundidos.
 *
 * Los estropicios que no esperas son los que se van sin que nadie los vea, así que después de tocar
 * geometría de cables, modelo de aparatos y arrastre conviene abrir los cinco y mirar.
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
let mal = 0;

for (let i = 0; i < 5; i++) {
	const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
	p.setDefaultTimeout(60_000);
	const er = []; p.on('pageerror', (e) => er.push(e.message));
	const qa = (fn, ...a) => p.evaluate(([f, ar]) => window.qa[f](...ar), [fn, a]);
	await p.goto(`http://127.0.0.1:${sv.address().port}/?qa=1&inicio=0`);
	await p.waitForFunction(() => !!window.qa?.proyecto, null, { timeout: 60_000 });
	await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click()); await p.waitForTimeout(400);
	await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click()); await p.waitForTimeout(600);
	if (await p.isVisible('#modal-dialogo')) { await p.evaluate(() => document.getElementById('dialogo-ok')?.click()); await p.waitForTimeout(500); await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click()); await p.waitForTimeout(600); }
	const tarjetas = await p.locator('.tarjeta-ejemplo button').count();
	if (i >= tarjetas) { await p.close(); continue; }
	await p.locator('.tarjeta-ejemplo button').nth(i).click({ timeout: 120_000 }); await p.waitForTimeout(2000);
	for (const [m, bt] of [['#modal-dialogo', 'dialogo-ok'], ['#modal-explicacion', 'btn-cerrar-explicacion']]) { if (await p.isVisible(m)) { await p.evaluate((x) => document.getElementById(x)?.click(), bt); await p.waitForTimeout(700); } }
	await p.evaluate(() => document.getElementById('modo-trabajo')?.click()); await p.waitForTimeout(600);

	const nombre = await p.evaluate(() => window.qa.proyecto().nombre);
	const disp = await p.evaluate(() => window.qa.proyecto().dispositivos.map((d) => d.id));
	const cables = await p.evaluate(() => window.qa.proyecto().conductores.map((c) => c.id));
	await qa('elegir', disp[0]); await p.waitForTimeout(300);
	const sel = await qa('seleccion');
	// Se pregunta por puntos VISIBLES: que un punto tapado devuelva otra cosa no es fallo de picking.
	let aciertos = 0, probados = 0;
	for (const id of cables.slice(0, 8)) {
		const puntos = await qa('puntosVisiblesDeCable', id, 12);
		if (!puntos.length) continue;
		probados++;
		if ((await qa('cableEnPixel', puntos[0].x, puntos[0].y)) === id) aciertos++;
	}
	await qa('elegir', undefined);
	await p.evaluate(() => document.getElementById('btn-energizar')?.click());
	await p.waitForTimeout(2200);
	const sim = await qa('simulacion');
	const emision = await qa('emisionCables');
	const vivos = emision.filter((e) => e.intensidad > 0);
	const impostores = vivos.filter((e) => e.emissive === 'ffc83d' || e.emissive === '000000');
	const ok = er.length === 0 && sel?.id === disp[0] && aciertos === probados && !impostores.length;
	if (!ok) mal++;
	console.log(`${ok ? 'OK ' : 'MAL'} ejemplo ${i} «${nombre}»: ${disp.length} aparatos, ${cables.length} cables · picking ${aciertos}/${probados} · vivos ${vivos.length}/${emision.length} · conductoresVivos ${sim.conductoresVivos}`
		+ (er.length ? ` · ERRORES: ${er.slice(0, 2).join(' | ')}` : '') + (impostores.length ? ` · EMISIVO AJENO en ${impostores.length}` : ''));
	await p.close();
}
console.log(mal === 0 ? '\nlos cinco tableros, bien' : `\n${mal} tablero(s) con problemas`);
await b.close(); sv.close();
process.exit(mal === 0 ? 0 : 1);
