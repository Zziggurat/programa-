/** CMP-04: encuadre visible, PNG derivado y paquete portable sin mover bornes. */
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const inicio = Date.now();
const temporal = mkdtempSync(join(tmpdir(), 'qa-m1-recorte-'));
const cwd = process.cwd();
const logAnterior = process.env.CHROME_LOG_FILE;
process.env.CHROME_LOG_FILE = join(temporal, 'chromium.log');
process.chdir(temporal);
let browser, servidor, checks = 0, fallos = 0;
const errores = [];
const ok = (nombre, pasa) => {
	checks++;
	if (!pasa) fallos++;
	console.log(`${pasa ? 'OK  ' : 'FAIL'} ${nombre}`);
};
const cp = pagina => pagina.locator('#ui-componentes-personalizados');
async function iniciarPagina(pagina, url) {
	pagina.setDefaultTimeout(30_000);
	pagina.on('pageerror', error => errores.push(String(error)));
	await pagina.goto(`${url}/?qa=1&inicio=0`);
	await esperarEditorListo(pagina);
	for (const selector of ['#btn-cerrar-ayuda', '#btn-cerrar-explicacion', '#btn-empezar-blanco']) {
		if (await pagina.locator(selector).isVisible()) await pagina.locator(selector).click();
	}
}
async function abrirComponentes(pagina) {
	await pagina.locator('#btn-componentes-personalizados').click();
	await cp(pagina).waitFor({ state: 'visible' });
}
async function exportarTarjeta(pagina, nombre) {
	const tarjeta = cp(pagina).locator('.cp-tarjeta').filter({ hasText: nombre });
	const descarga = pagina.waitForEvent('download');
	await tarjeta.getByRole('button', { name: 'Exportar', exact: true }).click();
	return JSON.parse(readFileSync(await (await descarga).path(), 'utf8'));
}

