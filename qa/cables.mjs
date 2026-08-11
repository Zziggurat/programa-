/**
 * QA automático del sistema de cables de TableroStudio.
 * Arranca la app compilada (app/dist) con la sonda «?qa=1&inicio=0» y comprueba, sobre el 3D real:
 * cero cables fantasma, conexión por clic, codos, arrastre, uniones y borrado.
 *
 *   node qa/cables.mjs
 */
import { chromium } from 'playwright-core';

import { join } from 'node:path';
import { abrirNavegador, servidorDeQA, RAIZ } from './lib/entorno.mjs';

const { servidor: server } = await servidorDeQA();
const url = `http://127.0.0.1:${server.address().port}/?qa=1&inicio=0`;

const browser = await abrirNavegador(chromium);
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|Not Found/i.test(m.text())) errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

let fallos = 0;
const must = (n, c, extra = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${extra ? ' → ' + extra : ''}`); };
// Zona del lienzo realmente pinchable: los paneles laterales y la barra lo tapan por encima.
const LIBRE = { x0: 316, x1: 1280 - 310, y0: 60, y1: 860 - 80 };
const enZonaLibre = (p) => p && p.x > LIBRE.x0 && p.x < LIBRE.x1 && p.y > LIBRE.y0 && p.y < LIBRE.y1;
const jsClick = (id) => page.evaluate((i) => document.getElementById(i)?.click(), id);
const qa = (fn, ...a) => page.evaluate(([f, args]) => window.qa[f](...args), [fn, a]);
const proyecto = () => qa('proyecto');
const nConductores = async () => (await proyecto()).conductores.length;
const toast = async () => (await page.isVisible('#toast')) ? (await page.textContent('#toast')) : '';
const cursor = () => page.evaluate(() => getComputedStyle(document.querySelector('#escena canvas')).cursor);

/** Carga el tablero de control de la biblioteca (el que usan estas comprobaciones). */
async function cargarEjemplo() {
	await jsClick('btn-empezar-ejemplo'); await page.waitForTimeout(300);
	if (await page.isVisible('#modal-ejemplos')) {
		await page.locator('.tarjeta-ejemplo button').nth(2).click(); await page.waitForTimeout(650);
if (await page.isVisible('#modal-dialogo')) { await page.evaluate(() => document.getElementById('dialogo-ok')?.click()); await page.waitForTimeout(300); }
		await jsClick('btn-cerrar-explicacion'); await page.waitForTimeout(150);
	}
}

await page.goto(url, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
await jsClick('btn-cerrar-ayuda'); await page.waitForTimeout(120);
await cargarEjemplo();
await jsClick('modo-trabajo'); await page.waitForTimeout(350);

console.log('\n--- 1. Cables fantasma ---');
const total = await nConductores();
const dibujados = await qa('cablesDibujados');
must('todos los cables del proyecto se dibujan en 3D (0 fantasmas)', dibujados === total, `${dibujados}/${total}`);

console.log('\n--- 2. Bornes y conexión por clic ---');
const todos = await qa('bornes');
const bornes = todos.filter(enZonaLibre);
must('hay bornes clicables en la zona de trabajo', bornes.length > 5, `${bornes.length} de ${todos.length}`);
const disp = new Set(todos.map((b) => b.dispositivo));
must('los aparatos de campo también tienen bornes clicables', disp.size >= 6, `${disp.size} aparatos`);
await page.mouse.move(bornes[0].x, bornes[0].y);
must('el borne bajo el ratón muestra cursor de mira', (await cursor()) === 'crosshair');

// Buscar un par de bornes de distinto aparato sin conectar.
const p0 = await proyecto();
const conn = new Set(p0.conductores.flatMap((c) => [
	`${c.de.dispositivoId}:${c.de.borneId}|${c.a.dispositivoId}:${c.a.borneId}`,
	`${c.a.dispositivoId}:${c.a.borneId}|${c.de.dispositivoId}:${c.de.borneId}`]));
let par;
for (let i = 0; i < bornes.length && !par; i++)
	for (let j = i + 1; j < bornes.length; j++) {
		if (bornes[i].dispositivo === bornes[j].dispositivo) continue;
		if (conn.has(`${bornes[i].dispositivo}:${bornes[i].borne}|${bornes[j].dispositivo}:${bornes[j].borne}`)) continue;
		if (Math.hypot(bornes[i].x - bornes[j].x, bornes[i].y - bornes[j].y) < 40) continue;
		par = [bornes[i], bornes[j]]; break;
	}
must('hay un par de bornes libres para la prueba', !!par);

// Se apunta al punto del borne que de verdad está despejado (si un cable le cruza por delante,
// el clic ahí sería para el cable: manda lo que se ve encima).
for (const b of par) {
	const p = await qa('puntoParaBorne', b.dispositivo, b.borne);
	if (p) { b.x = p.x; b.y = p.y; }
}

const n0 = await nConductores();
await page.mouse.click(par[0].x, par[0].y); await page.waitForTimeout(200);
must('tocar un borne inicia el cableado', /otro borne/i.test(await toast()));
await page.mouse.click(par[1].x, par[1].y); await page.waitForTimeout(300);
must('tocar el 2º borne crea el cable', (await nConductores()) === n0 + 1);
must('el cable nuevo se dibuja (sigue sin fantasmas)', (await qa('cablesDibujados')) === n0 + 1);

console.log('\n--- 3. Codos al tender (estilo Tinkercad) ---');
const n1 = await nConductores();
let par2;
const conn2 = new Set((await proyecto()).conductores.flatMap((c) => [
	`${c.de.dispositivoId}:${c.de.borneId}|${c.a.dispositivoId}:${c.a.borneId}`,
	`${c.a.dispositivoId}:${c.a.borneId}|${c.de.dispositivoId}:${c.de.borneId}`]));
for (let i = 0; i < bornes.length && !par2; i++)
	for (let j = i + 1; j < bornes.length; j++) {
		if (bornes[i].dispositivo === bornes[j].dispositivo) continue;
		if (conn2.has(`${bornes[i].dispositivo}:${bornes[i].borne}|${bornes[j].dispositivo}:${bornes[j].borne}`)) continue;
		if (Math.hypot(bornes[i].x - bornes[j].x, bornes[i].y - bornes[j].y) < 60) continue;
		par2 = [bornes[i], bornes[j]]; break;
	}
if (par2) {
	for (const b of par2) {
		const p = await qa('puntoParaBorne', b.dispositivo, b.borne);
		if (p) { b.x = p.x; b.y = p.y; }
	}
	await page.mouse.click(par2[0].x, par2[0].y); await page.waitForTimeout(150);
	const medio = { x: (par2[0].x + par2[1].x) / 2, y: (par2[0].y + par2[1].y) / 2 + 60 };
	await page.mouse.click(medio.x, medio.y); await page.waitForTimeout(150);   // codo 1
	await page.mouse.click(medio.x + 40, medio.y); await page.waitForTimeout(150); // codo 2
	await page.mouse.click(par2[1].x, par2[1].y); await page.waitForTimeout(300);
	const nuevo = (await proyecto()).conductores.at(-1);
	must('el cable se crea con los codos marcados', (await nConductores()) === n1 + 1 && (nuevo.trazado?.length ?? 0) === 2,
		`trazado=${nuevo.trazado?.length ?? 0}`);
}

console.log('\n--- 4. Duplicados, Esc y clic derecho ---');
const n2 = await nConductores();
await page.mouse.click(par[0].x, par[0].y); await page.waitForTimeout(150);
await page.mouse.click(par[1].x, par[1].y); await page.waitForTimeout(250);
must('no duplica un cable ya existente', (await nConductores()) === n2, await toast());
await page.mouse.click(par[0].x, par[0].y); await page.waitForTimeout(150);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
must('Esc cancela el cableado en curso', (await nConductores()) === n2);

console.log('\n--- 5. Seleccionar, unión, arrastre y borrado de un cable ---');
const idCable = (await proyecto()).conductores[0].id;
const pc = (await qa('puntosDeCable', idCable)).find(enZonaLibre);
must('se localiza el tubo de un cable en pantalla', !!pc);
if (pc) {
	await page.mouse.click(pc.x, pc.y); await page.waitForTimeout(250);
	const selTxt = await page.textContent('#panel-der');
	must('clic izquierdo selecciona el cable', /Cable/.test(selTxt));
	const puntos0 = ((await proyecto()).conductores.find((c) => c.id === idCable).trazado ?? []).length;
	// Las uniones se crean con DOBLE clic (izquierdo o derecho). Un solo clic no crea nada:
	// así mover un cable no llena el tablero de puntos sin querer.
	await page.mouse.click(pc.x, pc.y, { button: 'right' }); await page.waitForTimeout(250);
	must('un solo clic derecho NO crea unión',
		((await proyecto()).conductores.find((c) => c.id === idCable).trazado ?? []).length === puntos0);
	await page.mouse.dblclick(pc.x, pc.y); await page.waitForTimeout(350);
	const puntos1 = ((await proyecto()).conductores.find((c) => c.id === idCable).trazado ?? []).length;
	must('doble clic crea una unión', puntos1 === puntos0 + 1, `${puntos0}→${puntos1}`);

	// Arrastrar la unión recién creada: debe moverse (cambian sus coordenadas).
	const antes = JSON.stringify((await proyecto()).conductores.find((c) => c.id === idCable).trazado);
	// Se agarra por el TIRADOR de la unión, que es lo que se arrastra ahora.
	const pc2 = (await qa('puntoDeUnion', idCable, 0)) ?? pc;
	await page.mouse.move(pc2.x, pc2.y); await page.mouse.down(); await page.waitForTimeout(30);
	for (let k = 1; k <= 4; k++) { await page.mouse.move(pc2.x + 15 * k, pc2.y + 12 * k); await page.waitForTimeout(20); }
	await page.mouse.up(); await page.waitForTimeout(250);
	const despues = JSON.stringify((await proyecto()).conductores.find((c) => c.id === idCable).trazado);
	must('arrastrar mueve la unión', antes !== despues);
	must('arrastrar no añade uniones de más',
		((await proyecto()).conductores.find((c) => c.id === idCable).trazado ?? []).length === puntos1);

	// Ctrl+Z deshace el movimiento.
	await page.keyboard.press('Control+z'); await page.waitForTimeout(250);
	must('Ctrl+Z deshace el movimiento de la unión',
		JSON.stringify((await proyecto()).conductores.find((c) => c.id === idCable)?.trazado) === antes);

	// Supr borra el cable seleccionado.
	const nAntes = await nConductores();
	const pc3 = (await qa('puntosDeCable', idCable)).find(enZonaLibre) ?? pc;
	await page.mouse.click(pc3.x, pc3.y); await page.waitForTimeout(200);
	await page.keyboard.press('Delete'); await page.waitForTimeout(250);
	must('Supr borra el cable seleccionado', (await nConductores()) === nAntes - 1);
	await page.keyboard.press('Control+z'); await page.waitForTimeout(250);
	must('Ctrl+Z recupera el cable borrado', (await nConductores()) === nAntes);
}

console.log('\n--- 6. Coherencia final ---');
must('sigue sin cables fantasma tras todas las operaciones',
	(await qa('cablesDibujados')) === (await nConductores()),
	`${await qa('cablesDibujados')}/${await nConductores()}`);
await page.screenshot({ path: join(RAIZ, 'qa', '_cables.png') });
must('sin errores de JavaScript', errs.length === 0, errs.join(' | '));

await browser.close(); server.close();
console.log(`\n=== ${fallos === 0 ? 'TODO OK ✔' : fallos + ' FALLO(S)'} ===`);
process.exit(fallos === 0 ? 0 : 1);
