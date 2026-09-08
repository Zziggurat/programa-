/**
 * V8 · datos técnicos e ingeniería por la interfaz pública.
 *
 * No modifica window.qa, IndexedDB ni el modelo para preparar el caso: abre el laboratorio,
 * hace una copia, usa formularios/preview/confirmación y descarga los informes ordinarios.
 * El caso tiene FAIL deliberados de ingeniería; la regresión exige que se vean, no que se oculten.
 * Ejecutar sobre una build QA: node qa/todas.mjs datos-tecnicos-ingenieria
 */
import { chromium } from 'playwright-core';
import { existsSync, readFileSync, unlinkSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const inicio = Date.now();
const chromeLogAnterior = process.env.CHROME_LOG_FILE;
const debugLog = join(process.cwd(), 'debug.log');
const debugLogExistia = existsSync(debugLog);
process.env.CHROME_LOG_FILE = process.platform === 'win32' ? 'NUL' : '/dev/null';
let servidor, browser, page;
let comprobaciones = 0, fallos = 0, timeouts = 0;
const erroresJS = [];
function comprobar(nombre, condicion, detalle = '') {
	comprobaciones++;
	if (!condicion) fallos++;
	console.log(`${condicion ? 'OK  ' : 'FAIL'} ${nombre}${detalle ? ` → ${detalle}` : ''}`);
}
const cerca = (a, b) => typeof a === 'number' && Math.abs(a - b) < 1e-8;
const modal = () => page.locator('#modal-datos-tecnicos');
const dt = (accion) => modal().locator(`[data-dt="${accion}"]`);
const campo = (nombre) => modal().locator(`[data-dt-input="${nombre}"]`);
const estado = () => modal().locator('[data-dt-estado]');
async function llenar(nombre, valor) {
	await campo(nombre).fill(String(valor));
	await campo(nombre).press('Tab');
}
async function abrirDatos() {
	if (!await modal().isVisible()) {
		await page.locator('#btn-datos-tecnicos').click();
		await modal().waitFor({ state: 'visible' });
	}
}
async function cerrarDatos() {
	if (await modal().isVisible()) await dt('cerrar').click();
	await modal().waitFor({ state: 'hidden' });
}
async function preparar(accion) {
	await dt(accion).click();
	await dt('aplicar-preview').waitFor({ state: 'visible' });
	comprobar('Preview mantiene BASE hasta confirmar', /BASE todavía intacta/.test(await modal().locator('[data-dt-preview]').innerText()));
}
async function aplicar() {
	await dt('aplicar-preview').click();
	await page.locator('#modal-dialogo').waitFor({ state: 'visible' });
	await page.locator('#dialogo-ok').click();
	await page.locator('#modal-dialogo').waitFor({ state: 'hidden' });
	await estado().filter({ hasText: 'Aplicado y guardado atómicamente' }).waitFor();
}
async function abrirInstalacion() {
	await abrirDatos();
	await dt('instalacion').click();
	await campo('conductor').selectOption('w-fase-carga');
}
async function ampacidadVisible() {
	return JSON.parse(await modal().locator('.dt-cuerpo > pre').innerText());
}
async function criterioCoordinacion(modo, valor = '') {
	await abrirDatos();
	await dt('criterios').click();
	const fila = modal().locator('[data-dt-criterio="coordinarIbInIz"]');
	await fila.locator('[data-dt-criterio-modo]').selectOption(modo);
	await fila.locator('[data-dt-criterio-valor]').fill(valor);
	await preparar('preview-criterios');
	await aplicar();
}
async function ingenieria(vista) {
	await cerrarDatos();
	if (!await page.locator('#ingenieria-validar').isVisible()) await page.locator('#hta-ingenieria').click();
	await page.locator('#ingenieria-validar').click();
	await page.locator(`[data-ing-view="${vista}"]`).click();
}
async function descargarInforme(tipo) {
	const evento = page.waitForEvent('download');
	await page.locator(`[data-ing-doc="${tipo}"]`).click();
	const descarga = await evento;
	const error = await descarga.failure();
	if (error) throw new Error(`Descarga ${tipo}: ${error}`);
	const ruta = await descarga.path();
	if (!ruta) throw new Error(`Descarga ${tipo} sin archivo temporal`);
	return readFileSync(ruta, 'utf8');
}
async function informeJSON() {
	await ingenieria('documentacion');
	await page.locator('[data-ing-doc="prepare"]').click();
	await page.locator('[data-ing-doc="json"]:not([disabled])').waitFor();
	return JSON.parse(await descargarInforme('json'));
}
const icu = (informe) => informe.datosTecnicos?.resoluciones.find(r => r.entidadId === 'q1' && r.clave === 'proteccion.Icu@');
const coord = (informe) => informe.issues.find(i => i.code === 'TS-CABLE-IB-IN-IZ'
	&& i.relatedEntities.some(e => e.id === 'w-fase-carga'));
async function producto(revision) {
	await abrirDatos();
	await dt('biblioteca').click();
	const tarjeta = modal().locator('[data-dt-select]').filter({ hasText: 'Protección de prueba 25 A' })
		.filter({ hasText: new RegExp(`r${revision} · PRODUCTO`) });
	await tarjeta.click();
	const hash = await tarjeta.getAttribute('data-dt-select');
	await dt('vincular').click();
	await campo('entidad').selectOption('q1');
	return hash;
}
async function magnitudProteccion() {
	await ingenieria('protecciones');
	return page.locator('[data-ing-protection-card="q1"]').innerText();
}

// La campaña dispone además de un supervisor de árbol de procesos. Este límite acotado también
// protege la ejecución directa: cerrar Chromium aborta esperas Playwright y finally cierra HTTP.
const watchdog = setTimeout(() => {
	timeouts++;
	fallos++;
	console.error('TIMEOUT datos-tecnicos-ingenieria: límite total de 10 minutos; cerrando Chromium.');
	void browser?.close().catch(error => console.error('Error cerrando Chromium:', error));
	servidor?.closeAllConnections?.();
// Recorrido ampliado con Undo/Redo medido en 466 s, sin captura de impresión.
// Diez minutos cubre esa evidencia visual; el supervisor externo mantiene sus doce minutos.
}, 10 * 60_000);
watchdog.unref();

try {
	const servicio = await servidorDeQA();
	servidor = servicio.servidor;
	browser = await abrirNavegador(chromium);
	const contexto = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
	page = await contexto.newPage();
	page.setDefaultTimeout(30_000);
	page.setDefaultNavigationTimeout(60_000);
	page.on('pageerror', error => erroresJS.push(error.message));
	page.on('console', mensaje => { if (mensaje.type() === 'error') erroresJS.push(mensaje.text()); });
	page.context().on('page', otra => {
		otra.on('pageerror', error => erroresJS.push(error.message));
		otra.on('console', mensaje => { if (mensaje.type() === 'error') erroresJS.push(mensaje.text()); });
	});
	await page.goto(`${servicio.url}/?qa=1`);
	await esperarEditorListo(page);
	if (await page.locator('#inicio').isVisible()) await page.locator('#inicio-tableros').click();

	console.log('\n1. Laboratorio versionado y copia editable');
	await abrirDatos();
	await dt('ejemplo').click();
	await estado().filter({ hasText: 'Ejemplo de solo lectura' }).waitFor();
	await cerrarDatos();
	await page.locator('#chip-ejemplo').waitFor({ state: 'visible' });
	comprobar('Laboratorio abre como ejemplo, no como proyecto editable', await page.locator('#btn-copiar-ejemplo').isVisible());
	await page.locator('#btn-copiar-ejemplo').click();
	await page.locator('#chip-ejemplo').waitFor({ state: 'hidden' });
	await page.getByText('La copia es un tablero nuevo, independiente y guardado localmente.', { exact: true }).waitFor();
	comprobar('Copia del laboratorio conserva un nombre reconocible', /Laboratorio V8/.test(await page.locator('#nombre-proyecto').inputValue()));
	await abrirDatos();
	await dt('sintetico').click();
	await estado().filter({ hasText: 'Catálogo SINTÉTICO añadido' }).waitFor();
	await abrirInstalacion();
	const baseAmp = await ampacidadVisible();
	comprobar('Ampacidad resuelta desde instalación explícita', baseAmp.estado === 'RESOLVED');
	comprobar('Oracle independiente: 30 × 0.94 × 0.8 = 22.56 A', cerca(baseAmp.izBaseA, 30) && cerca(baseAmp.izA, 22.56), String(baseAmp.izA));
	comprobar('Ambos factores y su procedencia permanecen visibles', baseAmp.factoresAplicados.length === 2
		&& baseAmp.factoresAplicados.some(f => cerca(f.factor, .94)) && baseAmp.factoresAplicados.some(f => cerca(f.factor, .8))
		&& baseAmp.procedencia.origen === 'SINTETICO' && /^sha256:[a-f0-9]{64}$/.test(baseAmp.referencia.hash));
	const inicial = await informeJSON();
	const c0 = coord(inicial);
	const valor = (c, codigo) => c?.evidence.find(e => e.codigo === codigo)?.valor;
	comprobar('Ib ≤ Iz no oculta In > Iz: coordinación falla', c0?.status === 'FAIL'
		&& cerca(valor(c0, 'IB'), 10) && cerca(valor(c0, 'IN'), 25) && cerca(valor(c0, 'IZ'), 22.56),
		`Ib=${valor(c0, 'IB')}; In=${valor(c0, 'IN')}; Iz=${valor(c0, 'IZ')}`);
	comprobar('Fuente inicial exacta Icu 6 kA', icu(inicial)?.dato?.valor === 6 && icu(inicial)?.referencia.revision === 1);
	comprobar('Icu inicial suficiente no presenta error ni indeterminación de corte', !inicial.issues.some(i => i.code.startsWith('TS-PROT-BREAKING')
		&& i.relatedEntities.some(e => e.id === 'q1')));
	comprobar('Protecciones muestra Icu 6 kA de la misma proyección', /6 kA/.test(await magnitudProteccion()));
	await ingenieria('validacion');
	const visibleCoord = page.locator('[data-ing-issue-card]').filter({ hasText: 'TS-CABLE-IB-IN-IZ' }).first();
	comprobar('FAIL de coordinación accesible en panel visible', /FAIL/.test(await visibleCoord.innerText()));

	console.log('\n2. Datos incompletos y criterios independientes');
	await abrirInstalacion();
	await llenar('metodo', '');
	await preparar('preview-instalacion');
	// El dato persistente visible todavía es el anterior, aunque exista un candidato MISSING.
	comprobar('Preview incompleto no altera Iz de BASE', cerca((await ampacidadVisible()).izA, 22.56));
	await dt('cancelar-preview').click();
	await estado().filter({ hasText: 'Preview cancelado; BASE intacta' }).waitFor();
	const cancelado = await informeJSON();
	comprobar('Cancelar preview conserva el resultado al recalcular y exportar', cerca(cancelado.datosTecnicos.ampacidad.find(a => a.conductorId === 'w-fase-carga')?.izA, 22.56)
		&& cancelado.proyecto.id === inicial.proyecto.id);
	await abrirInstalacion();
	await llenar('metodo', '');
	await preparar('preview-instalacion');
	await aplicar();
	await abrirInstalacion();
	const incompleta = await ampacidadVisible();
	comprobar('Método ausente es MISSING, nunca un factor 1 implícito', incompleta.estado === 'MISSING'
		&& incompleta.izA === undefined && incompleta.faltantes.includes('instalacion.metodo'));
	await criterioCoordinacion('DESACTIVADO', 'Prueba de cobertura: desactivar no completa la instalación');
	await dt('faltantes').click();
	const faltantes = await modal().locator('.dt-cuerpo').innerText();
	comprobar('Desactivar coordinación no oculta ampacidad indeterminada', /INDETERMINATE/.test(faltantes) && /instalacion.metodo/.test(faltantes));
	const desactivado = await informeJSON();
	comprobar('Informe conserva cobertura incompleta aunque criterio esté desactivado', desactivado.issues.some(i => i.code === 'TS-CABLE-AMPACITY' && i.status === 'INDETERMINATE')
		&& desactivado.datosTecnicos.criterios.some(c => c.parametros.coordinarIbInIz.decision?.modo === 'DESACTIVADO'));
	await abrirInstalacion();
	await llenar('metodo', 'CANAL_SINTETICO');
	await preparar('preview-instalacion');
	await aplicar();
	await criterioCoordinacion('HEREDAR');
	const restaurado = await informeJSON();
	comprobar('Restaurar instalación y herencia restaura el FAIL real', coord(restaurado)?.status === 'FAIL'
		&& cerca(restaurado.datosTecnicos.ampacidad.find(a => a.conductorId === 'w-fase-carga')?.izA, 22.56));

	console.log('\n3. Ensayo prospectivo, revisión y override explícito');
	await abrirDatos();
	await dt('ensayo').click();
	await campo('proteccion').selectOption('q1');
	await campo('de').selectOption(JSON.stringify(['q1', '2']));
	await campo('a').selectOption(JSON.stringify(['red', 'N']));
	await campo('tipo-falla').selectOption('L_N');
	await preparar('preview-ensayo');
	await aplicar();
	const ensayo = await informeJSON();
	const prospectiva = ensayo.datosTecnicos.prospectiva.find(p => p.proteccionId === 'q1');
	comprobar('Icc se obtiene del punto y retorno elegidos, sin fallo runtime', prospectiva?.estado === 'RESUELTO'
		&& prospectiva.iccA > 100 && prospectiva.iccA < 6000 && prospectiva.ensayo.de.dispositivoId === 'q1'
		&& prospectiva.ensayo.a.dispositivoId === 'red' && prospectiva.ensayo.a.borneId === 'N',
		`${prospectiva?.estado}; Icc=${prospectiva?.iccA} A; ${prospectiva?.origen}`);
	await producto(1);
	const filaIcu = () => modal().locator('[data-dt-dato="proteccion.Icu@"]');
	await filaIcu().locator('[data-dt-decision]').selectOption('OVERRIDE');
	await filaIcu().locator('[data-dt-override]').fill('9');
	await preparar('preview-vinculo');
	await filaIcu().locator('[data-dt-override]').fill('8');
	comprobar('Editar después del preview invalida la confirmación anterior', await dt('aplicar-preview').count() === 0);
	await preparar('preview-vinculo');
	await filaIcu().locator('[data-dt-quitar-override]').click();
	comprobar('Quitar override invalida también el candidato ya preparado', await dt('aplicar-preview').count() === 0);
	await filaIcu().locator('[data-dt-decision]').selectOption('OVERRIDE');
	await filaIcu().locator('[data-dt-override]').fill('9');
	await preparar('preview-vinculo');
	await aplicar();
	await dt('resueltos').click();
	const override = JSON.parse(await modal().locator('[data-dt-preview] pre').innerText()).find(r => r.clave === 'proteccion.Icu@');
	comprobar('Override se conserva como decisión explícita, no dato de fabricante', override?.dato?.valor === 9 && override.origen === 'OVERRIDE');
	const hashR2 = await producto(2);
	comprobar('Adoptar revisión r2 ofrece conservar override anterior', await filaIcu().locator('[data-dt-decision]').inputValue() === 'OVERRIDE'
		&& await filaIcu().locator('[data-dt-override]').inputValue() === '9');
	await preparar('preview-vinculo');
	await aplicar();
	const protegidoPorOverride = await informeJSON();
	comprobar('Revisión nueva no borra override silenciosamente', icu(protegidoPorOverride)?.dato?.valor === 9
		&& icu(protegidoPorOverride)?.referencia.hash === hashR2 && icu(protegidoPorOverride)?.referencia.revision === 2);
	await producto(2);
	await filaIcu().locator('[data-dt-quitar-override]').click();
	await preparar('preview-vinculo');
	comprobar('Preview anuncia que adoptar datos puede empeorar validación', /Fallos \d+ → \d+/.test(await modal().locator('[data-dt-preview]').innerText()));
	await aplicar();
	const degradado = await informeJSON();
	comprobar('Quitar override adopta Icu 0.1 kA r2, con hash exacto', cerca(icu(degradado)?.dato?.valor, .1) && icu(degradado)?.referencia.hash === hashR2);
	comprobar('La revisión insuficiente produce FAIL de capacidad de corte', degradado.issues.some(i => i.code.startsWith('TS-PROT-BREAKING')
		&& i.status === 'FAIL' && i.relatedEntities.some(e => e.id === 'q1')));
	comprobar('Panel de protecciones refleja 0.1 kA, no dato legacy', /0[,.]1 kA/.test(await magnitudProteccion()));
	await ingenieria('validacion');
	const visibleCorte = page.locator('[data-ing-issue-card]').filter({ hasText: 'TS-PROT-BREAKING' }).first();
	comprobar('FAIL de capacidad visible, no solo en exportación', /FAIL/.test(await visibleCorte.innerText()));
	await page.locator('#btn-deshacer').click();
	const deshecho = await informeJSON();
	comprobar('Deshacer adopción restaura override y mantiene identidad', icu(deshecho)?.dato?.valor === 9
		&& deshecho.proyecto.id === inicial.proyecto.id);
	await page.locator('#btn-rehacer').click();
	const rehecho = await informeJSON();
	comprobar('Rehacer recupera r2 y su fallo real', cerca(icu(rehecho)?.dato?.valor, .1)
		&& rehecho.issues.some(i => i.code.startsWith('TS-PROT-BREAKING') && i.status === 'FAIL'));

	console.log('\n4. Recarga e informes coherentes');
	await page.reload();
	await esperarEditorListo(page);
	if (await page.locator('#inicio').isVisible()) await page.locator('#inicio-tableros').click();
	const final = await informeJSON();
	comprobar('Identidad del proyecto y datos fijados sobreviven recarga', typeof final.proyecto.id === 'string'
		&& final.proyecto.id.length > 10 && final.proyecto.id === inicial.proyecto.id
		&& !['EJEMPLO_EFIMERO', 'SIN_REPOSITORIO'].includes(final.proyecto.id)
		&& icu(final)?.referencia.hash === hashR2 && cerca(icu(final)?.dato?.valor, .1));
	comprobar('Ampacidad, criterios y prospectiva sobreviven recarga', cerca(final.datosTecnicos.ampacidad.find(a => a.conductorId === 'w-fase-carga')?.izA, 22.56)
		&& coord(final)?.status === 'FAIL' && final.datosTecnicos.prospectiva.some(p => p.proteccionId === 'q1' && p.estado === 'RESUELTO'));
	const html = await descargarInforme('html');
	const csv = await descargarInforme('technical');
	comprobar('HTML contiene dato, factores, fuente, revisión y hash', html.includes(hashR2) && html.includes('SINTETICO')
		&& html.includes('agrupamiento=0.8') && html.includes('ambiente=0.94') && html.includes('22.56')
		&& html.includes('proteccion.Icu@') && html.includes('0.1 kA'));
	comprobar('HTML no ejecuta scripts ni carga recursos remotos', !/<script\b/i.test(html)
		&& !/<(?:img|script|link)\b[^>]*(?:src|href)=["']https?:/i.test(html));
	comprobar('CSV técnico incluye esquema, fuente, revisión y hash', csv.includes('Entidad;Campo;Estado;Valor;Unidad;Decisión;Origen declarado;Fuente;Revisión;Hash;Condiciones')
		&& csv.includes('q1;proteccion.Icu@;RESOLVED;0.1;kA;') && csv.includes(hashR2) && csv.includes('SINTETICO'));
	comprobar('Informes no llaman certificado al catálogo sintético', /no autenticación ni certificación/.test(html)
		&& html.includes('no normativo, no apto para selección real'));
	if (process.env.QA_V8_CAPTURAS === '1') {
		const carpeta = mkdtempSync(join(tmpdir(), 'qa-v8-informe-'));
		writeFileSync(join(carpeta, 'informe.html'), html);
		const lectura = await page.context().newPage();
		try {
			await lectura.setContent(html);
			await lectura.screenshot({ path: join(carpeta, 'informe-pantalla.png') });
			await lectura.emulateMedia({ media: 'print' });
			await lectura.screenshot({ path: join(carpeta, 'informe-impresion.png') });
		} finally { await lectura.close(); }
		console.log(`Evidencia visual informe: ${carpeta}`);
	}
} catch (error) {
	fallos++;
	if (error?.name === 'TimeoutError') timeouts++;
	console.error('FAIL datos-tecnicos-ingenieria:', error?.stack ?? error);
} finally {
	clearTimeout(watchdog);
	comprobar('Sin errores JavaScript/console.error', erroresJS.length === 0, erroresJS.join(' | '));
	for (const [nombre, limpiar] of [
		['página', () => page?.close()], ['Chromium', () => browser?.close()],
		['servidor', async () => { servidor?.closeAllConnections?.(); if (servidor?.listening) await new Promise((ok, no) => servidor.close(error => error ? no(error) : ok())); }],
	]) {
		try { await limpiar(); } catch (error) { fallos++; console.error(`FAIL limpieza ${nombre}:`, error); }
	}
	if (!debugLogExistia && existsSync(debugLog)) unlinkSync(debugLog);
	if (chromeLogAnterior === undefined) delete process.env.CHROME_LOG_FILE;
	else process.env.CHROME_LOG_FILE = chromeLogAnterior;
	console.log(`\nQA datos-tecnicos-ingenieria: ${comprobaciones} comprobaciones; ${fallos} fallos; ${timeouts} timeouts; 0 skipped; ${erroresJS.length} errores JS; ${((Date.now() - inicio) / 1000).toFixed(1)} s.`);
	process.exitCode = fallos ? 1 : 0;
}
