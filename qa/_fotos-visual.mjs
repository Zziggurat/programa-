/**
 * LAS FOTOS DE LA REVISIÓN VISUAL, DESDE ÁNGULOS FIJOS Y REPETIBLES.
 *
 * No es una prueba: es el material para mirar los componentes con los ojos y decidir cuál sigue
 * pareciendo una primitiva 3D. A diferencia de `_fotos-canaletas.mjs`, aquí la cámara NO se mueve
 * arrastrando el ratón sino con `qa.verDesde`, porque un arrastre real cuesta segundos y no cae
 * dos veces en el mismo sitio: para comparar un antes y un después el encuadre tiene que ser el
 * mismo al milímetro.
 *
 *   node qa/_fotos-visual.mjs <carpeta> [indice-del-ejemplo]
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const RAIZ = '/workspace/programa-/app/dist';
const SALIDA = process.argv[2] ?? '/tmp/fotos-visual';
const EJEMPLO = Number(process.argv[3] ?? 2);
mkdirSync(SALIDA, { recursive: true });
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

const tapas = async (v) => {
	await p.evaluate((val) => {
		const c = document.getElementById('ver-tapas');
		if (c && c.checked !== val) c.click();
	}, v);
	await p.waitForTimeout(600);
};
const foto = async (n) => { await p.screenshot({ path: join(SALIDA, `${n}.png`) }); console.log('  ->', `${n}.png`); };

/**
 * Encuadra un aparato por su identificador. `dist` es cuántos radios de bulto se retira la cámara
 * (1.6 es un primer plano cómodo) y `giro`/`alto` inclinan la vista para que el relieve se vea:
 * de frente y plano, un bisel no se distingue de una arista viva.
 */
const cerca = async (id, dist = 1.6, giro = 0.35, alto = 0.22) => {
	const c = await qa('bulto', id);
	if (!c) { console.log('  (sin aparato', id, ')'); return false; }
	const r = Math.max(30, c.radio) * dist * 3.2;
	await qa('verDesde', {
		x: c.x + Math.sin(giro) * r, y: c.y + Math.sin(alto) * r, z: c.z + Math.cos(giro) * Math.cos(alto) * r,
		tx: c.x, ty: c.y, tz: c.z,
	});
	await p.waitForTimeout(500);
	return true;
};
/** Vista general: se calcula desde el bulto de TODO el tablero, no desde números a mano. */
const general = async (giro, alto, dist = 1.25) => {
	const ids = await p.evaluate(() => window.qa.proyecto().dispositivos.map((d) => d.id));
	let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z = 0;
	for (const id of ids) {
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

const ids = await p.evaluate(() => window.qa.proyecto().dispositivos.map((d) => ({ id: d.id, tipo: d.tipo })));
const primero = (...tipos) => ids.find((d) => tipos.includes(d.tipo))?.id;
console.log('aparatos:', ids.map((d) => `${d.id}(${d.tipo})`).join(' '));

await tapas(false);
await general(0, 0.05); await foto('01-general-frente');
await general(0.5, 0.3); await foto('02-general-diagonal');
if (await cerca(primero('contactor') ?? ids[0].id, 1.4)) await foto('03-contactor-de-cerca');
if (primero('disyuntor', 'diferencial')) { await cerca(primero('disyuntor', 'diferencial'), 1.4); await foto('04-proteccion'); }
if (primero('rele', 'guardamotor')) { await cerca(primero('rele', 'guardamotor'), 1.4); await foto('05-rele-o-guardamotor'); }
if (primero('bornero')) { await cerca(primero('bornero'), 1.3); await foto('06-bornera'); }
if (primero('fusible')) { await cerca(primero('fusible'), 1.4); await foto('07-fusible'); }
// Borne con cable puesto: se mira MUY de cerca, que es donde se ve si la puntera encaja.
if (await cerca(primero('contactor') ?? ids[0].id, 0.6, 0.5, 0.35)) await foto('08-borne-con-cable');
// El carril y la canaleta se buscan por debajo del primer aparato del riel.
await cerca(ids[0].id, 1.1, 0.2, -0.3); await foto('09-carril-y-canaleta');
if (primero('pulsador', 'selector', 'piloto')) {
	await cerca(primero('pulsador', 'selector', 'piloto'), 1.3, 0.4, 0.3);
	await foto('11-mando-de-puerta');
}
await tapas(true); await general(0.5, 0.3); await foto('10-conjunto-con-tapa');

console.log(errores.length ? `ERRORES: ${errores.slice(0, 3).join(' | ')}` : 'sin errores de JavaScript');
await b.close();
servidor.close();
