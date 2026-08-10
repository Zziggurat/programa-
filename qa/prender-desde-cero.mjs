/**
 * ¿PUEDE ALGUIEN ENCENDER UNA AMPOLLETA O UN MOTOR EMPEZANDO DE CERO?
 *
 * La pregunta literal de quien va a usar esto: «¿sabes cómo hacer funcionar, ejemplo, dar energía
 * y que prenda una ampolleta o un motor?». La prueba de `energizar.mjs` responde a medias, porque
 * parte de un tablero de ejemplo ya montado y ya cableado. Aquí se hace el camino entero, con
 * clics, como lo haría él:
 *
 *   placa en blanco → sacar los aparatos del catálogo → cablear tocando bornes → Energizar
 *
 * Al hacerlo salió lo que faltaba: en el catálogo NO había ni acometida, ni motor, ni ampolleta.
 * Estaban solo dentro de los tableros de ejemplo. Sin acometida no entra tensión al tablero, así
 * que «Energizar» no encendía nada por muy bien cableado que estuviera todo, y no había ningún
 * motor ni ninguna lámpara que encender. Por eso existe ahora el grupo «Campo» del catálogo, y
 * por eso existe esta prueba: para que no se pueda volver a romper ese camino sin enterarse.
 *
 *   node qa/prender-desde-cero.mjs
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirNavegador } from './lib/entorno.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SAL = join(AQUI, '_salida'); mkdirSync(SAL, { recursive: true });
const ROOT = join(AQUI, '..', 'app', 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
	let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
	const f = join(ROOT, p); if (!existsSync(f)) { res.statusCode = 404; res.end(''); return; }
	res.setHeader('Content-Type', MIME[extname(f)] ?? 'application/octet-stream'); res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/?qa=1&inicio=0`;

const browser = await abrirNavegador(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/i.test(m.text())) errs.push(m.text()); });

let fallos = 0;
const must = (n, c, extra = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${extra ? ' → ' + extra : ''}`); };
const click = (id) => page.evaluate((i) => { const b = document.getElementById(i); if (!b) throw new Error('no existe #' + i); b.click(); }, id);
const qa = (fn, ...a) => page.evaluate(([f, args]) => window.qa[f](...args), [fn, a]);
const proyecto = () => qa('proyecto');
const filas = () => page.evaluate(() => [...document.querySelectorAll('#sim-funcionando .fila-sim')]
	.map((f) => f.textContent.replace(/\s+/g, ' ').trim()));

/** Saca un aparato del catálogo por su nombre, como quien lo busca en la lista. */
async function sacarDelCatalogo(nombre) {
	const b = page.locator('#catalogo button', { hasText: nombre }).first();
	if (!(await b.count())) return undefined;
	const antes = (await proyecto()).dispositivos.map((d) => d.id);
	await b.click({ force: true });
	await page.waitForTimeout(450);
	const despues = (await proyecto()).dispositivos;
	return despues.find((d) => !antes.includes(d.id));
}

/**
 * Cablea dos bornes tocándolos en el 3D, exactamente como el usuario: un clic en uno y otro
 * clic en el otro. Nada de meter conductores por debajo.
 */
async function cablear(deId, deBorne, aId, aBorne) {
	const bornes = await qa('bornes');
	const p1 = bornes.find((b) => b.dispositivo === deId && b.borne === deBorne);
	const p2 = bornes.find((b) => b.dispositivo === aId && b.borne === aBorne);
	if (!p1 || !p2) return { ok: false, motivo: `no se ven los bornes ${deBorne}/${aBorne}` };
	const antes = (await proyecto()).conductores.length;
	await page.mouse.click(p1.x, p1.y); await page.waitForTimeout(160);
	await page.mouse.click(p2.x, p2.y); await page.waitForTimeout(260);
	const ahora = (await proyecto()).conductores.length;
	return { ok: ahora > antes, motivo: ahora > antes ? '' : 'el clic no tendió cable' };
}

/**
 * Cablea desde el formulario del panel derecho, la segunda vía que ofrece el programa
 * («toca un borne y luego otro. O usa el formulario de abajo»).
 *
 * Hace falta de verdad, no es un atajo de la prueba: un contactor de 45 mm lleva diez bornes, y
 * con el tablero entero encuadrado quedan a OCHO PÍXELES unos de otros. Ahí no se acierta a
 * clic —ni en la prueba ni con la mano— sin acercar la cámara. El formulario los nombra, así que
 * es el camino natural para los aparatos apretados.
 */
