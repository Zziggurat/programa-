/**
 * DIAGNÓSTICO AISLADO DE LOS DOS CASOS DE `agarre.mjs`.
 *
 * La suite entera hace cientos de clics reales y en este navegador sin tarjeta gráfica cada uno
 * cuesta segundos, así que no sirve para diagnosticar: se tarda una hora en llegar al caso que
 * interesa. Esto ejecuta sólo los dos que fallaban, con dos reglas que la suite no tenía:
 *
 *   — cada paso dice en voz alta qué está haciendo ANTES de hacerlo, para que un cuelgue se vea
 *     en el log en vez de tener que adivinarlo;
 *   — hay un cronómetro global que mata el proceso y dice en qué paso se quedó. Una prueba lenta
 *     puede tardar media hora; cuatro horas no es lentitud, es un bloqueo.
 *
 *   node qa/_agarre-casos.mjs
 */
import { chromium } from 'playwright-core';
import { abrirNavegador, servidorDeQA, trabajarSobreCopia } from './lib/entorno.mjs';

const LIMITE_GLOBAL_MS = Number(process.env.LIMITE ?? 12 * 60 * 1000);
let pasoActual = 'arrancando';
const t0 = Date.now();
const paso = (n) => { pasoActual = n; console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s] ${n}`); };
const guardia = setTimeout(() => {
	console.log(`\n=== BLOQUEADO en: ${pasoActual} (${((Date.now() - t0) / 1000).toFixed(0)} s) ===`);
	process.exit(2);
}, LIMITE_GLOBAL_MS);
guardia.unref?.();

paso('levantando el servidor de QA');
const { servidor } = await servidorDeQA();
const url = `http://127.0.0.1:${servidor.address().port}/?qa=1&inicio=0`;

paso('abriendo el navegador');
const browser = await abrirNavegador(chromium);
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
// Ninguna operación de Playwright puede esperar indefinidamente.
page.setDefaultTimeout(45_000);
page.setDefaultNavigationTimeout(60_000);
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

const qa = (fn, ...a) => page.evaluate(([f, args]) => window.qa[f](...args), [fn, a]);
const jsClick = (id) => page.evaluate((i) => document.getElementById(i)?.click(), id);
const LIBRE = { x0: 320, x1: 966, y0: 60, y1: 782 };
const enZona = (p) => p && p.x > LIBRE.x0 && p.x < LIBRE.x1 && p.y > LIBRE.y0 && p.y < LIBRE.y1;

paso('cargando la página');
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.qa?.proyecto, null, { timeout: 60_000 });
await jsClick('btn-cerrar-ayuda'); await page.waitForTimeout(200);

paso('abriendo el estrella-triángulo');
await jsClick('btn-empezar-ejemplo'); await page.waitForTimeout(400);
await page.locator('.tarjeta-ejemplo button').nth(2).click({ timeout: 120_000 });
await page.waitForTimeout(1500);
for (const [modal, boton] of [['#modal-dialogo', 'dialogo-ok'], ['#modal-explicacion', 'btn-cerrar-explicacion']]) {
	if (await page.isVisible(modal)) { await jsClick(boton); await page.waitForTimeout(400); }
}
await trabajarSobreCopia(page);
await jsClick('modo-trabajo'); await page.waitForTimeout(300);
await jsClick('btn-centrar'); await page.waitForTimeout(1200);

/* ================== CASO 1: el conductor que decía `sinPuntos` ================== */
paso('CASO 1 · buscando punto de agarre para el primer conductor');
const proy = await qa('proyecto');
const c0 = proy.conductores[0];
console.log(`      conductor: ${c0.id} (${c0.de.dispositivoId}:${c0.de.borneId} → ${c0.a.dispositivoId}:${c0.a.borneId})`);
for (const muestras of [31, 61, 121, 241]) {
	const p = await qa('puntoParaAgarrar', c0.id, muestras, LIBRE);
	console.log(`      con ${String(muestras).padStart(3)} muestras → ${p ? `(${p.x},${p.y}) ${enZona(p) ? 'EN ZONA' : 'fuera de zona'}` : 'ninguno'}`);
}
// ¿Y sin restringir a la zona del lienzo? Así se distingue «está oculto» de «cae bajo un panel».
const sinZona = await qa('puntoParaAgarrar', c0.id, 121);
console.log(`      sin exigir zona → ${sinZona ? `(${sinZona.x},${sinZona.y})` : 'ninguno'}`);

