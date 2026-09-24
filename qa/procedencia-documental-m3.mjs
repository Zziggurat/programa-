/** QA focal DOC-01: procedencia confirmada/efímera y bytes de preview/descarga. */
import { chromium } from 'playwright-core';
import { readFileSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

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
const ok = (nombre, cierto, detalle = '') => {
	pruebas++;
	if (!cierto) fallos++;
	console.log(`${cierto ? 'OK  ' : 'FAIL'} ${nombre}${detalle ? ` → ${detalle}` : ''}`);
};
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const bajar = async (page, selector) => {
	const evento = page.waitForEvent('download', { timeout: 15_000 });
	await page.locator(selector).click();
	const descarga = await evento;
	return readFileSync(await descarga.path());
};
const textoPdf = (bytes) => {
	// Equivalente mínimo de leer-pdf.py sin proceso Python externo (bloqueado en sandbox).
	const partes = [];
	for (const match of bytes.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
		const raw = Buffer.from(match[1], 'latin1');
		try { partes.push(inflateSync(raw).toString('latin1')); }
		catch { partes.push(raw.toString('latin1')); }
	}
	return Array.from(partes.join('\n').matchAll(/\(((?:[^()\\]|\\.)*)\)\s*T[jJ]/g),
		(m) => m[1].replaceAll('\\(', '(').replaceAll('\\)', ')')).join(' ');
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
	page.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text())) erroresJs.push(m.text()); });
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
		&& textoEsq.includes('Build ID'));
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
	ok('sin errores JavaScript', erroresJs.length === 0, erroresJs.slice(0, 2).join(' | '));
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
