/** CAB-24: editar un cable desde la UI no puede redistribuir los demás. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { EJEMPLOS } from '../dist/ejemplo/biblioteca.js';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const inicio = Date.now();
const ejemplo = EJEMPLOS.find((e) => /arranque directo/i.test(e.titulo));
assert.ok(ejemplo, 'falta el ejemplo de arranque directo');
const fixture = ejemplo.crear();
const erroresJS = [];
let servidor, navegador, pagina, casos = 0;
const comprobar = (nombre, condicion) => {
	casos++;
	assert.ok(condicion, nombre);
	console.log(`OK ${nombre}`);
};
const rutas = () => pagina.evaluate(() => Object.fromEntries(window.qa.proyecto().conductores
	.map((c) => [c.id, window.qa.rutaDe(c.id)])));
const firma = (ruta) => JSON.stringify(ruta);

try {
	const entorno = await servidorDeQA(); servidor = entorno.servidor;
	navegador = await abrirNavegador(chromium);
	pagina = await navegador.newPage({ viewport: { width: 1450, height: 900 } });
	pagina.setDefaultTimeout(60_000);
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
	await (await archivo).setFiles({ name: 'localidad-m6.tablero.json', mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(fixture)) });
	await pagina.waitForFunction(() => window.qa.proyecto().conductores.some((c) => c.id === 'w4'));
	await pagina.locator('#hta-conectar').click();
	const antes = await rutas();
	const indice = await pagina.evaluate(() => window.qa.proyecto().conductores.findIndex((c) => c.id === 'w4'));
	assert.ok(indice >= 0, 'falta w4');
	await pagina.locator('#lista-cables li').nth(indice).click();
	const actual = await pagina.locator('#cbl-seccion').inputValue();
	await pagina.locator('#cbl-seccion').selectOption(actual === '6' ? '2.5' : '6');
	await pagina.waitForFunction(() => window.qa.proyecto().conductores
		.filter((c) => c.id !== 'w4').every((c) => !!c.planRutaAutomatica));
	const despues = await rutas();
	const movidos = Object.keys(antes).filter((id) => id !== 'w4' && firma(antes[id]) !== firma(despues[id]));
	comprobar('editar w4 en la interfaz conserva los 27 recorridos ajenos', movidos.length === 0);
	comprobar('los planes ajenos son documentos V4 persistentes',
		await pagina.evaluate(() => window.qa.proyecto().version === 4
			&& window.qa.proyecto().conductores.filter((c) => c.id !== 'w4'
				&& c.planRutaAutomatica?.version === 1).length === 27));
	await pagina.evaluate(() => window.qa.esperarPersistencia());
	await pagina.reload({ waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	const reabierto = await rutas();
	comprobar('reabrir conserva la localidad exacta de los vecinos',
		Object.keys(antes).every((id) => id === 'w4' || firma(antes[id]) === firma(reabierto[id])));
	const canaleta = await pagina.evaluate(() => window.qa.proyecto().gabinete.canaletas[0]);
	assert.ok(canaleta, 'el ejemplo debe tener una canaleta');
	const planesAntesDucto = await pagina.evaluate(() => Object.fromEntries(window.qa.proyecto().conductores
		.filter((c) => c.planRutaAutomatica).map((c) => [c.id, c.planRutaAutomatica])));
	await pagina.locator('#hta-estructura').click();
	if (!await pagina.locator('#seccion-estructura').evaluate((e) => e.open))
		await pagina.locator('#seccion-estructura > summary').click();
	const filaCanaleta = pagina.locator(`#lista-canaletas .fila-estructura[data-id="${canaleta.id}"]`);
	await filaCanaleta.locator('[data-campo="x"]').fill(String(canaleta.x + 5));
	await pagina.locator('#aplicar-dim').click();
	await pagina.waitForFunction(({ id, x }) => window.qa.proyecto().gabinete.canaletas
		.find((c) => c.id === id)?.x === x, { id: canaleta.id, x: canaleta.x + 5 });
	const trasDucto = await pagina.evaluate(() => window.qa.proyecto());
	const pendientes = trasDucto.conductores.filter((c) => c.estadoRutaFisica === 'pendiente'
		&& !!c.planRutaAutomatica).map((c) => c.id);
	console.log(`Diagnóstico canaleta: ${pendientes.length} pendientes de ${Object.keys(planesAntesDucto).length} planes; IDs: ${pendientes.join(', ')}`);
	comprobar('mover canaleta marca solo rutas dependientes como pendientes',
		pendientes.length > 0 && pendientes.length < Object.keys(planesAntesDucto).length);
	comprobar('los planes viejos quedan guardados como referencia, sin dibujarse',
		pendientes.every((id) => firma(trasDucto.conductores.find((c) => c.id === id).planRutaAutomatica)
			=== firma(planesAntesDucto[id]))
		&& await pagina.evaluate((ids) => ids.every((id) => window.qa.rutaDe(id) === undefined), pendientes));
	await pagina.evaluate(() => window.qa.esperarPersistencia());
	await pagina.reload({ waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	comprobar('la revisión pendiente sobrevive la reapertura',
		await pagina.evaluate((ids) => ids.every((id) => window.qa.proyecto().conductores
			.find((c) => c.id === id)?.estadoRutaFisica === 'pendiente'), pendientes));
	const antesRevision = await rutas();
	await pagina.locator('#hta-conectar').click();
	const idRevisado = pendientes[0];
	const indicePendiente = await pagina.evaluate((id) => window.qa.proyecto().conductores
		.findIndex((c) => c.id === id), idRevisado);
	await pagina.locator('#lista-cables li').nth(indicePendiente).click();
	await pagina.locator('#cbl-replan').click();
	comprobar('la propuesta expone avisos y no confunde referencia visual con longitud de corte',
		/referencia visual.*no longitud de corte.*Avisos/s.test(await pagina.locator('#modal-dialogo').innerText()));
	await pagina.locator('#dialogo-ok').click();
	await pagina.waitForFunction((id) => {
		const c = window.qa.proyecto().conductores.find((x) => x.id === id);
		return c?.estadoRutaFisica !== 'pendiente' && !!c?.planRutaAutomatica;
	}, idRevisado);
	const despuesRevision = await rutas();
	console.log(`Diagnóstico revisión ${idRevisado}: longitud ${despuesRevision[idRevisado]?.length}; vecinos cambiados: ${Object.entries(antesRevision)
		.filter(([id, anterior]) => id !== idRevisado && firma(anterior) !== firma(despuesRevision[id]))
		.map(([id]) => id).join(', ')}`);
	comprobar('aceptar la propuesta recupera solo la ruta elegida',
		despuesRevision[idRevisado]?.length > 2
		&& Object.entries(antesRevision).every(([id, anterior]) =>
			id === idRevisado || firma(anterior) === firma(despuesRevision[id])));
	await pagina.locator('#btn-deshacer').click();
	comprobar('Undo recupera el estado pendiente y su plan anterior',
		await pagina.evaluate((id) => window.qa.proyecto().conductores
			.find((c) => c.id === id)?.estadoRutaFisica === 'pendiente', idRevisado));
	await pagina.locator('#btn-rehacer').click();
	comprobar('Redo vuelve a aceptar el recorrido revisado',
		await pagina.evaluate((id) => window.qa.proyecto().conductores
			.find((c) => c.id === id)?.estadoRutaFisica !== 'pendiente', idRevisado));
	comprobar('no hubo errores JavaScript', erroresJS.length === 0);
	console.log(`QA localidad CAB-24: ${casos}/${casos}, ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
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
