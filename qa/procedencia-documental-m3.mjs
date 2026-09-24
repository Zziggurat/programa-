/** QA focal DOC-01: procedencia confirmada/efímera y bytes de preview/descarga. */
import { chromium } from 'playwright-core';
import { readFileSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';
import { textoPdf } from './lib/texto-pdf.mjs';

const inicio = performance.now();
const { servidor, url } = await servidorDeQA();
const temporal = mkdtempSync(join(tmpdir(), 'qa-doc01-m3-'));
const cwdPrevio = process.cwd();
const chromeLogPrevio = process.env.CHROME_LOG_FILE;
process.env.CHROME_LOG_FILE = join(temporal, 'chromium.log');
process.chdir(temporal);
let browser;
let fallos = 0;
let pruebas = 0;
const erroresJs = [];
const recursosHttp = [];
const ok = (nombre, cierto, detalle = '') => {
	pruebas++;
	if (!cierto) fallos++;
	console.log(`${cierto ? 'OK  ' : 'FAIL'} ${nombre}${detalle ? ` → ${detalle}` : ''}`);
};
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const bajar = async (page, selector) => {
	// Adjuntar rechazo antes del clic: si auto-scroll tarda, el timeout no queda sin handler.
	const evento = page.waitForEvent('download', { timeout: 15_000 })
		.then((descarga) => ({ descarga }), (error) => ({ error }));
	let falloClic;
	try { await page.locator(selector).click({ timeout: 15_000 }); }
	catch (error) { falloClic = error; }
	const resultado = await evento;
	if (falloClic || resultado.error) {
		const aviso = await page.locator('#toast').textContent().catch(() => '');
		const visible = await page.locator(selector).isVisible().catch(() => false);
		const deshabilitado = await page.locator(selector).isDisabled().catch(() => false);
		throw new Error(`${selector}: sin descarga; visible=${visible}, disabled=${deshabilitado}, `
			+ `aviso=${aviso || '(ninguno)'}`, { cause: falloClic ?? resultado.error });
	}
	const descarga = resultado.descarga;
	return readFileSync(await descarga.path());
};
const preview = async (page) => page.evaluate(async () => {
	const iframe = document.querySelector('#dos-vista iframe');
	if (!iframe?.src.startsWith('blob:')) throw new Error('Vista previa PDF ausente');
	const datos = await (await fetch(iframe.src.split('#')[0])).arrayBuffer();
	return Array.from(new Uint8Array(datos));
});

try {
	browser = await abrirNavegador(chromium);
	const contexto = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
	const page = await contexto.newPage();
	page.on('pageerror', (e) => erroresJs.push(e.message));
	page.on('console', (m) => { if (m.type() === 'error'
		&& !/\/favicon\.ico(?:$|[?#])|favicon/i.test(`${m.location().url} ${m.text()}`))
		erroresJs.push(`${m.text()} [${m.location().url || 'sin URL'}]`); });
	page.on('response', (r) => { if (r.status() >= 400) recursosHttp.push(`${r.status()} ${r.url()}`); });
	await page.goto(`${url}/?qa=1&inicio=0`, { waitUntil: 'load' });
	await esperarEditorListo(page);
	if (await page.locator('#modal-ayuda').isVisible()) await page.locator('#btn-cerrar-ayuda').click();
	if (await page.locator('#bienvenida').isVisible()) await page.locator('#btn-empezar-blanco').click();
	await page.locator('#hta-anadir').click();
	await page.locator('#catalogo .item-catalogo').first().click();
	await page.waitForFunction(() => window.qa.proyecto().dispositivos.length > 0);
	await page.locator('#btn-archivo').click();
	await page.locator('#btn-datos-proyecto').click();
	await page.locator('#pr-revision').fill('ED-C');
	await page.locator('#pr-fecha').fill('2024-11-02');
	await page.locator('#pr-ip').fill('IP54');
	await page.locator('#btn-guardar-proyecto').click();
	const confirmado = await page.evaluate(() => window.qa.esperarPersistencia());
	ok('proyecto de QA confirmado', !!confirmado?.id && confirmado.revision >= 1);
	const proyectoAntesPreview = await page.evaluate(() => JSON.stringify(window.qa.proyecto()));
	await page.locator('#btn-exportar').click();
	const html = (await bajar(page, '#btn-dossier')).toString('utf8');
	ok('HTML distingue Project ID/revisión/editorial/Build ID',
		html.includes(`<dd>${confirmado.id}</dd>`) && html.includes(`<dd>${confirmado.revision}</dd>`)
		&& html.includes('<dd>ED-C</dd>') && html.includes('<dd>2024-11-02</dd>')
		&& html.includes('<dt>Build ID</dt><dd>DEV-'));
	if (!(await page.locator('#btn-dxf-placa').isVisible())) await page.locator('#btn-exportar').click();
	const placa = (await bajar(page, '#btn-dxf-placa')).toString('utf8');
	ok('placa DXF identifica revisión, Build ID y alcance sin falsear metraje',
		placa.includes(`Project ID ${confirmado.id}`)
		&& placa.includes(`Revision repositorio ${confirmado.revision}`)
		&& placa.includes('Build ID') && placa.includes('Alcance: placa de montaje')
		&& placa.includes('ruta fisica pendiente'));
	if (!(await page.locator('#btn-etiquetas').isVisible())) await page.locator('#btn-exportar').click();
	const rotulos = textoPdf(await bajar(page, '#btn-etiquetas'));
	ok('rótulos PDF mantienen escala e identidad de la revisión confirmada',
		rotulos.includes(confirmado.id) && rotulos.includes(String(confirmado.revision))
		&& rotulos.includes('Project ID') && rotulos.includes('Build ID')
		&& rotulos.includes('100 %'));
	await page.locator('#btn-pdf').click();
	await page.waitForFunction(() => /KB/.test(document.getElementById('dos-estado')?.textContent ?? ''),
		undefined, { timeout: 40_000 });
	const trasPreview = await page.evaluate(() => window.qa.esperarPersistencia());
	ok('generar PDF no cambia el proyecto ni la revisión confirmada',
		proyectoAntesPreview === await page.evaluate(() => JSON.stringify(window.qa.proyecto()))
		&& trasPreview.id === confirmado.id && trasPreview.revision === confirmado.revision
		&& JSON.stringify(trasPreview.proyecto) === JSON.stringify(confirmado.proyecto));
	const visto = Buffer.from(await preview(page));
	const descargaPdf = page.waitForEvent('download', { timeout: 15_000 });
	await page.locator('#dos-descargar').click();
	const pdf = await descargaPdf;
	const rutaPdf = await pdf.path();
	const bytesPdf = readFileSync(rutaPdf);
	ok('preview y descarga son idénticos byte a byte', visto.length > 1000 && sha(visto) === sha(bytesPdf),
		`${visto.length} bytes`);
	const textoDossier = textoPdf(bytesPdf);
	ok('dossier PDF separa identidad confirmada y revisión editorial',
		textoDossier.includes(confirmado.id) && textoDossier.includes(String(confirmado.revision))
		&& textoDossier.includes('ED-C') && textoDossier.includes('2024-11-02')
		&& textoDossier.includes('Build ID') && textoDossier.includes('DEV-'));
	// Un cambio desde la barra del proyecto, mientras el panel del dossier sigue abierto, deja
	// el PDF anterior visible. El clic debe refrescarlo y exigir revisión, sin emitir ese PDF viejo.
	await page.evaluate(() => {
		const campo = document.getElementById('nombre-proyecto');
		campo.value = 'Tablero DOC-01 editado';
		campo.dispatchEvent(new Event('change', { bubbles: true }));
	});
	const descargaPrematura = page.waitForEvent('download', { timeout: 1800 }).then(() => true, () => false);
	await page.locator('#dos-descargar').click();
	ok('editar y descargar antes de revisar no emite otro archivo', !(await descargaPrematura));
	await page.waitForFunction(() => /KB/.test(document.getElementById('dos-estado')?.textContent ?? ''),
		undefined, { timeout: 40_000 });
	const vistoNuevo = Buffer.from(await preview(page));
	const pdfNuevo = await bajar(page, '#dos-descargar');
	ok('segundo clic descarga la nueva preview exacta',
		sha(vistoNuevo) === sha(pdfNuevo) && sha(vistoNuevo) !== sha(visto));
	await page.locator('#dos-cerrar').click();
	await page.locator('#btn-esquema').click();
	await page.locator('#panel-esquema').waitFor({ state: 'visible' });
	const pdfEsqEvento = page.waitForEvent('download', { timeout: 15_000 });
	await page.locator('#esq-pdf').click();
	const pdfEsq = await pdfEsqEvento;
	const rutaEsq = await pdfEsq.path();
	const textoEsq = textoPdf(readFileSync(rutaEsq));
	ok('esquema PDF conserva ID/r y separa cajetín editorial/Build ID',
		textoEsq.includes(confirmado.id) && textoEsq.includes(String(confirmado.revision))
		&& textoEsq.includes('ED-C') && textoEsq.includes('REV. ED.')
		&& textoEsq.includes('Build ID')
		&& textoEsq.includes('Alcance: esquema eléctrico')
		&& textoEsq.includes('Rutas físicas pendientes del proyecto:')
		&& textoEsq.includes('Una ruta pendiente no define trayecto, longitud ni material'));
	const revisionEsquema = await page.evaluate(() => window.qa.esperarPersistencia());
	const svg = (await bajar(page, '#esq-svg')).toString('utf8');
	ok('SVG vectorial identifica la revisión confirmada y su límite físico',
		svg.includes(`Project ID ${revisionEsquema.id}`)
		&& svg.includes(`Revisión repositorio ${revisionEsquema.revision}`)
		&& svg.includes('Build ID') && svg.includes('ED-C')
		&& svg.includes('Rutas físicas pendientes del proyecto:'));
	// DXF vive en Entregar, no en la barra del esquema superpuesto.
	await page.locator('#esq-cerrar').click();
	await page.locator('#btn-exportar').click();
	const dxf = (await bajar(page, '#btn-dxf-esquema')).toString('utf8');
	ok('DXF R12 identifica la revisión confirmada sin crear entidades eléctricas',
		dxf.includes(`Project ID ${revisionEsquema.id}`)
		&& dxf.includes(`Revision repositorio ${revisionEsquema.revision}`)
		&& dxf.includes('Build ID') && dxf.includes('ED-C')
		&& dxf.includes('Rutas fisicas pendientes del proyecto:')
		&& dxf.includes('999\n'));
	await page.locator('#hta-ingenieria').click();
	await page.locator('#ingenieria-validar').click();
	await page.locator('[data-ing-view="documentacion"]').click();
	await page.locator('[data-ing-doc="prepare"]').click();
	await page.locator('[data-ing-doc="json"]:not([disabled])').waitFor({ timeout: 30_000 });
	const informeJson = JSON.parse((await bajar(page, '[data-ing-doc="json"]')).toString('utf8'));
	ok('Ingeniería JSON usa la misma identidad de proyecto y revisión confirmada',
		informeJson.trazabilidad?.procedencia?.estado === 'confirmado'
		&& informeJson.trazabilidad.procedencia.projectId === revisionEsquema.id
		&& informeJson.trazabilidad.procedencia.revisionRepositorio === revisionEsquema.revision
		&& informeJson.alcance?.includes('no certificación normativa'));
	const ingenieriaCsv = (await bajar(page, '[data-ing-doc="bom"]')).toString('utf8');
	ok('Ingeniería CSV vacío o poblado conserva procedencia y BOM UTF-8',
		ingenieriaCsv.charCodeAt(0) === 0xFEFF
		&& ingenieriaCsv.includes('Estado documental;Project ID;Revisión repositorio;')
		&& ingenieriaCsv.includes(revisionEsquema.id)
		&& ingenieriaCsv.includes(String(revisionEsquema.revision)));
	await contexto.close();

	const contextoEjemplo = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
	const ejemplo = await contextoEjemplo.newPage();
	ejemplo.on('pageerror', (e) => erroresJs.push(e.message));
	await ejemplo.goto(`${url}/?qa=1&inicio=0`, { waitUntil: 'load' });
	await esperarEditorListo(ejemplo);
	if (await ejemplo.locator('#modal-ayuda').isVisible()) await ejemplo.locator('#btn-cerrar-ayuda').click();
	await ejemplo.locator('#btn-empezar-ejemplo').click();
	await ejemplo.locator('.tarjeta-ejemplo button').first().click();
	await ejemplo.waitForFunction(() => document.getElementById('modal-dialogo')?.hidden === false
		|| document.getElementById('modal-ejemplos')?.hidden === true, undefined, { timeout: 20_000 });
	if (await ejemplo.locator('#modal-dialogo').isVisible()) await ejemplo.locator('#dialogo-ok').click();
	await ejemplo.waitForFunction(() => window.qa.proyecto()?.esEjemplo === true
		&& window.qa.documentoActivo()?.ejemplo === true, undefined, { timeout: 20_000 });
	if (await ejemplo.locator('#btn-cerrar-explicacion').isVisible()) await ejemplo.locator('#btn-cerrar-explicacion').click();
	await ejemplo.locator('#btn-exportar').click();
	const htmlEjemplo = (await bajar(ejemplo, '#btn-dossier')).toString('utf8');
	ok('ejemplo exportado queda efímero sin ID/revisión falsos',
		htmlEjemplo.includes('Ejemplo efímero') && htmlEjemplo.includes('<dd>No asignado</dd>')
		&& htmlEjemplo.includes('<dd>No asignada</dd>'));
	await contextoEjemplo.close();
	ok('sin errores JavaScript', erroresJs.length === 0,
		[...erroresJs.slice(0, 2), ...recursosHttp.slice(0, 3)].join(' | '));
} catch (e) {
	fallos++;
	console.error(e?.stack ?? e);
} finally {
	try { await browser?.close(); } catch (e) { fallos++; console.error(e); }
	servidor.closeAllConnections?.();
	try { await new Promise((resolve, reject) => servidor.close((e) => e ? reject(e) : resolve())); }
	catch (e) { fallos++; console.error(e); }
	process.chdir(cwdPrevio);
	const baseTemporal = realpathSync(tmpdir());
	const rutaTemporal = realpathSync(temporal);
	if (!rutaTemporal.startsWith(baseTemporal + sep)) throw new Error('Ruta temporal fuera del directorio de QA');
	rmSync(rutaTemporal, { recursive: true, force: true });
	if (chromeLogPrevio === undefined) delete process.env.CHROME_LOG_FILE;
	else process.env.CHROME_LOG_FILE = chromeLogPrevio;
}
console.log(`DOC-01 QA: ${pruebas} comprobaciones, ${fallos} fallos, ${erroresJs.length} JS errors, ${Math.round(performance.now() - inicio)} ms`);
process.exitCode = fallos ? 1 : 0;
