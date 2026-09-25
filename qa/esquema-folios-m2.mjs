/** ESQ-07: folios M2 por identidad, con preview, Undo y reapertura real. */
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
const confirmar = () => pagina.locator('#dialogo-ok').click();

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
	comprobar('legacy no ofrece gestión explícita de folios', await pagina.locator('#esq-folios').isHidden());
	await pagina.locator('#esq-activar-vistas').click();
	await confirmar();
	await pagina.waitForFunction(() => window.qa.proyecto().esquema?.representaciones?.length > 0);
	comprobar('al activar vistas M2 se ofrece Folios', await pagina.locator('#esq-folios').isVisible());
	await pagina.locator('#esq-folios').click();
	const antesCancelado = JSON.stringify(await proyecto());
	const historialAntes = await historial();
	await pagina.locator('#esq-folio-nuevo-titulo').fill('No guardar');
	await pagina.locator('#esq-folio-crear').click();
	comprobar('preview de alta identifica folio y no crea al preparar',
		(await pagina.locator('#dialogo-msg').textContent()).includes('No guardar')
		&& JSON.stringify(await proyecto()) === antesCancelado);
	await pagina.locator('#dialogo-cancelar').click();
	comprobar('cancelar conserva documento e historial',
		JSON.stringify(await proyecto()) === antesCancelado
		&& (await historial()).deshacer === historialAntes.deshacer);
	await pagina.locator('#esq-folio-nuevo-titulo').fill('Diagnóstico de bornes');
	await pagina.locator('#esq-folio-nueva-clase').selectOption('bornes');
	await pagina.locator('#esq-folio-nuevas-columnas').fill('8');
	await pagina.locator('#esq-folio-crear').click();
	const vistaPrevia = await pagina.locator('#dialogo-msg').textContent();
	comprobar('preview incluye ID, clase, columnas y delta editorial',
		/hoja-[\da-f-]+/.test(vistaPrevia) && vistaPrevia.includes('bornes')
		&& vistaPrevia.includes('8 col.') && vistaPrevia.includes('2 → 3 hojas'));
	await confirmar();
	await pagina.waitForFunction(() => window.qa.proyecto().hojas.length === 3);
	const creado = (await proyecto()).hojas.find((h) => h.titulo === 'Diagnóstico de bornes');
	assert.ok(creado?.id.startsWith('hoja-'));
	comprobar('crear selecciona la nueva hoja por ID estable',
		creado.numero === 3 && creado.clase === 'bornes' && creado.columnas === 8
		&& (await pagina.locator('#esq-indicador').textContent()).includes('Hoja 3 / 3')
		&& await pagina.locator(`#esq-folios-lista .actual [data-hoja-id="${creado.id}"]`).count() === 1);
	if (process.env.ESQ07_SCREENSHOT) {
		await pagina.screenshot({ path: process.env.ESQ07_SCREENSHOT });
		console.log(`CAPTURA_REVISION=${process.env.ESQ07_SCREENSHOT}`);
	}
	await pagina.locator('#esq-folios-lista [data-hoja-id="h1"]').focus();
	await pagina.keyboard.press('Enter');
	comprobar('selección por Enter conserva foco en el folio tras repintar la lista',
		await pagina.evaluate(() => document.activeElement?.getAttribute('data-hoja-id') === 'h1')
		&& (await pagina.locator('#esq-indicador').textContent()).includes('Hoja 1 / 3'));
	await pagina.locator(`#esq-folios-lista [data-hoja-id="${creado.id}"]`).focus();
	await pagina.keyboard.press('Enter');
	comprobar('volver al folio nuevo por teclado conserva su ID',
		await pagina.evaluate((id) => document.activeElement?.getAttribute('data-hoja-id') === id, creado.id)
		&& (await pagina.locator('#esq-indicador').textContent()).includes('Hoja 3 / 3'));
	await pagina.locator('#esq-folio-subir').click();
	comprobar('preview de orden cita dos IDs sin cambiar aún Proyecto',
		(await pagina.locator('#dialogo-msg').textContent()).includes(creado.id)
		&& (await proyecto()).hojas.find((h) => h.id === creado.id)?.numero === 3);
	await confirmar();
	await pagina.waitForFunction((id) => window.qa.proyecto().hojas.find((h) => h.id === id)?.numero === 2, creado.id);
	comprobar('reordenar conserva selección del ID, no el viejo índice',
		(await pagina.locator('#esq-indicador').textContent()).includes('Hoja 2 / 3')
		&& await pagina.locator(`#esq-folios-lista .actual [data-hoja-id="${creado.id}"]`).count() === 1);
	await pagina.locator('#esq-folio-titulo').fill('Revisión de bornes');
	await pagina.locator('#esq-folio-clase').selectOption('mixta');
	await pagina.locator('#esq-folio-columnas').fill('9');
	const undoAntesEdicion = (await historial()).deshacer;
	await pagina.locator('#esq-folio-guardar').click();
	comprobar('preview de edición incluye título, clase y columnas explícitos',
		(await pagina.locator('#dialogo-msg').textContent()).includes('Revisión de bornes')
		&& (await pagina.locator('#dialogo-msg').textContent()).includes('mixta')
		&& (await pagina.locator('#dialogo-msg').textContent()).includes('9 col.'));
	await confirmar();
	await pagina.waitForFunction((id) => window.qa.proyecto().hojas.find((h) => h.id === id)?.titulo === 'Revisión de bornes', creado.id);
	comprobar('edición crea una sola entrada Undo', (await historial()).deshacer === undoAntesEdicion + 1);
	// Los inputs conservan su Undo de texto; el atajo del proyecto actúa con foco fuera del campo.
	await pagina.locator('#esq-folio-guardar').focus();
	await pagina.keyboard.press('Control+z');
	await pagina.waitForFunction((id) => window.qa.proyecto().hojas.find((h) => h.id === id)?.titulo === 'Diagnóstico de bornes', creado.id);
	const deshecho = (await proyecto()).hojas.find((h) => h.id === creado.id);
	comprobar('Undo devuelve título/clase/columnas sin perder hoja seleccionada',
		deshecho?.clase === 'bornes' && deshecho.columnas === 8
		&& await pagina.locator(`#esq-folios-lista .actual [data-hoja-id="${creado.id}"]`).count() === 1);
	await pagina.keyboard.press('Control+y');
	await pagina.waitForFunction((id) => window.qa.proyecto().hojas.find((h) => h.id === id)?.titulo === 'Revisión de bornes', creado.id);
	await pagina.locator('#esq-folios-lista [data-hoja-id="h1"]').click();
	comprobar('borrar hoja poblada está bloqueado con causa visible',
		await pagina.locator('#esq-folio-eliminar').isDisabled()
		&& /contiene vistas o referencias/.test(await pagina.locator('#esq-folios-borrar-motivo').textContent()));
	const antesReduccion = JSON.stringify(await proyecto());
	await pagina.locator('#esq-folio-columnas').fill('4');
	await pagina.locator('#esq-folio-guardar').click();
	comprobar('reducir ancho bajo vistas existentes se rechaza sin mutación',
		/columnas dejaría fuera las vistas/.test(await pagina.locator('#toast').textContent())
		&& JSON.stringify(await proyecto()) === antesReduccion);
	await pagina.locator(`#esq-folios-lista [data-hoja-id="${creado.id}"]`).click();
	await pagina.evaluate(() => window.qa.esperarPersistencia());
	await pagina.reload({ waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	const reabierto = (await proyecto()).hojas.find((h) => h.id === creado.id);
	comprobar('guardado/reapertura conserva ID, número, título, clase y columnas',
		reabierto?.numero === 2 && reabierto.titulo === 'Revisión de bornes'
		&& reabierto.clase === 'mixta' && reabierto.columnas === 9);
	await pagina.locator('#btn-esquema').click();
	await pagina.locator('#esq-folios').click();
	await pagina.locator(`#esq-folios-lista [data-hoja-id="${creado.id}"]`).click();
	comprobar('reapertura permite navegar al mismo folio por ID',
		(await pagina.locator('#esq-indicador').textContent()).includes('Hoja 2 / 3'));
	await pagina.locator('#esq-folio-columnas').fill('');
	await pagina.locator('#esq-folio-guardar').click();
	const previewHerencia = await pagina.locator('#dialogo-msg').textContent();
	comprobar('limpiar columnas propone herencia, no una omisión invisible',
		previewHerencia.includes('9 col. (fijadas)') && previewHerencia.includes('10 col. (heredadas)'));
	await confirmar();
	await pagina.waitForFunction((id) => !Object.hasOwn(window.qa.proyecto().hojas.find((h) => h.id === id) ?? {}, 'columnas'), creado.id);
	comprobar('confirmar restaura herencia persistente y ancho efectivo global',
		(await proyecto()).hojas.find((h) => h.id === creado.id)?.columnas === undefined
		&& await pagina.locator('#esq-columnas').inputValue() === '10');
	await pagina.locator('#esq-folio-eliminar').click();
	comprobar('eliminar vacía exige confirmación y no actúa antes',
		(await pagina.locator('#dialogo-msg').textContent()).includes(creado.id)
		&& (await proyecto()).hojas.length === 3);
	await confirmar();
	await pagina.waitForFunction((id) => !window.qa.proyecto().hojas.some((h) => h.id === id), creado.id);
	comprobar('borrado vacío conserva dos hojas y una selección existente',
		(await proyecto()).hojas.length === 2 && /Hoja [12] \/ 2/.test(await pagina.locator('#esq-indicador').textContent()));
	comprobar('cero errores JavaScript', erroresJS.length === 0);
	console.log(`ESQ-07 folios: ${casos}/${casos}, 0 JS; ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
} catch (error) {
	console.error(error);
	if (erroresJS.length) console.error('Errores JS:', erroresJS);
	process.exitCode = 1;
} finally {
	await pagina?.close().catch(() => {});
	await navegador?.close().catch(() => {});
	await new Promise((resolve) => servidor?.close(resolve) ?? resolve());
}
