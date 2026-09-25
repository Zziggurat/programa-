/** ESQ-05: copia visible y segura de un aparato eléctrico, sin duplicar anclajes ni hilos. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const inicio = Date.now();
const fixture = {
	formato: 'tablero-studio', version: 2, nombre: 'QA copia esquemática M2', hojaActiva: 'h1',
	hojas: [{ id: 'h1', numero: 1, titulo: 'Mando' }, { id: 'h2', numero: 2, titulo: 'Potencia' }],
	gabinete: { ancho: 400, alto: 400, rieles: [], canaletas: [], colocaciones: [
		{ dispositivoId: 'ps', x: 30, y: 40, ancho: 35, alto: 30 },
		{ dispositivoId: 'x1', x: 90, y: 40, ancho: 35, alto: 30 },
	] },
	dispositivos: [
		{ id: 'ps', tipo: 'fuente', bornes: [{ id: '+24' }, { id: '0V' }] },
		{ id: 'x1', tipo: 'bornero', bornes: [{ id: '1' }, { id: '2' }] },
	],
	conductores: [{ id: 'c1', de: { dispositivoId: 'ps', borneId: '+24' },
		a: { dispositivoId: 'x1', borneId: '1' } }],
	esquema: { representaciones: [
		{ id: 'ps-vista', dispositivoId: 'ps', hojaId: 'h1',
			posicion: { columna: 3, fila: 3 }, parte: { tipo: 'completa' } },
		{ id: 'x-vista', dispositivoId: 'x1', hojaId: 'h1',
			posicion: { columna: 7, fila: 5 }, parte: { tipo: 'completa' } },
	] },
};
let servidor, navegador, pagina, casos = 0;
const erroresJS = [];
function comprobar(nombre, condicion) {
	casos++;
	assert.ok(condicion, nombre);
	console.log(`OK ${nombre}`);
}
const proyecto = () => pagina.evaluate(() => window.qa.proyecto());
const historial = () => pagina.evaluate(() => window.qa.historial().deshacer);
async function pegar(destino) {
	await pagina.locator('#esq-pegar-vista').click();
	await pagina.locator('#dialogo-input').fill(destino);
	await pagina.locator('#dialogo-ok').click();
}

try {
	const entorno = await servidorDeQA(); servidor = entorno.servidor;
	navegador = await abrirNavegador(chromium);
	pagina = await navegador.newPage({ viewport: { width: 1420, height: 860 } });
	pagina.setDefaultTimeout(20_000);
	pagina.on('pageerror', (error) => erroresJS.push(error.message));
	pagina.on('console', (mensaje) => {
		if (mensaje.type() === 'error' && !/favicon|404/i.test(mensaje.text())) erroresJS.push(mensaje.text());
	});
	await pagina.goto(`${entorno.url}/?qa=1&inicio=0`, { waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	if (await pagina.locator('#btn-cerrar-ayuda').isVisible()) await pagina.locator('#btn-cerrar-ayuda').click();
	await pagina.locator('#btn-archivo').click();
	const chooser = pagina.waitForEvent('filechooser');
	await pagina.locator('#btn-abrir').click();
	await (await chooser).setFiles({ name: 'qa-copia-m2.tablero.json', mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(fixture)) });
	await pagina.waitForFunction(() => window.qa.proyecto().nombre === 'QA copia esquemática M2');
	await pagina.locator('#btn-esquema').click();
	const fuente = pagina.locator('#esquema-hoja .simbolo[data-representacion="ps-vista"]');
	await fuente.locator('rect[fill="transparent"]').click({ position: { x: 4, y: 4 } });
	const antes = await proyecto(), undo0 = await historial();
	comprobar('una vista completa ofrece copiar pero no pegar antes de preparar la copia',
		await pagina.locator('#esq-copiar-vista').isEnabled()
		&& await pagina.locator('#esq-pegar-vista').isDisabled());
	await pagina.locator('#esq-copiar-vista').click();
	comprobar('copiar es transitorio y no crea Undo ni altera el circuito',
		JSON.stringify(await proyecto()) === JSON.stringify(antes)
		&& await historial() === undo0
		&& await pagina.locator('#esq-pegar-vista').isEnabled()
		&& /sin cables/.test(await pagina.locator('#esq-copia-estado').innerText()));
	await pegar('1.7.5');
	comprobar('casilla ocupada se rechaza sin objeto fantasma ni Undo',
		JSON.stringify(await proyecto()) === JSON.stringify(antes) && await historial() === undo0);
	await pegar('2.4.3');
	await pagina.waitForFunction(() => window.qa.proyecto().dispositivos.length === 3);
	const despues = await proyecto();
	const copia = despues.dispositivos.find((d) => d.id !== 'ps' && d.id !== 'x1');
	const vista = despues.esquema.representaciones.find((r) => r.dispositivoId === copia?.id);
	comprobar('pegar crea aparato y vista nuevos en el segundo folio con un solo Undo',
		!!copia && !!vista && vista.id !== 'ps-vista' && vista.hojaId === 'h2'
		&& vista.posicion.columna === 4 && vista.posicion.fila === 3
		&& despues.gabinete.colocaciones.some((c) => c.dispositivoId === copia.id)
		&& await historial() === undo0 + 1);
	comprobar('los conductores existentes no se copian ni cambian extremos',
		JSON.stringify(despues.conductores) === JSON.stringify(antes.conductores)
		&& !despues.conductores.some((c) => c.de.dispositivoId === copia.id || c.a.dispositivoId === copia.id));
	comprobar('el símbolo copiado se ve con dos anclajes únicos',
		await pagina.locator(`#esquema-hoja .simbolo[data-representacion="${vista.id}"]`).count() === 1
		&& await pagina.locator('#esquema-hoja .simbolo[data-representacion="ps-vista"]').count() === 0);
	await pagina.locator('#esq-ajustar').focus();
	await pagina.keyboard.press('Control+z');
	await pagina.waitForFunction(() => window.qa.proyecto().dispositivos.length === 2);
	comprobar('Undo retira aparato, vista y colocación juntos',
		!((await proyecto()).esquema.representaciones.some((r) => r.id === vista.id))
		&& await historial() === undo0);
	await pagina.keyboard.press('Control+y');
	await pagina.waitForFunction(() => window.qa.proyecto().dispositivos.length === 3);
	comprobar('Redo recupera una sola identidad y el mismo circuito',
		(await proyecto()).esquema.representaciones.filter((r) => r.dispositivoId === copia.id).length === 1
		&& JSON.stringify((await proyecto()).conductores) === JSON.stringify(antes.conductores));
	await pagina.evaluate(() => window.qa.esperarPersistencia());
	await pagina.reload({ waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	const reabierto = await proyecto();
	comprobar('reapertura conserva aparato, vista única y circuito',
		reabierto.dispositivos.some((d) => d.id === copia.id)
		&& reabierto.esquema.representaciones.filter((r) => r.dispositivoId === copia.id).length === 1
		&& JSON.stringify(reabierto.conductores) === JSON.stringify(antes.conductores));
	await pagina.locator('#btn-esquema').click();
	if (await pagina.locator('#esquema-hoja .simbolo[data-representacion="ps-vista"]').count() === 0)
		await pagina.locator('#esq-anterior').click();
	await pagina.locator('#esquema-hoja .simbolo[data-representacion="ps-vista"] rect[fill="transparent"]')
		.click({ position: { x: 4, y: 4 } });
	const pin = () => pagina.locator('#esquema-hoja .borne-esq[data-representacion="ps-vista"][data-borne="+24"] circle').first()
		.evaluate((el) => ({ x: Number(el.getAttribute('cx')), y: Number(el.getAttribute('cy')) }));
	const pin0 = await pin(), giroUndo = await historial();
	await pagina.locator('#esq-girar-vista').click();
	const pin180 = await pin();
	comprobar('giro visible de 180° invierte el anclaje sin cambiar el circuito',
		(await proyecto()).esquema.representaciones.find((r) => r.id === 'ps-vista')?.giro === 180
		&& (pin180.x !== pin0.x || pin180.y !== pin0.y)
		&& JSON.stringify((await proyecto()).conductores) === JSON.stringify(antes.conductores)
		&& await historial() === giroUndo + 1);
	await pagina.locator('#esq-ajustar').focus();
	await pagina.keyboard.press('Control+z');
	await pagina.waitForFunction(() => window.qa.proyecto().esquema.representaciones
		.find((r) => r.id === 'ps-vista')?.giro === undefined);
	comprobar('Undo del giro restaura pin y orientación histórica',
		JSON.stringify(await pin()) === JSON.stringify(pin0) && await historial() === giroUndo);
	await pagina.keyboard.press('Control+y');
	await pagina.waitForFunction(() => window.qa.proyecto().esquema.representaciones
		.find((r) => r.id === 'ps-vista')?.giro === 180);
	comprobar('Redo del giro conserva la identidad eléctrica',
		JSON.stringify(await pin()) === JSON.stringify(pin180)
		&& JSON.stringify((await proyecto()).conductores) === JSON.stringify(antes.conductores));
	await pagina.evaluate(() => window.qa.esperarPersistencia());
	await pagina.reload({ waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	comprobar('giro persiste en el folio correcto al reabrir',
		(await proyecto()).esquema.representaciones.find((r) => r.id === 'ps-vista')?.giro === 180);
	comprobar('cero errores JavaScript', erroresJS.length === 0);
	console.log(`ESQ-05: ${casos} comprobaciones terminadas; cerrando recursos`);
} catch (error) {
	console.error(error);
	if (erroresJS.length) console.error('Errores JS:', erroresJS);
	process.exitCode = 1;
} finally {
	console.log('Limpieza QA: cerrando página');
	try { await pagina?.close(); console.log('Limpieza QA: página cerrada'); }
	catch (error) { console.error('No se cerró la página:', error); process.exitCode = 1; }
	console.log('Limpieza QA: cerrando Chromium');
	try { await navegador?.close(); console.log('Limpieza QA: Chromium cerrado'); }
	catch (error) { console.error('No se cerró Chromium:', error); process.exitCode = 1; }
	console.log('Limpieza QA: cerrando servidor');
	try {
		servidor?.closeAllConnections?.();
		if (servidor) await new Promise((resolve, reject) => servidor.close((error) => error ? reject(error) : resolve()));
		console.log('Limpieza QA: servidor cerrado');
	} catch (error) { console.error('No se cerró el servidor:', error); process.exitCode = 1; }
}
if (!process.exitCode) console.log(`ESQ-05 copiar y girar vista: ${casos}/${casos}, 0 JS; `
	+ `${((Date.now() - inicio) / 1000).toFixed(1)} s incluyendo limpieza`);
