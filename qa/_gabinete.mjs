/**
 * MIRAR EL ARMARIO. Puerta abierta y cerrada, de frente, de lado y de cerca, en dos tableros de
 * tamaños muy distintos, y con los prensaestopas a la vista para comprobar que el suelo del
 * armario no se los come.
 *
 * Y de paso la medida que importa: el moteado con la cámara moviéndose medio píxel, con su
 * control de cámara quieta obligatorio en cero. Meter treinta chapas nuevas en la escena es la
 * mejor manera de reintroducir el z-fighting que se acaba de quitar, así que se comprueba.
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const RAIZ = '/workspace/programa-/app/dist';
const SALIDA = '/workspace/programa-/qa/capturas';
mkdirSync(SALIDA, { recursive: true });
const EJEMPLO = Number(process.argv[2] ?? 2);
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
await p.locator('.tarjeta-ejemplo button').nth(EJEMPLO).click({ timeout: 120_000 }); await p.waitForTimeout(2200);
for (const [m, bt] of [['#modal-dialogo', 'dialogo-ok'], ['#modal-explicacion', 'btn-cerrar-explicacion']]) { if (await p.isVisible(m)) { await p.evaluate((i) => document.getElementById(i)?.click(), bt); await p.waitForTimeout(700); } }
await p.evaluate(() => document.getElementById('modo-trabajo')?.click()); await p.waitForTimeout(700);

const g = await p.evaluate(() => window.qa.proyecto().gabinete);
const nombre = await p.evaluate(() => window.qa.proyecto().nombre);
console.log(`${nombre}: placa ${g.ancho}×${g.alto} · caja ${JSON.stringify(g.caja ?? 'estimada')}`);

const camaras = [
	['frente', { x: 0, y: 0, z: 1500 }],
	['tres-cuartos', { x: -1000, y: 380, z: 1200 }],
	['lateral', { x: -1700, y: 60, z: 620 }],
	['cerca-cierre', { x: 420, y: 0, z: 430 }],
	// El suelo del armario: es donde entran los cables de campo por su placa pasacables, y donde
	// se vería enseguida si la chapa se come los prensaestopas.
	['suelo', { x: 120, y: -g.alto * 0.85, z: 640, tx: 0, ty: -g.alto / 2, tz: 0 }],
];
const abrir = async (v) => {
	await p.evaluate((quiero) => {
		const btn = document.getElementById('btn-puerta');
		const abierta = btn.textContent.startsWith('Cerrar');
		if (abierta !== quiero) btn.click();
	}, v);
	await p.waitForTimeout(700);
};

for (const estado of [true, false]) {
	await abrir(estado);
	for (const [n, cam] of camaras) {
		await qa('verDesde', cam);
		await p.waitForTimeout(260);
		await p.screenshot({ path: join(SALIDA, `gab${EJEMPLO}-${estado ? 'abierta' : 'cerrada'}-${n}.png`) });
	}
}

// Moteado: cámara casi quieta contra cámara quieta del todo.
await abrir(false);
const centro = { x: 0, y: 0, z: 0 };
const radio = Math.max(g.ancho, g.alto) * 1.5;
const cam = (i, paso) => {
	const a = 0.30 + i * paso, e = 0.16 + i * paso * 0.4;
	return { x: centro.x + Math.sin(a) * radio, y: centro.y + Math.sin(e) * radio, z: centro.z + Math.cos(a) * Math.cos(e) * radio, tx: 0, ty: 0, tz: 0 };
};
const quietas = Array.from({ length: 4 }, () => cam(0, 0));
const moviendo = Array.from({ length: 6 }, (_, i) => cam(i, 0.0004));
const quieta = (await qa('medirMoteado', quietas)).porMillon;
const normal = (await qa('medirMoteado', moviendo)).porMillon;
console.log(`moteado del armario cerrado · cámara quieta ${quieta} (tiene que ser 0) · moviéndose ${normal} por millón`);
await abrir(true);
const abiertaQ = (await qa('medirMoteado', quietas)).porMillon;
const abiertaM = (await qa('medirMoteado', moviendo)).porMillon;
console.log(`moteado del armario abierto  · cámara quieta ${abiertaQ} (tiene que ser 0) · moviéndose ${abiertaM} por millón`);
console.log(er.length ? `ERRORES: ${er.slice(0, 3).join(' | ')}` : 'sin errores de JavaScript');
await b.close(); sv.close();
