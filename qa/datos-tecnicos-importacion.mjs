/**
 * V8: archivos hostiles, preview/cancelación, adopción visible, biblioteca/frozen y roundtrip.
 * Todas las mutaciones pasan por UI normal/file inputs. Sondas window.qa/IDB solo observan.
 * Ejecutar mediante node qa/todas.mjs datos-tecnicos-importacion después de build QA.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';
import { canonSeguridad, entradasTecnicasHostiles, enviarJSONTecnico, leerBibliotecaTecnica,
	paqueteSeguridadTecnica, snapshotProyectoVisible } from './lib/datos-tecnicos-seguridad.mjs';

const inicio = Date.now(); let servidor, navegador, contexto, pagina, url;
const contextos = new Set(); let fallos = 0, comprobaciones = 0, timeouts = 0;
// Medido en Windows/SwiftShader: 55 checks, 333 s de recorrido; el trace no muestra
// polling infinito (55 clics = 173 s). Ocho minutos deja margen y el runner conserva
// su supervisor de procesos de doce minutos. Se cierra la escena anterior antes de la limpia.
const limite = Number(process.env.QA_V8_IMPORT_TIMEOUT_MS ?? 480_000);
if (!Number.isFinite(limite) || limite < 1000) throw new Error('QA_V8_IMPORT_TIMEOUT_MS inválido');
const conservarCapturas = process.env.QA_V8_CAPTURAS === '1';
const erroresJS = []; const temporal = mkdtempSync(join(tmpdir(), 'qa-v8-importacion-'));
const cwdAnterior = process.cwd(), chromeLogAnterior = process.env.CHROME_LOG_FILE;
process.env.CHROME_LOG_FILE = join(temporal, 'chromium.log'); process.chdir(temporal);
let alarma, finRecorrido;
function comprobar(nombre, condicion, detalle = '') {
	comprobaciones++; if (!condicion) fallos++;
	console.log(`${condicion ? 'OK  ' : 'FAIL'}  ${nombre}${detalle ? ` → ${detalle}` : ''}`);
}
function iguales(nombre, a, b) { comprobar(nombre, canonSeguridad(a) === canonSeguridad(b)); }
const modal = () => pagina.locator('#modal-datos-tecnicos');
const boton = nombre => modal().locator(`[data-dt="${nombre}"]`);
const estado = () => modal().locator('[data-dt-estado]');
const esperarMensaje = async expresion => {
	await pagina.waitForFunction(source => new RegExp(source, 'i').test(document.querySelector('#modal-datos-tecnicos [data-dt-estado]')?.textContent ?? ''), expresion.source);
	return estado().innerText();
};
async function abrirDatos() { await pagina.locator('#btn-datos-tecnicos').click(); await modal().waitFor({ state: 'visible' }); }
async function abrirImportar() { await boton('biblioteca').click(); await boton('importar').click(); await modal().locator('[data-dt-archivo]').waitFor(); }
async function prepararImport(texto) { await abrirImportar(); await enviarJSONTecnico(pagina, texto); await boton('confirmar-import').waitFor({ state: 'visible' }); }
async function confirmarDialogo(aceptar = true) {
	await pagina.locator('#modal-dialogo').waitFor({ state: 'visible' });
	await pagina.locator(aceptar ? '#dialogo-ok' : '#dialogo-cancelar').click();
	await pagina.locator('#modal-dialogo').waitFor({ state: 'hidden' });
}
async function iniciarPagina(ctx) {
	const p = await ctx.newPage(); p.setDefaultTimeout(30_000); p.setDefaultNavigationTimeout(60_000);
	pagina = p;
	p.on('pageerror', error => erroresJS.push(`pageerror: ${error.message}`));
	p.on('console', m => { if (m.type() === 'error' && !/\/favicon\.ico(?:$|\?)/i.test(m.location().url ?? '')) erroresJS.push(`console: ${m.text()}`); });
	await p.goto(`${url}/?qa=1&inicio=0`, { waitUntil: 'domcontentloaded' }); await esperarEditorListo(p);
	for (const selector of ['#btn-cerrar-ayuda', '#btn-cerrar-explicacion', '#btn-empezar-blanco']) {
		if (await p.locator(selector).isVisible()) await p.locator(selector).click();
	}
	await p.waitForFunction(() => !document.getElementById('btn-datos-tecnicos')?.disabled);
	return p;
}
async function capturar(nombre) {
	if (!conservarCapturas) return;
	const ruta = join(temporal, `${nombre}.png`), anterior = pagina.viewportSize();
	try { await pagina.setViewportSize({ width: 1440, height: 960 }); await pagina.screenshot({ path: ruta }); }
	finally { if (anterior) await pagina.setViewportSize(anterior); }
	console.log(`CAPTURA  ${ruta}`);
}
async function descargarProyecto(nombre) {
	const descarga = pagina.waitForEvent('download'); await boton('exportar-proyecto').click();
	const archivo = await descarga, ruta = join(temporal, nombre); await archivo.saveAs(ruta);
	const portatil = JSON.parse(readFileSync(ruta, 'utf8'));
	return { ruta, contenido: portatil.formato === 'tablero-studio-paquete' ? portatil.proyecto : portatil };
}

async function recorrido() {
	const entorno = await servidorDeQA(); servidor = entorno.servidor; url = entorno.url;
	navegador = await abrirNavegador(chromium);
	// Formularios a tamaño de ventana real compacto: evita rasterizar una escena HD por cada clic.
	// Las capturas conservan 1440px; ningún control, clic, aserción ni límite se elimina.
	contexto = await navegador.newContext({ viewport: { width: 800, height: 600 }, acceptDownloads: true }); contextos.add(contexto);
	if (process.env.QA_V8_TRACE === '1') await contexto.tracing.start({ screenshots: false, snapshots: false, sources: false });
	pagina = await iniciarPagina(contexto); const base = await snapshotProyectoVisible(pagina);
	const paquete = paqueteSeguridadTecnica(), valido = JSON.stringify(paquete), hashProducto = paquete.revisiones[0].hash;
	await abrirDatos(); const bibliotecaInicial = await leerBibliotecaTecnica(pagina);
	comprobar('contexto limpio tiene biblioteca técnica vacía', bibliotecaInicial.length === 0);

	console.log('--- 1. Rechazo hostil sin escrituras ni cambios de proyecto ---');
	for (const caso of entradasTecnicasHostiles()) {
		await abrirImportar(); await enviarJSONTecnico(pagina, caso.texto);
		await modal().locator('[data-dt-estado][data-error="true"]').waitFor();
		comprobar(`${caso.nombre}: error visible y específico`, caso.error.test(await estado().innerText()), await estado().innerText());
		comprobar(`${caso.nombre}: no ofrece confirmar`, !(await boton('confirmar-import').isVisible()));
		iguales(`${caso.nombre}: biblioteca intacta`, await leerBibliotecaTecnica(pagina), bibliotecaInicial);
		iguales(`${caso.nombre}: identidad/revisión/diseño intactos`, await snapshotProyectoVisible(pagina), base);
	}
	comprobar('JSON hostil no contaminó prototipos', await pagina.evaluate(() => Object.prototype.v8Contaminado === undefined));

	console.log('--- 2. Preview válido/cancelar y archivo inválido posterior ---');
	await prepararImport(valido);
	iguales('preview válido todavía no escribe biblioteca', await leerBibliotecaTecnica(pagina), bibliotecaInicial);
	await enviarJSONTecnico(pagina, '{', 'archivo-posterior-invalido.json');
	await modal().locator('[data-dt-estado][data-error="true"]').waitFor();
	comprobar('seleccionar archivo inválido invalida confirmación del preview anterior', !(await boton('confirmar-import').isVisible()) || !(await boton('confirmar-import').isEnabled()));
	await boton('cancelar-import').click();
	await prepararImport(valido); await boton('cancelar-import').click(); await esperarMensaje(/Importación cancelada/);
	iguales('cancelar archivo válido no cambia biblioteca', await leerBibliotecaTecnica(pagina), bibliotecaInicial);
	iguales('cancelaciones conservan BASE y revisión', await snapshotProyectoVisible(pagina), base);

	await prepararImport(valido); await boton('confirmar-import').click(); await esperarMensaje(/revisiones nuevas/);
	const bibliotecaImportada = await leerBibliotecaTecnica(pagina);
	comprobar('confirmar importa exactamente una revisión real', bibliotecaImportada.filter(r => r.tipo === 'REVISION' && r.revision.hash === hashProducto).length === 1);
	iguales('importar biblioteca no adopta datos en el proyecto', await snapshotProyectoVisible(pagina), base);
	comprobar('texto HTML hostil se muestra literal, sin crear elementos', (await modal().innerText()).includes('<img src=x') && await modal().locator('img[src="x"]').count() === 0);
	comprobar('no se ejecutó JavaScript de una ficha', await pagina.evaluate(() => window.__qaV8Xss === undefined));
	await capturar('01-datos-tecnicos');
	await prepararImport(valido); await boton('confirmar-import').click(); await esperarMensaje(/0 revisiones nuevas; 1 idénticas/);
	iguales('reimportación idéntica es idempotente', await leerBibliotecaTecnica(pagina), bibliotecaImportada);

	console.log('--- 3. Ejemplo/copia/adopción transaccional visible ---');
	await boton('ejemplo').click();
	await pagina.waitForFunction(() => window.qa.proyecto().nombre === 'Laboratorio V8 — datos técnicos y ampacidad' && window.qa.proyecto().esEjemplo === true);
	await boton('cerrar').click(); await pagina.locator('#btn-copiar-ejemplo').click();
	await pagina.waitForFunction(() => window.qa.documentoActivo().ejemplo === false && !window.qa.proyecto().esEjemplo);
	await pagina.locator('#nombre-proyecto').fill('QA V8 seguridad y portable'); await pagina.locator('#nombre-proyecto').press('Tab');
	const antesAdopcion = await snapshotProyectoVisible(pagina);
	await abrirDatos(); await modal().locator(`[data-dt-select="${hashProducto}"]`).click(); await boton('vincular').click();
	await modal().locator('[data-dt-input="entidad"]').selectOption('q1');
	await modal().locator('[data-dt-input="sistema"]').selectOption('AC'); await modal().locator('[data-dt-input="tension"]').fill('230');
	await boton('preview-vinculo').click(); await boton('aplicar-preview').waitFor({ state: 'visible' });
	await capturar('02-comparacion');
	iguales('preview de vínculo no modifica BASE', await snapshotProyectoVisible(pagina), antesAdopcion);
	await boton('cancelar-preview').click();
	iguales('cancelar preview de vínculo conserva BASE', await snapshotProyectoVisible(pagina), antesAdopcion);
	await boton('preview-vinculo').click(); await boton('aplicar-preview').waitFor({ state: 'visible' });
	await boton('aplicar-preview').click(); await confirmarDialogo(false);
	iguales('cancelar confirmación final conserva BASE', await snapshotProyectoVisible(pagina), antesAdopcion);
	await boton('aplicar-preview').click(); await confirmarDialogo(); await esperarMensaje(/Aplicado y guardado/);
	const adoptado = await snapshotProyectoVisible(pagina);
	comprobar('confirmación conserva documento y avanza revisión', adoptado.id === antesAdopcion.id && adoptado.revision > antesAdopcion.revision);
	comprobar('proyecto fija el hash exacto del producto seleccionado', adoptado.proyecto.datosTecnicos.vinculos.find(v => v.entidad === 'DEVICE' && v.entidadId === 'q1').producto.hash === hashProducto);
	comprobar('subconjunto mantiene tabla/criterios y no ficha anterior huérfana', adoptado.proyecto.datosTecnicos.revisiones.length === 3 && !adoptado.proyecto.datosTecnicos.revisiones.some(r => r.tipo === 'PRODUCTO' && r.hash !== hashProducto));

	console.log('--- 4. Exportar, borrar global y conservar frozen ---');
	await boton('biblioteca').click();
	const antesBorrado = await descargarProyecto('proyecto-antes-borrado.json');
	iguales('exportación contiene subconjunto exacto del proyecto', antesBorrado.contenido.datosTecnicos, adoptado.proyecto.datosTecnicos);
	await modal().locator(`[data-dt-select="${hashProducto}"]`).click(); await boton('borrar-catalogo').click(); await confirmarDialogo();
	await esperarMensaje(/Catálogo global borrado/);
	comprobar('catálogo se eliminó realmente de IndexedDB global', (await leerBibliotecaTecnica(pagina)).filter(r => r.tipo === 'REVISION' && r.revision.catalogo.id === 'qa-seguridad-v8').length === 0);
	iguales('borrar global no altera revisión ni frozen activo', await snapshotProyectoVisible(pagina), adoptado);
	comprobar('ficha fijada todavía se consulta desde proyecto', await modal().locator(`[data-dt-select="${hashProducto}"]`).count() === 1);
	const despuesBorrado = await descargarProyecto('proyecto-despues-borrado.json');
	iguales('exportar sin catálogo global conserva datos técnicos', despuesBorrado.contenido.datosTecnicos, antesBorrado.contenido.datosTecnicos);
	await boton('cerrar').click(); await pagina.close(); pagina = await iniciarPagina(contexto);
	const reabierto = await snapshotProyectoVisible(pagina);
	iguales('cerrar/reabrir aplicación conserva documento y subconjunto', reabierto, adoptado);
	comprobar('reapertura no resucita el catálogo eliminado', (await leerBibliotecaTecnica(pagina)).length === 0);

	console.log('--- 5. Importar proyecto en almacenamiento limpio ---');
	// La reapertura ya se comprobó. No hace falta mantener otra escena WebGL renderizando
	// durante la importación limpia; los snapshots esperados son valores capturados arriba.
	await pagina.close();
	const limpio = await navegador.newContext({ viewport: { width: 800, height: 600 }, acceptDownloads: true }); contextos.add(limpio);
	if (process.env.QA_V8_TRACE === '1') await limpio.tracing.start({ screenshots: false, snapshots: false, sources: false });
	pagina = await iniciarPagina(limpio); const inicialLimpio = await snapshotProyectoVisible(pagina);
	comprobar('destino empieza sin catálogo ni vínculos', (await leerBibliotecaTecnica(pagina)).length === 0 && !inicialLimpio.proyecto.datosTecnicos);
	await pagina.locator('#btn-archivo').click(); const chooser = pagina.waitForEvent('filechooser');
	await pagina.locator('#btn-abrir').click(); await (await chooser).setFiles(despuesBorrado.ruta);
	await pagina.waitForFunction(nombre => window.qa.proyecto().nombre === nombre, adoptado.proyecto.nombre);
	// El montaje ocurre antes de publicar el documento activo. El nombre visible no es un
	// commit de la transición: la notificación se emite después de crear/abrir y confirmar IDB.
	await pagina.locator('#toast').filter({ hasText: 'Proyecto abierto correctamente' }).waitFor({ state: 'visible' });
	const importado = await snapshotProyectoVisible(pagina);
	iguales('roundtrip portable conserva todo el subconjunto congelado', importado.proyecto.datosTecnicos, adoptado.proyecto.datosTecnicos);
	comprobar('importado tiene identidad propia, no pisa documento inicial', importado.id !== inicialLimpio.id);
	comprobar('importar proyecto no reinstala biblioteca global', (await leerBibliotecaTecnica(pagina)).length === 0);
	await abrirDatos(); await modal().locator(`[data-dt-select="${hashProducto}"]`).click();
	comprobar('ficha y procedencia siguen disponibles offline tras roundtrip', /SINTETICO/.test(await modal().innerText()) && (await modal().innerText()).includes(hashProducto));
	await boton('vincular').click(); await modal().locator('[data-dt-input="entidad"]').selectOption('q1'); await boton('resueltos').click();
	const evidencia = await modal().locator('[data-dt-preview]').innerText();
	comprobar('recomputación resuelve In/Icu desde frozen sin biblioteca', evidencia.includes('RESOLVED') && evidencia.includes('proteccion.inA') && evidencia.includes('proteccion.Icu') && evidencia.includes(hashProducto));
	await capturar('03-portable-recomputado');
	comprobar('no hubo errores JavaScript', erroresJS.length === 0, erroresJS.join(' | '));
}

try {
	await Promise.race([recorrido(), new Promise((_, reject) => { alarma = setTimeout(() => { timeouts++; reject(new Error(`TIMEOUT: datos-tecnicos-importacion agotó ${limite} ms`)); }, limite); })]);
    finRecorrido = Date.now();
} catch (error) {
	finRecorrido = Date.now();
	if (error?.name === 'TimeoutError') timeouts++;
	fallos++; console.error(error?.stack ?? error);
	if (pagina && !pagina.isClosed()) await pagina.screenshot({ path: join(temporal, 'fallo.png'), timeout: 5000 }).catch(() => {});
} finally {
	clearTimeout(alarma);
	if (process.env.QA_V8_TRACE === '1') {
		let n = 0;
		for (const ctx of contextos) try { await ctx.tracing.stop({ path: join(temporal, `acciones-${++n}.zip`) }); } catch (e) { fallos++; console.error('No se conservó trace:', e); }
	}
	for (const ctx of contextos) try { await ctx.close(); } catch (e) { fallos++; console.error('No cerró contexto:', e); }
	try { await navegador?.close(); } catch (e) { fallos++; console.error('No cerró Chromium:', e); }
	if (servidor) try { servidor.closeAllConnections?.(); await new Promise((ok, no) => servidor.close(e => e ? no(e) : ok())); } catch (e) { fallos++; console.error('No cerró servidor:', e); }
	process.chdir(cwdAnterior);
	if (chromeLogAnterior === undefined) delete process.env.CHROME_LOG_FILE; else process.env.CHROME_LOG_FILE = chromeLogAnterior;
	const real = realpathSync(temporal), baseTemp = realpathSync(tmpdir());
	assert.ok(real.startsWith(`${baseTemp}${sep}`) && basename(real).startsWith('qa-v8-importacion-'), 'limpieza restringida al temporal creado por esta suite');
	if (fallos === 0 && !conservarCapturas) rmSync(real, { recursive: true, force: true });
	else console.error(`Evidencia temporal conservada fuera del repositorio: ${resolve(temporal)}`);
}
console.log(`\nV8 importación: ${comprobaciones} comprobaciones, ${fallos} fallos, ${timeouts} timeouts, ${erroresJS.length} errores JS, 0 skipped; ${((Date.now() - inicio) / 1000).toFixed(2)} s (recorrido ${((finRecorrido - inicio) / 1000).toFixed(2)} s; limpieza ${((Date.now() - finRecorrido) / 1000).toFixed(2)} s).`);
process.exitCode = fallos === 0 ? 0 : 1;
