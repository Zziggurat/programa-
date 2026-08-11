/**
 * QA de los controladores reales: comprueba que se pueden colocar desde el catálogo, que
 * sus borneras quedan donde dice la ficha de datos, que se cablean por terminal y que el
 * modelo 3D no se rompe con ninguno de los doce equipos.
 *
 *   node qa/controladores.mjs
 */
import { chromium } from 'playwright-core';

import { join } from 'node:path';
import { abrirNavegador, servidorDeQA } from './lib/entorno.mjs';

const { servidor: server } = await servidorDeQA();
const url = `http://127.0.0.1:${server.address().port}/?qa=1&inicio=0`;

const browser = await abrirNavegador(chromium);
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|Not Found/i.test(m.text())) errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

let fallos = 0;
const must = (n, c, extra = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${extra ? ' → ' + extra : ''}`); };
const jsClick = (id) => page.evaluate((i) => {
	const b = document.getElementById(i);
	if (!b) throw new Error(`No existe el botón #${i}`); // un id mal escrito falsearía la prueba
	b.click();
}, id);
const qa = (fn, ...a) => page.evaluate(([f, args]) => window.qa[f](...args), [fn, a]);

/** Vacía la placa como haría el usuario con «Nuevo» (el diálogo pide confirmación). */
async function empezarDeCero() {
	await jsClick('btn-nuevo');
	await page.waitForTimeout(250);
	if (await page.isVisible('#modal-dialogo')) {
		await page.click('#dialogo-ok');
		await page.waitForTimeout(500);
	}
	await page.waitForTimeout(300);
}