paso('CASO 1 · agarrando y ordenando de verdad ese conductor');
const HOLGADA = { x0: LIBRE.x0 + 40, x1: LIBRE.x1 - 40, y0: LIBRE.y0 + 40, y1: LIBRE.y1 - 40 };
let punto;
for (const zona of [HOLGADA, LIBRE]) {
	for (const m of [31, 61, 121, 241]) {
		const q = await qa('puntoParaAgarrar', c0.id, m, zona);
		if (enZona(q)) { punto = q; break; }
	}
	if (punto) break;
}
console.log(`      punto elegido: ${punto ? `(${punto.x},${punto.y})` : 'NINGUNO'}`);
if (punto) {
	const antes = JSON.stringify((await qa('proyecto')).conductores.find((c) => c.id === c0.id)?.trazado ?? null);
	await page.mouse.move(punto.x, punto.y); await page.mouse.down(); await page.waitForTimeout(60);
	const sel = await qa('seleccion');
	await page.mouse.up(); await page.waitForTimeout(120);
	console.log(`      selecciona: ${sel?.tipo}/${sel?.id} ${sel?.id === c0.id ? '(correcto)' : '(OTRO)'}`);
	await page.mouse.dblclick(punto.x, punto.y); await page.waitForTimeout(500);
	const tra = (await qa('proyecto')).conductores.find((c) => c.id === c0.id)?.trazado ?? [];
	console.log(`      uniones tras doble clic: ${tra.length}`);
	if (tra.length) {
		const tirador = await qa('puntoDeUnion', c0.id, tra.length - 1);
		console.log(`      tirador en ${tirador ? `(${tirador.x},${tirador.y})` : 'ninguno'} ${enZona(tirador) ? 'EN ZONA' : 'FUERA DE ZONA'}`);
		if (enZona(tirador)) {
			await page.mouse.move(tirador.x, tirador.y); await page.mouse.down(); await page.waitForTimeout(60);
			for (let k = 1; k <= 6; k++) { await page.mouse.move(tirador.x + 18 * k, tirador.y + 14 * k); await page.waitForTimeout(30); }
			await page.mouse.up(); await page.waitForTimeout(300);
			const despues = JSON.stringify((await qa('proyecto')).conductores.find((c) => c.id === c0.id)?.trazado ?? null);
			console.log(`      CASO 1 → ${despues !== antes ? 'SE MUEVE (OK)' : 'NO se mueve (FALLO)'}`);
		}
	}
}

/* ================== CASO 2: cámara girada a la derecha ================== */
paso('CASO 2 · girando la cámara a la derecha');
const lienzo = await page.locator('#escena').boundingBox();
const x = lienzo.x + lienzo.width * 0.72;
const y = lienzo.y + lienzo.height * 0.3;
await page.mouse.move(x, y);
await page.mouse.down();
for (let k = 1; k <= 5; k++) { await page.mouse.move(x + (150 * k) / 5, y); await page.waitForTimeout(30); }
await page.mouse.up();
await page.waitForTimeout(2500);

paso('CASO 2 · comprobando puntos de agarre de los primeros conductores');
const rutas = await qa('rutas');
for (const r of rutas.slice(0, 8)) {
	const p31 = await qa('puntoParaAgarrar', r.id, 31, LIBRE);
	const p241 = await qa('puntoParaAgarrar', r.id, 241, LIBRE);
	console.log(`      ${String(r.id).padEnd(4)} 31→${p31 ? `(${p31.x},${p31.y})` : 'ninguno'.padEnd(9)}   241→${p241 ? `(${p241.x},${p241.y})` : 'ninguno'}`);
}

paso('cerrando');
console.log(errs.length ? `ERRORES JS: ${errs.slice(0, 3).join(' | ')}` : 'sin errores de JavaScript');
clearTimeout(guardia);
await browser.close();
servidor.close();
console.log(`\n=== diagnóstico terminado en ${((Date.now() - t0) / 1000).toFixed(0)} s ===`);
