/** CMP-04: carcasa elegida por la UI, revisión no retroactiva y portabilidad V3/V4. */
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const inicio = Date.now();
const temporal = mkdtempSync(join(tmpdir(), 'qa-m1-carcasa-'));
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
const tarjeta = pagina => cp(pagina).locator('.cp-tarjeta').filter({ hasText: 'Carcasa CMP-04 QA' });

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
async function exportarTarjeta(pagina) {
	const descarga = pagina.waitForEvent('download');
	await tarjeta(pagina).getByRole('button', { name: 'Exportar', exact: true }).click();
	return JSON.parse(readFileSync(await (await descarga).path(), 'utf8'));
}

try {
	const servicio = await servidorDeQA(); servidor = servicio.servidor;
	browser = await abrirNavegador(chromium);
	const contexto = await browser.newContext({ acceptDownloads: true, viewport: { width: 1366, height: 900 } });
	const pagina = await contexto.newPage(); await iniciarPagina(pagina, servicio.url);
	const base64 = await pagina.evaluate(() => {
		const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 80;
		const c = canvas.getContext('2d'); c.fillStyle = '#df4f3a'; c.fillRect(0, 0, 120, 80);
		c.fillStyle = '#184dbb'; c.fillRect(20, 15, 80, 50);
		return canvas.toDataURL('image/png').split(',')[1];
	});
	await abrirComponentes(pagina);
	await cp(pagina).locator('[data-cp="nuevo"]').click();
	await cp(pagina).locator('[data-cp-campo="nombre"]').fill('Carcasa CMP-04 QA');
	await cp(pagina).locator('[data-cp="siguiente"]').click();
	await cp(pagina).locator('[data-cp-campo="tipo"]').selectOption('otro');
	await cp(pagina).locator('[data-cp="siguiente"]').click();
	const elegir = pagina.waitForEvent('filechooser'); await cp(pagina).locator('[data-cp="imagen"]').click();
	await (await elegir).setFiles({ name: 'frente.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') });
	const imagen = cp(pagina).locator('[data-cp="preview"] img'); await imagen.waitFor({ state: 'visible' });
	await imagen.click({ position: { x: 180, y: 90 } });
	const ancla = await cp(pagina).locator('[data-cp="preview"] .cp-marca').first().evaluate(el =>
		({ izquierda: el.style.left, arriba: el.style.top }));
	await cp(pagina).locator('[data-cp-ir="dimensiones"]').click();
	await cp(pagina).locator('[data-cp-campo="ancho"]').fill('60');
	await cp(pagina).locator('[data-cp-campo="alto"]').fill('90');
	await cp(pagina).locator('[data-cp-campo="fondo"]').fill('35');
	await cp(pagina).locator('[data-cp-ir="apariencia"]').click();
	const plantilla = cp(pagina).locator('[data-cp="carcasa-plantilla"]');
	const acabado = cp(pagina).locator('[data-cp="carcasa-acabado"]');
	ok('legacy inicia sin carcasa y acabado inactivo', await plantilla.inputValue() === '' && await acabado.isDisabled());
	await plantilla.selectOption('modulo-din');
	ok('módulo DIN ilustrativo tiene acabado explícito y montaje NO EVALUABLE',
		await acabado.inputValue() === 'gris-claro' && await acabado.isEnabled()
		&& /NO EVALUABLE/.test(await cp(pagina).locator('[data-cp="carcasa-estado"]').innerText()));
	await acabado.selectOption('grafito');
	await plantilla.selectOption('caja-industrial');
	ok('cambiar plantilla mantiene acabado escogido', await acabado.inputValue() === 'grafito');
	await plantilla.selectOption('modulo-din');
	await cp(pagina).locator('[data-cp="preview-apariencia"] canvas').waitFor({ state: 'visible' });
	const anclaVista = await cp(pagina).locator('[data-cp="preview-apariencia"] .cp-marca').first().evaluate(el =>
		({ izquierda: el.style.left, arriba: el.style.top }));
	ok('carcasa no mueve anclas u/v en la vista', isDeepStrictEqual(anclaVista, ancla));
	await cp(pagina).locator('[data-cp="carcasa-plantilla"]').scrollIntoViewIfNeeded();
	await pagina.screenshot({ path: join(temporal, 'carcasa-asistente.png') });
	await cp(pagina).locator('[data-cp-ir="revision"]').click();
	ok('resumen muestra carcasa sin atribuir montaje DIN',
		/Módulo DIN ilustrativo/.test(await cp(pagina).locator('[data-cp="resumen"]').innerText())
		&& /No declarado: ajuste NO EVALUABLE/.test(await cp(pagina).locator('[data-cp="resumen"]').innerText()));
	await cp(pagina).locator('[data-cp="validar"]').click();
	await cp(pagina).locator('[data-cp="errores"].cp-ok').waitFor();
	await cp(pagina).locator('[data-cp="guardar"]').click();
	await tarjeta(pagina).waitFor({ state: 'visible' });
	const v3 = await exportarTarjeta(pagina);
	const bytes = Buffer.from(v3.asset.base64, 'base64');
	ok('.tscomp V3 contiene carcasa, medidas y asset SHA exactos', v3.version === 3
		&& isDeepStrictEqual(v3.definicion.carcasa, { plantilla: 'modulo-din', acabado: 'grafito' })
		&& v3.definicion.montaje === undefined && v3.definicion.dimensiones.anchoMm === 60
		&& v3.definicion.dimensiones.altoMm === 90 && v3.definicion.dimensiones.fondoMm === 35
		&& v3.asset.id === `sha256:${createHash('sha256').update(bytes).digest('hex')}`);
	ok('perfil y borne no reciben semántica desde la carcasa', v3.definicion.tipoDispositivo === 'otro'
		&& v3.definicion.comportamiento.clase === 'sin-comportamiento'
		&& v3.definicion.terminales.length === 1
		&& `${v3.definicion.terminales[0].u * 100}%` === ancla.izquierda
		&& `${v3.definicion.terminales[0].v * 100}%` === ancla.arriba);

	const limpio = await browser.newContext({ acceptDownloads: true });
	const segunda = await limpio.newPage(); await iniciarPagina(segunda, servicio.url);
	await abrirComponentes(segunda);
	const importacion = segunda.waitForEvent('filechooser'); await cp(segunda).locator('[data-cp="importar"]').click();
	await (await importacion).setFiles({ name: 'carcasa.tscomp.json', mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(v3)) });
	await tarjeta(segunda).waitFor({ state: 'visible' });
	const vuelta = await exportarTarjeta(segunda);
	ok('import/export limpio preserva carcasa, comportamiento, bornes, revisión y bytes', vuelta.version === 3
		&& isDeepStrictEqual(vuelta.definicion.carcasa, v3.definicion.carcasa)
		&& isDeepStrictEqual(vuelta.definicion.comportamiento, v3.definicion.comportamiento)
		&& isDeepStrictEqual(vuelta.definicion.terminales, v3.definicion.terminales)
		&& vuelta.definicion.revision === v3.definicion.revision
		&& vuelta.asset.id === v3.asset.id && Buffer.from(vuelta.asset.base64, 'base64').equals(bytes));
	await limpio.close();

	await tarjeta(pagina).getByRole('button', { name: 'Colocar', exact: true }).click();
	await cp(pagina).waitFor({ state: 'hidden' });
	await pagina.waitForFunction(id => window.qa.proyecto().dispositivos.some(d =>
		d.componentePersonalizado?.definicionId === id), v3.definicion.id);
	await pagina.locator('#escena canvas').click({ position: { x: 520, y: 260 } });
	await pagina.evaluate(() => window.qa.esperarPersistencia());
	const colocado = await pagina.evaluate(id => window.qa.proyecto().dispositivos.find(d =>
		d.componentePersonalizado?.definicionId === id), v3.definicion.id);
	ok('instancia fija r1, carcasa y función eléctrica sin mover bornes', colocado?.componentePersonalizado?.revision === 1
		&& isDeepStrictEqual(colocado.carcasaPersonalizada, v3.definicion.carcasa)
		&& isDeepStrictEqual(colocado.bornes, v3.definicion.terminales)
		&& isDeepStrictEqual(colocado.comportamiento, v3.definicion.comportamiento)
		&& colocado.montajeComponente === undefined);
	const mallas = await pagina.evaluate(id => window.qa.mallasDeAparato(id), colocado.id);
	ok('3D monta volumen de acabado grafito detrás del frente', Array.isArray(mallas)
		&& mallas.some(m => m.color === '#41484d') && mallas.some(m => m.caras === 2));
	await pagina.screenshot({ path: join(temporal, 'carcasa-colocada-3d.png') });

	const descargaProyecto = pagina.waitForEvent('download');
	await pagina.locator('#btn-archivo').click(); await pagina.locator('#btn-guardar').click();
	const paquete = JSON.parse(readFileSync(await (await descargaProyecto).path(), 'utf8'));
	ok('Guardar proyecto elige V4 y conserva definición/instancia con carcasa', paquete.version === 4
		&& paquete.componentes.some(d => d.id === v3.definicion.id
			&& isDeepStrictEqual(d.carcasa, v3.definicion.carcasa))
		&& paquete.proyecto.dispositivos.some(d => d.id === colocado.id
			&& isDeepStrictEqual(d.carcasaPersonalizada, v3.definicion.carcasa)));

	await abrirComponentes(pagina);
	await tarjeta(pagina).getByRole('button', { name: 'Editar', exact: true }).click();
	await cp(pagina).locator('[data-cp-ir="apariencia"]').click();
	ok('editar una revisión conserva plantilla y acabado visibles',
		await plantilla.inputValue() === 'modulo-din' && await acabado.inputValue() === 'grafito');
	await plantilla.selectOption('');
	ok('volver a legacy requiere selección visible y desactiva acabado',
		await plantilla.inputValue() === '' && await acabado.isDisabled());
	await cp(pagina).locator('[data-cp-ir="revision"]').click();
	await cp(pagina).locator('[data-cp="validar"]').click();
	await cp(pagina).locator('[data-cp="errores"].cp-ok').waitFor();
	await cp(pagina).locator('[data-cp="guardar"]').click();
	await tarjeta(pagina).waitFor({ state: 'visible' });
	const legacy = await exportarTarjeta(pagina);
	const instanciaPosterior = await pagina.evaluate(id => window.qa.proyecto().dispositivos.find(d => d.id === id), colocado.id);
	ok('r2 legacy no borra carcasa de r1 colocada ni altera función', legacy.definicion.revision === 2
		&& legacy.definicion.carcasa === undefined && legacy.version < 3
		&& isDeepStrictEqual(instanciaPosterior.carcasaPersonalizada, v3.definicion.carcasa)
		&& isDeepStrictEqual(instanciaPosterior.bornes, colocado.bornes)
		&& isDeepStrictEqual(instanciaPosterior.comportamiento, colocado.comportamiento));
	await contexto.close();
} catch (error) {
	fallos++; console.error('FAIL carcasa CMP-04:', error.stack ?? error);
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
	console.log(`QA carcasa-componentes-m1: ${checks} comprobaciones; ${fallos} fallos; ${(Date.now() - inicio) / 1000} s.`);
	process.exitCode = fallos ? 1 : 0;
}
