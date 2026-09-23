/** CMP-06: vínculo visible PRODUCTO V8 exacto y roundtrip individual .tscomp V2. */
import { chromium } from 'playwright-core';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7xQAAAAASUVORK5CYII=', 'base64');
const inicio = Date.now();
const temporal = mkdtempSync(join(tmpdir(), 'qa-m1-ficha-'));
const cwd = process.cwd(), logAnterior = process.env.CHROME_LOG_FILE;
process.env.CHROME_LOG_FILE = join(temporal, 'chromium.log'); process.chdir(temporal);
let browser, servidor, checks = 0, fallos = 0, timeouts = 0;
const errores = [];
const ok = (nombre, pasa) => {
	checks++; if (!pasa) fallos++;
	console.log(`${pasa ? 'OK  ' : 'FAIL'} ${nombre}`);
};
const vigilar = pagina => {
	pagina.setDefaultTimeout(30_000);
	pagina.on('pageerror', error => errores.push(String(error)));
	pagina.on('console', mensaje => { if (mensaje.type() === 'error' && !/favicon\.ico/.test(mensaje.location().url ?? '')) errores.push(mensaje.text()); });
};
async function iniciar(pagina, url) {
	await pagina.goto(`${url}/?qa=1&inicio=0`); await esperarEditorListo(pagina);
	for (const selector of ['#btn-cerrar-ayuda', '#btn-cerrar-explicacion', '#btn-empezar-blanco']) {
		if (await pagina.locator(selector).isVisible()) await pagina.locator(selector).click();
	}
}
const dt = pagina => pagina.locator('#modal-datos-tecnicos');
async function crearProducto(pagina) {
	await pagina.locator('#btn-datos-tecnicos').click();
	const modal = dt(pagina), input = nombre => modal.locator(`[data-dt-input="${nombre}"]`);
	await modal.locator('[data-dt="nuevo"]').click();
	await input('producto-id').fill('proteccion-cmp06-m1');
	await input('nombre').fill('Protección CMP-06 sintética');
	await input('fuente').fill('Ensayo QA local sin certificación');
	await input('origen').selectOption('SINTETICO');
	await modal.locator('[data-dt="campo"]').click();
	await input('campo').selectOption('proteccion.Icu'); await input('valor').fill('6');
	await input('sistema').selectOption('AC'); await input('tension').fill('230');
	await modal.locator('[data-dt-guardar-campo]').click();
	await modal.locator('[data-dt="publicar"]').click();
	await pagina.locator('#modal-dialogo').waitFor({ state: 'visible' });
	await pagina.locator('#dialogo-ok').click();
	await modal.locator('[data-dt-estado]').filter({ hasText: 'Revisión publicada' }).waitFor();
	const descarga = pagina.waitForEvent('download'); await modal.locator('[data-dt="exportar"]').click();
	const producto = JSON.parse(readFileSync(await (await descarga).path(), 'utf8')).revisiones.find(r => r.tipo === 'PRODUCTO');
	ok('producto V8 publicado por UI con familia protección y hash exacto', producto?.familia === 'PROTECCION' && /^sha256:[0-9a-f]{64}$/.test(producto.hash));
	await modal.locator('[data-dt="cerrar"]').click();
	return producto;
}
const cp = pagina => pagina.locator('#ui-componentes-personalizados');
async function abrirComponentes(pagina) {
	await pagina.locator('#btn-componentes-personalizados').click(); await cp(pagina).waitFor({ state: 'visible' });
}
async function crearComponente(pagina, producto) {
	await abrirComponentes(pagina); await cp(pagina).locator('[data-cp="nuevo"]').click();
	await cp(pagina).locator('[data-cp-campo="nombre"]').fill('Disyuntor CMP-06 QA');
	await cp(pagina).locator('[data-cp-campo="referencia"]').fill('QA-CMP-06');
	await cp(pagina).locator('[data-cp="siguiente"]').click();
	await cp(pagina).locator('[data-cp-campo="tipo"]').selectOption('disyuntor');
	await cp(pagina).locator('[data-cp="siguiente"]').click();
	const archivo = pagina.waitForEvent('filechooser'); await cp(pagina).locator('[data-cp="imagen"]').click();
	await (await archivo).setFiles({ name: 'disyuntor-cmp06.png', mimeType: 'image/png', buffer: PNG });
	await cp(pagina).locator('[data-cp="preview"] img').waitFor({ state: 'visible' });
	for (const posicion of [{ x: 45, y: 25 }, { x: 45, y: 145 }]) {
		await cp(pagina).locator('[data-cp="preview"] img').click({ position: posicion });
	}
	const filas = cp(pagina).locator('[data-cp="terminales"] tr');
	await filas.nth(1).waitFor();
	for (const [indice, id, rol] of [[0, 'L1', 'polo-entrada'], [1, 'T1', 'polo-salida']]) {
		const fila = filas.nth(indice);
		await fila.locator('input').first().fill(id);
		await fila.locator('select').nth(0).selectOption('L');
		await fila.locator('select').nth(1).selectOption(rol);
		await fila.locator('input').nth(1).fill('p1');
		await fila.locator('input').nth(2).fill(indice === 0 ? '1/L1' : '2/T1');
	}
	ok('rótulo visible difiere del ID eléctrico y respeta el ancla u/v de la imagen',
		(await cp(pagina).locator('.cp-marca').first().innerText()).includes('1/L1')
		&& await cp(pagina).locator('[data-cp="preview"] img').count() === 1);
	await cp(pagina).locator('[data-cp="agregar-bloque"]').click();
	const bloque = cp(pagina).locator('[data-cp-bloque="0"]');
	await bloque.getByLabel('Rótulo del bloque').fill('Potencia');
	ok('un borne sin bloque se informa NO_EVALUABLE en vez de afirmar ubicación',
		/NO_EVALUABLE/.test(await cp(pagina).locator('[data-cp="bloques-estado"]').innerText()));
	await cp(pagina).locator('[data-cp="agregar-bloque"]').click();
	ok('dos bloques vecinos sin rangos quedan NO_EVALUABLE, no ubicados físicamente',
		/NO_EVALUABLE.*sin rangos explícitos/.test(await cp(pagina).locator('[data-cp="bloques-estado"]').innerText()));
	await cp(pagina).locator('[data-cp-bloque="1"]').getByRole('button', { name: 'Quitar bloque' }).click();
	await bloque.getByRole('button', { name: 'Añadir borne al bloque' }).click();
	await bloque.locator('[data-cp-bloque-campo="desde"]').fill('10');
	await bloque.locator('[data-cp-bloque-campo="hasta"]').fill('90');
	ok('bloque físico declara lado, orden L1→T1 y tramo evaluable',
		(await bloque.locator('[data-cp-bloque-borne="0"]').inputValue()) === 'L1'
		&& (await bloque.locator('[data-cp-bloque-borne="1"]').inputValue()) === 'T1'
		&& /GEOMETRIA_DECLARADA/.test(await cp(pagina).locator('[data-cp="bloques-estado"]').innerText()));
	await pagina.setViewportSize({ width: 1024, height: 768 });
	await cp(pagina).locator('.cp-cuerpo').evaluate(elemento => { elemento.scrollTop = elemento.scrollHeight; });
	const botonBloque = await cp(pagina).locator('[data-cp="agregar-bloque"]').boundingBox();
	const pieBloques = await cp(pagina).locator('.cp-navegacion').boundingBox();
	ok('bloques editables alcanzables sin quedar bajo el pie fijo a 1024 px',
		!!botonBloque && !!pieBloques && botonBloque.y + botonBloque.height <= pieBloques.y + 1);
	await pagina.screenshot({ path: join(temporal, 'bloques-1024.png') });
	await pagina.setViewportSize({ width: 1366, height: 900 });
	await cp(pagina).locator('[data-cp="siguiente"]').click();
	await cp(pagina).locator('[data-cp="siguiente"]').click();
	const selector = cp(pagina).locator('[data-cp="producto-tecnico"]');
	await selector.waitFor();
	ok('solo se ofrecen PRODUCTO de familia explícita compatible', await selector.locator('option').count() === 2
		&& (await cp(pagina).locator('[data-cp="ficha-estado"]').innerText()).includes('PROTECCION'));
	await selector.selectOption({ index: 1 });
	ok('selección muestra hash, fuente y aviso de integridad no autenticidad',
		(await cp(pagina).locator('[data-cp="detalle-ficha"]').innerText()).includes(producto.hash)
		&& /NO autenticidad/.test(await cp(pagina).locator('[data-cp="detalle-ficha"]').innerText()));
	await cp(pagina).locator('[data-cp="vincular-ficha"]').click();
	ok('vínculo exacto requiere confirmación visible y no modifica parámetros',
		(await cp(pagina).locator('[data-cp="ficha-contenido"]').innerText()).includes(producto.hash)
		&& /fijadas en el borrador/.test(await cp(pagina).locator('[data-cp="ficha-estado"]').innerText()));
	await cp(pagina).locator('[data-cp="siguiente"]').click();
	ok('resumen final identifica la revisión técnica y su procedencia no certificada',
		(await cp(pagina).locator('[data-cp="resumen"]').innerText()).includes(producto.hash));
	await cp(pagina).locator('[data-cp="validar"]').click();
	await cp(pagina).locator('[data-cp="errores"].cp-ok').waitFor();
	await cp(pagina).locator('[data-cp="guardar"]').click();
	await cp(pagina).locator('.cp-tarjeta').filter({ hasText: 'Disyuntor CMP-06 QA' }).waitFor();
}
async function exportar(pagina) {
	const descarga = pagina.waitForEvent('download');
	await cp(pagina).locator('.cp-tarjeta').filter({ hasText: 'Disyuntor CMP-06 QA' })
		.getByRole('button', { name: 'Exportar', exact: true }).click();
	return JSON.parse(readFileSync(await (await descarga).path(), 'utf8'));
}
const limite = setTimeout(() => {
	timeouts++; fallos++; console.error(`TIMEOUT ficha CMP-06 (${checks} comprobaciones alcanzadas)`);
	void browser?.close(); servidor?.closeAllConnections?.();
}, 8 * 60_000); limite.unref();
try {
	const servicio = await servidorDeQA(); servidor = servicio.servidor;
	browser = await abrirNavegador(chromium);
	const contexto = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
	const pagina = await contexto.newPage(); vigilar(pagina); await iniciar(pagina, servicio.url);
	const producto = await crearProducto(pagina);
	await crearComponente(pagina, producto);
	const paquete = await exportar(pagina);
	ok('la UI exporta .tscomp V2 con cierre PRODUCTO exacto', paquete.version === 2
		&& paquete.definicion.fichaTecnica?.producto.hash === producto.hash
		&& paquete.definicion.fichaTecnica.revisiones.length === 1);
	ok('el paquete conserva rótulos, orden, lado y tramo físico independientes de anclas u/v',
		paquete.definicion.terminales[0].id === 'L1' && paquete.definicion.terminales[0].rotulo === '1/L1'
		&& paquete.definicion.terminales[0].u !== undefined
		&& paquete.definicion.bloquesTerminales?.[0].lado === 'arriba'
		&& paquete.definicion.bloquesTerminales[0].desde === .1
		&& paquete.definicion.bloquesTerminales[0].hasta === .9
		&& paquete.definicion.bloquesTerminales[0].bornes.join(',') === 'L1,T1');
	const tarjeta = cp(pagina).locator('.cp-tarjeta').filter({ hasText: 'Disyuntor CMP-06 QA' });
	await tarjeta.getByRole('button', { name: 'Editar', exact: true }).click();
	await cp(pagina).locator('[data-cp-ir="apariencia"]').click();
	await cp(pagina).locator('[data-cp="producto-tecnico"]').waitFor();
	ok('editar conserva la ficha fijada sin volver a seleccionarla',
		(await cp(pagina).locator('.cp-ficha-actual').innerText()).includes(producto.hash));
	await cp(pagina).locator('[data-cp-ir="revision"]').click();
	await cp(pagina).locator('[data-cp="validar"]').click();
	await cp(pagina).locator('[data-cp="errores"].cp-ok').waitFor();
	await cp(pagina).locator('[data-cp="guardar"]').click();
	await cp(pagina).locator('.cp-tarjeta').filter({ hasText: 'revisión 2' }).waitFor();
	const revision = await exportar(pagina);
	ok('guardar revisión conserva el mismo cierre técnico exacto', revision.definicion.revision === 2
		&& revision.definicion.fichaTecnica?.producto.hash === producto.hash);
	const limpio = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
	const segunda = await limpio.newPage(); vigilar(segunda); await iniciar(segunda, servicio.url);
	await abrirComponentes(segunda);
	const archivo = segunda.waitForEvent('filechooser'); await cp(segunda).locator('[data-cp="importar"]').click();
	await (await archivo).setFiles({ name: 'disyuntor-v2.tscomp.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(revision)) });
	await cp(segunda).locator('.cp-tarjeta').filter({ hasText: 'Disyuntor CMP-06 QA' }).waitFor();
	const importado = await exportar(segunda);
	ok('importación en almacenamiento limpio conserva imagen y ficha exacta', importado.version === 2
		&& importado.asset.id === revision.asset.id
		&& importado.definicion.fichaTecnica?.producto.hash === producto.hash
		&& importado.definicion.bloquesTerminales?.[0].bornes.join(',') === 'L1,T1');
	await cp(segunda).locator('.cp-tarjeta').filter({ hasText: 'Disyuntor CMP-06 QA' })
		.getByRole('button', { name: 'Editar', exact: true }).click();
	await cp(segunda).locator('[data-cp-ir="apariencia"]').click();
	ok('la ficha portable se ve aun sin catálogo global en el destino',
		(await cp(segunda).locator('[data-cp="ficha-contenido"]').innerText()).includes(producto.hash));
	await segunda.setViewportSize({ width: 1024, height: 768 });
	await cp(segunda).locator('.cp-cuerpo').evaluate(elemento => { elemento.scrollTop = elemento.scrollHeight; });
	const accion = await cp(segunda).locator('[data-cp="desvincular-ficha"]').boundingBox();
	const pie = await cp(segunda).locator('.cp-navegacion').boundingBox();
	ok('ficha y acción final alcanzables al desplazarse sin taparse bajo el pie fijo a 1024 px',
		!!accion && !!pie && accion.y + accion.height <= pie.y + 1);
	await segunda.screenshot({ path: join(temporal, 'ficha-portable.png') });
	await limpio.close(); await contexto.close();
} catch (error) {
	fallos++; if (error?.name === 'TimeoutError') timeouts++;
	console.error('FAIL ficha CMP-06:', error.stack ?? error);
} finally {
	clearTimeout(limite); ok('Sin errores JavaScript', errores.length === 0); if (errores.length) console.error(errores);
	try { await browser?.close(); } catch (error) { fallos++; console.error(error); }
	try { servidor?.closeAllConnections?.(); if (servidor?.listening) await new Promise((resolver, rechazar) => servidor.close(error => error ? rechazar(error) : resolver())); } catch (error) { fallos++; console.error(error); }
	process.chdir(cwd); if (logAnterior === undefined) delete process.env.CHROME_LOG_FILE; else process.env.CHROME_LOG_FILE = logAnterior;
	console.log(`Evidencia visual: ${temporal}`);
	console.log(`QA ficha-componente-m1: ${checks} comprobaciones; ${fallos} fallos; ${timeouts} timeouts; 0 skipped; ${(Date.now() - inicio) / 1000} s.`);
	process.exitCode = fallos ? 1 : 0;
}