try {
	const servicio = await servidorDeQA(); servidor = servicio.servidor;
	browser = await abrirNavegador(chromium);
	const contexto = await browser.newContext({ acceptDownloads: true, viewport: { width: 1366, height: 900 } });
	const pagina = await contexto.newPage(); await iniciarPagina(pagina, servicio.url);
	const base64 = await pagina.evaluate(() => {
		const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 80;
		const c = canvas.getContext('2d');
		c.fillStyle = '#ed2330'; c.fillRect(0, 0, 60, 80);
		c.fillStyle = '#176ce0'; c.fillRect(60, 0, 60, 80);
		return canvas.toDataURL('image/png').split(',')[1];
	});
	await abrirComponentes(pagina);
	await cp(pagina).locator('[data-cp="nuevo"]').click();
	await cp(pagina).locator('[data-cp-campo="nombre"]').fill('Foto recortable CMP-04 QA');
	await cp(pagina).locator('[data-cp="siguiente"]').click();
	await cp(pagina).locator('[data-cp-campo="tipo"]').selectOption('otro');
	await cp(pagina).locator('[data-cp="siguiente"]').click();
	const elegir = pagina.waitForEvent('filechooser'); await cp(pagina).locator('[data-cp="imagen"]').click();
	await (await elegir).setFiles({ name: 'mitades.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') });
	const imagen = cp(pagina).locator('[data-cp="preview"] img'); await imagen.waitFor({ state: 'visible' });
	await imagen.click({ position: { x: 180, y: 90 } });
	const ancla = await cp(pagina).locator('[data-cp="preview"] .cp-marca').first().evaluate(el =>
		({ izquierda: el.style.left, arriba: el.style.top }));
	await cp(pagina).locator('[data-cp-ir="apariencia"]').click();
	await cp(pagina).locator('[data-cp="preview-apariencia"] canvas').waitFor({ state: 'visible' });
	const controlEscala = cp(pagina).locator('[data-cp="escala-imagen"]');
	const controlHorizontal = cp(pagina).locator('[data-cp="encuadre-horizontal"]');
	ok('controles de escala y encuadre visibles', await controlEscala.isVisible() && await controlHorizontal.isVisible());
	await controlEscala.click(); await controlEscala.press('Home');
	for (let i = 0; i < 20; i++) await controlEscala.press('ArrowRight');
	await controlHorizontal.click(); await controlHorizontal.press('End');
	ok('teclado ajusta escala 200 % y encuadre horizontal 100 %',
		await controlEscala.inputValue() === '200' && await controlHorizontal.inputValue() === '100');
	await pagina.waitForFunction(() => {
		const canvas = document.querySelector('#ui-componentes-personalizados [data-cp="preview-apariencia"] canvas');
		if (!canvas) return false;
		const pixel = canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
		return pixel[2] > 180 && pixel[0] < 60;
	});
	const anclaDespues = await cp(pagina).locator('[data-cp="preview-apariencia"] .cp-marca').first().evaluate(el =>
		({ izquierda: el.style.left, arriba: el.style.top }));
	ok('la vista recortada mueve píxeles pero no anclas u/v',
		JSON.stringify(anclaDespues) === JSON.stringify(ancla));
	await cp(pagina).locator('[data-cp="preview-apariencia"]').scrollIntoViewIfNeeded();
	await pagina.screenshot({ path: join(temporal, 'recorte-pendiente.png') });
	await cp(pagina).locator('[data-cp-ir="revision"]').click();
	await cp(pagina).locator('[data-cp="validar"]').click();
	ok('guardar exige aplicar el encuadre visible',
		/recorte y la escala/.test(await cp(pagina).locator('[data-cp="errores"]').innerText()));
	await cp(pagina).locator('[data-cp-ir="apariencia"]').click();
	await cp(pagina).locator('[data-cp="aplicar-recorte"]').click();
	await cp(pagina).locator('[data-cp="estado-recorte"]').filter({ hasText: 'coincide con la imagen' }).waitFor();
	await cp(pagina).locator('[data-cp="preview-apariencia"]').scrollIntoViewIfNeeded();
	await pagina.screenshot({ path: join(temporal, 'recorte-aplicado.png') });
	await cp(pagina).locator('[data-cp-ir="revision"]').click();
	await cp(pagina).locator('[data-cp="validar"]').click();
	await cp(pagina).locator('[data-cp="errores"].cp-ok').waitFor();
	await cp(pagina).locator('[data-cp="guardar"]').click();
	await cp(pagina).locator('.cp-tarjeta').filter({ hasText: 'Foto recortable CMP-04 QA' }).waitFor();
	const paquete = await exportarTarjeta(pagina, 'Foto recortable CMP-04 QA');
	const bytes = Buffer.from(paquete.asset.base64, 'base64');
	ok('PNG derivado tiene SHA-256 verificable y permanece en .tscomp',
		paquete.asset.mime === 'image/png'
		&& paquete.asset.id === `sha256:${createHash('sha256').update(bytes).digest('hex')}`
		&& paquete.definicion.assetId === paquete.asset.id);
	ok('perfil documental y ancla sobreviven al guardado', paquete.definicion.tipoDispositivo === 'otro'
		&& paquete.definicion.terminales.length === 1
		&& `${paquete.definicion.terminales[0].u * 100}%` === ancla.izquierda
		&& `${paquete.definicion.terminales[0].v * 100}%` === ancla.arriba);
	const limpio = await browser.newContext({ acceptDownloads: true });
	const segunda = await limpio.newPage(); await iniciarPagina(segunda, servicio.url);
	await abrirComponentes(segunda);
	const importacion = segunda.waitForEvent('filechooser'); await cp(segunda).locator('[data-cp="importar"]').click();
	await (await importacion).setFiles({ name: 'recorte.tscomp.json', mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(paquete)) });
	await cp(segunda).locator('.cp-tarjeta').filter({ hasText: 'Foto recortable CMP-04 QA' }).waitFor();
	const reexportado = await exportarTarjeta(segunda, 'Foto recortable CMP-04 QA');
	const recuperado = reexportado.asset.id === paquete.asset.id
		&& Buffer.from(reexportado.asset.base64, 'base64').equals(bytes)
		&& reexportado.definicion.revision === paquete.definicion.revision
		&& isDeepStrictEqual(reexportado.definicion.terminales, paquete.definicion.terminales);
	if (!recuperado) console.error('Diferencia roundtrip:', {
		assetOriginal: paquete.asset.id, assetImportado: reexportado.asset.id,
		bytesIguales: Buffer.from(reexportado.asset.base64, 'base64').equals(bytes),
		revisionOriginal: paquete.definicion.revision, revisionImportada: reexportado.definicion.revision,
		terminalesOriginales: paquete.definicion.terminales, terminalesImportados: reexportado.definicion.terminales,
	});
	ok('almacenamiento limpio recupera asset, revisión y borne', recuperado);
	await limpio.close(); await contexto.close();
} catch (error) {
	fallos++; console.error('FAIL recorte CMP-04:', error.stack ?? error);
} finally {
	ok('Sin errores JavaScript', errores.length === 0); if (errores.length) console.error(errores);
	try { await browser?.close(); } catch (error) { fallos++; console.error(error); }
	try {
		servidor?.closeAllConnections?.();
		if (servidor?.listening) await new Promise((resolver, rechazar) =>
			servidor.close(error => error ? rechazar(error) : resolver()));
	} catch (error) { fallos++; console.error(error); }
	process.chdir(cwd);
	if (logAnterior === undefined) delete process.env.CHROME_LOG_FILE;
	else process.env.CHROME_LOG_FILE = logAnterior;
	console.log(`Evidencia visual: ${temporal}`);
	console.log(`QA recorte-componentes-m1: ${checks} comprobaciones; ${fallos} fallos; ${(Date.now() - inicio) / 1000} s.`);
	process.exitCode = fallos ? 1 : 0;
}
