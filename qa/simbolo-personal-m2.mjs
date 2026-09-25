/** ESQ-06: símbolo personal creado por UI, revisión, paquete y archivo individual. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const inicio = Date.now();
const temporal = mkdtempSync(join(tmpdir(), 'qa-esq06-personal-'));
const cwd = process.cwd();
let browser, servidor, comprobaciones = 0;
const erroresJS = [];
const cp = pagina => pagina.locator('#ui-componentes-personalizados');
const tarjeta = pagina => cp(pagina).locator('.cp-tarjeta').filter({ hasText: 'Símbolo ESQ-06 QA' });
function comprobar(nombre, condicion) {
	assert.ok(condicion, nombre);
	comprobaciones++;
	console.log(`OK ${nombre}`);
}
async function iniciarPagina(pagina, url) {
	pagina.setDefaultTimeout(30_000);
	pagina.on('pageerror', error => erroresJS.push(String(error)));
	pagina.on('console', mensaje => {
		if (mensaje.type() === 'error' && !/favicon|404/i.test(mensaje.text())) erroresJS.push(mensaje.text());
	});
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
async function exportarTarjeta(pagina) {
	const descarga = pagina.waitForEvent('download');
	await tarjeta(pagina).getByRole('button', { name: 'Exportar', exact: true }).click();
	return JSON.parse(readFileSync(await (await descarga).path(), 'utf8'));
}

try {
	process.chdir(temporal);
	const entorno = await servidorDeQA(); servidor = entorno.servidor;
	browser = await abrirNavegador(chromium);
	const contexto = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 920 } });
	const pagina = await contexto.newPage(); await iniciarPagina(pagina, entorno.url);
	const base64 = await pagina.evaluate(() => {
		const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 80;
		const c = canvas.getContext('2d'); c.fillStyle = '#14729d'; c.fillRect(0, 0, 120, 80);
		return canvas.toDataURL('image/png').split(',')[1];
	});
	await abrirComponentes(pagina);
	await cp(pagina).locator('[data-cp="nuevo"]').click();
	await cp(pagina).locator('[data-cp-campo="nombre"]').fill('Símbolo ESQ-06 QA');
	await cp(pagina).locator('[data-cp="siguiente"]').click();
	await cp(pagina).locator('[data-cp-campo="tipo"]').selectOption('resistencia');
	await cp(pagina).locator('[data-cp="siguiente"]').click();
	const elegir = pagina.waitForEvent('filechooser'); await cp(pagina).locator('[data-cp="imagen"]').click();
	await (await elegir).setFiles({ name: 'frente.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') });
	const imagen = cp(pagina).locator('[data-cp="preview"] img'); await imagen.waitFor({ state: 'visible' });
	await imagen.click({ position: { x: 180, y: 90 } });
	await imagen.click({ position: { x: 180, y: 150 } });
	const bornes = cp(pagina).locator('[data-cp="terminales"] tr');
	await bornes.nth(0).locator('input').first().fill('L');
	await bornes.nth(0).locator('select').nth(0).selectOption('L');
	await bornes.nth(0).locator('select').nth(1).selectOption('carga-fase');
	await bornes.nth(1).locator('input').first().fill('N');
	await bornes.nth(1).locator('select').nth(0).selectOption('N');
	await bornes.nth(1).locator('select').nth(1).selectOption('carga-retorno');
	await cp(pagina).locator('[data-cp-ir="apariencia"]').click();
	comprobar('dibujo personal es opt-in y comienza sin geometría arbitraria',
		!await cp(pagina).locator('[data-cp="simbolo-activo"]').isChecked()
		&& await cp(pagina).locator('[data-cp="simbolo-controles"]').isHidden());
	await cp(pagina).locator('[data-cp="simbolo-activo"]').check();
	await cp(pagina).locator('[data-cp="simbolo-forma"]').selectOption('rombo');
	await cp(pagina).locator('[data-cp="simbolo-rotulo"]').fill('QA');
	await cp(pagina).locator('[data-cp="simbolo-autor"]').fill('Equipo QA');
	await cp(pagina).locator('[data-cp="simbolo-licencia"]').fill('Uso interno declarado');
	await cp(pagina).locator('[data-cp="simbolo-agregar"]').click();
	comprobar('vista previa vectorial y bornes eléctricos visibles, sin SVG libre',
		await cp(pagina).locator('[data-cp="simbolo-preview"] svg').count() === 1
		&& await cp(pagina).locator('[data-cp="simbolo-preview"] line').count() >= 5
		&& await cp(pagina).locator('[data-cp="simbolo-segmentos"] li').count() === 1);
	await cp(pagina).locator('[data-cp="simbolo-preview"]').scrollIntoViewIfNeeded();
	await pagina.screenshot({ path: join(temporal, 'simbolo-asistente.png') });
	await cp(pagina).locator('[data-cp-ir="revision"]').click();
	comprobar('revisión advierte autor/licencia no verificados',
		/Equipo QA.*Uso interno declarado.*NO VERIFICADA/.test(await cp(pagina).locator('[data-cp="resumen"]').innerText()));
	await cp(pagina).locator('[data-cp="validar"]').click();
	await cp(pagina).locator('[data-cp="errores"].cp-ok').waitFor();
	await cp(pagina).locator('[data-cp="guardar"]').click();
	await tarjeta(pagina).waitFor({ state: 'visible' });
	const v4 = await exportarTarjeta(pagina);
	comprobar('.tscomp V4 exporta la forma, el trazo y las declaraciones explícitas',
		v4.version === 4 && v4.definicion.simboloEsquema?.forma === 'rombo'
		&& v4.definicion.simboloEsquema?.segmentos?.length === 1
		&& v4.definicion.simboloEsquema?.autorDeclarado === 'Equipo QA'
		&& v4.definicion.simboloEsquema?.licenciaDeclarada === 'Uso interno declarado');

	const limpio = await browser.newContext({ acceptDownloads: true });
	const segunda = await limpio.newPage(); await iniciarPagina(segunda, entorno.url);
	await abrirComponentes(segunda);
	const importar = segunda.waitForEvent('filechooser'); await cp(segunda).locator('[data-cp="importar"]').click();
	await (await importar).setFiles({ name: 'simbolo.tscomp.json', mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(v4)) });
	await tarjeta(segunda).waitFor({ state: 'visible' });
	const vuelta = await exportarTarjeta(segunda);
	comprobar('importación en biblioteca limpia preserva dibujo y función',
		isDeepStrictEqual(vuelta.definicion.simboloEsquema, v4.definicion.simboloEsquema)
		&& isDeepStrictEqual(vuelta.definicion.comportamiento, v4.definicion.comportamiento)
		&& vuelta.asset.id === v4.asset.id);
	await limpio.close();

	await tarjeta(pagina).getByRole('button', { name: 'Colocar', exact: true }).click();
	await cp(pagina).waitFor({ state: 'hidden' });
	await pagina.locator('#escena canvas').click({ position: { x: 520, y: 260 } });
	const instancia = await pagina.evaluate(id => window.qa.proyecto().dispositivos.find(d =>
		d.componentePersonalizado?.definicionId === id), v4.definicion.id);
	comprobar('instancia conserva revisión y símbolo sin cambiar terminales ni perfil',
		instancia?.componentePersonalizado?.revision === 1
		&& isDeepStrictEqual(instancia.simboloEsquemaPersonal, v4.definicion.simboloEsquema)
		&& isDeepStrictEqual(instancia.comportamiento, v4.definicion.comportamiento));
	await pagina.locator('#btn-archivo').click();
	const [descargaProyecto] = await Promise.all([
		pagina.waitForEvent('download'), pagina.locator('#btn-guardar').click(),
	]);
	const paquete = JSON.parse(readFileSync(await descargaProyecto.path(), 'utf8'));
	comprobar('proyecto portable V5 conserva definición e instancia por separado',
		paquete.version === 5
		&& paquete.componentes.some(d => d.id === v4.definicion.id && d.simboloEsquema?.forma === 'rombo')
		&& paquete.proyecto.dispositivos.some(d => d.id === instancia.id && d.simboloEsquemaPersonal?.forma === 'rombo'));
	await pagina.locator('#btn-esquema').click();
	const simbolo = pagina.locator(`#esquema-hoja .simbolo[data-dispositivo="${instancia.id}"]`);
	await simbolo.waitFor({ state: 'visible' });
	comprobar('plano real utiliza el símbolo personal y no una plantilla genérica',
		await simbolo.getAttribute('data-familia-simbolo') === 'personal'
		&& await simbolo.locator('text').filter({ hasText: 'QA' }).count() >= 1);
	await pagina.locator('#esq-activar-vistas').click();
	await pagina.locator('#dialogo-ok').click();
	await pagina.waitForFunction(id => window.qa.proyecto().esquema?.representaciones?.some(r =>
		r.dispositivoId === id), instancia.id);
	await simbolo.locator('rect[fill="transparent"]').click({ position: { x: 4, y: 4 } });
	comprobar('inspector declara procedencia personal no verificada',
		await pagina.locator('#esq-plantilla-procedencia').getAttribute('data-familia') === 'personal'
		&& /CONFORMIDAD NO VERIFICADA/.test(await pagina.locator('#esq-plantilla-procedencia summary').innerText()));
	const [descargaSvg] = await Promise.all([
		pagina.waitForEvent('download'), pagina.locator('#esq-svg').click(),
	]);
	const svg = readFileSync(await descargaSvg.path(), 'utf8');
	comprobar('SVG conserva autor/licencia declarados y no afirma certificación',
		/data-autor-declarado="Equipo QA"/.test(svg)
		&& /data-licencia-declarada="Uso interno declarado"/.test(svg)
		&& /data-licencia-verificada="no"/.test(svg));
	const [descargaPdf] = await Promise.all([
		pagina.waitForEvent('download'), pagina.locator('#esq-pdf').click(),
	]);
	await descargaPdf.saveAs(join(temporal, 'simbolo-esquema.pdf'));
	const pdf = readFileSync(join(temporal, 'simbolo-esquema.pdf')).toString('latin1');
	comprobar('PDF añade anexo legible con autor y licencia declarados',
		/Autor\/origen declarado: Equipo QA/.test(pdf)
		&& /Licencia declarada: Uso interno declarado/.test(pdf)
		&& (pdf.match(/\/Type \/Page\b/g)?.length ?? 0) === 2);
	await pagina.screenshot({ path: join(temporal, 'simbolo-en-esquema.png') });
	comprobar('sin errores JavaScript', erroresJS.length === 0);
	console.log(`ESQ-06 símbolo personal: ${comprobaciones}/${comprobaciones}, 0 JS; ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
	await contexto.close();
} catch (error) {
	console.error(error.stack ?? error);
	if (erroresJS.length) console.error('Errores JS:', erroresJS);
	process.exitCode = 1;
} finally {
	try { await browser?.close(); } catch (error) { console.error(error); process.exitCode = 1; }
	try {
		servidor?.closeAllConnections?.();
		if (servidor?.listening) await new Promise((resolver, rechazar) =>
			servidor.close(error => error ? rechazar(error) : resolver()));
	} catch (error) { console.error(error); process.exitCode = 1; }
	process.chdir(cwd);
	console.log(`Evidencia visual temporal: ${temporal}`);
}
