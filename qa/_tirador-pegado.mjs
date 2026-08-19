/**
 * «LOS PUNTOS APARECEN ALEJADOS DEL CABLE, SOBRE TODO SEGÚN EL ÁNGULO DE LA CÁMARA».
 *
 * La queja tiene una forma muy concreta y por eso se puede medir: si el tirador se dibuja a una
 * profundidad distinta de la del cable, de frente coinciden —la perspectiva no delata la
 * diferencia— y en cuanto la cámara se mueve de sitio se separan. Así que se mide la distancia en
 * PÍXELES entre cada tirador y el recorrido dibujado de su cable, desde seis cámaras distintas.
 *
 * Un tirador pegado da la misma distancia pequeña desde todas. Uno a profundidad fija da cero de
 * frente y decenas de píxeles de lado, que es justo lo que se veía.
 */
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
await p.locator('.tarjeta-ejemplo button').nth(2).click({ timeout: 120_000 }); await p.waitForTimeout(2000);
for (const [m, bt] of [['#modal-dialogo', 'dialogo-ok'], ['#modal-explicacion', 'btn-cerrar-explicacion']]) { if (await p.isVisible(m)) { await p.evaluate((i) => document.getElementById(i)?.click(), bt); await p.waitForTimeout(700); } }
await p.evaluate(() => document.getElementById('modo-trabajo')?.click()); await p.waitForTimeout(500);
await p.evaluate(() => document.getElementById('btn-copiar-ejemplo')?.click()); await p.waitForTimeout(800);

const g = await p.evaluate(() => window.qa.proyecto().gabinete);
const cable = await p.evaluate(() => window.qa.proyecto().conductores[0].id);
const can = g.canaletas.find((c) => c.orientacion === 'h');

// Tres puntos a mano en sitios distintos: uno al aire, uno dentro de la canaleta y uno hundido.
const ruta0 = await qa('rutaDe', cable);
const i0 = await qa('crearPuntoCable', cable, ruta0[Math.floor(ruta0.length * 0.35)].x, ruta0[Math.floor(ruta0.length * 0.35)].y);
await qa('moverPuntoCable', cable, i0, Math.round(g.ancho * 0.45), Math.round(g.alto * 0.55), 78);
const ruta1 = await qa('rutaDe', cable);
const i1 = await qa('crearPuntoCable', cable, ruta1[Math.floor(ruta1.length * 0.7)].x, ruta1[Math.floor(ruta1.length * 0.7)].y);
await qa('moverPuntoCable', cable, i1, Math.round(can.x + can.largo * 0.5), Math.round(can.y), Math.round(can.alto * 0.5));
console.log('peinado:', JSON.stringify(await qa('trazadoDe', cable)), '\n');

const camaras = [
	['de frente', { x: 0, y: 0, z: 1500 }],
	['tres cuartos', { x: -900, y: 300, z: 1100 }],
	['lateral izquierdo', { x: -1500, y: 0, z: 260 }],
	['lateral derecho', { x: 1500, y: 0, z: 260 }],
	['cenital', { x: 0, y: 1400, z: 300 }],
	['muy de lado y cerca', { x: -700, y: 120, z: 150 }],
];
console.log('cámara                   antes (z fija 55)     ahora (sobre el recorrido)');
let peor = 0;
let peorAntes = 0;
for (const [nombre, cam] of camaras) {
	await qa('verDesde', cam);
	await p.waitForTimeout(250);
	const d = await qa('distanciaTiradores', cable);
	const max = Math.max(...d.map((x) => x.pixeles));
	const maxAntes = Math.max(...d.map((x) => x.antes ?? 0));
	peor = Math.max(peor, max);
	peorAntes = Math.max(peorAntes, maxAntes);
	console.log(`${nombre.padEnd(24)} ${maxAntes.toFixed(1).padStart(10)} px ${max.toFixed(1).padStart(16)} px`);
	await p.screenshot({ path: join(SALIDA, `tirador-${nombre.replace(/ /g, '-')}.png`) });
}
console.log(`\npeor separación tirador↔cable: antes ${peorAntes.toFixed(1)} px · ahora ${peor.toFixed(1)} px`);
console.log(er.length ? `ERRORES: ${er.slice(0, 2).join(' | ')}` : 'sin errores de JavaScript');
await b.close(); sv.close();
