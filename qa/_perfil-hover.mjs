/**
 * ¿CUÁNTO CUESTA SABER QUÉ HAY BAJO EL PUNTERO? Medido, no supuesto.
 *
 * Desde que la selección de cables se resuelve proyectando el recorrido a la pantalla y midiendo
 * en píxeles, el trabajo por movimiento del ratón es proporcional al número de cables. Es la clase
 * de cambio que arregla la sensación de uso y estropea el rendimiento sin que nadie se entere, así
 * que se mide en el tablero más cargado que hay: el estrella-triángulo, con 52 conductores.
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

const n = await p.evaluate(() => window.qa.proyecto().conductores.length);
// Una pasada en frío para que el JIT no se cuele en la medida, y luego la de verdad.
await qa('simularPaseo', 30);
await qa('cronometro', true);
const m = await qa('simularPaseo', 120);
const r = await qa('cronometroLeer');
await qa('cronometro', false);
console.log(`tablero con ${n} conductores · ${m.eventos} movimientos de ratón sin apretar`);
console.log(`  ${m.msTotal} ms en total · mediana ${m.mediana} ms · p95 ${m.p95} ms · peor ${m.peor} ms`);
console.log(`  movimientos que cayeron sobre un cable: ${m.encontrados}\n`);
console.log('etapa                        veces   ms total   ms por vez');
for (const e of r.etapas) console.log(`  ${e.etapa.padEnd(26)} ${String(e.veces).padStart(4)}   ${String(e.msTotal).padStart(8)}   ${String(e.msPorVez).padStart(9)}`);
console.log(er.length ? `\nERRORES: ${er.slice(0, 2).join(' | ')}` : '\nsin errores de JavaScript');
await b.close(); sv.close();
