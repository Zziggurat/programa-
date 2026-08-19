/**
 * QUÉ CUESTA ARRASTRAR UNA UNIÓN DE CABLE, etapa por etapa y con el ratón de verdad.
 *
 * Diego pidió números antes de optimizar, y con razón: en este proyecto ya ha pasado dos veces que
 * la causa «evidente» era falsa. Aquí no se simula nada por dentro: se pulsa, se mueve el ratón
 * treinta veces y se suelta, igual que haría una persona, y se lee el cronómetro que instrumenta
 * el camino real desde `pointermove` hasta el repintado.
 *
 *   node qa/_perfil-arrastre.mjs [ejemplo] [movimientos]
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const RAIZ = '/workspace/programa-/app/dist';
const EJEMPLO = Number(process.argv[2] ?? 2);
const PASOS = Number(process.argv[3] ?? 30);
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
await p.evaluate(() => document.getElementById('modo-trabajo')?.click()); await p.waitForTimeout(600);
await p.evaluate(() => document.getElementById('btn-copiar-ejemplo')?.click()).catch(() => {});
await p.waitForTimeout(600);

const cables = await p.evaluate(() => window.qa.proyecto().conductores.length);
const elegido = await p.evaluate(() => window.qa.proyecto().conductores[0].id);
console.log(`tablero con ${cables} conductores · se arrastra un punto de ${elegido}\n`);

// Un punto visible del cable, para poder agarrarlo con el ratón de verdad.
const ruta = await qa('rutaDe', elegido);
const medio = ruta[Math.floor(ruta.length / 2)];
const puntos = await qa('puntosVisiblesDeCable', elegido, 30);
let agarre;
for (const pt of puntos) {
	const tapado = await p.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName !== 'CANVAS', [pt.x, pt.y]);
	if (tapado) continue;
	if ((await qa('cableEnPixel', pt.x, pt.y)) === elegido) { agarre = pt; break; }
}
if (!agarre) { console.log('no se pudo agarrar el cable'); await b.close(); sv.close(); process.exit(1); }

/*
 * La unión se crea con la sonda y no con un doble clic.
 *
 * Con el doble clic la primera pasada midió 139 segundos para treinta movimientos… y el cronómetro
 * salió vacío: la unión no se había creado, así que el arrastre nunca entró en su rama y lo que se
 * midió fue otra cosa. La sonda es la MISMA función que usa el ratón, así que no se pierde
 * realismo, y ahora sí se sabe que hay un punto que arrastrar.
 */
const idx = await qa('crearPuntoCable', elegido, medio.x, medio.y);
await p.waitForTimeout(400);
const trazado = await qa('trazadoDe', elegido);
console.log('trazado tras crear la unión:', JSON.stringify(trazado));
if (!trazado?.length) { console.log('no se creó la unión'); await b.close(); sv.close(); process.exit(1); }
const wp = trazado[Math.max(0, idx)];
const enPantalla = await qa('pantallaDe', wp.x, wp.y, wp.z ?? 46);
console.log(`la unión está en pantalla en (${Math.round(enPantalla.x)}, ${Math.round(enPantalla.y)})`);
agarre = enPantalla;

await qa('cronometro', true);
const medida = await qa('simularArrastre', elegido, Math.max(0, idx), PASOS);
const r = await qa('cronometroLeer');
await qa('cronometro', false);

if (!medida) { console.log('no se pudo simular el arrastre'); await b.close(); sv.close(); process.exit(1); }
console.log(`\nARRASTRE DE ${medida.eventos} MOVIMIENTOS: ${medida.msTotal} ms en total`);
console.log(`  por evento: mediana ${medida.mediana} ms · p95 ${medida.p95} ms · peor ${medida.peor} ms\n`);
console.log('etapa                        veces   ms total   ms por vez');
for (const e of r.etapas) {
	console.log(`  ${e.etapa.padEnd(26)} ${String(e.veces).padStart(4)}   ${String(e.msTotal).padStart(8)}   ${String(e.msPorVez).padStart(9)}`);
}
console.log('\nlo que se ejecutó por debajo:');
console.log(`  repartos completos del router : ${r.contadores.repartos}`);
console.log(`  firmas del ruteo calculadas   : ${r.contadores.firmas} (${r.contadores.msFirmas} ms)`);
console.log(`  cables reconstruidos          : ${r.contadores.cablesConstruidos}`);
console.log(`  TubeGeometry creadas          : ${r.contadores.tubos}`);
console.log(`\n  por cada movimiento: ${(r.contadores.cablesConstruidos / medida.eventos).toFixed(1)} cables · ${(r.contadores.tubos / medida.eventos).toFixed(1)} tubos · ${(r.contadores.repartos / medida.eventos).toFixed(2)} repartos`);
console.log(er.length ? `ERRORES: ${er.slice(0, 2).join(' | ')}` : 'sin errores de JavaScript');
await b.close(); sv.close();
