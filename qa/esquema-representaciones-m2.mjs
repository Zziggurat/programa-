/** QA M2 focal: identidad gráfica, movimiento/undo, borrado sin aparato y pendientes. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const fixture = {
	formato: 'tablero-studio', version: 1, nombre: 'QA vistas M2',
	gabinete: { ancho: 400, alto: 600, rieles: [], canaletas: [], colocaciones: [] },
	hojas: [
		{ id: 'potencia', numero: 1, titulo: 'Potencia' },
		{ id: 'mando', numero: 2, titulo: 'Mando' },
	],
	dispositivos: [
		{
			id: 'km1', tipo: 'contactor', designacion: '-KM1',
			bornes: ['1/L1', '2/T1', 'A1', 'A2', '13', '14'].map((id) => ({ id })),
			comportamiento: {
				version: 1, clase: 'contactos-electromagneticos',
				bobina: { entrada: 'A1', retorno: 'A2' },
				polos: [{ entrada: '1/L1', salida: '2/T1' }],
				contactos: [{ entrada: '13', salida: '14', reposo: 'abierto', funcion: 'auxiliar' }],
			},
		},
		{ id: 'xp', tipo: 'bornero', bornes: [{ id: 'X1' }, { id: 'X2' }] },
		{ id: 'xm', tipo: 'bornero', bornes: [{ id: 'X1' }] },
	],
	conductores: [
		{ id: 'c-potencia', de: { dispositivoId: 'km1', borneId: '1/L1' },
			a: { dispositivoId: 'xp', borneId: 'X1' } },
		{ id: 'c-mando', de: { dispositivoId: 'km1', borneId: 'A1' },
			a: { dispositivoId: 'xm', borneId: 'X1' } },
		{ id: 'c-entre-hojas', de: { dispositivoId: 'km1', borneId: '13' },
			a: { dispositivoId: 'xp', borneId: 'X2' } },
	],
	esquema: { representaciones: [
		{ id: 'km1-polos', dispositivoId: 'km1', hojaId: 'potencia',
			posicion: { columna: 4, fila: 3 }, parte: { tipo: 'contactos', pares: [
				{ entrada: '1/L1', salida: '2/T1' },
			] } },
		{ id: 'km1-bobina', dispositivoId: 'km1', hojaId: 'mando',
			posicion: { columna: 3, fila: 5 }, parte: { tipo: 'bobina' } },
		{ id: 'km1-aux', dispositivoId: 'km1', hojaId: 'mando',
			posicion: { columna: 6, fila: 3 }, parte: { tipo: 'contactos', pares: [
				{ entrada: '13', salida: '14' },
			] } },
		{ id: 'xp-vista', dispositivoId: 'xp', hojaId: 'potencia',
			posicion: { columna: 7, fila: 4 }, parte: { tipo: 'completa' } },
		{ id: 'xm-vista', dispositivoId: 'xm', hojaId: 'mando',
			posicion: { columna: 7, fila: 4 }, parte: { tipo: 'completa' } },
	] },
};

const { servidor, url } = await servidorDeQA();
let browser;
let page;
const errores = [];
const proyecto = () => page.evaluate(() => window.qa.proyecto());
const vista = (id) => page.evaluate((clave) =>
	window.qa.proyecto().esquema?.representaciones?.find((r) => r.id === clave), id);

async function seleccionarConductor(id) {
	const punto = await page.locator(`.hilo[data-conductor="${id}"]`).evaluate((g) => {
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
}

async function moverVista(id, columnas) {
	const puntos = await page.locator(`.simbolo[data-representacion="${id}"]`).evaluate((g, salto) => {
		const rect = g.querySelector('rect[fill="transparent"]');
		const matriz = g.ownerSVGElement?.getScreenCTM();
		const svg = g.ownerSVGElement;
		if (!rect || !matriz || !svg) return null;
		const x = Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')) / 2;
		const y = Number(rect.getAttribute('y')) + Number(rect.getAttribute('height')) / 2;
		const paso = (svg.viewBox.baseVal.width - 20 - 10) / 10;
		const a = new DOMPoint(x, y).matrixTransform(matriz);
		const b = new DOMPoint(x + paso * salto, y).matrixTransform(matriz);
		return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
	}, columnas);
	assert.ok(puntos, `no se pudo calcular el arrastre de ${id}`);
	await page.mouse.move(puntos.a.x, puntos.a.y);
	await page.mouse.down();
	await page.mouse.move(puntos.b.x, puntos.b.y, { steps: 8 });
	await page.mouse.up();
}

try {
	browser = await abrirNavegador(chromium);
	page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
	page.on('pageerror', (e) => errores.push(e.message));
	page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/i.test(m.text())) errores.push(m.text()); });
	await page.goto(`${url}/?qa=1&inicio=0`, { waitUntil: 'domcontentloaded' });
	await esperarEditorListo(page);
	if (await page.locator('#btn-cerrar-ayuda').isVisible()) await page.locator('#btn-cerrar-ayuda').click();
	await page.evaluate((p) => window.qa.cargarJson(JSON.stringify(p)), fixture);
	await page.waitForFunction(() => window.qa.proyecto().nombre === 'QA vistas M2');
	await page.locator('#btn-esquema').click();
	assert.match(await page.locator('#esq-indicador').textContent(), /Hoja 1 \/ 2/);
	assert.equal(await page.locator('.simbolo[data-representacion="km1-polos"]').count(), 1);
	assert.equal(await page.locator('.simbolo[data-representacion="km1-bobina"]').count(), 0);
	await page.locator('.simbolo[data-representacion="km1-polos"]').click();
	assert.match(await page.locator('#esq-ayuda').textContent(), /Vista km1-polos.*Referencias: bobina \/2\.3/);
	assert.ok(await page.locator('#esq-borrar-representacion').isVisible());
	assert.equal(await page.locator('.hilo[data-conductor="c-potencia"]').count(), 1);
	console.log('OK vistas por ID, hojas estables y referencia cruzada visible');

	await seleccionarConductor('c-potencia');
	assert.ok(await page.locator('#esq-desconectar').isVisible(), 'se perdió la selección de conductor');
	console.log('OK inspector de conductor existente conservado');

	await page.locator('#esq-siguiente').click();
	await page.locator('.simbolo[data-representacion="km1-bobina"]').click();
	assert.match(await page.locator('#esq-ayuda').textContent(), /Vista km1-bobina/);
	await page.evaluate(() => { window.qa.proyecto().esEjemplo = true; });
	await page.locator('#esq-borrar-representacion').click();
	assert.ok(await page.locator('#modal-dialogo').isHidden(), 'se confirmó una edición de solo lectura');
	assert.ok(await vista('km1-bobina'), 'se borró una vista de solo lectura');
	await page.evaluate(() => { delete window.qa.proyecto().esEjemplo; });
	console.log('OK ejemplo inspeccionable sin diálogo de borrado');

	const historialAntes = await page.evaluate(() => window.qa.historial().deshacer);
	await moverVista('km1-bobina', 1);
	await page.waitForFunction(() => window.qa.proyecto().esquema.representaciones
		.find((r) => r.id === 'km1-bobina')?.posicion.columna === 4);
	assert.equal((await vista('km1-bobina')).hojaId, 'mando');
	assert.equal(await page.evaluate(() => window.qa.historial().deshacer), historialAntes + 1);
	await page.keyboard.press('Control+z');
	await page.waitForFunction(() => window.qa.proyecto().esquema.representaciones
		.find((r) => r.id === 'km1-bobina')?.posicion.columna === 3);
	await page.keyboard.press('Control+y');
	await page.waitForFunction(() => window.qa.proyecto().esquema.representaciones
		.find((r) => r.id === 'km1-bobina')?.posicion.columna === 4);
	console.log('OK arrastre de vista, persistencia en modelo y Ctrl+Z/Y');

	await page.locator('.simbolo[data-representacion="km1-aux"]').click();
	await page.locator('#esq-borrar-representacion').click();
	assert.ok(await page.locator('#modal-dialogo').isVisible());
	assert.match(await page.locator('#dialogo-msg').textContent(), /aparato y sus conductores seguirán/);
	await page.locator('#dialogo-cancelar').click();
	assert.ok(await vista('km1-aux'), 'cancelar eliminó la vista');
	await page.locator('#esq-borrar-representacion').click();
	await page.locator('#dialogo-ok').click();
	await page.waitForFunction(() => !window.qa.proyecto().esquema.representaciones
		.some((r) => r.id === 'km1-aux'));
	const despues = await proyecto();
	assert.equal(despues.dispositivos.filter((d) => d.id === 'km1').length, 1);
	assert.deepEqual(despues.conductores.map((c) => c.id).sort(), fixture.conductores.map((c) => c.id).sort());
	await page.locator('#esq-anterior').click();
	assert.match(await page.locator('#esq-problemas').textContent(), /c-entre-hojas/);
	console.log('OK borrado solo gráfico, circuito intacto y pendiente visible');

	await page.evaluate(() => window.qa.esperarPersistencia());
	await page.reload({ waitUntil: 'domcontentloaded' });
	await esperarEditorListo(page);
	const reabierto = await proyecto();
	assert.equal(reabierto.esquema.representaciones.find((r) => r.id === 'km1-bobina')?.posicion.columna, 4);
	assert.ok(!reabierto.esquema.representaciones.some((r) => r.id === 'km1-aux'));
	assert.deepEqual(reabierto.conductores.map((c) => c.id).sort(), fixture.conductores.map((c) => c.id).sort());
	assert.deepEqual(errores, [], `errores JavaScript: ${errores.join(' | ')}`);
	console.log('OK guardado/reapertura y cero errores JavaScript');
} finally {
	await browser?.close();
	await new Promise((resolve) => servidor.close(resolve));
}
