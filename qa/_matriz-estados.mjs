/**
 * LAS PAREJAS DE FOTOS QUE HAY QUE MIRAR, no leer.
 *
 * Cada pareja es EL MISMO recorte del MISMO encuadre, y lo único que cambia entre las dos es el
 * estado. Así se puede poner una al lado de la otra y contestar sin explicaciones: cuál está
 * energizado, cuál está señalado, cuál está seleccionado y de qué color era el cable.
 *
 * Los recortes de cable se centran en un punto VALIDADO del conductor (el rayo confirma que ahí se
 * ve ese cable y no la placa de detrás), así que la foto es de ese cable y no de su vecindario.
 *
 *   node qa/_matriz-estados.mjs <carpeta> [indice-del-ejemplo]
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const RAIZ = '/workspace/programa-/app/dist';
const SALIDA = process.argv[2] ?? '/tmp/matriz';
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

const disp = await p.evaluate(() => window.qa.proyecto().dispositivos.map((d) => ({ id: d.id, tipo: d.tipo })));
const conductores = await p.evaluate(() => window.qa.proyecto().conductores.map((c) => ({ id: c.id, color: c.color ?? '(sin color)' })));
const km = disp.find((d) => d.tipo === 'contactor')?.id ?? disp[0].id;
const piloto = disp.find((d) => d.tipo === 'piloto' || d.tipo === 'lampara')?.id;

const general = async (giro = 0.35, alto = 0.2, dist = 0.95) => {
	let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z = 0;
	for (const { id } of disp) {
		const c = await qa('bulto', id);
		if (!c) continue;
		x0 = Math.min(x0, c.x - c.radio); x1 = Math.max(x1, c.x + c.radio);
		y0 = Math.min(y0, c.y - c.radio); y1 = Math.max(y1, c.y + c.radio);
		z = Math.max(z, c.z);
	}
	const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, r = Math.max(x1 - x0, y1 - y0) * dist;
	await qa('verDesde', { x: cx + Math.sin(giro) * r, y: cy + Math.sin(alto) * r, z: z + Math.cos(giro) * Math.cos(alto) * r, tx: cx, ty: cy, tz: z });
	await p.waitForTimeout(600);
};
const sobre = async (id, factor = 3.0) => {
	const c = await qa('bulto', id);
	const r = Math.max(30, c.radio) * factor;
	await qa('verDesde', { x: c.x + Math.sin(0.35) * r, y: c.y + Math.sin(0.22) * r, z: c.z + Math.cos(0.35) * Math.cos(0.22) * r, tx: c.x, ty: c.y, tz: c.z });
	await p.waitForTimeout(500);
};
/*
 * DÓNDE SE PUEDE FOTOGRAFIAR: encima del lienzo Y con nada de la interfaz delante.
 *
 * El lienzo 3D ocupa TODA la ventana y los paneles laterales flotan por encima. Así que «el punto
 * cae dentro del lienzo» no quiere decir nada: los primeros recortes salieron fotografiando la
 * lista de cables del panel izquierdo, que está justo encima del canvas. Lo que de verdad hace
 * falta es preguntar qué elemento hay en ese píxel, y `elementFromPoint` lo contesta sin que haya
 * que adivinar el ancho de ningún panel.
 */
const descubierto = async (pt) => p.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', [pt.x, pt.y]);
const puntoBueno = async (id) => {
	for (const pt of await qa('puntosVisiblesDeCable', id, 30)) {
		if (!(await descubierto(pt))) continue;
		if ((await qa('cableEnPixel', pt.x, pt.y)) === id) return pt;
	}
	return undefined;
};

/*
 * LA FRANJA DE TABLERO QUE NO TAPA NADA, medida una vez barriendo la ventana.
 *
 * Exigir que el recorte saliera CENTRADO en el cable y además limpio dejaba fuera casi todos los
 * conductores: los puntos que se ven de un cable suelen caer cerca de un panel. Así que el recorte
 * se mete a la fuerza dentro de la franja libre; el cable sigue dentro de la foto, solo que no
 * justo en medio, y eso para mirar una pareja de imágenes da igual.
 */
const zonaLibre = await (async () => {
	const alto = p.viewportSize().height, ancho = p.viewportSize().width;
	const medio = Math.round(alto / 2);
	const libre = async (x, y) => descubierto({ x, y });
	let iz = 0; while (iz < ancho && !(await libre(iz, medio))) iz += 10;
	let de = ancho - 1; while (de > iz && !(await libre(de, medio))) de -= 10;
	const cx = Math.round((iz + de) / 2);
	let ar = 0; while (ar < alto && !(await libre(cx, ar))) ar += 10;
	let ab = alto - 1; while (ab > ar && !(await libre(cx, ab))) ab -= 10;
	return { x0: iz + 6, x1: de - 6, y0: ar + 6, y1: ab - 6 };
})();
console.log('zona libre del tablero:', JSON.stringify(zonaLibre));
// Recorte centrado en el punto: la pareja apagado/encendido comparte encuadre y recorte, así que
// lo único que puede cambiar de una foto a otra es el estado del cable.
const RECORTE = { w: 300, h: 200 };
const acotar = (v, min, max) => Math.round(Math.max(min, Math.min(max, v)));
const recorte = (pt) => ({
	x: acotar(pt.x - RECORTE.w / 2, zonaLibre.x0, zonaLibre.x1 - RECORTE.w),
	y: acotar(pt.y - RECORTE.h / 2, zonaLibre.y0, zonaLibre.y1 - RECORTE.h),
	width: RECORTE.w, height: RECORTE.h,
});

