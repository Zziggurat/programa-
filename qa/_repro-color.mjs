/**
 * REPRODUCIR EL BUG DEL COLOR DEL PILOTO, usando la interfaz como la usa Diego.
 *
 * Se añade un piloto desde el panel del Frontal, se abre su ficha y se mira QUÉ CONTROLES hay para
 * cambiarle el color. Después se toca el que parece serlo y se lee el color que de verdad tiene la
 * lente en la escena. Si el control existe y la lente no cambia, el fallo no es el valor por
 * defecto: es que el camino de la interfaz al material está roto.
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
await p.locator('.tarjeta-ejemplo button').nth(2).click({ timeout: 120_000 }); await p.waitForTimeout(2200);
for (const [m, bt] of [['#modal-dialogo', 'dialogo-ok'], ['#modal-explicacion', 'btn-cerrar-explicacion']]) { if (await p.isVisible(m)) { await p.evaluate((i) => document.getElementById(i)?.click(), bt); await p.waitForTimeout(700); } }
await p.evaluate(() => document.getElementById('btn-copiar-ejemplo')?.click()); await p.waitForTimeout(900);
await p.evaluate(() => document.getElementById('esp-frontal')?.click()); await p.waitForTimeout(1300);

console.log('=== 1. añado un piloto desde el panel del Frontal ===');
await p.evaluate(() => document.getElementById('btn-add-piloto')?.click()); await p.waitForTimeout(800);
const nuevo = (await qa('componentesDePuerta')).slice(-1)[0];
console.log(`  el piloto nuevo es ${nuevo.id} y su lente sale ${nuevo.color}`);

console.log('\n=== 2. ¿qué controles ofrece su ficha? ===');
const campos = await p.evaluate(() => [...document.querySelectorAll('#panel-der input, #panel-der select, #panel-der textarea')]
	.map((e) => `${e.tagName.toLowerCase()}#${e.id || '(sin id)'}${e.type ? `[${e.type}]` : ''}`));
console.log('  ' + (campos.length ? campos.join('\n  ') : 'la ficha no ofrece NINGÚN campo'));
const hayColorSenal = campos.some((c) => /senal|piloto|lente/i.test(c));
console.log(`  ¿hay algún control de color de LENTE? ${hayColorSenal ? 'sí' : 'NO'}`);

console.log('\n=== 3. toco el control de color que la ficha SÍ ofrece ===');
const cambio = await p.evaluate(() => {
	const i = document.getElementById('dev-color');
	if (!i) return 'no existe #dev-color';
	i.value = '#d8332c';
	i.dispatchEvent(new Event('change', { bubbles: true }));
	return 'puesto a #d8332c';
});
console.log(`  ${cambio}`);
await p.waitForTimeout(900);
const tras = (await qa('componentesDePuerta')).find((c) => c.id === nuevo.id);
console.log(`  la lente de ${nuevo.id} ahora es ${tras?.color}`);
console.log(`  ¿ha cambiado la lente? ${tras?.color !== nuevo.color ? 'sí' : 'NO — el control no llega a la lente'}`);

console.log('\n=== 4. y en el modelo, ¿qué guardó? ===');
const d = await p.evaluate((id) => {
	const x = window.qa.proyecto().dispositivos.find((k) => k.id === id);
	return x && { colorSenal: x.colorSenal, colorCuerpo: x.colorCuerpo };
}, nuevo.id);
console.log('  ', JSON.stringify(d));
console.log(er.length ? `\nERRORES: ${er.slice(0, 2).join(' | ')}` : '\nsin errores de JavaScript');
await b.close(); sv.close();