async function cablearPorPanel(deId, deBorne, aId, aBorne) {
	const antes = (await proyecto()).conductores.length;
	await page.evaluate((id) => window.qa.seleccionarPorId(id), deId);
	await page.waitForTimeout(220);
	const puesto = await page.evaluate(([bo, dest, bd]) => {
		const sel = (id) => document.getElementById(id);
		const origen = sel('cable-borne-origen');
		const destino = sel('cable-destino');
		const borneDestino = sel('cable-borne-destino');
		const boton = sel('btn-conectar');
		if (!origen || !destino || !borneDestino || !boton) return 'no está el formulario';
		if (![...origen.options].some((o) => o.value === bo)) return `el origen no tiene el borne ${bo}`;
		origen.value = bo;
		if (![...destino.options].some((o) => o.value === dest)) return 'el destino no está en la lista';
		destino.value = dest;
		destino.dispatchEvent(new Event('change', { bubbles: true }));
		if (![...borneDestino.options].some((o) => o.value === bd)) return `el destino no tiene el borne ${bd}`;
		borneDestino.value = bd;
		boton.click();
		return '';
	}, [deBorne, aId, aBorne]);
	await page.waitForTimeout(280);
	const ahora = (await proyecto()).conductores.length;
	return { ok: !puesto && ahora > antes, motivo: puesto || (ahora > antes ? '' : 'no se creó el cable') };
}

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1500);
await click('btn-cerrar-ayuda'); await page.waitForTimeout(200);

/* =============== 1. El catálogo tiene con qué =============== */
console.log('--- 1. En el catálogo hay de dónde sacar la tensión y qué encender ---');
await click('btn-empezar-blanco'); await page.waitForTimeout(400);
must('la placa arranca vacía', (await proyecto()).dispositivos.length === 0);

const catalogo = await page.evaluate(() => [...document.querySelectorAll('#catalogo button')]
	.map((b) => b.textContent.replace(/\s+/g, ' ').trim()));
must('hay una ACOMETIDA para meter tensión al tablero', catalogo.some((t) => /Acometida/i.test(t)),
	catalogo.filter((t) => /Acometida/i.test(t)).join(' · '));
must('hay una AMPOLLETA que encender', catalogo.some((t) => /Ampolleta/i.test(t)));
must('hay un MOTOR que arrancar', catalogo.some((t) => /^Motor/i.test(t)));

/* =============== 2. El circuito más simple: red → disyuntor → ampolleta =============== */
console.log('\n--- 2. Red → disyuntor → ampolleta, montado a clics ---');
const red = await sacarDelCatalogo('Acometida 220 V');
const q1 = await sacarDelCatalogo('Disyuntor 2P C6');
const lampara = await sacarDelCatalogo('Ampolleta 220 V');
must('entra la acometida', !!red, red?.designacion);
must('entra el disyuntor', !!q1, q1?.designacion);
must('entra la ampolleta', !!lampara, lampara?.designacion);
must('la acometida NO ocupa sitio en la placa (es de campo)', await page.evaluate((id) =>
	!window.qa.proyecto().gabinete.colocaciones.some((c) => c.dispositivoId === id), red.id));
must('el disyuntor SÍ va sobre un riel', await page.evaluate((id) =>
	!!window.qa.proyecto().gabinete.colocaciones.find((c) => c.dispositivoId === id)?.rielId, q1.id));

await click('modo-trabajo'); await page.waitForTimeout(400);
await click('btn-centrar'); await page.waitForTimeout(700);

const tramos = [
	['la fase de la red entra al disyuntor', red.id, 'L', q1.id, '1'],
	['el neutro de la red entra al disyuntor', red.id, 'N', q1.id, '3'],
	['la salida de fase va a la ampolleta', q1.id, '2', lampara.id, 'L'],
	['el neutro sale del disyuntor a la ampolleta', q1.id, '4', lampara.id, 'N'],
];
for (const [nombre, a, ba, b, bb] of tramos) {
	const r = await cablear(a, ba, b, bb);
	must(nombre, r.ok, r.motivo);
}

console.log('\n--- 3. Se energiza y la ampolleta PRENDE ---');
await click('btn-energizar'); await page.waitForTimeout(800);
must('aparece el panel de simulación', await page.isVisible('#seccion-simulacion'));
const conLampara = await filas();
must('la ampolleta aparece ENCENDIDA', conLampara.some((f) => /encendid/i.test(f)),
	conLampara.join(' | ') || '(no funciona nada)');
must('y hay cables con tensión', (await qa('simulacion')).conductoresVivos > 0,
	`${(await qa('simulacion')).conductoresVivos} cables`);
await page.screenshot({ path: join(SAL, 'ampolleta-encendida.png') });

