/**
 * LA MATRIZ DE COLOR DE LOS CONDUCTORES, MEDIDA EN EL FRAMEBUFFER.
 *
 * Un conductor energizado tiene que SEGUIR SIENDO de su color. Gris energizado = gris.
 * Marrón energizado = marrón. Eso no se juzga a ojo: se mide el mismo píxel del mismo cable,
 * desde el mismo encuadre, apagado y encendido, y se compara tono/saturación/luz.
 *
 * Dos trampas que ya me han engañado y que aquí están cerradas:
 *   1. El punto puede caer en la PLACA y no en el cable. Por eso cada muestra se valida con
 *      `cableEnPixel` ANTES de creerse el color.
 *   2. Al energizar la escena se mueve lo justo para que el punto deje de estar sobre el cable.
 *      Por eso se vuelve a validar DESPUÉS de energizar, y si falla se dice, no se calla.
 *
 *   node qa/_color-cables.mjs [carpeta] [indice-del-ejemplo]
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const RAIZ = '/workspace/programa-/app/dist';
const SALIDA = process.argv[2] ?? '/tmp/color-cables';
const EJEMPLO = Number(process.argv[3] ?? 2);
mkdirSync(SALIDA, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const sv = http.createServer((q, r) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u === '/') u = '/index.html'; const f = join(RAIZ, u); if (!existsSync(f)) { r.statusCode = 404; r.end(''); return; } r.setHeader('Content-Type', MIME[extname(f)] ?? 'application/octet-stream'); r.end(readFileSync(f)); });
await new Promise((r) => sv.listen(0, r));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
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

// Un conductor por cada color presente: la matriz que pidió Diego (negro, marrón, gris, azul, PE…).
const conductores = await p.evaluate(() => window.qa.proyecto().conductores.map((c) => ({ id: c.id, color: c.color ?? '(sin color)', de: c.de.dispositivoId })));
const porColor = new Map();
for (const c of conductores) if (!porColor.has(c.color)) porColor.set(c.color, c.id);
console.log('colores presentes:', [...porColor.keys()].join(', '));

const encuadre = async () => {
	const ids = await p.evaluate(() => window.qa.proyecto().dispositivos.map((d) => d.id));
	let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z = 0;
	for (const id of ids) {
		const c = await qa('bulto', id);
		if (!c) continue;
		x0 = Math.min(x0, c.x - c.radio); x1 = Math.max(x1, c.x + c.radio);
		y0 = Math.min(y0, c.y - c.radio); y1 = Math.max(y1, c.y + c.radio);
		z = Math.max(z, c.z);
	}
	const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, r = Math.max(x1 - x0, y1 - y0) * 0.95;
	await qa('verDesde', { x: cx + Math.sin(0.35) * r, y: cy + Math.sin(0.2) * r, z: z + Math.cos(0.35) * Math.cos(0.2) * r, tx: cx, ty: cy, tz: z });
	await p.waitForTimeout(600);
};
await encuadre();

/*
 * CÓMO SE MIDE EL COLOR DE UN CABLE SIN ENGAÑARSE.
 *
 * Un conductor es un tubo de milímetro y medio visto de lejos: cae en uno o dos píxeles. Eso abre
 * tres formas de medir mal, y las tres me han dado ya números con toda la pinta de ser buenos:
 *
 *   1. El punto proyectado cae FUERA del lienzo -> se lee 0,0,0 y parece «negro».
 *   2. El punto cae sobre la PLACA y no sobre el cable -> se lee el fondo.
 *   3. El punto cae en la raya especular del tubo -> un cable negro se lee casi blanco.
 *
 * Contra (1) se recorta al lienzo, contra (2) se valida cada punto con `cableEnPixel`, y contra
 * (3) se toma la MEDIANA de varios puntos repartidos a lo largo del cable: un reflejo puntual o un
 * píxel de borde quedan fuera de la mediana, mientras que el color propio del conductor, que es lo
 * que se repite, la ocupa.
 */
const MUESTRAS_POR_CABLE = 7;
const mediana = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
const aHsl = (r, g, b) => {
	const R = r / 255, G = g / 255, B = b / 255;
	const mx = Math.max(R, G, B), mn = Math.min(R, G, B), l = (mx + mn) / 2, d = mx - mn;
	if (d === 0) return { tono: 0, saturacion: 0, luz: Math.round(l * 100) };
	const sat = d / (1 - Math.abs(2 * l - 1));
	const h = mx === R ? ((G - B) / d + (G < B ? 6 : 0)) : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
	return { tono: Math.round(h * 60), saturacion: Math.round(sat * 100), luz: Math.round(l * 100) };
};
const lienzo = await p.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const dentro = (pt) => pt.x > lienzo.x + 4 && pt.x < lienzo.x + lienzo.w - 4 && pt.y > lienzo.y + 4 && pt.y < lienzo.y + lienzo.h - 4;