await page.goto(url, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
await jsClick('btn-cerrar-ayuda'); await page.waitForTimeout(120);

console.log('\n--- 1. Los controladores están en el catálogo ---');
await empezarDeCero();

const catalogo = await page.evaluate(() =>
	[...document.querySelectorAll('#catalogo .item-catalogo')].map((b) => ({
		nombre: b.querySelector('.nombre')?.textContent ?? '',
		title: b.title,
	})));
const marcas = ['Honeywell', 'Schneider', 'Siemens', 'JCI'];
for (const m of marcas) {
	const n = catalogo.filter((c) => c.nombre.includes(m)).length;
	must(`hay controladores de ${m}`, n >= 3, `${n}`);
}
const spyder = catalogo.find((c) => c.title.includes('PUB6438S'));
must('el top 1 de Honeywell (Spyder PUB6438S) está en el catálogo', !!spyder);
must('el catálogo dice de dónde salen las medidas', !!spyder && /hoja de datos|NOMINALES/i.test(spyder.title),
	spyder?.title.split('\n').pop());

console.log('\n--- 2. Se coloca y sus borneras caen donde dice la ficha ---');
const buscar = async (texto) => {
	await page.fill('#buscar-catalogo', texto); await page.waitForTimeout(200);
	const btn = page.locator('#catalogo .item-catalogo').first();
	await btn.click(); await page.waitForTimeout(400);
};
await buscar('PUB6438S');

const p1 = await qa('proyecto');
const ctrl = p1.dispositivos.find((d) => d.referencia === 'PUB6438S');
must('el controlador se coloca en la placa', !!ctrl);
must('lleva sus borneras declaradas', (ctrl?.terminales?.length ?? 0) >= 5, String(ctrl?.terminales?.length));
must('lleva todos sus terminales reales', (ctrl?.bornes?.length ?? 0) >= 30, String(ctrl?.bornes?.length));
must('lleva su fondo real de catálogo', ctrl?.profundidad === 57, String(ctrl?.profundidad));
const col = p1.gabinete.colocaciones.find((c) => c.dispositivoId === ctrl.id);
must('la huella es la de la hoja de datos (138 × 174 mm)', col?.ancho === 138 && col?.alto === 174,
	`${col?.ancho}×${col?.alto}`);

// Los anclajes de los bornes deben caer dentro de la huella y en el borde que toca.
const anclajes = await page.evaluate(([id, bornes]) =>
	bornes.map((b) => ({ b, a: window.qa.anclaje(id, b) })), [ctrl.id, ['UI1', 'DO1', '24V~', 'AOC']]);
const dentro = anclajes.every(({ a }) => a && a.x >= col.x && a.x <= col.x + col.ancho
	&& a.y >= col.y && a.y <= col.y + col.alto);
must('cada terminal se ancla dentro de la huella del equipo', dentro, JSON.stringify(anclajes));
const ui1 = anclajes.find((x) => x.b === 'UI1').a;
const do1 = anclajes.find((x) => x.b === 'DO1').a;
const v24 = anclajes.find((x) => x.b === '24V~').a;
must('UI1 está en la bornera de arriba', Math.abs(ui1.y - (col.y + 6)) < 0.01, String(ui1.y - col.y));
must('DO1 está en la bornera de la derecha', Math.abs(do1.x - (col.x + col.ancho - 6)) < 0.01, String(do1.x - col.x));
must('24V~ está en la bornera de la izquierda', Math.abs(v24.x - (col.x + 6)) < 0.01, String(v24.x - col.x));
must('dos terminales distintos no comparten punto', ui1.x !== do1.x || ui1.y !== do1.y);

console.log('\n--- 3. Se cablea por terminal como cualquier aparato ---');
await jsClick('modo-trabajo'); await page.waitForTimeout(300);
const antes = (await qa('proyecto')).conductores.length;
await qa('conectar', ctrl.id, 'UI1', ctrl.id, 'UIC1');
await page.waitForTimeout(250);
const p2 = await qa('proyecto');
must('se crea el conductor entre dos terminales del controlador', p2.conductores.length === antes + 1);
const cable = p2.conductores[p2.conductores.length - 1];
must('el cable enlaza los terminales pedidos',
	cable.de.borneId === 'UI1' && cable.a.borneId === 'UIC1',
	`${cable.de.borneId}→${cable.a.borneId}`);

console.log('\n--- 4. Los doce controladores se dibujan sin romper nada ---');
await empezarDeCero();
await jsClick('modo-editor'); await page.waitForTimeout(200);
const referencias = await page.evaluate(() => window.qa.controladores());
must('la app expone las doce fichas', referencias.length >= 12, String(referencias.length));
let colocados = 0;
for (const ref of referencias) {
	await page.fill('#buscar-catalogo', ref); await page.waitForTimeout(140);
	const n = await page.locator('#catalogo .item-catalogo').count();
	if (n === 0) { must(`«${ref}» aparece al buscarlo`, false); continue; }
	await page.locator('#catalogo .item-catalogo').first().click();
	await page.waitForTimeout(220);
	colocados++;
}
must('se colocan los doce controladores seguidos', colocados === referencias.length, `${colocados}/${referencias.length}`);
const p3 = await qa('proyecto');
must('todos quedan en el proyecto', p3.dispositivos.length >= referencias.length, String(p3.dispositivos.length));
const sinSitio = await page.evaluate((ids) => ids.flatMap((id) => {
	const d = window.qa.proyecto().dispositivos.find((x) => x.id === id);
	if (!d?.terminales) return [];
	return d.bornes.filter((b) => !window.qa.anclaje(id, b.id)).map((b) => `${d.referencia}:${b.id}`);
}), p3.dispositivos.map((d) => d.id));
must('ningún terminal se queda sin anclaje', sinSitio.length === 0, sinSitio.slice(0, 6).join(', '));

console.log('\n--- 5. Controlador a medida (el que no está en el catálogo) ---');
await empezarDeCero();
await jsClick('btn-controlador-medida'); await page.waitForTimeout(250);
must('se abre el diálogo del controlador a medida', await page.isVisible('#modal-controlador'));

// Sin referencia no debe crear nada: avisa y se queda abierto.
await jsClick('btn-crear-controlador'); await page.waitForTimeout(200);
must('sin modelo no crea nada y avisa', await page.isVisible('#ctrl-aviso') && await page.isVisible('#modal-controlador'));

await page.fill('#ctrl-fabricante', 'Honeywell');
await page.fill('#ctrl-referencia', 'CIPer-XX');
await page.fill('#ctrl-ancho', '160');
await page.fill('#ctrl-alto', '120');
await page.fill('#ctrl-fondo', '62');
await page.fill('#ctrl-arriba', 'UI1-8, COM');
await page.fill('#ctrl-abajo', 'DO1-6, DOC');
await page.fill('#ctrl-izquierda', '24V~, 24V COM, GND');
await page.fill('#ctrl-derecha', 'MS/TP+, MS/TP-, SHLD');
await jsClick('btn-crear-controlador'); await page.waitForTimeout(500);

must('el diálogo se cierra al crearlo', !(await page.isVisible('#modal-controlador')));
const pm = await qa('proyecto');
const medida = pm.dispositivos.find((d) => d.referencia === 'CIPer-XX');
must('el controlador a medida queda en el proyecto', !!medida);
must('el rango UI1-8 se expandió a ocho terminales',
	(medida?.bornes ?? []).filter((b) => /^UI\d$/.test(b.id)).length === 8);
must('«24V COM» quedó como UN terminal, no dos',
	(medida?.bornes ?? []).some((b) => b.id === '24V COM'));
must('«MS/TP-» no se confundió con un rango',
	(medida?.bornes ?? []).some((b) => b.id === 'MS/TP-'));
must('GND se reconoce como tierra', (medida?.bornes ?? []).find((b) => b.id === 'GND')?.tipo === 'PE');
must('lleva el fondo indicado', medida?.profundidad === 62, String(medida?.profundidad));
const colM = pm.gabinete.colocaciones.find((c) => c.dispositivoId === medida.id);
must('lleva la huella indicada', colM?.ancho === 160 && colM?.alto === 120, `${colM?.ancho}×${colM?.alto}`);
const sinAnclaje = await page.evaluate((id) => {
	const d = window.qa.proyecto().dispositivos.find((x) => x.id === id);
	return d.bornes.filter((b) => !window.qa.anclaje(id, b.id)).map((b) => b.id);
}, medida.id);
must('todos sus terminales tienen anclaje', sinAnclaje.length === 0, sinAnclaje.join(', '));

console.log('\n--- 6. Coherencia ---');
must('sin errores de JavaScript', errs.length === 0, errs.slice(0, 3).join(' | '));

await page.screenshot({ path: 'qa/_controladores.png' });
console.log(fallos ? `\n=== ${fallos} FALLO(S) ===` : '\n=== TODO OK ✔ ===');
await browser.close();
server.close();
process.exit(fallos ? 1 : 0);
