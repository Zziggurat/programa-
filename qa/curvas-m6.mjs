/** CAB-25: modo circular persistente desde el inspector, diagnóstico y reapertura. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const inicio = Date.now();
let servidor, navegador, pagina, casos = 0;
const erroresJS = [];
const comprobar = (nombre, condicion) => {
	casos++;
	assert.ok(condicion, nombre);
	console.log(`OK ${nombre}`);
};
const fixture = {
	formato: 'tablero-studio', version: 4, nombre: 'QA curvas M6',
	hojas: [{ id: 'h1', numero: 1, titulo: 'Curvas' }],
	dispositivos: [
		{ id: 'a', tipo: 'rele', designacion: '-K1', bornes: [{ id: '1' }, { id: '2' }] },
		{ id: 'b', tipo: 'rele', designacion: '-K2', bornes: [{ id: '1' }, { id: '2' }] },
	],
	conductores: [{ id: 'w1', de: { dispositivoId: 'a', borneId: '1' },
		a: { dispositivoId: 'b', borneId: '1' }, seccion: 1.5,
		rutaFisica: { version: 1, modo: 'MANUAL', marco: 'PLACA', geometria: 'POLILINEA',
			nodos: [{ id: 'w1:n1', x: 125, y: 120, z: 35 },
				{ id: 'w1:n2', x: 255, y: 120, z: 35 }] } }],
	gabinete: { ancho: 500, alto: 300, rieles: [], canaletas: [], colocaciones: [
		{ dispositivoId: 'a', x: 20, y: 35, ancho: 45, alto: 65 },
		{ dispositivoId: 'b', x: 330, y: 35, ancho: 45, alto: 65 },
	] },
};
const cable = () => pagina.evaluate(() => window.qa.proyecto().conductores.find((c) => c.id === 'w1'));
const puntos = () => pagina.evaluate(() => window.qa.rutaDe('w1'));

try {
	const entorno = await servidorDeQA(); servidor = entorno.servidor;
	navegador = await abrirNavegador(chromium);
	pagina = await navegador.newPage({ viewport: { width: 1400, height: 900 } });
	pagina.setDefaultTimeout(25_000);
	pagina.on('pageerror', (e) => erroresJS.push(e.message));
	pagina.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/i.test(m.text())) erroresJS.push(m.text()); });
	await pagina.goto(`${entorno.url}/?qa=1&inicio=0`, { waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	if (await pagina.locator('#btn-cerrar-ayuda').isVisible()) await pagina.locator('#btn-cerrar-ayuda').click();
	await pagina.locator('#btn-archivo').click();
	const archivo = pagina.waitForEvent('filechooser');
	await pagina.locator('#btn-abrir').click();
	await (await archivo).setFiles({ name: 'curvas-m6.tablero.json', mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(fixture)) });
	await pagina.waitForFunction(() => window.qa.proyecto().nombre === 'QA curvas M6');
	await pagina.locator('#hta-conectar').click();
	await pagina.locator('#lista-cables li').first().click();
	comprobar('modo inicial es polilínea literal', (await cable()).rutaFisica.version === 1);
	const recta = await puntos();
	await pagina.locator('#cbl-radio-m6').fill('8');
	await pagina.locator('#cbl-geometria-m6').selectOption('ARCO_CIRCULAR');
	await pagina.waitForFunction(() => window.qa.proyecto().conductores[0].rutaFisica?.version === 2);
	const curva = await puntos();
	comprobar('modo circular declarado guarda 8 mm y modifica la trayectoria visible',
		(await cable()).rutaFisica.radioMm === 8 && curva.length > recta.length
		&& JSON.stringify(curva) !== JSON.stringify(recta));
	if (process.env.QA_CURVAS_CAPTURE) {
		await pagina.locator('#btn-centrar').click();
		await pagina.waitForTimeout(400);
		await pagina.screenshot({ path: process.env.QA_CURVAS_CAPTURE });
	}
	const nodoAntes = JSON.stringify((await cable()).rutaFisica.nodos[0]);
	const tirador = await pagina.evaluate(() => window.qa.puntoDeUnion('w1', 0));
	assert.ok(tirador && tirador.x > 0 && tirador.y > 0);
	await pagina.mouse.move(tirador.x, tirador.y);
	await pagina.mouse.down();
	await pagina.mouse.move(tirador.x + 35, tirador.y + 12, { steps: 6 });
	await pagina.waitForFunction((antes) => JSON.stringify(window.qa.proyecto().conductores[0].rutaFisica.nodos[0]) !== antes,
		nodoAntes);
	await pagina.mouse.up();
	await pagina.waitForFunction(() => !document.body.classList.contains('ruteando'));
	comprobar('arrastrar el nodo circular cambia la ruta sin perder modo ni radio',
		JSON.stringify((await cable()).rutaFisica.nodos[0]) !== nodoAntes
		&& (await cable()).rutaFisica.version === 2 && (await cable()).rutaFisica.radioMm === 8);
	await pagina.locator('#btn-deshacer').click();
	comprobar('Undo del arrastre circular repone el nodo y el camino',
		JSON.stringify((await cable()).rutaFisica.nodos[0]) === nodoAntes
		&& JSON.stringify(await puntos()) === JSON.stringify(curva));
	await pagina.locator('#cbl-diagnostico-m6').click();
	comprobar('diagnóstico no afirma fabricación ni salida de borne certificada',
		/Las transiciones de borne.*no están verificados/.test(await pagina.locator('#cbl-resultado-m6').innerText()));
	await pagina.locator('#cbl-radio-m6').fill('500');
	await pagina.locator('#cbl-radio-m6').press('Tab');
	await pagina.waitForFunction(() => window.qa.proyecto().conductores[0].rutaFisica?.radioMm === 500);
	await pagina.locator('#cbl-diagnostico-m6').click();
	comprobar('radio que no cabe se informa sin reducir los 500 mm declarados',
		(await cable()).rutaFisica.radioMm === 500
		&& /Radio declarado no cumplido/.test(await pagina.locator('#cbl-resultado-m6').innerText()));
	await pagina.locator('#btn-deshacer').click();
	comprobar('Undo recupera el radio anterior', (await cable()).rutaFisica.radioMm === 8);
	await pagina.locator('#btn-rehacer').click();
	comprobar('Redo recupera el radio declarado', (await cable()).rutaFisica.radioMm === 500);
	await pagina.locator('#cbl-radio-m6').fill('8');
	await pagina.locator('#cbl-radio-m6').press('Tab');
	await pagina.evaluate(() => window.qa.esperarPersistencia());
	await pagina.reload({ waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	comprobar('reapertura conserva modo, radio y trayectoria',
		(await cable()).rutaFisica.version === 2 && (await cable()).rutaFisica.radioMm === 8
		&& JSON.stringify(await puntos()) === JSON.stringify(curva));
	comprobar('sin errores JavaScript', erroresJS.length === 0);
	console.log(`RESULTADO ${casos}/${casos} en ${((Date.now() - inicio) / 1000).toFixed(1)} s; errores JS ${erroresJS.length}`);
} catch (error) {
	console.error(`FALLO ${casos} comprobaciones completadas:`, error);
	process.exitCode = 1;
} finally {
	await pagina?.close().catch(() => {});
	await navegador?.close().catch(() => {});
	await new Promise((resolve) => servidor?.close(resolve) ?? resolve());
}
