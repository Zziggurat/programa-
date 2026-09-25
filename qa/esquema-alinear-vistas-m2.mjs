/** ESQ-05: multiselección transitoria y alineación atómica de vistas, sin tocar la red. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { abrirNavegador, esperarEditorListo, servidorDeQA, trabajarSobreCopia } from './lib/entorno.mjs';

const inicio = Date.now();
let servidor, navegador, pagina;
let casos = 0;
const erroresJS = [];
function comprobar(nombre, valor) {
	casos++;
	assert.ok(valor, nombre);
	console.log(`OK ${nombre}`);
}
const proyecto = () => pagina.evaluate(() => window.qa.proyecto());
const historial = () => pagina.evaluate(() => window.qa.historial());
const vista = (p, id) => p.esquema.representaciones.find((r) => r.id === id);
const firmaCircuito = (p) => JSON.stringify([p.dispositivos, p.conductores]);
async function alternarVista(id) {
	await pagina.locator(`#esquema-hoja .simbolo[data-representacion="${id}"] > rect[fill="transparent"]`)
		.click({ modifiers: ['Shift'], position: { x: 4, y: 4 } });
}

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
	await pagina.locator('#btn-aprender').click();
	await pagina.locator('#btn-ejemplos').click();
	await pagina.locator('.tarjeta-ejemplo', { hasText: 'Arranque directo de motor' })
		.first().getByRole('button', { name: /Abrir y estudiar/i }).click();
	if (await pagina.locator('#modal-dialogo').isVisible()) await pagina.locator('#dialogo-ok').click();
	await pagina.waitForFunction(() => window.qa.proyecto().nombre === 'Arranque directo de motor 380 V');
	if (await pagina.locator('#modal-explicacion').isVisible())
		await pagina.locator('#btn-cerrar-explicacion').click();
	assert.equal(await trabajarSobreCopia(pagina), true);
	await pagina.locator('#hta-seleccionar').click();
	await pagina.locator('#btn-esquema').click();
	await pagina.locator('#esq-activar-vistas').click();
	await pagina.locator('#dialogo-ok').click();
	await pagina.waitForFunction(() => window.qa.proyecto().esquema?.representaciones?.length > 0);
	const p0 = await proyecto();
	const q1 = p0.esquema.representaciones.find((r) => r.dispositivoId === 'q1' && r.hojaId === 'h1')?.id;
	const km1 = p0.esquema.representaciones.find((r) => r.dispositivoId === 'km1' && r.hojaId === 'h1')?.id;
	const m1 = p0.esquema.representaciones.find((r) => r.dispositivoId === 'm1' && r.hojaId === 'h1')?.id;
	assert.ok(q1 && km1 && m1);
	assert.deepEqual([vista(p0, q1).posicion.columna, vista(p0, q1).posicion.fila], [3, 5]);
	assert.deepEqual([vista(p0, km1).posicion.columna, vista(p0, km1).posicion.fila], [4, 8]);
	const firma = firmaCircuito(p0);
	const undo0 = (await historial()).deshacer;
	comprobar('vistas de fuerza comparten folio y tienen IDs estables',
		p0.hojas.some((h) => h.id === 'h1') && q1 !== km1);
	await alternarVista(q1);
	await alternarVista(km1);
	comprobar('Shift selecciona dos vistas sin modificar Proyecto ni Undo',
		JSON.stringify(await proyecto()) === JSON.stringify(p0)
		&& (await historial()).deshacer === undo0
		&& await pagina.locator('#esquema-hoja .simbolo[data-multiseleccion="true"]').count() === 2);
	comprobar('alineación visible identifica ancla y dos acciones',
		await pagina.locator('#esq-alinear-fila').isVisible()
		&& await pagina.locator('#esq-alinear-columna').isVisible()
		&& (await pagina.locator('#esq-grupo-estado').textContent()).includes(km1));
	await pagina.locator('#esq-alinear-columna').click();
	comprobar('preview de alineación cita IDs y no mueve todavía',
		(await pagina.locator('#dialogo-msg').textContent()).includes(q1)
		&& (await pagina.locator('#dialogo-msg').textContent()).includes(km1)
		&& vista(await proyecto(), q1).posicion.columna === 3
		&& (await historial()).deshacer === undo0);
	await pagina.locator('#dialogo-cancelar').click();
	comprobar('cancelar alineación no muta ni crea Undo',
		vista(await proyecto(), q1).posicion.columna === 3
		&& (await historial()).deshacer === undo0);
	await pagina.locator('#esq-alinear-columna').click();
	await pagina.locator('#dialogo-ok').click();
	await pagina.waitForFunction((id) => window.qa.proyecto().esquema.representaciones
		.find((r) => r.id === id)?.posicion.columna === 4, q1);
	const alineado = await proyecto();
	comprobar('aplicar alinea solo vistas del folio con un Undo',
		vista(alineado, q1).posicion.fila === 5
		&& vista(alineado, km1).posicion.columna === 4
		&& vista(alineado, km1).posicion.fila === 8
		&& (await historial()).deshacer === undo0 + 1
		&& firmaCircuito(alineado) === firma);
	await pagina.locator('#esq-alinear-columna').click();
	comprobar('alineación repetida es no-op sin otro Undo',
		!await pagina.locator('#modal-dialogo').isVisible()
		&& (await historial()).deshacer === undo0 + 1);

	await pagina.locator('#esq-grupo-limpiar').click();
	await alternarVista(m1);
	await alternarVista(q1);
	const antesRechazo = JSON.stringify(await proyecto());
	await pagina.locator('#esq-alinear-columna').click();
	comprobar('destinos coincidentes se rechazan sin mutación parcial',
		!await pagina.locator('#modal-dialogo').isVisible()
		&& JSON.stringify(await proyecto()) === antesRechazo
		&& (await historial()).deshacer === undo0 + 1);
	await pagina.locator('#esq-grupo-limpiar').click();
	for (const id of [q1, km1]) {
		const simbolo = pagina.locator(`#esquema-hoja .simbolo[data-representacion="${id}"]`);
		await simbolo.focus();
		await simbolo.press('Shift+Enter');
	}
	comprobar('Shift+Enter permite agrupar vistas sin tocar el circuito',
		await pagina.locator('#esquema-hoja .simbolo[data-multiseleccion="true"]').count() === 2
		&& firmaCircuito(await proyecto()) === firma
		&& (await historial()).deshacer === undo0 + 1);
	await pagina.locator('#esq-siguiente').click();
	comprobar('cambiar de folio invalida la selección editorial transitoria',
		await pagina.locator('#esquema-hoja .simbolo[data-multiseleccion="true"]').count() === 0
		&& await pagina.locator('#esq-grupo-limpiar').isDisabled()
		&& (await historial()).deshacer === undo0 + 1);
	await pagina.locator('#esq-anterior').click();
	await pagina.locator('#esq-ajustar').focus();
	await pagina.keyboard.press('Control+z');
	await pagina.waitForFunction((id) => window.qa.proyecto().esquema.representaciones
		.find((r) => r.id === id)?.posicion.columna === 3, q1);
	comprobar('Undo restaura la posición sin cambiar el circuito', firmaCircuito(await proyecto()) === firma);
	await pagina.keyboard.press('Control+y');
	await pagina.waitForFunction((id) => window.qa.proyecto().esquema.representaciones
		.find((r) => r.id === id)?.posicion.columna === 4, q1);
	comprobar('Redo vuelve a alinear una sola identidad', firmaCircuito(await proyecto()) === firma);
	await pagina.evaluate(() => window.qa.esperarPersistencia());
	await pagina.reload({ waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	comprobar('reapertura conserva alineación y circuito',
		vista(await proyecto(), q1)?.posicion.columna === 4
		&& firmaCircuito(await proyecto()) === firma);
	comprobar('cero errores JavaScript', erroresJS.length === 0);
	console.log(`ESQ-05 alinear vistas: ${casos}/${casos}, 0 JS; ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
} catch (error) {
	console.error(error);
	if (erroresJS.length) console.error('Errores JS:', erroresJS);
	process.exitCode = 1;
} finally {
	try { await pagina?.close(); }
	catch (error) { console.error('No se cerró la página:', error); process.exitCode = 1; }
	try { await navegador?.close(); }
	catch (error) { console.error('No se cerró Chromium:', error); process.exitCode = 1; }
	try {
		servidor?.closeAllConnections?.();
		if (servidor) await new Promise((resolve, reject) => servidor.close((error) => error ? reject(error) : resolve()));
	} catch (error) { console.error('No se cerró el servidor:', error); process.exitCode = 1; }
}
