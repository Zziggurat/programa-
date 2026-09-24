/** QA de UI real M2: legacy → vistas, desdoblar, undo/redo y reapertura. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const fixture = {
	formato: 'tablero-studio', version: 1, nombre: 'QA activación M2',
	gabinete: { ancho: 400, alto: 600, rieles: [], canaletas: [], colocaciones: [] },
	hojas: [{ id: 'h1', numero: 1, titulo: 'Hoja 1' }],
	dispositivos: [
		{ id: 'm1', tipo: 'motor', designacion: '-M1', bornes: [{ id: 'U' }] },
		{ id: 'km1', tipo: 'contactor', designacion: '-KM1',
			bornes: ['1/L1', '2/T1', 'A1', 'A2', '13', '14'].map((id) => ({ id })),
		},
		{ id: 's1', tipo: 'pulsador', designacion: '-S1', bornes: [{ id: '13' }, { id: '14' }] },
	],
	conductores: [
		{ id: 'c-potencia', de: { dispositivoId: 'km1', borneId: '2/T1' },
			a: { dispositivoId: 'm1', borneId: 'U' } },
		{ id: 'c-mando', de: { dispositivoId: 'km1', borneId: 'A1' },
			a: { dispositivoId: 's1', borneId: '13' } },
	],
};

const { servidor, url } = await servidorDeQA();
let browser;
let page;
const errores = [];
const proyecto = () => page.evaluate(() => window.qa.proyecto());
const vistas = () => page.evaluate(() => window.qa.proyecto().esquema?.representaciones);

try {
	browser = await abrirNavegador(chromium);
	page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
	page.on('pageerror', (e) => errores.push(e.message));
	page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/i.test(m.text())) errores.push(m.text()); });
	await page.goto(`${url}/?qa=1&inicio=0`, { waitUntil: 'domcontentloaded' });
	await esperarEditorListo(page);
	if (await page.locator('#btn-cerrar-ayuda').isVisible()) await page.locator('#btn-cerrar-ayuda').click();
	await page.evaluate((p) => window.qa.cargarJson(JSON.stringify(p)), fixture);
	await page.waitForFunction(() => window.qa.proyecto().nombre === 'QA activación M2');
	await page.locator('#btn-esquema').click();
	assert.match(await page.locator('#esq-indicador').textContent(), /Hoja 1 \/ 2/);
	assert.equal(await page.locator('[data-dispositivo="m1"]').count(), 1);
	await page.locator('#esq-siguiente').click();
	assert.equal(await page.locator('[data-dispositivo="km1"]').count(), 1);
	assert.equal(await page.locator('[data-dispositivo="s1"]').count(), 1);
	assert.equal(await vistas(), undefined);
	console.log('OK legado visible en dos hojas antes de activar');

	await page.evaluate(() => { window.qa.proyecto().esEjemplo = true; });
	await page.locator('#esq-activar-vistas').click();
	assert.ok(await page.locator('#modal-dialogo').isHidden(), 'el ejemplo abrió confirmación de edición');
	assert.equal(await vistas(), undefined);
	await page.evaluate(() => { delete window.qa.proyecto().esEjemplo; });
	console.log('OK ejemplo inspeccionable sin confirmación de conversión');

	const historialAntes = await page.evaluate(() => window.qa.historial().deshacer);
	await page.locator('#esq-activar-vistas').click();
	assert.ok(await page.locator('#modal-dialogo').isVisible());
	assert.match(await page.locator('#dialogo-msg').textContent(), /3 aparatos.*2 hoja\(s\).*2 conductores/s);
	assert.match(await page.locator('#dialogo-msg').textContent(), /dibujo anterior: «Circuito de potencia»/);
	await page.locator('#dialogo-cancelar').click();
	assert.equal(await vistas(), undefined);
	await page.locator('#esq-activar-vistas').click();
	await page.locator('#dialogo-ok').click();
	await page.waitForFunction(() => window.qa.proyecto().esquema?.representaciones?.length === 3);
	assert.equal(await page.evaluate(() => window.qa.historial().deshacer), historialAntes + 1);
	const convertido = await proyecto();
	assert.equal(convertido.dispositivos.length, 3);
	assert.deepEqual(convertido.conductores.map((c) => c.id), fixture.conductores.map((c) => c.id));
	assert.equal(convertido.hojas.length, 2);
	assert.equal(convertido.hojas[0].id, 'h1');
	assert.equal(convertido.hojas[0].titulo, 'Hoja 1', 'la activación no reescribió título persistente');
	assert.ok(convertido.esquema.representaciones.every((r) => r.parte.tipo === 'completa'));
	await page.keyboard.press('Control+z');
	await page.waitForFunction(() => window.qa.proyecto().esquema?.representaciones === undefined);
	assert.equal(await page.locator('[data-dispositivo="km1"]').count(), 1);
	await page.keyboard.press('Control+y');
	await page.waitForFunction(() => window.qa.proyecto().esquema?.representaciones?.length === 3);
	console.log('OK previsualización/cancelación, activación completa y Ctrl+Z/Y');

	await page.locator('[data-dispositivo="km1"]').click();
	assert.ok(await page.locator('#esq-desdoblar').isVisible());
	await page.locator('#esq-desdoblar').click();
	for (const nombre of ['bobina', 'polos', 'auxiliares']) {
		assert.ok(await page.locator(`#esq-desdoblar-hoja-${nombre}`).isVisible());
	}
	const hPotencia = convertido.hojas.find((h) => h.numero === 1).id;
	const hMando = convertido.hojas.find((h) => h.numero === 2).id;
	await page.locator('#esq-desdoblar-hoja-bobina').selectOption(hMando);
	await page.locator('#esq-desdoblar-columna-bobina').fill('4');
	await page.locator('#esq-desdoblar-fila-bobina').fill('5');
	await page.locator('#esq-desdoblar-hoja-polos').selectOption(hPotencia);
	await page.locator('#esq-desdoblar-columna-polos').fill('4');
	await page.locator('#esq-desdoblar-fila-polos').fill('3');
	await page.locator('#esq-desdoblar-hoja-auxiliares').selectOption(hMando);
	await page.locator('#esq-desdoblar-columna-auxiliares').fill('6');
	await page.locator('#esq-desdoblar-fila-auxiliares').fill('3');
	await page.locator('#esq-anterior').click();
	assert.ok(await page.locator('#esq-desdoblar-formulario').isVisible(), 'navegar hoja cerró el formulario');
	assert.equal(await page.locator('#esq-desdoblar-hoja-polos').inputValue(), hPotencia);
	assert.equal(await page.locator('#esq-desdoblar-columna-auxiliares').inputValue(), '6');
	await page.locator('#esq-siguiente').click();
	assert.ok(await page.locator('#esq-desdoblar-aplicar').isVisible());
	const historialSplit = await page.evaluate(() => window.qa.historial().deshacer);
	await page.locator('#esq-desdoblar-aplicar').click();
	assert.match(await page.locator('#dialogo-msg').textContent(), /3 vistas funcionales.*bobina.*polos.*auxiliares/s);
	await page.locator('#dialogo-ok').click();
	await page.waitForFunction(() => window.qa.proyecto().esquema.representaciones
		.filter((r) => r.dispositivoId === 'km1').length === 3);
	assert.equal(await page.evaluate(() => window.qa.historial().deshacer), historialSplit + 1);
	const desdoblado = await proyecto();
	assert.equal(desdoblado.dispositivos.filter((d) => d.id === 'km1').length, 1);
	assert.deepEqual(desdoblado.conductores.map((c) => c.id), fixture.conductores.map((c) => c.id));
	assert.deepEqual(desdoblado.esquema.representaciones.filter((r) => r.dispositivoId === 'km1')
		.map((r) => r.parte.tipo), ['bobina', 'contactos', 'contactos']);
	assert.equal(desdoblado.esquema.representaciones.find((r) => r.dispositivoId === 'km1'
		&& r.parte.tipo === 'bobina').hojaId, hMando);
	await page.locator('#esq-anterior').click();
	assert.equal(await page.locator('[data-dispositivo="km1"]').count(), 1);
	await page.locator('#esq-siguiente').click();
	assert.equal(await page.locator('[data-dispositivo="km1"]').count(), 2);
	await page.keyboard.press('Control+z');
	await page.waitForFunction(() => window.qa.proyecto().esquema.representaciones
		.filter((r) => r.dispositivoId === 'km1').length === 1);
	await page.keyboard.press('Control+y');
	await page.waitForFunction(() => window.qa.proyecto().esquema.representaciones
		.filter((r) => r.dispositivoId === 'km1').length === 3);
	console.log('OK desdoblamiento en dos hojas, identidad/cables únicos y Ctrl+Z/Y');

	await page.evaluate(() => window.qa.esperarPersistencia());
	await page.reload({ waitUntil: 'domcontentloaded' });
	await esperarEditorListo(page);
	const reabierto = await proyecto();
	assert.equal(reabierto.esquema.representaciones.filter((r) => r.dispositivoId === 'km1').length, 3);
	assert.equal(reabierto.dispositivos.filter((d) => d.id === 'km1').length, 1);
	assert.equal(reabierto.dispositivos.find((d) => d.id === 'km1').comportamiento, undefined);
	assert.equal(reabierto.conductores.length, 2);
	assert.deepEqual(errores, [], `errores JavaScript: ${errores.join(' | ')}`);
	console.log('OK persistencia/reapertura y cero errores JavaScript');
} finally {
	await browser?.close();
	await new Promise((resolve) => servidor.close(resolve));
}
