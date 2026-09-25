/** MON-01/02: editar coordenadas visibles de un riel conserva anclajes y una sola historia. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { abrirNavegador, esperarEditorListo, servidorDeQA, trabajarSobreCopia } from './lib/entorno.mjs';

let servidor, navegador, pagina;
let casos = 0;
const erroresJS = [];
const comprobar = (nombre, valor) => {
	casos++;
	assert.ok(valor, nombre);
	console.log(`OK ${nombre}`);
};
const proyecto = () => pagina.evaluate(() => window.qa.proyecto());
const historial = () => pagina.evaluate(() => window.qa.historial());
const firmaElectrica = (p) => JSON.stringify([p.dispositivos, p.conductores]);
const riel = (p, id) => p.gabinete.rieles.find((r) => r.id === id);
const anclados = (p, id) => p.gabinete.colocaciones.filter((c) => c.rielId === id)
	.map((c) => ({ id: c.dispositivoId, x: c.x, y: c.y, rielId: c.rielId }))
	.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

async function seleccionarRiel(id) {
	const punto = await pagina.evaluate((rielId) => window.qa.puntoDeEstructura('riel', rielId), id);
	assert.ok(punto, `el riel ${id} no tiene punto visible`);
	await pagina.mouse.click(punto.x, punto.y);
	await pagina.locator('#e-aplicar').waitFor({ state: 'visible' });
	assert.match(await pagina.locator('#panel-der h1').innerText(), new RegExp(id));
}

try {
	const entorno = await servidorDeQA(); servidor = entorno.servidor;
	navegador = await abrirNavegador(chromium);
	pagina = await navegador.newPage({ viewport: { width: 1440, height: 900 } });
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
	if (await pagina.locator('#modal-explicacion').isVisible()) await pagina.locator('#btn-cerrar-explicacion').click();
	assert.equal(await trabajarSobreCopia(pagina), true);
	assert.match(await pagina.locator('#modo-editor').getAttribute('class') ?? '', /activo/,
		'la copia abre en Editor; no hay que pulsar un modo oculto');
	await pagina.locator('#btn-centrar').click();

	const p0 = await proyecto();
	const id = p0.gabinete.rieles.find((r) => anclados(p0, r.id).length >= 2)?.id;
	assert.ok(id, 'el fixture necesita un riel con varios aparatos anclados');
	const r0 = riel(p0, id), a0 = anclados(p0, id);
	const electricidad = firmaElectrica(p0);
	await seleccionarRiel(id);
	comprobar('panel expresa X/Y/largo en milímetros de placa',
		await pagina.locator('#e-x').inputValue() === String(r0.x)
		&& await pagina.locator('#e-y').inputValue() === String(r0.y)
		&& /mm desde la esquina superior izquierda/i.test(await pagina.locator('#panel-der').innerText()));
	const undo0 = (await historial()).deshacer;
	await pagina.locator('#e-girar').click();
	comprobar('giro de riel ocupado se bloquea sin desanclar aparatos ni crear Undo',
		JSON.stringify(await proyecto()) === JSON.stringify(p0) && (await historial()).deshacer === undo0);
	await pagina.locator('#e-x').fill(String(r0.x + 5));
	await pagina.locator('#e-y').fill(String(r0.y + 20));
	await pagina.locator('#e-aplicar').click();
	await pagina.waitForFunction(({ id, x, y }) => {
		const r = window.qa.proyecto().gabinete.rieles.find((item) => item.id === id);
		return r?.x === x && r?.y === y;
	}, { id, x: r0.x + 5, y: r0.y + 20 });
	const p1 = await proyecto();
	comprobar('riel y TODOS sus anclados reciben el mismo delta, sin perder rielId',
		JSON.stringify(anclados(p1, id)) === JSON.stringify(a0.map((c) =>
			({ ...c, x: c.x + 5, y: c.y + 20 }))));
	comprobar('una sola operación Undo y grafo eléctrico inalterado',
		(await historial()).deshacer === undo0 + 1 && firmaElectrica(p1) === electricidad);
	comprobar('los otros rieles y sus aparatos no se desplazaron',
		p1.gabinete.rieles.filter((r) => r.id !== id).every((r) =>
			JSON.stringify(anclados(p1, r.id)) === JSON.stringify(anclados(p0, r.id))));
	await pagina.locator('#btn-deshacer').click();
	await pagina.waitForFunction(({ id, x, y }) => {
		const r = window.qa.proyecto().gabinete.rieles.find((item) => item.id === id);
		return r?.x === x && r?.y === y;
	}, { id, x: r0.x, y: r0.y });
	comprobar('Undo restaura soporte y aparatos juntos',
		JSON.stringify(anclados(await proyecto(), id)) === JSON.stringify(a0));
	await pagina.locator('#btn-rehacer').click();
	await pagina.waitForFunction(({ id, x, y }) => {
		const r = window.qa.proyecto().gabinete.rieles.find((item) => item.id === id);
		return r?.x === x && r?.y === y;
	}, { id, x: r0.x + 5, y: r0.y + 20 });
	comprobar('Redo restaura soporte, anclados y circuito',
		JSON.stringify(anclados(await proyecto(), id)) === JSON.stringify(anclados(p1, id))
		&& firmaElectrica(await proyecto()) === electricidad);

	await seleccionarRiel(id);
	const antesRechazo = JSON.stringify(await proyecto()), undo1 = (await historial()).deshacer;
	await pagina.locator('#e-largo').fill('60');
	await pagina.locator('#e-aplicar').click();
	comprobar('riel demasiado corto se rechaza sin mutación ni Undo',
		JSON.stringify(await proyecto()) === antesRechazo && (await historial()).deshacer === undo1);
	await pagina.locator('#e-largo').fill(String(r0.largo));
	await pagina.locator('#e-y').fill('260');
	await pagina.locator('#e-aplicar').click();
	comprobar('choque con otro riel se rechaza sin mover un solo aparato',
		JSON.stringify(await proyecto()) === antesRechazo && (await historial()).deshacer === undo1);
	await pagina.locator('#e-y').fill(String(r0.y + 20));
	await pagina.locator('#e-x').fill('');
	await pagina.locator('#e-aplicar').click();
	comprobar('campo vacío no se convierte en cero ni crea Undo',
		JSON.stringify(await proyecto()) === antesRechazo && (await historial()).deshacer === undo1);
	await pagina.locator('#e-x').fill(String(r0.x + 5));
	await pagina.locator('#e-aplicar').click();
	comprobar('aplicar las mismas medidas es no-op',
		JSON.stringify(await proyecto()) === antesRechazo && (await historial()).deshacer === undo1);

	const confirmado = await pagina.evaluate(() => window.qa.esperarPersistencia());
	comprobar('la revisión persistida conserva el riel y sus aparatos',
		riel(confirmado.proyecto, id).x === r0.x + 5
		&& JSON.stringify(anclados(confirmado.proyecto, id)) === JSON.stringify(anclados(p1, id)));
	await pagina.reload({ waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	await pagina.waitForFunction(({ id, x }) => window.qa.proyecto().gabinete.rieles
		.find((r) => r.id === id)?.x === x, { id, x: r0.x + 5 });
	comprobar('reapertura conserva identidad, montaje y circuito',
		JSON.stringify(anclados(await proyecto(), id)) === JSON.stringify(anclados(p1, id))
		&& firmaElectrica(await proyecto()) === electricidad);
	// El formulario general de estructura es otra entrada real a las medidas del mismo riel.
	await pagina.locator('#hta-estructura').click();
	if (!await pagina.locator('#seccion-estructura').evaluate((e) => e.open))
		await pagina.locator('#seccion-estructura > summary').click();
	const filaRiel = pagina.locator(`#lista-rieles .fila-estructura[data-id="${id}"]`);
	assert.equal(await filaRiel.count(), 1);
	const antesLista = await proyecto(), undoLista = (await historial()).deshacer;
	await filaRiel.locator('[data-campo="x"]').fill(String(r0.x + 5.5));
	await filaRiel.locator('[data-campo="y"]').fill(String(r0.y + 15));
	await pagina.locator('#aplicar-dim').click();
	const despuesLista = await proyecto();
	comprobar('la lista general mueve riel y anclados juntos con un único Undo',
		riel(despuesLista, id).x === r0.x + 5.5 && riel(despuesLista, id).y === r0.y + 15
		&& JSON.stringify(anclados(despuesLista, id)) === JSON.stringify(anclados(antesLista, id)
			.map((c) => ({ ...c, x: c.x + 0.5, y: c.y - 5 })))
		&& (await historial()).deshacer === undoLista + 1);
	comprobar('la lista muestra milímetros decimales sin redondear el modelo',
		await pagina.locator(`#lista-rieles .fila-estructura[data-id="${id}"] [data-campo="x"]`).inputValue()
		=== String(r0.x + 5.5));
	const firmaLista = JSON.stringify(despuesLista), undoRechazo = (await historial()).deshacer;
	await pagina.locator(`#lista-rieles .fila-estructura[data-id="${id}"] [data-campo="y"]`).fill('260');
	await pagina.locator('#aplicar-dim').click();
	comprobar('la lista general rechaza el choque sin mutación parcial ni Undo',
		JSON.stringify(await proyecto()) === firmaLista && (await historial()).deshacer === undoRechazo);
	await pagina.locator(`#lista-rieles .fila-estructura[data-id="${id}"] [data-campo="y"]`).fill('');
	await pagina.locator('#aplicar-dim').click();
	comprobar('la lista general no transforma vacío en origen cero',
		JSON.stringify(await proyecto()) === firmaLista && (await historial()).deshacer === undoRechazo);
	// Aparato DIN: la posición numérica no despega el clip ni usa cercanía como nuevo anclaje.
	await pagina.locator('#hta-seleccionar').click();
	if (!await pagina.locator('#seccion-dispositivos').evaluate((e) => e.open))
		await pagina.locator('#seccion-dispositivos summary').click();
	const aparatoId = 'q1';
	const designacion = (await proyecto()).dispositivos.find((d) => d.id === aparatoId).designacion;
	await pagina.locator('#lista-dispositivos li').filter({ hasText: designacion }).first().click();
	await pagina.locator('#pos-aparato-aplicar').waitFor({ state: 'visible' });
	const antesAparato = await proyecto();
	const colAntes = antesAparato.gabinete.colocaciones.find((c) => c.dispositivoId === aparatoId);
	const bultoAntes = await pagina.evaluate((id) => window.qa.bulto(id), aparatoId);
	const undoAparato = (await historial()).deshacer;
	comprobar('inspector de aparato expresa coordenadas reales y anclaje explícito',
		await pagina.locator('#pos-aparato-x').inputValue() === String(colAntes.x)
		&& /Anclado a r1: solo se mueve por el eje X/.test(await pagina.locator('#panel-der').innerText()));
	await pagina.locator('#pos-aparato-x').fill(String(colAntes.x + 5));
	await pagina.locator('#pos-aparato-aplicar').click();
	const despuesAparato = await proyecto();
	const colDespues = despuesAparato.gabinete.colocaciones.find((c) => c.dispositivoId === aparatoId);
	comprobar('aparato se mueve 5 mm sin cambiar rielId, circuito ni otros montajes',
		colDespues.x === colAntes.x + 5 && colDespues.y === colAntes.y
		&& colDespues.rielId === id
		&& firmaElectrica(despuesAparato) === firmaElectrica(antesAparato)
		&& despuesAparato.gabinete.colocaciones.every((c) => c.dispositivoId === aparatoId
			|| JSON.stringify(c) === JSON.stringify(antesAparato.gabinete.colocaciones.find((a) => a.dispositivoId === c.dispositivoId)))
		&& (await historial()).deshacer === undoAparato + 1);
	const bultoDespues = await pagina.evaluate((id) => window.qa.bulto(id), aparatoId);
	comprobar('la malla 3D y todos los cables siguen al modelo sin fantasmas',
		bultoAntes && bultoDespues && Math.abs((bultoDespues.x - bultoAntes.x) - 5) < 0.01
		&& await pagina.evaluate(() => window.qa.cablesDibujados() === window.qa.proyecto().conductores.length));
	const firmaAparato = JSON.stringify(despuesAparato), undoInvalido = (await historial()).deshacer;
	await pagina.locator('#pos-aparato-y').fill(String(colAntes.y + 10));
	await pagina.locator('#pos-aparato-aplicar').click();
	comprobar('mover fuera del eje DIN se rechaza sin despegar anclaje',
		JSON.stringify(await proyecto()) === firmaAparato && (await historial()).deshacer === undoInvalido);
	await pagina.locator('#pos-aparato-y').fill(String(colAntes.y));
	await pagina.locator('#pos-aparato-x').fill('100');
	await pagina.locator('#pos-aparato-aplicar').click();
	comprobar('solape con otro aparato se rechaza sin mutación',
		JSON.stringify(await proyecto()) === firmaAparato && (await historial()).deshacer === undoInvalido);
	await pagina.locator('#pos-aparato-x').fill('');
	await pagina.locator('#pos-aparato-aplicar').click();
	comprobar('campo de posición vacío no se convierte en cero',
		JSON.stringify(await proyecto()) === firmaAparato && (await historial()).deshacer === undoInvalido);
	await pagina.locator('#btn-deshacer').click();
	comprobar('Undo de aparato restaura solo su posición',
		(await proyecto()).gabinete.colocaciones.find((c) => c.dispositivoId === aparatoId).x === colAntes.x);
	await pagina.locator('#btn-rehacer').click();
	comprobar('Redo de aparato repone la posición y el anclaje',
		(await proyecto()).gabinete.colocaciones.find((c) => c.dispositivoId === aparatoId).x === colDespues.x
		&& (await proyecto()).gabinete.colocaciones.find((c) => c.dispositivoId === aparatoId).rielId === id);
	await pagina.evaluate(() => window.qa.esperarPersistencia());
	await pagina.reload({ waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	comprobar('posición numérica del aparato sobrevive reapertura',
		(await proyecto()).gabinete.colocaciones.find((c) => c.dispositivoId === aparatoId).x === colDespues.x
		&& (await proyecto()).gabinete.colocaciones.find((c) => c.dispositivoId === aparatoId).rielId === id);
	comprobar('ningún error JavaScript', erroresJS.length === 0);
	console.log(`MON-01/02 montaje numérico: ${casos}/${casos}, 0 JS`);
} catch (fallo) {
	console.error(fallo);
	process.exitCode = 1;
} finally {
	await pagina?.close().catch(() => {});
	await navegador?.close().catch(() => {});
	if (servidor) await new Promise((resolve) => servidor.close(resolve));
}
