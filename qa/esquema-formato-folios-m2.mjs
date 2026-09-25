/** ESQ-07: A2/A3 por folio, edición visible, rejilla de arrastre y entrega SVG. */
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
const confirmar = () => pagina.locator('#dialogo-ok').click();

function casillaLibre(p, hojaId, vistaId) {
	const actual = vista(p, vistaId);
	const ocupadas = new Set(p.esquema.representaciones
		.filter((r) => r.id !== vistaId && r.hojaId === hojaId)
		.map((r) => `${r.posicion.columna}:${r.posicion.fila}`));
	const hoja = p.hojas.find((h) => h.id === hojaId);
	const columnas = hoja?.columnas ?? p.esquema.columnasPorHoja ?? 10;
	for (let col = 1; col <= columnas; col++) for (let fila = 1; fila <= 8; fila++) {
		if ((col !== actual.posicion.columna || fila !== actual.posicion.fila)
			&& !ocupadas.has(`${col}:${fila}`)) return { columna: col, fila };
	}
	throw new Error(`No hay casilla libre en ${hojaId}`);
}

async function puntoCasilla(hoja, columnas, posicion) {
	const caja = await pagina.locator('#esquema-hoja svg').boundingBox();
	assert.ok(caja && caja.width > 0 && caja.height > 0);
	const xMm = 20 + (posicion.columna - 0.5) * ((hoja.anchoMm - 30) / columnas);
	const arriba = 14 + 28 + 18;
	const abajo = hoja.altoMm - 34 - 34 - 18;
	const yMm = arriba + (posicion.fila - 1) * (abajo - arriba) / 7;
	return { x: caja.x + xMm / hoja.anchoMm * caja.width,
		y: caja.y + yMm / hoja.altoMm * caja.height };
}

