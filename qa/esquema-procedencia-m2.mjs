/** ESQ-06: la procedencia visible y exportada corresponde a la geometría realmente usada. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const inicio = Date.now();
const fixture = {
	formato: 'tablero-studio', version: 2, nombre: 'QA simbología local M2', hojaActiva: 'h1',
	hojas: [{ id: 'h1', numero: 1, titulo: 'Mando' }],
	gabinete: { ancho: 400, alto: 400, rieles: [], canaletas: [], colocaciones: [] },
	dispositivos: [
		{ id: 'ps', tipo: 'fuente', bornes: [{ id: '+24' }, { id: '0V' }] },
		{ id: 'yv', tipo: 'valvula', bornes: [{ id: 'A' }, { id: 'B' }] },
	],
	conductores: [],
	esquema: { representaciones: [
		{ id: 'ps-vista', dispositivoId: 'ps', hojaId: 'h1', posicion: { columna: 3, fila: 3 }, parte: { tipo: 'completa' } },
		{ id: 'yv-vista', dispositivoId: 'yv', hojaId: 'h1', posicion: { columna: 7, fila: 5 }, parte: { tipo: 'completa' } },
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

try {
	const entorno = await servidorDeQA(); servidor = entorno.servidor;
	navegador = await abrirNavegador(chromium);
	pagina = await navegador.newPage({ viewport: { width: 1420, height: 860 }, acceptDownloads: true });
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
	await (await chooser).setFiles({ name: 'qa-simbologia.tablero.json', mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(fixture)) });
	await pagina.waitForFunction(() => window.qa.proyecto().nombre === 'QA simbología local M2');
	await pagina.locator('#btn-esquema').click();
	const antes = JSON.stringify(await proyecto()), undo0 = await historial();
	const fuente = pagina.locator('#esquema-hoja .simbolo[data-representacion="ps-vista"]');
	const valvula = pagina.locator('#esquema-hoja .simbolo[data-representacion="yv-vista"]');
	comprobar('fuente y válvula están representadas una vez por ID',
		await fuente.count() === 1 && await valvula.count() === 1);
	comprobar('motor gráfico diferencia plantilla dedicada y fallback genérico',
		await fuente.getAttribute('data-familia-simbolo') === 'dedicado'
		&& await valvula.getAttribute('data-familia-simbolo') === 'generico'
		&& await fuente.getAttribute('data-plantilla') !== await valvula.getAttribute('data-plantilla'));
	for (const [nombre, simbolo, familia] of [
		['fuente', fuente, 'dedicado'], ['válvula', valvula, 'generico'],
	]) {
		await simbolo.locator('rect[fill="transparent"]').click({ position: { x: 4, y: 4 } });
		const detalle = pagina.locator('#esq-plantilla-procedencia');
		comprobar(`inspector de ${nombre} declara familia y límite normativo`,
			await detalle.isVisible() && await detalle.getAttribute('data-familia') === familia
			&& /NO VERIFICADA/.test(await detalle.locator('summary').innerText()));
		if (!await detalle.evaluate((el) => el.open)) await detalle.locator('summary').click();
		comprobar(`inspector de ${nombre} distingue origen y licencia declarada`,
			/Origen gráfico: trazos generados en el editor/.test(await detalle.innerText())
			&& /licencia individual.*no están verificadas/i.test(await detalle.innerText())
			&& /GPL-2\.0-or-later/.test(await detalle.innerText()));
	}
	const descarga = pagina.waitForEvent('download');
	await pagina.locator('#esq-svg').click();
	const archivo = await descarga;
	const partes = [];
	for await (const trozo of await archivo.createReadStream()) partes.push(trozo);
	const svg = Buffer.concat(partes).toString('utf8');
	comprobar('SVG exportado conserva IDs de ambas plantillas',
		svg.includes(`data-plantilla="${await fuente.getAttribute('data-plantilla')}"`)
		&& svg.includes(`data-plantilla="${await valvula.getAttribute('data-plantilla')}"`));
	comprobar('SVG exportado no certifica simbología ni licencia individual',
		(svg.match(/data-licencia-verificada="no"/g)?.length ?? 0) === 2
		&& (svg.match(/data-conformidad-normativa="NO_VERIFICADA"/g)?.length ?? 0) === 2
		&& /No certifica normas ni fabricación/.test(svg));
	comprobar('inspeccionar y exportar no cambian el proyecto ni crean Undo',
		JSON.stringify(await proyecto()) === antes && await historial() === undo0);
	comprobar('cero errores JavaScript', erroresJS.length === 0);
	console.log(`ESQ-06 procedencia: ${casos}/${casos}, 0 JS; ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
} catch (error) {
	console.error(error);
	if (erroresJS.length) console.error('Errores JS:', erroresJS);
	process.exitCode = 1;
} finally {
	try { await pagina?.close(); } catch (error) { console.error(error); process.exitCode = 1; }
	try { await navegador?.close(); } catch (error) { console.error(error); process.exitCode = 1; }
	try {
		servidor?.closeAllConnections?.();
		if (servidor) await new Promise((resolve, reject) => servidor.close((error) => error ? reject(error) : resolve()));
	} catch (error) { console.error(error); process.exitCode = 1; }
}
