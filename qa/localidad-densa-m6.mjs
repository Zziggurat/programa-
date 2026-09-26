/** CAB-24: localidad y persistencia en el ejemplo estrella-triángulo denso. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { EJEMPLOS } from '../dist/ejemplo/biblioteca.js';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const inicio = Date.now();
const ejemplo = EJEMPLOS.find((e) => /estrella-triángulo/i.test(e.titulo));
assert.ok(ejemplo, 'falta el ejemplo estrella-triángulo');
const fixture = ejemplo.crear();
const total = fixture.conductores.length;
assert.ok(total >= 59, `el ejemplo dejó de ser denso: ${total} conductores`);
let servidor, navegador, pagina, casos = 0;
const erroresJS = [];
const comprobar = (nombre, condicion) => {
	casos++;
	assert.ok(condicion, nombre);
	console.log(`OK ${nombre}`);
};
const rutas = () => pagina.evaluate(() => Object.fromEntries(window.qa.proyecto().conductores
	.map((c) => [c.id, window.qa.rutaDe(c.id)])));
const firma = (valor) => JSON.stringify(valor);

try {
	const entorno = await servidorDeQA(); servidor = entorno.servidor;
	navegador = await abrirNavegador(chromium);
	pagina = await navegador.newPage({ viewport: { width: 1450, height: 900 } });
	pagina.setDefaultTimeout(120_000);
	pagina.on('pageerror', (e) => erroresJS.push(e.message));
	pagina.on('console', (m) => {
		if (m.type() === 'error' && !/favicon|404/i.test(m.text())) erroresJS.push(m.text());
	});
	await pagina.goto(`${entorno.url}/?qa=1&inicio=0`, { waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	if (await pagina.locator('#btn-cerrar-ayuda').isVisible()) await pagina.locator('#btn-cerrar-ayuda').click();
	await pagina.locator('#btn-archivo').click();
	const archivo = pagina.waitForEvent('filechooser');
	await pagina.locator('#btn-abrir').click();
	await (await archivo).setFiles({ name: 'localidad-densa.tablero.json', mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(fixture)) });
	await pagina.waitForFunction((n) => window.qa.proyecto().conductores.length === n, total);
	await pagina.locator('#hta-conectar').click();
	const antes = await rutas();
	const rutasFisicas = Object.values(antes).filter((ruta) => Array.isArray(ruta)).length;
	console.log(`Precondición densa: ${total} conexiones, ${rutasFisicas} rutas físicas`);
	const indice = await pagina.evaluate(() => window.qa.proyecto().conductores.findIndex((c) => c.id === 'w18'));
	assert.ok(indice >= 0, 'falta w18');
	await pagina.locator('#lista-cables li').nth(indice).click();
	const previo = await pagina.locator('#cbl-seccion').inputValue();
	const t = Date.now();
	await pagina.locator('#cbl-seccion').selectOption(previo === '6' ? '2.5' : '6');
	await pagina.waitForFunction((n) => window.qa.proyecto().conductores
		.filter((c) => c.planRutaAutomatica?.version === 1).length === n, rutasFisicas);
	const asignacionMs = Date.now() - t;
	const despues = await rutas();
	comprobar(`editar w18 conserva los otros ${total - 1} recorridos exactos`,
		Object.entries(antes).every(([id, ruta]) => id === 'w18' || firma(ruta) === firma(despues[id])));
	if (process.env.QA_DENSE_CAPTURE) await pagina.screenshot({ path: process.env.QA_DENSE_CAPTURE });
	const bytes = Buffer.byteLength(JSON.stringify(await pagina.evaluate(() => window.qa.proyecto())));
	const esperaInicio = Date.now();
	await pagina.evaluate(() => window.qa.esperarPersistencia());
	const esperaMs = Date.now() - esperaInicio;
	await pagina.reload({ waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	const reabierto = await rutas();
	comprobar(`reapertura conserva los ${rutasFisicas} planes y los ${total - 1} vecinos`,
		Object.entries(antes).every(([id, ruta]) => id === 'w18' || firma(ruta) === firma(reabierto[id]))
		&& await pagina.evaluate((n) => window.qa.proyecto().conductores
			.filter((c) => c.planRutaAutomatica?.version === 1).length === n, rutasFisicas));
	comprobar('sin errores JavaScript', erroresJS.length === 0);
	console.log(`Medición ${total} conexiones: documento ${bytes} bytes; edición hasta ${rutasFisicas} planes ${asignacionMs} ms; espera de guardado ${esperaMs} ms`);
	console.log(`QA localidad densa M6: ${casos}/${casos}, ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
} catch (error) {
	console.error(error.stack ?? error);
	process.exitCode = 1;
} finally {
	try { await pagina?.close(); } catch (error) { console.error(error); process.exitCode = 1; }
	try { await navegador?.close(); } catch (error) { console.error(error); process.exitCode = 1; }
	if (servidor) {
		servidor.closeAllConnections?.();
		await new Promise((resolve, reject) => servidor.close((error) => error ? reject(error) : resolve()))
			.catch((error) => { console.error(error); process.exitCode = 1; });
	}
}