async function textoDescarga(descarga) {
	const flujo = await descarga.createReadStream();
	assert.ok(flujo);
	const trozos = [];
	for await (const trozo of flujo) trozos.push(trozo);
	return Buffer.concat(trozos).toString('utf8');
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
	if (await pagina.locator('#modal-dialogo').isVisible()) await confirmar();
	await pagina.waitForFunction(() => window.qa.proyecto().nombre === 'Arranque directo de motor 380 V');
	if (await pagina.locator('#modal-explicacion').isVisible())
		await pagina.locator('#btn-cerrar-explicacion').click();
	assert.equal(await trabajarSobreCopia(pagina), true);
	await pagina.locator('#hta-seleccionar').click();
	await pagina.locator('#btn-esquema').click();
	await pagina.locator('#esq-activar-vistas').click();
	await confirmar();
	await pagina.waitForFunction(() => window.qa.proyecto().esquema?.representaciones?.length > 0);
	const p0 = await proyecto();
	const h1 = p0.hojas.find((h) => h.numero === 1)?.id;
	const h2 = p0.hojas.find((h) => h.numero === 2)?.id;
	assert.ok(h1 && h2);
	const firma = firmaCircuito(p0);
	comprobar('documento anterior conserva A3 implícito',
		p0.hojas.every((h) => h.formatoPapel === undefined)
		&& await pagina.locator('#esquema-hoja svg').getAttribute('viewBox') === '0 0 420 297');

	await pagina.locator('#esq-folios').click();
	await pagina.locator('#esq-folio-formato').selectOption('A2');
	const antes = JSON.stringify(await proyecto());
	const undo0 = (await historial()).deshacer;
	await pagina.locator('#esq-folio-guardar').click();
	comprobar('A2 muestra preview sin escribir antes de confirmar',
		(await pagina.locator('#dialogo-msg').textContent()).includes('A2')
		&& JSON.stringify(await proyecto()) === antes
		&& (await historial()).deshacer === undo0);
	await pagina.locator('#dialogo-cancelar').click();
	comprobar('cancelar formato no crea Undo ni cambia el papel',
		JSON.stringify(await proyecto()) === antes && (await historial()).deshacer === undo0);
	await pagina.locator('#esq-folio-guardar').click();
	await confirmar();
	await pagina.waitForFunction((id) => window.qa.proyecto().hojas.find((h) => h.id === id)?.formatoPapel === 'A2', h1);
	comprobar('formato A2 se guarda con una captura y sin alterar circuito',
		(await historial()).deshacer === undo0 + 1
		&& firmaCircuito(await proyecto()) === firma
		&& (await proyecto()).hojas.find((h) => h.id === h2)?.formatoPapel === undefined);
	comprobar('folio A2 montado conserva vista 594×420 y etiqueta visible',
		await pagina.locator('#esquema-hoja svg').getAttribute('viewBox') === '0 0 594 420'
		&& /A2/.test(await pagina.locator('#esq-formato-actual').textContent()));
	const tamanoConPanel = await pagina.locator('#esquema-hoja').boundingBox();
	await pagina.locator('#esq-folios-cerrar').click();
	const tamanoSinPanel = await pagina.locator('#esquema-hoja').boundingBox();
	comprobar('cerrar Folios recupera el ajuste visible del lienzo A2',
		!!tamanoConPanel && !!tamanoSinPanel && tamanoSinPanel.width > tamanoConPanel.width * 1.3);
	if (process.env.ESQ07_FORMATO_CAPTURAS) {
		await pagina.locator('#esquema-hoja').screenshot({ path: `${process.env.ESQ07_FORMATO_CAPTURAS}/folio-a2.png` });
	}

	const pA2 = await proyecto();
	const id = await pagina.locator('#esquema-hoja .simbolo[data-representacion]')
		.first().getAttribute('data-representacion');
	assert.ok(id && vista(pA2, id)?.hojaId === h1);
	const origen = vista(pA2, id);
	const destino = casillaLibre(pA2, h1, id);
	const columnas = pA2.hojas.find((h) => h.id === h1)?.columnas ?? pA2.esquema.columnasPorHoja ?? 10;
	const simbolo = await pagina.locator(`#esquema-hoja .simbolo[data-representacion="${id}"]`).boundingBox();
	assert.ok(simbolo && simbolo.width > 0 && simbolo.height > 0);
	await pagina.mouse.move(simbolo.x + simbolo.width / 2, simbolo.y + simbolo.height / 2);
	await pagina.mouse.down();
	const punto = await puntoCasilla({ anchoMm: 594, altoMm: 420 }, columnas, destino);
	await pagina.mouse.move(punto.x, punto.y, { steps: 2 });
	comprobar('rejilla A2 anuncia la casilla exacta sin mutar durante pointermove',
		await pagina.locator('#esq-movimiento-aviso').getAttribute('data-estado') === 'valido'
		&& (await pagina.locator('#esq-movimiento-aviso').textContent()).includes(`${destino.columna}.${destino.fila}`)
		&& vista(await proyecto(), id)?.posicion.columna === origen.posicion.columna
		&& (await historial()).deshacer === undo0 + 1);
	await pagina.mouse.up();
	await pagina.waitForFunction(({ id, destino }) => {
		const r = window.qa.proyecto().esquema.representaciones.find((v) => v.id === id);
		return r?.posicion.columna === destino.columna && r?.posicion.fila === destino.fila;
	}, { id, destino });
	comprobar('soltar en A2 preserva ID y circuito y añade un Undo',
		(await historial()).deshacer === undo0 + 2
		&& firmaCircuito(await proyecto()) === firma
		&& vista(await proyecto(), id)?.hojaId === h1);

	const descargaSvg = pagina.waitForEvent('download');
	await pagina.locator('#esq-svg').click();
	const svg = await textoDescarga(await descargaSvg);
	comprobar('SVG entregable A2 usa tamaño físico del folio', /viewBox="0 0 594 420"/.test(svg));
	await pagina.locator('#esq-siguiente').click();
	comprobar('segunda hoja permanece A3 en el mismo documento',
		await pagina.locator('#esquema-hoja svg').getAttribute('viewBox') === '0 0 420 297'
		&& /A3/.test(await pagina.locator('#esq-formato-actual').textContent()));
	if (process.env.ESQ07_FORMATO_CAPTURAS) {
		await pagina.locator('#esquema-hoja').screenshot({ path: `${process.env.ESQ07_FORMATO_CAPTURAS}/folio-a3.png` });
	}
	await pagina.evaluate(() => window.qa.esperarPersistencia());
	await pagina.reload({ waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	const reabierto = await proyecto();
	comprobar('reapertura conserva A2/A3 por ID y movimiento',
		reabierto.hojas.find((h) => h.id === h1)?.formatoPapel === 'A2'
		&& reabierto.hojas.find((h) => h.id === h2)?.formatoPapel === undefined
		&& vista(reabierto, id)?.posicion.columna === destino.columna
		&& vista(reabierto, id)?.posicion.fila === destino.fila
		&& firmaCircuito(reabierto) === firma);
	comprobar('cero errores JavaScript', erroresJS.length === 0);
	console.log(`ESQ-07 formato por folio: ${casos}/${casos}, 0 JS; ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
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