// Y se apaga al abrir la protección: si no, no estaría encendida por el circuito sino por magia.
console.log('\n--- 4. Al abrir el disyuntor se apaga (el circuito es de verdad) ---');
await qa('accionar', q1.id); await page.waitForTimeout(600);
must('con el disyuntor abierto la ampolleta se apaga',
	!(await filas()).some((f) => /encendid/i.test(f)), (await filas()).join(' | '));
await qa('accionar', q1.id); await page.waitForTimeout(600);
must('al rearmarlo vuelve a prender', (await filas()).some((f) => /encendid/i.test(f)));
await click('btn-energizar'); await page.waitForTimeout(400);

/* =============== 3. Un motor con su contactor y su pulsador =============== */
console.log('\n--- 5. Arranque de motor: contactor, marcha y motor trifásico ---');
await click('modo-editor'); await page.waitForTimeout(300);
const km = await sacarDelCatalogo('Contactor 3P 9A');
const s1 = await sacarDelCatalogo('Pulsador marcha/paro');
const motor = await sacarDelCatalogo('Motor 3F 380 V');
const red3 = await sacarDelCatalogo('Acometida 380 V');
must('entra el contactor', !!km, km?.designacion);
must('entra el pulsador', !!s1, s1?.designacion);
must('entra el motor trifásico', !!motor, motor?.designacion);
must('entra la acometida trifásica', !!red3, red3?.designacion);

await click('modo-trabajo'); await page.waitForTimeout(400);
await click('btn-centrar'); await page.waitForTimeout(800);

/*
 * Los diez bornes del contactor caben en 45 mm: con el tablero entero encuadrado quedan a ocho
 * píxeles unos de otros y no se acierta a clic sin acercar la cámara. Este circuito se cablea
 * por el formulario del panel, que es lo que hace uno cuando el aparato viene apretado. Que el
 * clic funciona ya lo ha demostrado el circuito de la ampolleta, cuyos bornes van holgados.
 */
const potencia = [
	['L1 de la red al contactor', red3.id, 'L1', km.id, '1/L1'],
	['L2 de la red al contactor', red3.id, 'L2', km.id, '3/L2'],
	['L3 de la red al contactor', red3.id, 'L3', km.id, '5/L3'],
	['salida T1 del contactor al motor', km.id, '2/T1', motor.id, 'U'],
	['salida T2 del contactor al motor', km.id, '4/T2', motor.id, 'V'],
	['salida T3 del contactor al motor', km.id, '6/T3', motor.id, 'W'],
];
// Mando: fase → pulsador de marcha (contacto NA 13-14) → bobina A1, y A2 al neutro.
const mando = [
	['fase de mando al pulsador de marcha', red3.id, 'L1', s1.id, '13'],
	['del pulsador a la bobina del contactor', s1.id, '14', km.id, 'A1'],
	['la bobina vuelve al neutro', km.id, 'A2', red3.id, 'N'],
];
for (const [nombre, a, ba, b, bb] of [...potencia, ...mando]) {
	const r = await cablearPorPanel(a, ba, b, bb);
	must(nombre, r.ok, r.motivo);
}
const cablesMotor = (await proyecto()).conductores.length;
must('quedan cableados los nueve tramos del arranque', cablesMotor >= 13, `${cablesMotor} cables en total`);

console.log('\n--- 6. Se energiza, se pulsa MARCHA y el motor GIRA ---');
await click('btn-energizar'); await page.waitForTimeout(800);
must('el motor NO arranca solo al dar tensión',
	!(await filas()).some((f) => /girando/i.test(f)), (await filas()).join(' | '));
await qa('accionar', s1.id); await page.waitForTimeout(700);
const arrancado = await filas();
must('al pulsar MARCHA el motor GIRA', arrancado.some((f) => /girando/i.test(f)),
	arrancado.join(' | ') || '(no funciona nada)');
must('y el contactor aparece con la bobina metida', arrancado.some((f) => /bobina/i.test(f)),
	arrancado.join(' | '));
await page.screenshot({ path: join(SAL, 'motor-girando.png') });

await qa('accionar', s1.id); await page.waitForTimeout(700);
must('sin enclavamiento, al soltar el pulsador el motor se para',
	!(await filas()).some((f) => /girando/i.test(f)), (await filas()).join(' | '));

console.log('\n--- 7. Sin errores ---');
must('ningún error de JavaScript en todo el montaje', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close(); server.close();
console.log(`\n=== ${fallos === 0 ? 'TODO OK ✔' : fallos + ' FALLO(S) ✗'} ===`);
process.exit(fallos === 0 ? 0 : 1);
