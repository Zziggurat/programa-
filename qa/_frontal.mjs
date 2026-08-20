/**
 * EL FRONTAL, PROBADO COMO SE USA: entrando al espacio, cogiendo piezas con el ratón, moviéndolas
 * sobre la chapa, alineándolas y volviendo al interior a ver que no se ha roto nada.
 *
 * No se llama a las funciones por dentro: se despachan eventos de puntero de verdad sobre el
 * lienzo, que es lo único que demuestra que la interacción funciona y no solo la aritmética.
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
const foto = (n) => p.screenshot({ path: join(SALIDA, `frontal-${n}.png`) });
const clic = (id) => p.evaluate((i) => document.getElementById(i)?.click(), id);

await p.goto(`http://127.0.0.1:${sv.address().port}/?qa=1&inicio=0`);
await p.waitForFunction(() => !!window.qa?.proyecto, null, { timeout: 60_000 });
await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click()); await p.waitForTimeout(400);
await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click()); await p.waitForTimeout(600);
if (await p.isVisible('#modal-dialogo')) { await p.evaluate(() => document.getElementById('dialogo-ok')?.click()); await p.waitForTimeout(500); await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click()); await p.waitForTimeout(600); }
await p.locator('.tarjeta-ejemplo button').nth(2).click({ timeout: 120_000 }); await p.waitForTimeout(2200);
for (const [m, bt] of [['#modal-dialogo', 'dialogo-ok'], ['#modal-explicacion', 'btn-cerrar-explicacion']]) { if (await p.isVisible(m)) { await p.evaluate((i) => document.getElementById(i)?.click(), bt); await p.waitForTimeout(700); } }
await p.evaluate(() => document.getElementById('btn-copiar-ejemplo')?.click()); await p.waitForTimeout(900);

console.log('=== la cámara del interior antes de irnos ===');
const camInterior = await qa('camaraAhora');
console.log('  ', JSON.stringify(camInterior));

console.log('\n=== entrar en FRONTAL ===');
await clic('esp-frontal'); await p.waitForTimeout(1400);
await foto('1-frontal');
const piezas = await qa('piezasDelFrontal');
console.log(`  ${piezas.length} piezas montadas en la puerta:`);
for (const q of piezas) console.log(`    ${q.clase.padEnd(8)} ${String(q.id).padEnd(9)} en (${q.x}, ${q.y})  ${q.ancho}×${q.alto} mm`);

console.log('\n=== arrastrar el piloto S con el ratón, con las ayudas puestas ===');
const antes = piezas.find((q) => q.id === 'hs');
const desde = await qa('puntoEnPantallaDeFrontal', 'aparato', 'hs');
console.log(`  el piloto S está en (${antes.x}, ${antes.y}) y en pantalla en (${Math.round(desde.x)}, ${Math.round(desde.y)})`);
await p.mouse.move(desde.x, desde.y);
await p.mouse.down();
for (let i = 1; i <= 8; i++) { await p.mouse.move(desde.x + i * 5, desde.y + i * 4); await p.waitForTimeout(25); }
await p.waitForTimeout(150);
await foto('2-arrastrando-con-guias');
await p.mouse.up(); await p.waitForTimeout(300);
const tras = (await qa('piezasDelFrontal')).find((q) => q.id === 'hs');
console.log(`  soltado en (${tras.x}, ${tras.y})  ·  se movió: ${tras.x !== antes.x || tras.y !== antes.y}`);

console.log('\n=== las flechas colocan al milímetro ===');
await p.keyboard.press('ArrowRight'); await p.waitForTimeout(120);
const f1 = (await qa('piezasDelFrontal')).find((q) => q.id === 'hs');
await p.keyboard.down('Shift'); await p.keyboard.press('ArrowDown'); await p.keyboard.up('Shift'); await p.waitForTimeout(120);
const f2 = (await qa('piezasDelFrontal')).find((q) => q.id === 'hs');
console.log(`  → una flecha: ${tras.x} → ${f1.x} (un milímetro)`);
console.log(`  ↓ con Mayúsculas: ${f1.y} → ${f2.y} (diez milímetros)`);

console.log('\n=== alinear los tres pilotos y repartirlos ===');
await qa('marcarEnFrontal', [['aparato', 'hr'], ['aparato', 'hs'], ['aparato', 'ht']]);
await clic('btn-al-cy'); await p.waitForTimeout(250);
await clic('btn-rep-h'); await p.waitForTimeout(250);
for (const q of (await qa('piezasDelFrontal')).filter((k) => k.clase === 'aparato')) {
	console.log(`    ${q.id} en (${q.x}, ${q.y})`);
}
await foto('3-alineados');

console.log('\n=== añadir un piloto y un rótulo, y quitarlos ===');
const cuantas = (await qa('piezasDelFrontal')).length;
await clic('btn-add-piloto'); await p.waitForTimeout(600);
await clic('btn-add-placa'); await p.waitForTimeout(600);
console.log(`  de ${cuantas} piezas a ${(await qa('piezasDelFrontal')).length}`);
await foto('4-anadidos');
await p.keyboard.press('Delete'); await p.waitForTimeout(500);
console.log(`  tras Supr: ${(await qa('piezasDelFrontal')).length}`);

console.log('\n=== volver al INTERIOR: la cámara vuelve donde estaba ===');
await clic('esp-interior'); await p.waitForTimeout(1200);
const camVuelta = await qa('camaraAhora');
const dif = Math.hypot(camVuelta.pos.x - camInterior.pos.x, camVuelta.pos.y - camInterior.pos.y, camVuelta.pos.z - camInterior.pos.z);
console.log(`  la cámara del interior se ha desviado ${dif.toFixed(1)} mm respecto de como se dejó`);
await foto('5-vuelta-al-interior');
await clic('esp-conjunto'); await p.waitForTimeout(1200); await foto('6-conjunto');

console.log('\n=== nada del interior se ha movido, y sigue todo conectado ===');
const drc = await p.evaluate(() => document.getElementById('chip-drc')?.textContent?.trim());
console.log(`  DRC: ${drc}`);
console.log(er.length ? `\nERRORES: ${er.slice(0, 3).join(' | ')}` : '\nsin errores de JavaScript');
await b.close(); sv.close();
