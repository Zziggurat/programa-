/** Importación real V2: una conexión esquemática no se presenta como cable instalado. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const inicio = Date.now();
const temporal = mkdtempSync(join(tmpdir(), 'qa-ruta-pendiente-m2-'));
const cwd = process.cwd();
const logAnterior = process.env.CHROME_LOG_FILE;
process.env.CHROME_LOG_FILE = join(temporal, 'chromium.log');
process.chdir(temporal);
const fixture = {
	formato: 'tablero-studio', version: 2, nombre: 'QA ruta física pendiente M2',
	hojaActiva: 'h1', hojas: [{ id: 'h1', numero: 1, titulo: 'Conectividad' }],
	gabinete: { ancho: 500, alto: 300, rieles: [], canaletas: [], colocaciones: [
		{ dispositivoId: 'a', x: 20, y: 35, ancho: 45, alto: 65 },
		{ dispositivoId: 'b', x: 330, y: 35, ancho: 45, alto: 65 },
	] },
	dispositivos: [
		{ id: 'a', tipo: 'rele', designacion: '-K1', bornes: [{ id: '1' }, { id: '2' }] },
		{ id: 'b', tipo: 'rele', designacion: '-K2', bornes: [{ id: '1' }, { id: '2' }] },
	],
	conductores: [
		{ id: 'fisico', de: { dispositivoId: 'a', borneId: '1' },
			a: { dispositivoId: 'b', borneId: '1' }, seccion: 1.5, color: 'negro' },
		{ id: 'pendiente', de: { dispositivoId: 'a', borneId: '2' },
			a: { dispositivoId: 'b', borneId: '2' }, estadoRutaFisica: 'pendiente' },
	],
};

let navegador, servidor, pagina, comprobaciones = 0, fallos = 0;
const erroresJS = [];
const comprobar = (nombre, condicion) => {
	comprobaciones++;
	if (!condicion) fallos++;
	console.log(`${condicion ? 'OK  ' : 'FAIL'} ${nombre}`);
};
const proyecto = () => pagina.evaluate(() => window.qa.proyecto());

try {
	const entorno = await servidorDeQA(); servidor = entorno.servidor;
	navegador = await abrirNavegador(chromium);
	pagina = await navegador.newPage({ viewport: { width: 1500, height: 960 } });
	pagina.setDefaultTimeout(30_000);
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
	await (await selector).setFiles({ name: 'ruta-pendiente.tablero.json',
		mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
	await pagina.waitForFunction(() => window.qa.proyecto().nombre === 'QA ruta física pendiente M2');
	const cargado = await proyecto();
	comprobar('el archivo V2 conserva una conexión lógica y un cable físico',
		cargado.version === 2 && cargado.conductores.length === 2
		&& cargado.conductores.find((c) => c.id === 'pendiente')?.estadoRutaFisica === 'pendiente');
	comprobar('el 3D solo dibuja el conductor físicamente tendido',
		await pagina.evaluate(() => window.qa.cablesDibujados()) === 1);
	const resumen = await pagina.locator('#resumen-cables').textContent();
	comprobar('el resumen excluye metraje y ocupación de la conexión pendiente',
		/1 conexión sin ruta física.*sin metraje ni ocupación/s.test(resumen));

	const boton = pagina.locator('#hta-conectar');
	await boton.waitFor({ state: 'visible' });
	const caja = await boton.boundingBox();
	if (!caja) throw new Error('Cablear no tiene área visible');
	await pagina.mouse.click(caja.x + caja.width / 2, caja.y + caja.height / 2);
	await pagina.waitForFunction(() => document.body.classList.contains('modo-trabajo'));
	const fila = pagina.locator('#lista-cables li').nth(1);
	comprobar('el listado distingue la conexión de un trazado directo',
		/ruta física pendiente/i.test(await fila.textContent()));
	await fila.click();
	const panel = await pagina.locator('#panel-der').textContent();
	comprobar('el inspector declara metraje no determinado, no cable automático',
		/ruta física pendiente/i.test(panel) && /Metraje y material de corte: no determinados/i.test(panel)
		&& !/directo \(en L, automático\)/i.test(panel));
	comprobar('sección y color no se inventan por el selector',
		await pagina.locator('#cbl-seccion').inputValue() === ''
		&& await pagina.locator('#cbl-color').inputValue() === '');

	// Declarar una sección planificada no materializa la ruta ni crea metros en el 3D.
	await pagina.locator('#cbl-seccion').selectOption('2.5');
	await pagina.waitForFunction(() => window.qa.proyecto().conductores
		.find((c) => c.id === 'pendiente')?.seccion === 2.5);
	comprobar('una sección prevista no dibuja cable ni quita estado pendiente',
		(await proyecto()).conductores.find((c) => c.id === 'pendiente')?.estadoRutaFisica === 'pendiente'
		&& await pagina.evaluate(() => window.qa.cablesDibujados()) === 1);
	await pagina.evaluate(() => window.qa.esperarPersistencia());
	await pagina.reload({ waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	const reabierto = await proyecto();
	comprobar('reabrir conserva conectividad, sección prevista y ausencia de ruta',
		reabierto.version === 2 && reabierto.conductores.length === 2
		&& reabierto.conductores.find((c) => c.id === 'pendiente')?.seccion === 2.5
		&& reabierto.conductores.find((c) => c.id === 'pendiente')?.estadoRutaFisica === 'pendiente'
		&& await pagina.evaluate(() => window.qa.cablesDibujados()) === 1);
} catch (error) {
	fallos++; console.error('FAIL QA ruta pendiente M2:', error.stack ?? error);
} finally {
	comprobar('sin errores JavaScript', erroresJS.length === 0);
	if (erroresJS.length) console.error(erroresJS);
	try { await navegador?.close(); } catch (error) { fallos++; console.error(error); }
	try {
		servidor?.closeAllConnections?.();
		if (servidor?.listening) await new Promise((resolve, reject) =>
			servidor.close((error) => error ? reject(error) : resolve()));
	} catch (error) { fallos++; console.error(error); }
	process.chdir(cwd);
	if (logAnterior === undefined) delete process.env.CHROME_LOG_FILE;
	else process.env.CHROME_LOG_FILE = logAnterior;
	console.log(`QA ruta pendiente M2: ${comprobaciones} comprobaciones, ${fallos} fallos, ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
	process.exitCode = fallos ? 1 : 0;
}