await general(0.35, 0.2, 0.78);
const porColor = new Map();
for (const c of conductores) if (!porColor.has(c.color)) porColor.set(c.color, c.id);
const sitios = [];
for (const [color, id] of porColor) {
	const pt = await puntoBueno(id);
	if (!pt) { console.log(`${color}: sin punto visible para la foto`); continue; }
	sitios.push({ color, id, pt });
	await p.screenshot({ path: join(SALIDA, `cable-${color.replace(/[/]/g, '-')}-1-normal.png`), clip: recorte(pt) });
}
await p.screenshot({ path: join(SALIDA, 'general-1-normal.png') });

// Hover y selección de un cable, en el mismo recorte que su foto normal.
const s0 = sitios[0];
if (s0) {
	await p.mouse.move(s0.pt.x, s0.pt.y); await p.waitForTimeout(700);
	await p.screenshot({ path: join(SALIDA, `cable-${s0.color.replace(/[/]/g, '-')}-2-hover.png`), clip: recorte(s0.pt) });
	await p.mouse.click(s0.pt.x, s0.pt.y); await p.waitForTimeout(700);
	await p.mouse.move(900, 120); await p.waitForTimeout(500);   // apartar el puntero para que el hover no contamine la foto
	await p.screenshot({ path: join(SALIDA, `cable-${s0.color.replace(/[/]/g, '-')}-3-seleccionado.png`), clip: recorte(s0.pt) });
}

// Aparatos en reposo, antes de dar tensión.
await sobre(km); await p.screenshot({ path: join(SALIDA, 'contactor-1-reposo.png') });
if (piloto) { await sobre(piloto, 4.5); await p.screenshot({ path: join(SALIDA, 'piloto-1-apagado.png') }); }

// --- TENSIÓN ---
await p.evaluate(() => document.getElementById('btn-energizar')?.click());
await p.waitForTimeout(2500);
/*
 * Meter la maniobra: un contactor con tensión pero en reposo no se distingue de uno sin tensión,
 * así que sin esto la pareja «reposo / activado» serían dos fotos iguales.
 *
 * Se prueban los pulsadores DE UNO EN UNO. Accionarlos todos a la vez no arranca nada: el de paro
 * es normalmente cerrado, y pulsarlo a la vez que el de marcha deja el circuito abierto. Es lo que
 * pasó en la primera pasada —S0 y S1 accionados, «nada está funcionando»—, y las dos fotos del
 * contactor salieron idénticas.
 */
const mandos = disp.filter((d) => d.tipo === 'pulsador' || d.tipo === 'selector');
for (const d of mandos) {
	await qa('accionar', d.id).catch(() => {});
	await p.waitForTimeout(900);
	const sim = await qa('simulacion');
	if (sim.activos.length) { console.log(`la maniobra entra accionando ${d.id}`); break; }
	await qa('accionar', d.id).catch(() => {});   // soltarlo y probar el siguiente
	await p.waitForTimeout(300);
}
await p.waitForTimeout(1200);

await sobre(km); await p.screenshot({ path: join(SALIDA, 'contactor-2-activado.png') });
if (piloto) { await sobre(piloto, 4.5); await p.screenshot({ path: join(SALIDA, 'piloto-2-encendido.png') }); }

await qa('elegir', undefined); await p.waitForTimeout(300);
await general(0.35, 0.2, 0.78);
for (const s of sitios) await p.screenshot({ path: join(SALIDA, `cable-${s.color.replace(/[/]/g, '-')}-4-energizado.png`), clip: recorte(s.pt) });
await qa('elegir', undefined); await p.waitForTimeout(400);
await general();
await p.screenshot({ path: join(SALIDA, 'general-2-energizado.png') });
if (s0) {
	// El mismo encuadre que las demás fotos del cable: si aquí se queda la vista general, la
	// pareja «seleccionado / seleccionado+energizado» compara dos encuadres, no dos estados.
	await general(0.35, 0.2, 0.78);
	await p.mouse.click(s0.pt.x, s0.pt.y); await p.waitForTimeout(700);
	await p.mouse.move(900, 120); await p.waitForTimeout(500);   // apartar el puntero para que el hover no contamine la foto
	await p.screenshot({ path: join(SALIDA, `cable-${s0.color.replace(/[/]/g, '-')}-5-seleccionado-energizado.png`), clip: recorte(s0.pt) });
}
/*
 * EL TESTIGO DE UNA PROTECCIÓN, que es el indicador real que hay en estos tableros.
 *
 * Diego pedía la pareja «piloto apagado / encendido», pero ninguno de los cinco tableros de
 * ejemplo lleva un piloto: existen en el catálogo y nada más. El equivalente que sí hay montado es
 * la mirilla de una protección, y sirve para lo mismo que había que comprobar: al cambiar de
 * estado se enciende LA MIRILLA, no el aparato entero.
 */
const proteccion = disp.find((d) => ['disyuntor', 'diferencial', 'guardamotor', 'rele'].includes(d.tipo));
if (proteccion) {
	await sobre(proteccion.id, 3.4);
	await p.screenshot({ path: join(SALIDA, 'proteccion-1-normal.png') });
	await qa('accionar', proteccion.id).catch(() => {});
	await p.waitForTimeout(1200);
	await sobre(proteccion.id, 3.4);
	await p.screenshot({ path: join(SALIDA, 'proteccion-2-disparada.png') });
	console.log(`testigo fotografiado en ${proteccion.id} (${proteccion.tipo})`);
} else {
	console.log('este tablero no lleva ninguna protección con mirilla');
}
console.log('cables fotografiados:', sitios.map((s) => `${s.color}=${s.id}`).join(', '));
console.log('vivos:', JSON.stringify(await qa('simulacion')));
console.log(er.length ? `ERRORES: ${er.slice(0, 2).join(' | ')}` : 'sin errores de JavaScript');
await b.close(); sv.close();
