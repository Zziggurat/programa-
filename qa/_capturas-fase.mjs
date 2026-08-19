/**
 * LAS CAPTURAS QUE PIDIÓ DIEGO PARA JUZGAR ESTA FASE.
 *
 * Guía del eje Z, snap a canaleta, cable dentro con la tapa fuera y puesta, preview inválido en
 * rojo, y las tres vistas —frontal, lateral y diagonal—. Cada pareja comparte encuadre, para que
 * lo único que cambie entre dos fotos sea lo que se quiere comparar.
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const RAIZ = '/workspace/programa-/app/dist';
const SALIDA = process.argv[2] ?? '/tmp/capturas-fase';
mkdirSync(SALIDA, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const sv = http.createServer((q, r) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u === '/') u = '/index.html'; const f = join(RAIZ, u); if (!existsSync(f)) { r.statusCode = 404; r.end(''); return; } r.setHeader('Content-Type', MIME[extname(f)] ?? 'application/octet-stream'); r.end(readFileSync(f)); });
await new Promise((r) => sv.listen(0, r));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
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
const can = g.canaletas.find((c) => c.orientacion === 'h');
const cable = await p.evaluate(() => window.qa.proyecto().conductores[0].id);

const mirar = async (giro, alto, dist, foco) => {
	const f = foco ?? { x: can.x + can.largo / 2, y: can.y, z: can.alto / 2 };
	await qa('verDesde', {
		x: f.x + Math.sin(giro) * dist, y: f.y + Math.sin(alto) * dist,
		z: f.z + Math.cos(giro) * Math.cos(alto) * dist, tx: f.x, ty: f.y, tz: f.z,
	});
	await p.waitForTimeout(550);
};
const generalDesde = async (giro, alto) => mirar(giro, alto, Math.max(g.ancho, g.alto) * 0.95,
	{ x: g.ancho / 2, y: g.alto / 2, z: 40 });

// --- Vistas generales: frontal, diagonal y lateral ---
await generalDesde(0.02, 0.05); await p.screenshot({ path: join(SALIDA, '01-general-frontal.png') });
await generalDesde(0.55, 0.30); await p.screenshot({ path: join(SALIDA, '02-general-diagonal.png') });
await generalDesde(1.30, 0.10); await p.screenshot({ path: join(SALIDA, '03-general-lateral.png') });

// --- Editando Z desde el lateral, con la guía del eje puesta ---
const ruta0 = await qa('rutaDe', cable);
const medio = ruta0[Math.floor(ruta0.length / 2)];
const idx = await qa('crearPuntoCable', cable, medio.x, medio.y);
await mirar(1.35, 0.08, 300);
await p.screenshot({ path: join(SALIDA, '04-lateral-antes-de-mover.png') });
// Se deja el arrastre ABIERTO para poder fotografiar la guía del eje: se dispara a mano.
await p.evaluate(([id, i]) => {
	window.qa.simularArrastre(id, i, 12, 0, -4, 'z');
}, [cable, idx]);
await p.waitForTimeout(500);
await p.screenshot({ path: join(SALIDA, '05-lateral-tras-mover-en-Z.png') });

// --- Snap a canaleta: dentro, con tapa fuera y puesta ---
const zDentro = Math.round(can.alto * 0.5);
for (let i = 0; i < 3; i++) {
	const x = Math.round(can.x + can.largo * (0.3 + i * 0.2));
	const k = i === 0 ? idx : await qa('crearPuntoCable', cable, x, Math.round(can.y));
	await qa('moverPuntoCable', cable, k, x, Math.round(can.y), zDentro);
}
/*
 * Para ver un cable DENTRO de una canaleta hay que mirar dentro de la canaleta.
 *
 * Con la cámara a media altura y de frente, el ducto se ve de canto y lo único que sale es su
 * pared: las dos fotos —tapa fuera y tapa puesta— salían idénticas y no demostraban nada. Desde
 * arriba y algo adelantado se ve el canal por dentro, que es donde está el cable.
 */
const dentroDelDucto = { x: can.x + can.largo * 0.5, y: can.y, z: can.alto * 0.4 };
await qa('ponerTapas', false);
await mirar(0.30, 1.05, 170, dentroDelDucto);
await p.screenshot({ path: join(SALIDA, '06-dentro-tapa-fuera.png') });
await qa('ponerTapas', true); await p.waitForTimeout(450);
await p.screenshot({ path: join(SALIDA, '07-dentro-tapa-puesta.png') });
await qa('ponerTapas', false);
await mirar(1.42, 0.35, 190, dentroDelDucto);
await p.screenshot({ path: join(SALIDA, '08-lateral-cable-dentro.png') });

// --- Preview inválido: un punto metido en el fondo de la canaleta ---
await mirar(0.35, 0.45, 250);
await qa('moverPuntoCable', cable, idx, Math.round(can.x + can.largo * 0.3), Math.round(can.y), 1);
const problema = await qa('validez', Math.round(can.x + can.largo * 0.3), Math.round(can.y), 1);
await p.waitForTimeout(400);
await p.screenshot({ path: join(SALIDA, '09-preview-invalido.png') });
console.log('preview inválido:', JSON.stringify(problema));

console.log(er.length ? `ERRORES: ${er.slice(0, 2).join(' | ')}` : 'sin errores de JavaScript');
await b.close(); sv.close();
