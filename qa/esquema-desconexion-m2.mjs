/** Recorrido visible M2: inspeccionar y desconectar un conductor real desde el esquema. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { abrirNavegador, esperarEditorListo, servidorDeQA, trabajarSobreCopia } from './lib/entorno.mjs';

const { servidor, url } = await servidorDeQA();
let browser;
let page;
const errores = [];

const proyecto = () => page.evaluate(() => window.qa.proyecto());
const tieneConductor = (id) => page.evaluate((cid) =>
	window.qa.proyecto().conductores.some((c) => c.id === cid), id);

async function buscarHilo(id) {
	const texto = await page.locator('#esq-indicador').textContent();
	const total = Number(texto?.split('/')[1]?.trim());
	assert.ok(total > 0, `el esquema no tiene hojas: ${texto}`);
	for (let i = 1; i < total; i++) await page.locator('#esq-anterior').click();
	for (let i = 0; i < total; i++) {
		const grupos = page.locator('#esquema-hoja .hilo[data-conductor]');
		const ids = await grupos.evaluateAll((nodos) => nodos.map((n) => n.getAttribute('data-conductor')));
		const indice = id === undefined ? (ids.length ? 0 : -1) : ids.indexOf(id);
		if (indice >= 0) return grupos.nth(indice);
		if (i < total - 1) await page.locator('#esq-siguiente').click();
	}
	throw new Error(`el conductor ${id ?? '(cualquiera)'} no tiene trazo seleccionable en ninguna hoja`);
}

async function seleccionarHilo(grupo) {
	const id = await grupo.getAttribute('data-conductor');
	assert.ok(id);
	const punto = await grupo.evaluate((g) => {
		const trazo = g.querySelector('path.hilo-agarre');
		const matriz = trazo?.getScreenCTM();
		if (!trazo || !matriz) return null;
		const largo = trazo.getTotalLength();
		for (let i = 1; i < 20; i++) {
			const p = trazo.getPointAtLength((i / 20) * largo);
			const q = new DOMPoint(p.x, p.y).matrixTransform(matriz);
			const encima = document.elementFromPoint(q.x, q.y);
			if (encima === trazo || encima?.closest('.hilo[data-conductor]') === g) return { x: q.x, y: q.y };
		}
		return null;
	});
	assert.ok(punto, `no hay un punto visible para pinchar el conductor ${id}`);
	await page.mouse.click(punto.x, punto.y);
	await page.locator('#esq-desconectar').waitFor({ state: 'visible' });
	return id;
}

try {
	browser = await abrirNavegador(chromium);
	page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
	page.on('pageerror', (e) => errores.push(e.message));
	page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/i.test(m.text())) errores.push(m.text()); });
	await page.goto(`${url}/?qa=1&inicio=0`, { waitUntil: 'domcontentloaded' });
	await esperarEditorListo(page);
	await page.locator('#btn-cerrar-ayuda').click();
	await page.locator('#btn-empezar-ejemplo').click();
	await page.locator('.tarjeta-ejemplo button').first().click();
	if (await page.locator('#modal-dialogo').isVisible()) await page.locator('#dialogo-ok').click();
	await page.waitForFunction(() => window.qa.proyecto().esEjemplo === true);
	if (await page.locator('#modal-explicacion').isVisible()) await page.locator('#btn-cerrar-explicacion').click();

	await page.locator('#btn-esquema').click();
	const id = await seleccionarHilo(await buscarHilo());
	const ejemplo = await proyecto();
	assert.ok(ejemplo.conductores.length >= 2, 'el fixture necesita más de un conductor para detectar borrado lateral');
	const conductor = ejemplo.conductores.find((c) => c.id === id);
	assert.ok(conductor);
	const inspector = await page.locator('#esq-ayuda').textContent();
	assert.ok(inspector.includes(id) && inspector.includes(conductor.de.borneId)
		&& inspector.includes(conductor.a.borneId), `el inspector no identifica los extremos: ${inspector}`);
	console.log(`OK inspección de ${id} y sus bornes en ejemplo de solo lectura`);
	await page.locator('#esq-desconectar').click();
	assert.ok(await page.locator('#modal-dialogo').isHidden(), 'se pidió confirmar una edición vetada');
	assert.ok(await tieneConductor(id), 'se alteró el ejemplo de solo lectura');
	console.log('OK ejemplo inspeccionable, sin confirmación ni mutación');

	await page.locator('#esq-cerrar').click();
	assert.equal(await trabajarSobreCopia(page), true, 'no se creó la copia editable');
	assert.ok(await tieneConductor(id), 'la copia perdió el conductor de prueba');
	const antes = await proyecto();
	const otrosIds = antes.conductores.filter((c) => c.id !== id).map((c) => c.id).sort();
	await page.locator('#btn-esquema').click();
	await seleccionarHilo(await buscarHilo(id));
	await page.locator('#esq-desconectar').click();
	assert.ok(await page.locator('#modal-dialogo').isVisible(), 'falta confirmación de desconexión');
	const pregunta = await page.locator('#dialogo-msg').textContent();
	assert.ok(pregunta.includes(id) && pregunta.includes(conductor.de.borneId)
		&& pregunta.includes(conductor.a.borneId), `la confirmación omite datos afectados: ${pregunta}`);
	await page.locator('#dialogo-cancelar').click();
	assert.ok(await tieneConductor(id), 'cancelar quitó el conductor');
	console.log('OK cancelación conserva la conexión');

	await page.locator('#esq-desconectar').click();
	await page.locator('#dialogo-ok').click();
	await page.waitForFunction((cid) => !window.qa.proyecto().conductores.some((c) => c.id === cid), id);
	assert.deepEqual((await proyecto()).conductores.map((c) => c.id).sort(), otrosIds,
		'desconectar cambió otro conductor');
	assert.ok(await page.locator('#esq-desconectar').isHidden(), 'el inspector conservó el conductor eliminado');
	console.log('OK desconexión por ID desde el esquema');

	await page.keyboard.press('Control+z');
	await page.waitForFunction((cid) => window.qa.proyecto().conductores.some((c) => c.id === cid), id);
	assert.deepEqual((await proyecto()).conductores.find((c) => c.id === id), conductor,
		'deshacer no restauró los datos del conductor');
	await buscarHilo(id);
	await page.keyboard.press('Control+y');
	await page.waitForFunction((cid) => !window.qa.proyecto().conductores.some((c) => c.id === cid), id);
	console.log('OK Ctrl+Z/Y restaura y vuelve a quitar el mismo conductor');

	await page.evaluate(() => window.qa.esperarPersistencia());
	await page.reload({ waitUntil: 'domcontentloaded' });
	await esperarEditorListo(page);
	assert.ok(!(await tieneConductor(id)), 'el conductor reapareció tras guardar y reabrir');
	assert.deepEqual((await proyecto()).conductores.map((c) => c.id).sort(), otrosIds,
		'la reapertura perdió otros conductores');
	await page.locator('#btn-esquema').click();
	assert.ok(Number((await page.locator('#esq-indicador').textContent())?.split('/')[1]?.trim()) > 0,
		'el esquema no se reabrió con hojas');
	const ausente = await buscarHilo(id).then(() => false, () => true);
	assert.ok(ausente, 'el esquema reabierto dibuja el conductor eliminado');
	assert.deepEqual(errores, [], `errores JavaScript: ${errores.join(' | ')}`);
	console.log('OK guardado/reapertura y sin errores JavaScript');
} finally {
	await browser?.close();
	await new Promise((resolve) => servidor.close(resolve));
}
