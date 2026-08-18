/**
 * MEDIDA DE LA ILUMINACIÓN EN LOS MISMOS ENCUADRES QUE LAS FOTOS.
 *
 * Ajustar luces a ojo sobre capturas acaba compensando una cosa con otra. Esto lee el
 * framebuffer en cada encuadre y saca cuánto hay pegado al negro y cuánto al blanco —los dos
 * sitios donde se pierde información y no se recupera—, más la mediana y el contraste. Y de
 * paso mide el fotograma, para que el coste de cada ajuste de luz salga junto a su efecto.
 *
 *   node qa/_luz.mjs [indice-del-ejemplo] [ao]
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const RAIZ = '/workspace/programa-/app/dist';
const EJEMPLO = Number(process.argv[2] ?? 2);
const CON_AO = process.argv[3] === 'ao';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const servidor = http.createServer((req, res) => {
	let ruta = decodeURIComponent(req.url.split('?')[0]);
	if (ruta === '/') ruta = '/index.html';
	const f = join(RAIZ, ruta);
	if (!existsSync(f)) { res.statusCode = 404; res.end(''); return; }
	res.setHeader('Content-Type', MIME[extname(f)] ?? 'application/octet-stream');
	res.end(readFileSync(f));
});
await new Promise((r) => servidor.listen(0, r));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
p.setDefaultTimeout(60_000);
const errores = [];
p.on('pageerror', (e) => errores.push(e.message));
const qa = (fn, ...a) => p.evaluate(([f, args]) => window.qa[f](...args), [fn, a]);

await p.goto(`http://127.0.0.1:${servidor.address().port}/?qa=1&inicio=0`);
await p.waitForFunction(() => !!window.qa?.proyecto, null, { timeout: 60_000 });
await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click());
await p.waitForTimeout(400);
await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click());
await p.waitForTimeout(600);
if (await p.isVisible('#modal-dialogo')) {
	await p.evaluate(() => document.getElementById('dialogo-ok')?.click());
	await p.waitForTimeout(500);
	await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click());
	await p.waitForTimeout(600);
}
await p.locator('.tarjeta-ejemplo button').nth(EJEMPLO).click({ timeout: 120_000 });
await p.waitForTimeout(2000);
for (const [modal, boton] of [['#modal-dialogo', 'dialogo-ok'], ['#modal-explicacion', 'btn-cerrar-explicacion']]) {
	if (await p.isVisible(modal)) {
		await p.evaluate((id) => document.getElementById(id)?.click(), boton);
		await p.waitForTimeout(700);
	}
}
await p.evaluate(() => document.getElementById('modo-trabajo')?.click());
await p.waitForTimeout(600);

if (CON_AO) console.log('oclusión ambiental:', await qa('ao', true) ? 'ENCENDIDA' : 'no disponible');

const ids = await p.evaluate(() => window.qa.proyecto().dispositivos.map((d) => ({ id: d.id, tipo: d.tipo })));
const primero = (...t) => ids.find((d) => t.includes(d.tipo))?.id;
const cerca = async (id, dist, giro = 0.35, alto = 0.22) => {
	const c = await qa('bulto', id);
	if (!c) return false;
	const r = Math.max(30, c.radio) * dist * 3.2;
	await qa('verDesde', {
		x: c.x + Math.sin(giro) * r, y: c.y + Math.sin(alto) * r, z: c.z + Math.cos(giro) * Math.cos(alto) * r,
		tx: c.x, ty: c.y, tz: c.z,
	});
	await p.waitForTimeout(500);
	return true;
};
const general = async (giro, alto, dist = 1.25) => {
	let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z = 0;
	for (const { id } of ids) {
		const c = await qa('bulto', id);
		if (!c) continue;
		x0 = Math.min(x0, c.x - c.radio); x1 = Math.max(x1, c.x + c.radio);
		y0 = Math.min(y0, c.y - c.radio); y1 = Math.max(y1, c.y + c.radio);
		z = Math.max(z, c.z);
	}
	const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
	const r = Math.max(x1 - x0, y1 - y0) * dist;
	await qa('verDesde', {
		x: cx + Math.sin(giro) * r, y: cy + Math.sin(alto) * r, z: z + Math.cos(giro) * Math.cos(alto) * r,
		tx: cx, ty: cy, tz: z,
	});
	await p.waitForTimeout(500);
};
/*
 * AQUÍ NO SE MIDE EL TIEMPO DE FOTOGRAMA, y conviene dejarlo escrito para que nadie lo intente
 * otra vez: en un Chromium sin pantalla el navegador ESTRANGULA `requestAnimationFrame` a un
 * puñado de llamadas por segundo, así que cronometrar entre fotogramas da mil milisegundos
 * midiendo una escena vacía. El coste se mide con `qa/coste-arranque.mjs`, que lo saca de otra
 * forma y da cifras que sí se pueden comparar entre versiones.
 */
const filas = [];
const medir = async (nombre) => filas.push({ encuadre: nombre, ...(await qa('histograma')) });
await general(0, 0.05); await medir('general-frente');
await general(0.5, 0.3); await medir('general-diagonal');
await cerca(primero('contactor') ?? ids[0].id, 1.4); await medir('contactor');
await cerca(primero('bornero') ?? ids[0].id, 1.3); await medir('bornera');
await cerca(primero('bornero') ?? ids[0].id, 0.32, 0.3, 0.25); await medir('macro-borne');
await general(1.15, 0.06, 1.0); await medir('lateral');

const pad = (s, n) => String(s).padEnd(n);
console.log('\nencuadre           negros%  blancos%  mediana  media  contraste');
for (const f of filas) {
	console.log(`${pad(f.encuadre, 18)} ${pad(f.negrosMuertos, 8)} ${pad(f.blancosMuertos, 9)} ${pad(f.mediana, 8)} ${pad(f.media, 6)} ${f.contraste}`);
}
const med = (k) => Math.round((filas.reduce((a, f) => a + f[k], 0) / filas.length) * 100) / 100;
console.log(`${pad('MEDIA', 18)} ${pad(med('negrosMuertos'), 8)} ${pad(med('blancosMuertos'), 9)} ${pad(med('mediana'), 8)} ${pad(med('media'), 6)} ${med('contraste')}`);
console.log(errores.length ? `ERRORES: ${errores.slice(0, 3).join(' | ')}` : 'sin errores de JavaScript');
await b.close();
servidor.close();
