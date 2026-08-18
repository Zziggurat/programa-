/**
 * LOS CUATRO ESTADOS EN EL MISMO ENCUADRE: normal, hover, seleccionado y energizado.
 *
 * Puestos uno al lado de otro se ve en un segundo si la jerarquía funciona. Separados, cada uno
 * parece razonable y aun así pueden confundirse entre sí, que es el fallo que hay que cazar.
 *
 *   node qa/_estados.mjs <carpeta> [indice-del-ejemplo]
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const RAIZ = '/workspace/programa-/app/dist';
const SALIDA = process.argv[2] ?? '/tmp/estados';
const EJEMPLO = Number(process.argv[3] ?? 2);
mkdirSync(SALIDA, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const sv = http.createServer((q, r) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u === '/') u = '/index.html'; const f = join(RAIZ, u); if (!existsSync(f)) { r.statusCode = 404; r.end(''); return; } r.setHeader('Content-Type', MIME[extname(f)] ?? 'application/octet-stream'); r.end(readFileSync(f)); });
await new Promise((r) => sv.listen(0, r));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
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
await p.evaluate(() => document.getElementById('modo-trabajo')?.click()); await p.waitForTimeout(600);

const ids = await p.evaluate(() => window.qa.proyecto().dispositivos.map((d) => ({ id: d.id, tipo: d.tipo })));
const km = ids.find((d) => d.tipo === 'contactor')?.id ?? ids[0].id;
const general = async (giro, alto, dist = 1.25) => {
	let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z = 0;
	for (const { id } of ids) {
		const c = await qa('bulto', id);
		if (!c) continue;
		x0 = Math.min(x0, c.x - c.radio); x1 = Math.max(x1, c.x + c.radio);
		y0 = Math.min(y0, c.y - c.radio); y1 = Math.max(y1, c.y + c.radio);
		z = Math.max(z, c.z);
	}
	const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, r = Math.max(x1 - x0, y1 - y0) * dist;
	await qa('verDesde', { x: cx + Math.sin(giro) * r, y: cy + Math.sin(alto) * r, z: z + Math.cos(giro) * Math.cos(alto) * r, tx: cx, ty: cy, tz: z });
	await p.waitForTimeout(500);
};
// Encuadre medio sobre el contactor: se ve el aparato entero y sus vecinos, que es donde tiene
// que notarse cuál está marcado y cuál no.
const medio = async () => {
	const c = await qa('bulto', km);
	const r = Math.max(30, c.radio) * 2.4 * 3.2;
	await qa('verDesde', { x: c.x + Math.sin(0.4) * r, y: c.y + Math.sin(0.25) * r, z: c.z + Math.cos(0.4) * Math.cos(0.25) * r, tx: c.x, ty: c.y, tz: c.z });
	await p.waitForTimeout(500);
};

await medio();
await p.screenshot({ path: join(SALIDA, '1-normal.png') });

// HOVER sobre un CABLE, que es lo único que hoy responde al puntero sin pulsar.
const cables = await p.evaluate(() => window.qa.proyecto().conductores.map((c) => c.id));
const sobre = await qa('puntoSobreCable', cables[0]);
if (sobre) { await p.mouse.move(sobre.x, sobre.y); await p.waitForTimeout(800); await p.screenshot({ path: join(SALIDA, '2-hover-cable.png') }); }
else console.log('(no se pudo situar el puntero sobre un cable)');

// SELECCIONADO.
await qa('elegir', km); await p.waitForTimeout(600);
await p.screenshot({ path: join(SALIDA, '3-seleccionado.png') });

// ENERGIZADO, ya sin selección, para que no se mezclen las dos señales.
await qa('elegir', undefined); await p.waitForTimeout(300);
await p.evaluate(() => document.getElementById('btn-energizar')?.click());
await p.waitForTimeout(2500);
await p.screenshot({ path: join(SALIDA, '4-energizado.png') });
await general(0.5, 0.3);
await p.screenshot({ path: join(SALIDA, '5-energizado-general.png') });
// COMBINADOS: ningún estado puede borrar la información de otro.
await medio();
await qa('hoverDispositivo', km); await p.waitForTimeout(600);
await p.screenshot({ path: join(SALIDA, '6-hover-mas-energizado.png') });
await qa('hoverDispositivo', undefined);
await qa('elegir', km); await p.waitForTimeout(600);
await p.screenshot({ path: join(SALIDA, '7-seleccionado-mas-energizado.png') });
console.log('tensiones vivas:', JSON.stringify(await qa('tensionesVivas').catch(() => 'sin sonda')));

console.log(er.length ? `ERRORES: ${er.slice(0, 2).join(' | ')}` : 'sin errores de JavaScript');
await b.close(); sv.close();
