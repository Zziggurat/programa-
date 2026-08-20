/**
 * LOS DIEZ CASOS DE LA VALIDACIÓN, ejecutados de verdad en el navegador.
 *
 * Lo que se mira NO es una variable de estado: es lo que la escena está dibujando —la intensidad
 * de emisión de cada lente y la opacidad de su halo—. Si el piloto luciera por decreto y no por
 * el circuito, aquí no se notaría la diferencia; por eso el estado se cambia cortando un HILO,
 * que es lo que pasa en un tablero cuando se pierde una fase.
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
const foto = (n) => p.screenshot({ path: join(SALIDA, `piloto-${n}.png`) });

await p.goto(`http://127.0.0.1:${sv.address().port}/?qa=1&inicio=0`);
await p.waitForFunction(() => !!window.qa?.proyecto, null, { timeout: 60_000 });
await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click()); await p.waitForTimeout(400);
await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click()); await p.waitForTimeout(600);
if (await p.isVisible('#modal-dialogo')) { await p.evaluate(() => document.getElementById('dialogo-ok')?.click()); await p.waitForTimeout(500); await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click()); await p.waitForTimeout(600); }
await p.locator('.tarjeta-ejemplo button').nth(2).click({ timeout: 120_000 }); await p.waitForTimeout(2200);
for (const [m, bt] of [['#modal-dialogo', 'dialogo-ok'], ['#modal-explicacion', 'btn-cerrar-explicacion']]) { if (await p.isVisible(m)) { await p.evaluate((i) => document.getElementById(i)?.click(), bt); await p.waitForTimeout(700); } }
await p.evaluate(() => document.getElementById('modo-trabajo')?.click()); await p.waitForTimeout(600);
await p.evaluate(() => document.getElementById('btn-copiar-ejemplo')?.click()); await p.waitForTimeout(900);

const cerrar = async (quiero) => {
	await p.evaluate((q) => {
		const btn = document.getElementById('btn-puerta');
		const abierta = btn.textContent.startsWith('Cerrar');
		if (abierta === q) btn.click();
	}, quiero);
	await p.waitForTimeout(750);
};
const energizar = async (quiero) => {
	await p.evaluate((q) => {
		const btn = document.getElementById('btn-energizar');
		if (btn.classList.contains('activo') !== q) btn.click();
	}, quiero);
	await p.waitForTimeout(900);
};
const linea = (t) => `${t.id}: ${t.encendido ? 'ENCENDIDO' : 'apagado '} · emisión ${t.emision} · halo ${t.halo} · lente ${t.color}`;

console.log('=== 1. tres pilotos R/S/T montados en la puerta ===');
for (const t of await qa('componentesDePuerta')) console.log('  ' + linea(t));

console.log('\n=== 2. los tres apagados (tablero sin energizar) ===');
await energizar(false);
await cerrar(true);
for (const t of await qa('componentesDePuerta')) console.log('  ' + linea(t));
await foto('2-apagados-cerrada');

console.log('\n=== 3. los tres encendidos ===');
await energizar(true);
for (const t of await qa('componentesDePuerta')) console.log('  ' + linea(t));
await foto('3-encendidos-cerrada');

console.log('\n=== 5/7. puerta cerrada, vista frontal y lateral ===');
await qa('verDesde', { x: 0, y: 0, z: 900 }); await p.waitForTimeout(300); await foto('5-cerrada-frente');
await qa('verDesde', { x: -1500, y: 120, z: 620 }); await p.waitForTimeout(300); await foto('7-cerrada-lateral');

console.log('\n=== 4. se pierde la fase S: R encendido, S apagado, T encendido ===');
const hilo = await qa('conductorHacia', 'hs', 'X1');
console.log(`  se corta el conductor ${hilo} (el que lleva la fase S a su piloto)`);
await qa('quitarConductor', hilo);
await p.waitForTimeout(900);
for (const t of await qa('componentesDePuerta')) console.log('  ' + linea(t));
await qa('verDesde', { x: 0, y: 0, z: 900 }); await p.waitForTimeout(300); await foto('4-falta-S');

console.log('\n=== 6. puerta abierta: cuerpo y terminales por dentro ===');
await cerrar(false);
await qa('verDesde', { x: -1050, y: 300, z: 1000 }); await p.waitForTimeout(400); await foto('6-abierta-tres-cuartos');
const tras = await qa('componentesDePuerta');
// La CARA INTERIOR de la puerta: se mira desde dentro del armario hacia la hoja abierta, que es
// desde donde se cablea. El punto al que se mira sale de dónde han quedado los pilotos.
const medio = tras[1].mundo;
await qa('verDesde', { x: medio.x + 620, y: medio.y + 40, z: medio.z + 240, tx: medio.x, ty: medio.y, tz: medio.z });
await p.waitForTimeout(400); await foto('6-abierta-detras');
await qa('verDesde', { x: medio.x + 260, y: medio.y + 20, z: medio.z + 110, tx: medio.x, ty: medio.y, tz: medio.z });
await p.waitForTimeout(400); await foto('6-terminales-cerca');
console.log('  posición en el mundo con la puerta ABIERTA:');
for (const t of tras) console.log(`    ${t.id}: (${t.mundo.x}, ${t.mundo.y}, ${t.mundo.z})`);

console.log('\n=== extra. ¿se pueden señalar con comodidad? ===');
await cerrar(true);
for (const [nombre, cam] of [['de cerca', { x: 0, y: 0, z: 900 }], ['de lejos', { x: 0, y: 0, z: 3200 }], ['de lado', { x: -1400, y: 100, z: 700 }]]) {
	await qa('verDesde', cam); await p.waitForTimeout(300);
	const filas = [];
	for (const desvio of [0, 8, 14]) {
		const r = await qa('senalar', 'hs', desvio);
		filas.push(`${desvio} px → ${r?.fuera ? 'fuera de pantalla' : r?.hallado}`);
	}
	console.log(`  ${nombre.padEnd(9)} ${filas.join(' · ')}`);
}

console.log('\n=== 9. lo que cuesta un cambio de estado eléctrico ===');
// `cronometro(true)` pone los contadores a cero; lo que se cuenta después es lo que cuesta
// energizar y desenergizar seis veces, sin tocar el proyecto.
await qa('cronometro', true);
for (let i = 0; i < 6; i++) { await energizar(i % 2 === 1); }
const c = (await qa('cronometroLeer')).contadores;
await qa('cronometro', false);
console.log(`  seis cambios de energización · repartos del router ${c.repartos} · cables reconstruidos ${c.cablesConstruidos} · TubeGeometry ${c.tubos}`);

console.log('\n=== 10. moteado con el armario y los pilotos ===');
await energizar(true); await cerrar(true);
await p.waitForTimeout(600);
const cam = (i, paso) => { const a = 0.30 + i * paso, e = 0.16 + i * paso * 0.4; const r = 1100;
	return { x: Math.sin(a) * r, y: Math.sin(e) * r, z: Math.cos(a) * Math.cos(e) * r, tx: 0, ty: 0, tz: 0 }; };
const quieta = (await qa('medirMoteado', Array.from({ length: 4 }, () => cam(0, 0)))).porMillon;
const moviendo = (await qa('medirMoteado', Array.from({ length: 6 }, (_, i) => cam(i, 0.0004)))).porMillon;
console.log(`  cámara quieta ${quieta} (tiene que ser 0) · moviéndose ${moviendo} por millón`);

console.log('\n=== 8. guardar y volver a cargar ===');
const json = await p.evaluate(() => JSON.stringify(window.qa.proyecto()));
console.log(`  el proyecto guardado ocupa ${(json.length / 1024).toFixed(0)} kB y trae ${(json.match(/"montaje":"puerta"/g) ?? []).length} montajes en puerta`);
console.log(er.length ? `\nERRORES: ${er.slice(0, 3).join(' | ')}` : '\nsin errores de JavaScript');
await b.close(); sv.close();
