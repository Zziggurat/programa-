/** ESQ-08: índice navegable E/S y circuitos desde una importación normal, sin hooks de edición. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const inicio = Date.now();
const temporal = mkdtempSync(join(tmpdir(), 'qa-esq-referencias-m2-'));
const cwdAnterior = process.cwd();
const chromeLogAnterior = process.env.CHROME_LOG_FILE;
process.env.CHROME_LOG_FILE = join(temporal, 'chromium.log');
process.chdir(temporal);

const fixture = {
	formato: 'tablero-studio', version: 2, nombre: 'QA referencias esquemáticas M2',
	hojaActiva: 'alimentacion',
	hojas: [
		{ id: 'alimentacion', numero: 1, titulo: 'Alimentación' },
		{ id: 'plc', numero: 2, titulo: 'Controlador' },
		{ id: 'terminales', numero: 3, titulo: 'Bornes' },
	],
	gabinete: { ancho: 400, alto: 400, rieles: [], canaletas: [], colocaciones: [] },
	dispositivos: [
		{ id: 'ps', tipo: 'fuente', bornes: [{ id: '+24' }, { id: '0V' }],
			comportamiento: { version: 1, clase: 'fuente', salidas: [
				{ borne: '+24', papel: 'fase', tensionV: 24 }, { borne: '0V', papel: 'retorno', tensionV: 0 },
			] } },
		{ id: 'plc1', tipo: 'plc', designacion: '-A1',
			bornes: ['+24', '0V', 'DI1', 'DI2', 'DO1', 'DOC'].map((id) => ({ id,
				...(id === 'DI1' ? { rotulo: 'AO55' } : {}) })),
			comportamiento: { version: 1, clase: 'controlador',
				alimentacion: { entradas: ['+24'], retornos: ['0V'] },
				salidasDigitales: [{ borne: 'DO1', comun: 'DOC' }], salidasAnalogicas: [] },
			programaPLC: { version: 1, lenguaje: 'tablerostudio-plc-v4', FUENTE: '',
				etiquetas: [
					{ nombre: 'ENTRADA1', tipo: 'BOOL', io: { clase: 'DI', borne: 'DI1' } },
					{ nombre: 'ENTRADA2', tipo: 'BOOL', io: { clase: 'DI', borne: 'DI2' } },
				] } },
		{ id: 'x1', tipo: 'bornero', designacion: '-X1', bornes: [{ id: '1' }, { id: '2' }] },
		{ id: 'x2', tipo: 'bornero', designacion: '-X2', bornes: [{ id: '1' }] },
	],
	conductores: [
		{ id: 'w-feed', de: { dispositivoId: 'ps', borneId: '+24' },
			a: { dispositivoId: 'plc1', borneId: '+24' } },
		{ id: 'w-di', de: { dispositivoId: 'plc1', borneId: 'DI1' },
			a: { dispositivoId: 'x1', borneId: '1' } },
		{ id: 'w-do', de: { dispositivoId: 'plc1', borneId: 'DO1' },
			a: { dispositivoId: 'x1', borneId: '2' } },
		{ id: 'w-missing', de: { dispositivoId: 'plc1', borneId: 'DI2' },
			a: { dispositivoId: 'x2', borneId: '1' } },
	],
	esquema: { representaciones: [
		{ id: 'ps-vista', dispositivoId: 'ps', hojaId: 'alimentacion',
			posicion: { columna: 2, fila: 2 }, parte: { tipo: 'completa' } },
		{ id: 'plc-vista', dispositivoId: 'plc1', hojaId: 'plc',
			posicion: { columna: 4, fila: 3 }, parte: { tipo: 'completa' } },
		{ id: 'x-vista', dispositivoId: 'x1', hojaId: 'terminales',
			posicion: { columna: 6, fila: 4 }, parte: { tipo: 'completa' } },
	] },
};

let navegador, servidor, pagina;
let comprobaciones = 0, fallos = 0;
const erroresJS = [];
const comprobar = (nombre, condicion) => {
	comprobaciones++;
	if (!condicion) fallos++;
	console.log(`${condicion ? 'OK  ' : 'FAIL'} ${nombre}`);
};
const proyecto = () => pagina.evaluate(() => window.qa.proyecto());
const hojaActual = () => pagina.locator('#esq-indicador').textContent();

try {
	const entorno = await servidorDeQA(); servidor = entorno.servidor;
	navegador = await abrirNavegador(chromium);
	pagina = await navegador.newPage({ viewport: { width: 1600, height: 920 } });
	pagina.setDefaultTimeout(20_000);
	pagina.on('pageerror', (e) => erroresJS.push(e.message));
	pagina.on('console', (m) => {
		if (m.type() === 'error' && !/favicon|404/i.test(m.text())) erroresJS.push(m.text());
	});
	await pagina.goto(`${entorno.url}/?qa=1&inicio=0`, { waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	if (await pagina.locator('#btn-cerrar-ayuda').isVisible()) await pagina.locator('#btn-cerrar-ayuda').click();
	await pagina.locator('#btn-archivo').click();
	const selector = pagina.waitForEvent('filechooser');
	await pagina.locator('#btn-abrir').click();
	await (await selector).setFiles({ name: 'referencias-esquema.tablero.json',
		mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
	await pagina.waitForFunction(() => window.qa.proyecto().nombre === 'QA referencias esquemáticas M2');
	const antes = await proyecto();
	await pagina.locator('#btn-esquema').click();
	const indice = pagina.locator('#esq-referencias');
	comprobar('índice ESQ-08 visible, desplegable y cerrado por defecto',
		await indice.isVisible() && !(await indice.evaluate((el) => el.open)));
	await indice.locator('summary').click();
	await pagina.locator('[data-referencia-conductor="w-di"]').waitFor();
	const filaDI = pagina.locator('[data-referencia-conductor="w-di"]');
	comprobar('semántica persistente DI prevalece sobre rótulo engañoso AO55',
		(await filaDI.textContent()).includes('DI1 (DI,')
		&& !(await filaDI.textContent()).includes('(AO,'));
	comprobar('canal y terminal tienen enlaces por ID de hoja y representación',
		await filaDI.locator('button[data-hoja-id="plc"][data-representacion-id="plc-vista"]').count() === 1
		&& await filaDI.locator('button[data-hoja-id="terminales"][data-representacion-id="x-vista"]').count() === 1);
	comprobar('terminal sin ancla se diagnostica, no recibe hoja arbitraria',
		await pagina.locator('[data-referencia-conductor="w-missing"]').count() === 0
		&& await pagina.locator('[data-referencia-diagnostico="TERMINAL_SIN_ANCLA"]').count() > 0);
	await filaDI.getByRole('button', { name: /Ver canal/i }).click();
	comprobar('navegar al canal abre hoja PLC y selecciona vista exacta',
		/Hoja 2/.test(await hojaActual())
		&& (await pagina.locator('#esq-ayuda').textContent()).includes('plc-vista'));
	await pagina.locator('[data-referencia-conductor="w-di"]')
		.getByRole('button', { name: /Ver terminal/i }).click();
	comprobar('navegar al terminal abre hoja de bornes y selecciona su vista',
		/Hoja 3/.test(await hojaActual())
		&& (await pagina.locator('#esq-ayuda').textContent()).includes('x-vista'));
	const circuito = pagina.locator('[data-referencia-circuito]')
		.filter({ has: pagina.locator('button[data-hoja-id="plc"]') }).first();
	comprobar('el circuito identificado enlaza alimentación y PLC, no inventa hoja de retorno/E/S',
		await circuito.count() === 1
		&& await circuito.locator('button[data-hoja-id="alimentacion"]').count() === 1
		&& await circuito.locator('button[data-hoja-id="plc"]').count() === 1
		&& await circuito.locator('button[data-hoja-id="terminales"]').count() === 0);
	await circuito.locator('button[data-hoja-id="alimentacion"]').click();
	comprobar('navegación de circuito por ID abre hoja de alimentación', /Hoja 1/.test(await hojaActual()));
	comprobar('índice expresa su alcance limitado y muestra diagnósticos',
		(await pagina.locator('#esq-referencias-contenido').textContent()).includes('no es un mapa exhaustivo de retornos')
		&& await pagina.locator('[data-referencia-diagnostico]').count() > 0);
	comprobar('navegación no altera el documento eléctrico', JSON.stringify(await proyecto()) === JSON.stringify(antes));
	comprobar('sin errores JavaScript', erroresJS.length === 0);
} catch (error) {
	fallos++;
	console.error('FAIL QA referencias esquema M2:', error.stack ?? error);
} finally {
	try { await navegador?.close(); } catch (error) { fallos++; console.error(error); }
	try {
		servidor?.closeAllConnections?.();
		if (servidor?.listening) await new Promise((resolve, reject) =>
			servidor.close((error) => error ? reject(error) : resolve()));
	} catch (error) { fallos++; console.error(error); }
	process.chdir(cwdAnterior);
	if (chromeLogAnterior === undefined) delete process.env.CHROME_LOG_FILE;
	else process.env.CHROME_LOG_FILE = chromeLogAnterior;
	const base = realpathSync(tmpdir());
	const ruta = realpathSync(temporal);
	assert.ok(ruta.startsWith(base + sep), 'el temporal de QA debe estar dentro de tmp');
	rmSync(ruta, { recursive: true, force: true });
	console.log(`QA referencias esquema M2: ${comprobaciones} comprobaciones, ${fallos} fallos, `
		+ `${erroresJS.length} JS errors, ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
	process.exitCode = fallos ? 1 : 0;
}
