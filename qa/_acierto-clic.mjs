/**
 * «ESTOY HACIENDO CLIC EXACTAMENTE SOBRE EL CABLE Y EL EDITOR NO LO ENCUENTRA.»
 *
 * Se apunta al EJE de cada conductor, en varios puntos de su recorrido, se redondea a píxeles
 * enteros —que es lo que entrega un ratón— y se pregunta qué encuentra el editor ahí. Un acierto
 * es que encuentre ESE cable; encontrar otro o no encontrar ninguno son las dos formas del fallo.
 *
 * En la misma pasada se le pregunta lo mismo al método anterior (el tubo de agarre invisible de
 * radio fijo en milímetros), para que la comparación sea entre dos reglas mirando el mismo píxel
 * de la misma cámara y no entre dos sesiones distintas.
 *
 * Las cámaras están elegidas para cubrir las quejas: lejos, de canto, y desde detrás de la placa.
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
await p.locator('.tarjeta-ejemplo button').nth(2).click({ timeout: 120_000 }); await p.waitForTimeout(2000);
for (const [m, bt] of [['#modal-dialogo', 'dialogo-ok'], ['#modal-explicacion', 'btn-cerrar-explicacion']]) { if (await p.isVisible(m)) { await p.evaluate((i) => document.getElementById(i)?.click(), bt); await p.waitForTimeout(700); } }
await p.evaluate(() => document.getElementById('modo-trabajo')?.click()); await p.waitForTimeout(600);

const ids = await p.evaluate(() => window.qa.proyecto().conductores.map((c) => c.id));
const camaras = [
	['de frente, encuadre normal', { x: 0, y: 0, z: 1500 }],
	['de frente pero lejos', { x: 0, y: 0, z: 3400 }],
	['tres cuartos', { x: -900, y: 300, z: 1100 }],
	['lateral, la placa de canto', { x: -1700, y: 0, z: 200 }],
	['cenital', { x: 0, y: 1600, z: 260 }],
];
const FRACCIONES = [0.2, 0.35, 0.5, 0.65, 0.8];

console.log(`tablero con ${ids.length} conductores · ${FRACCIONES.length} puntos por cable\n`);
console.log('cámara                        casos   antes    ahora    tapado por otro   no encuentra nada');
let tAntes = 0, tAhora = 0, tCasos = 0, tTapado = 0, tNada = 0;
for (const [nombre, cam] of camaras) {
	await qa('verDesde', cam);
	await p.waitForTimeout(250);
	let casos = 0, antes = 0, ahora = 0, tapado = 0, nada = 0;
	for (const id of ids) {
		for (const f of FRACCIONES) {
			const r = await qa('aciertoDeClic', id, f);
			if (!r) continue;         // el punto cae fuera del lienzo: no es un caso de agarre
			casos++;
			if (r.acertabaAntes) antes++;
			if (r.acierta) ahora++;
			if (r.porque === 'tapado') tapado++;
			if (r.porque === 'ninguno') nada++;
		}
	}
	tCasos += casos; tAntes += antes; tAhora += ahora; tTapado += tapado; tNada += nada;
	const pc = (n) => `${((n / Math.max(1, casos)) * 100).toFixed(1)} %`;
	console.log(`${nombre.padEnd(30)} ${String(casos).padStart(5)}  ${pc(antes).padStart(7)}  ${pc(ahora).padStart(7)}  ${pc(tapado).padStart(15)}  ${pc(nada).padStart(17)}`);
}
console.log(`\nEN TOTAL: ${tCasos} clics sobre el eje de un cable`);
console.log(`  el método anterior encontraba el cable señalado en ${((tAntes / tCasos) * 100).toFixed(1)} % de los casos`);
console.log(`  el de ahora lo encuentra en ${((tAhora / tCasos) * 100).toFixed(1)} %`);
console.log(`  de los que no acierta: ${((tTapado / tCasos) * 100).toFixed(1)} % es otro cable que está DELANTE en ese píxel (correcto)`);
console.log(`  y solo en ${((tNada / tCasos) * 100).toFixed(1)} % no encuentra nada, que es el fallo del que se partía`);
console.log(`  suma: ${(((tAhora + tTapado + tNada) / tCasos) * 100).toFixed(1)} % (el resto es un cable que no estaba delante: eso sí sobra)`);
console.log(er.length ? `ERRORES: ${er.slice(0, 2).join(' | ')}` : 'sin errores de JavaScript');
await b.close(); sv.close();
