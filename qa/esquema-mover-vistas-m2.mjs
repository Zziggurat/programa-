/** ESQ-05: arrastre M2 visible, propuesta pura, confirmación única y cancelación segura. */
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
const firmaCircuito = (p) => JSON.stringify([p.dispositivos, p.conductores]);
const vista = (p, id) => p.esquema.representaciones.find((r) => r.id === id);
const clave = (r) => `${r.hojaId}:${r.posicion.columna}:${r.posicion.fila}`;
const ocupadas = (p, excepto) => new Set(p.esquema.representaciones
	.filter((r) => r.id !== excepto).map(clave));
function libre(p, hojaId, excepto, columnaPreferida) {
	const hoja = p.hojas.find((h) => h.id === hojaId);
	const max = hoja?.columnas ?? p.esquema.columnasPorHoja ?? 10;
	const cols = [columnaPreferida, ...Array.from({ length: max }, (_, i) => i + 1)]
		.filter((n, i, a) => n >= 1 && n <= max && a.indexOf(n) === i);
	const usadas = ocupadas(p, excepto);
	for (const columna of cols) for (let fila = 1; fila <= 8; fila++) {
		if (!usadas.has(`${hojaId}:${columna}:${fila}`)) return { hojaId, columna, fila };
	}
	throw new Error(`No hay casilla libre en hoja ${hojaId}`);
}
async function puntoCasilla(p, casilla) {
	const hoja = p.hojas.find((h) => h.id === casilla.hojaId);
	const max = hoja?.columnas ?? p.esquema.columnasPorHoja ?? 10;
	const caja = await pagina.locator('#esquema-hoja svg').boundingBox();
	assert.ok(caja && caja.width > 0 && caja.height > 0);
	const xMm = 20 + (casilla.columna - 0.5) * (390 / max);
	const yMm = 60 + (casilla.fila - 1) * (151 / 7);
	return { x: caja.x + xMm / 420 * caja.width, y: caja.y + yMm / 297 * caja.height };
}
async function tomar(id) {
	const caja = await pagina.locator(`#esquema-hoja .simbolo[data-representacion="${id}"]`).boundingBox();
	assert.ok(caja && caja.width > 0 && caja.height > 0, `vista ${id} no visible`);
	await pagina.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
	await pagina.mouse.down();
}
async function soltarEn(p, casilla) {
	const punto = await puntoCasilla(p, casilla);
	await pagina.mouse.move(punto.x, punto.y, { steps: 2 });
	await pagina.mouse.up();
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
	const h1 = p0.hojas.find((h) => h.numero === 1)?.id;
	const h2 = p0.hojas.find((h) => h.numero === 2)?.id;
	assert.ok(h1 && h2);
	const id = await pagina.locator('#esquema-hoja .simbolo[data-representacion]').first().getAttribute('data-representacion');
	assert.ok(id);
	const origen = vista(p0, id);
	assert.ok(origen && origen.hojaId === h1);
	const destino = libre(p0, h1, id, origen.posicion.columna + 1);
	const firma = firmaCircuito(p0);
	const undo0 = (await historial()).deshacer;
	comprobar('ejemplo copiado tiene vistas M2 y dos folios', p0.esquema.representaciones.length > 2 && p0.hojas.length >= 2);

	await tomar(id);
	await pagina.evaluate(() => { window.__svgAntesMover = document.querySelector('#esquema-hoja svg'); });
	const punto = await puntoCasilla(p0, destino);
	await pagina.mouse.move(punto.x, punto.y, { steps: 2 });
	comprobar('destino libre se anuncia sin modificar documento ni Undo',
		await pagina.locator('#esq-movimiento-aviso').getAttribute('data-estado') === 'valido'
		&& clave(vista(await proyecto(), id)) === clave(origen)
		&& (await historial()).deshacer === undo0);
	comprobar('pointermove no reconstruye SVG ni cambia el grafo',
		await pagina.evaluate(() => document.querySelector('#esquema-hoja svg') === window.__svgAntesMover)
		&& firmaCircuito(await proyecto()) === firma
		&& await pagina.locator('#esquema-hoja .guia-suelta').count() === 1);
	await pagina.mouse.up();
	await pagina.waitForFunction(({ id, destino }) => {
		const r = window.qa.proyecto().esquema.representaciones.find((x) => x.id === id);
		return r?.hojaId === destino.hojaId && r?.posicion.columna === destino.columna
			&& r?.posicion.fila === destino.fila;
	}, { id, destino });
	comprobar('soltar aplica una sola vista y una sola captura Undo',
		(await historial()).deshacer === undo0 + 1
		&& firmaCircuito(await proyecto()) === firma
		&& await pagina.locator(`#esquema-hoja .simbolo[data-representacion="${id}"]`).count() === 1);
	comprobar('el feedback transitorio no queda en el SVG',
		await pagina.locator('#esq-movimiento-aviso').isHidden()
		&& await pagina.locator('#esquema-hoja .guia-suelta').count() === 0);

	const p1 = await proyecto();
	const ocupada = p1.esquema.representaciones.find((r) => r.id !== id && r.hojaId === h1);
	assert.ok(ocupada);
	const undo1 = (await historial()).deshacer;
	await tomar(id);
	const puntoOcupado = await puntoCasilla(p1, {
		hojaId: h1, columna: ocupada.posicion.columna, fila: ocupada.posicion.fila,
	});
	await pagina.mouse.move(puntoOcupado.x, puntoOcupado.y, { steps: 2 });
	comprobar('casilla ocupada muestra rechazo antes de soltar',
		await pagina.locator('#esq-movimiento-aviso').getAttribute('data-estado') === 'invalido'
		&& /ya tiene otra vista/.test(await pagina.locator('#esq-movimiento-aviso').textContent()));
	await pagina.mouse.up();
	comprobar('destino ocupado no muta ni captura historial',
		clave(vista(await proyecto(), id)) === clave(vista(p1, id))
		&& (await historial()).deshacer === undo1);
	await tomar(id);
	const cajaFuera = await pagina.locator('#esquema-hoja svg').boundingBox();
	assert.ok(cajaFuera);
	await pagina.mouse.move(cajaFuera.x + cajaFuera.width / 2,
		cajaFuera.y + 5 / 297 * cajaFuera.height, { steps: 2 });
	comprobar('fuera de la rejilla hay rechazo visible',
		await pagina.locator('#esq-movimiento-aviso').getAttribute('data-estado') === 'invalido');
	await pagina.mouse.up();
	comprobar('soltar fuera de límites tampoco modifica documento ni Undo',
		clave(vista(await proyecto(), id)) === clave(vista(p1, id))
		&& (await historial()).deshacer === undo1);
	await tomar(id);
	await pagina.mouse.up();
	comprobar('clic sin arrastre solo selecciona y no crea Undo',
		clave(vista(await proyecto(), id)) === clave(vista(p1, id))
		&& (await historial()).deshacer === undo1);

	const cancelable = libre(p1, h1, id, destino.columna + 1);
	await tomar(id);
	const pc = await puntoCasilla(p1, cancelable);
	await pagina.mouse.move(pc.x, pc.y, { steps: 2 });
	await pagina.keyboard.press('Escape');
	await pagina.mouse.up();
	comprobar('Escape cancela propuesta sin cerrar esquema ni mutar proyecto',
		await pagina.locator('#panel-esquema').isVisible()
		&& clave(vista(await proyecto(), id)) === clave(vista(p1, id))
		&& (await historial()).deshacer === undo1
		&& await pagina.locator('#esq-movimiento-aviso').isHidden());

	await pagina.evaluate(() => window.addEventListener('pointerdown',
		(e) => { window.__qaPunteroId = e.pointerId; }, { capture: true, once: true }));
	await tomar(id);
	await pagina.mouse.move(pc.x, pc.y, { steps: 2 });
	await pagina.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', {
		pointerId: window.__qaPunteroId, bubbles: true,
	})));
	await pagina.mouse.up();
	comprobar('pointercancel no se interpreta como commit',
		clave(vista(await proyecto(), id)) === clave(vista(p1, id))
		&& (await historial()).deshacer === undo1);

	await pagina.locator('#esq-ajustar').focus();
	await pagina.keyboard.press('Control+z');
	await pagina.waitForFunction(({ id, origen }) => {
		const r = window.qa.proyecto().esquema.representaciones.find((x) => x.id === id);
		return r?.hojaId === origen.hojaId && r?.posicion.columna === origen.posicion.columna
			&& r?.posicion.fila === origen.posicion.fila;
	}, { id, origen });
	comprobar('Undo restaura la vista de origen con el grafo eléctrico intacto',
		firmaCircuito(await proyecto()) === firma);
	await pagina.keyboard.press('Control+y');
	await pagina.waitForFunction(({ id, destino }) => {
		const r = window.qa.proyecto().esquema.representaciones.find((x) => x.id === id);
		return r?.hojaId === destino.hojaId && r?.posicion.columna === destino.columna
			&& r?.posicion.fila === destino.fila;
	}, { id, destino });
	comprobar('Redo recupera una sola vista sin duplicar conductor',
		firmaCircuito(await proyecto()) === firma);

	const p2 = await proyecto();
	const destinoOtroFolio = libre(p2, h2, id, 1);
	assert.equal(destinoOtroFolio.columna, 1, 'no hay fila libre en la primera columna del segundo folio');
	await tomar(id);
	const caja = await pagina.locator('#esquema-hoja svg').boundingBox();
	assert.ok(caja);
	const yMm = 60 + (destinoOtroFolio.fila - 1) * (151 / 7);
	await pagina.mouse.move(caja.x + 415 / 420 * caja.width, caja.y + yMm / 297 * caja.height,
		{ steps: 2 });
	comprobar('borde derecho propone el folio siguiente sin mutar antes de soltar',
		await pagina.locator('#esq-movimiento-aviso').getAttribute('data-estado') === 'valido'
		&& clave(vista(await proyecto(), id)) === clave(vista(p2, id)));
	await pagina.mouse.up();
	await pagina.waitForFunction(({ id, h2 }) => window.qa.proyecto().esquema.representaciones
		.find((r) => r.id === id)?.hojaId === h2, { id, h2 });
	comprobar('traslado entre folios conserva ID y navega por hojaId',
		clave(vista(await proyecto(), id)) === `${h2}:1:${destinoOtroFolio.fila}`
		&& (await pagina.locator('#esq-indicador').textContent()).includes('Hoja 2')
		&& firmaCircuito(await proyecto()) === firma);

	const final = await proyecto();
	await pagina.evaluate(() => window.qa.esperarPersistencia());
	await pagina.reload({ waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	comprobar('guardado y reapertura conservan el destino y el circuito',
		clave(vista(await proyecto(), id)) === clave(vista(final, id))
		&& firmaCircuito(await proyecto()) === firma);
	comprobar('cero errores JavaScript', erroresJS.length === 0);
	console.log(`ESQ-05 mover vistas: ${casos}/${casos}, 0 JS; ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
} catch (error) {
	console.error(error);
	if (erroresJS.length) console.error('Errores JS:', erroresJS);
	process.exitCode = 1;
} finally {
	const cierre = Date.now();
	try { await pagina?.close(); }
	catch (error) { console.error('No se cerró la página QA:', error); process.exitCode = 1; }
	const paginaMs = Date.now() - cierre;
	try { await navegador?.close(); }
	catch (error) { console.error('No se cerró Chromium QA:', error); process.exitCode = 1; }
	const navegadorMs = Date.now() - cierre - paginaMs;
	try {
		servidor?.closeAllConnections?.();
		if (servidor) await new Promise((resolve, reject) => servidor.close((error) => error ? reject(error) : resolve()));
	} catch (error) { console.error('No se cerró el servidor QA:', error); process.exitCode = 1; }
	console.log(`LIMPIEZA página=${paginaMs} ms Chromium=${navegadorMs} ms servidor=${Date.now() - cierre - paginaMs - navegadorMs} ms`);
}