/** Puntos del cable que están en pantalla Y son de verdad ese cable. */
const puntosBuenos = async (id) => {
	const out = [];
	for (const pt of (await qa('puntosVisiblesDeCable', id, 30)).filter(dentro)) {
		if ((await qa('cableEnPixel', pt.x, pt.y)) === id) out.push(pt);
		if (out.length >= MUESTRAS_POR_CABLE) break;
	}
	return out;
};

/** El color del cable en esos puntos, por mediana de canal, revalidando cada uno. */
const medir = async (id, puntos) => {
	const R = [], G = [], B = [];
	for (const pt of puntos) {
		if ((await qa('cableEnPixel', pt.x, pt.y)) !== id) continue;
		const c = await qa('colorEnPixel', pt.x, pt.y);
		R.push(c.r); G.push(c.g); B.push(c.b);
	}
	if (!R.length) return undefined;
	const r = mediana(R), g = mediana(G), b = mediana(B);
	return { r, g, b, ...aHsl(r, g, b), validos: R.length };
};

const muestras = [];
for (const [color, id] of porColor) {
	const puntos = await puntosBuenos(id);
	if (puntos.length < 3) { console.log(`${color.padEnd(16)} ${id}: solo ${puntos.length} puntos válidos, no se mide`); continue; }
	const apagado = await medir(id, puntos);
	if (apagado) muestras.push({ color, id, puntos, apagado });
}
await p.screenshot({ path: join(SALIDA, 'a-apagado.png') });

const emisionApagado = await qa('emisionCables');
await p.evaluate(() => document.getElementById('btn-energizar')?.click());
await p.waitForTimeout(2500);
await p.screenshot({ path: join(SALIDA, 'b-energizado.png') });
const emisionEncendido = await qa('emisionCables');
const vivos = new Set(await p.evaluate(() => [...(window.qa.simulacion().activos ?? [])]));
const conVida = new Set(emisionEncendido.filter((e) => e.intensidad > 0).map((e) => e.id));

console.log('\n== EMISIÓN REAL DE LOS MATERIALES (lo que hace, no lo que debería hacer) ==');
for (const { id } of muestras) {
	const a = emisionApagado.find((e) => e.id === id);
	const e = emisionEncendido.find((x) => x.id === id);
	if (!a || !e) continue;
	console.log(`${id.padEnd(10)} color=#${a.color}  emissive=#${e.emissive}  intensidad ${a.intensidad} -> ${e.intensidad}`);
}

console.log('\n== COLOR EN PANTALLA ==');
console.log('color            id        apagado RGB / T S L         encendido RGB / T S L        Δtono Δsat Δluz');
for (const m of muestras) {
	// Los MISMOS puntos y la MISMA cámara que en la toma de apagado: no se ha movido nada entre las
	// dos tomas, así que lo que cambie es el color y no el encuadre.
	const enc = await medir(m.id, m.puntos);
	if (!enc) { console.log(`${m.color.padEnd(16)} ${m.id}: se perdió de vista al energizar`); continue; }
	const sigue = enc.validos >= 3;
	const a = m.apagado;
	const dt = enc.tono - a.tono, ds = enc.saturacion - a.saturacion, dl = enc.luz - a.luz;
	const fmt = (c) => `${String(c.r).padStart(3)},${String(c.g).padStart(3)},${String(c.b).padStart(3)} / ${String(c.tono).padStart(3)} ${String(c.saturacion).padStart(2)} ${String(c.luz).padStart(2)}`;
	console.log(`${m.color.padEnd(16)} ${m.id.padEnd(9)} ${fmt(a)}    ${fmt(enc)}   ${String(dt).padStart(5)} ${String(ds).padStart(4)} ${String(dl).padStart(4)}` + (sigue ? '' : `   << OJO: solo ${enc.validos} puntos válidos al energizar`) + (conVida.has(m.id) ? '' : '   (este conductor no tiene tensión en este tablero)'));
}
console.log(`\naparatos activos: ${[...vivos].join(', ') || '(ninguno)'}`);
console.log(er.length ? `ERRORES: ${er.slice(0, 2).join(' | ')}` : 'sin errores de JavaScript');
await b.close(); sv.close();
