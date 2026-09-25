/** DOC-08: el ZIP con imágenes exige permiso visible antes de archivar o descargar. */
import { chromium } from 'playwright-core';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const inicio = performance.now();
const temporal = mkdtempSync(join(tmpdir(), 'qa-doc08-activos-'));
const cwdAnterior = process.cwd();
const logAnterior = process.env.CHROME_LOG_FILE;
process.env.CHROME_LOG_FILE = join(temporal, 'chromium.log');
process.chdir(temporal);
let servidor, browser, page;
let comprobaciones = 0, fallos = 0;
const erroresJS = [], descargas = [];
// PNG RGB 2×2 válido, generado para QA: el PDF debe incrustarlo, no solo dibujar <img> en el editor.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGO8I2LDwMDAxAAGAA7aATAS/mzBAAAAAElFTkSuQmCC', 'base64');
function comprobar(nombre, condicion, detalle = '') {
	comprobaciones++;
	if (!condicion) fallos++;
	console.log(`${condicion ? 'OK  ' : 'FAIL'} ${nombre}${detalle ? ` → ${detalle}` : ''}`);
}
function entradasStore(zip) {
	const entradas = new Map();
	let pos = 0;
	while (pos + 30 <= zip.length && zip.readUInt32LE(pos) === 0x04034b50) {
		const largoNombre = zip.readUInt16LE(pos + 26);
		const largoExtra = zip.readUInt16LE(pos + 28);
		const largo = zip.readUInt32LE(pos + 18);
		const ruta = zip.subarray(pos + 30, pos + 30 + largoNombre).toString('utf8');
		const comienzo = pos + 30 + largoNombre + largoExtra;
		entradas.set(ruta, zip.subarray(comienzo, comienzo + largo));
		pos = comienzo + largo;
	}
	return entradas;
}

try {
	const entorno = await servidorDeQA();
	servidor = entorno.servidor;
	browser = await abrirNavegador(chromium);
	page = await browser.newPage({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
	page.setDefaultTimeout(30_000);
	page.on('download', evento => descargas.push(evento));
	page.on('pageerror', error => erroresJS.push(`pageerror: ${error.message}`));
	page.on('console', mensaje => {
		if (mensaje.type() === 'error' && !/\/favicon\.ico(?:$|[?#])/i.test(mensaje.location().url ?? ''))
			erroresJS.push(`console: ${mensaje.text()}`);
	});
	await page.goto(`${entorno.url}/?qa=1&inicio=0`, { waitUntil: 'load' });
	await esperarEditorListo(page);
	if (await page.locator('#modal-ayuda').isVisible()) await page.locator('#btn-cerrar-ayuda').click();
	if (await page.locator('#bienvenida').isVisible()) await page.locator('#btn-empezar-blanco').click();
	await page.evaluate(() => window.qa.esperarPersistencia());
	await page.locator('#btn-pdf').click();
	await page.locator('#dos-logo-archivo').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
	await page.waitForFunction(() => !!window.qa.proyecto().dossier?.empresa?.logo);
	await page.locator('#dos-archivo').setInputFiles({ name: 'obra.png', mimeType: 'image/png', buffer: png });
	await page.waitForFunction(() => window.qa.proyecto().dossier?.bloques?.filter(b => b.tipo === 'imagen' && b.imagen).length === 1);
	comprobar('logo e imagen añadidos mediante la interfaz real',
		await page.locator('#dos-logo-vista').isVisible() && await page.locator('#dos-bloques .dos-imagen').count() === 1);
	await page.locator('#dos-cerrar').click();
	await page.evaluate(() => window.qa.esperarPersistencia());
	await page.locator('#hta-ingenieria').click();
	await page.locator('#ingenieria-validar').click();
	await page.locator('[data-ing-view="documentacion"]').click();
	await page.locator('[data-ing-doc-refresh]').click();
	const revisionAntes = await page.evaluate(() => window.qa.documentoActivo()?.revision);
	await page.locator('[data-ing-doc="paquete"]').click();
	await page.locator('#modal-dialogo').waitFor({ state: 'visible' });
	const aviso = await page.locator('#dialogo-msg').innerText();
	comprobar('el permiso nombra logo, imagen, privacidad y ZIP',
		aviso.includes('el logo de la empresa') && aviso.includes('1 imagen del dossier')
		&& aviso.includes('información privada') && aviso.includes('ZIP'), aviso);
	comprobar('la acción afirmativa especifica inclusión de imágenes',
		(await page.locator('#dialogo-ok').innerText()).includes('Incluir imágenes'));
	await page.locator('#dialogo-cancelar').click();
	await page.locator('#modal-dialogo').waitFor({ state: 'hidden' });
	await page.locator('[data-ing-doc-refresh]').click();
	const revisionTrasCancelar = await page.evaluate(() => window.qa.documentoActivo()?.revision);
	comprobar('cancelar no descargó ni creó una revisión archivada',
		descargas.length === 0 && await page.locator('.ing-doc-revisions article').count() === 0
		&& revisionTrasCancelar === revisionAntes,
		`descargas=${descargas.length}, revisión=${revisionAntes}→${revisionTrasCancelar}`);

	const descarga = page.waitForEvent('download', { timeout: 120_000 });
	await page.locator('[data-ing-doc="paquete"]').click();
	await page.locator('#modal-dialogo').waitFor({ state: 'visible' });
	await page.locator('#dialogo-ok').click();
	const evento = await descarga;
	const ruta = await evento.path();
	if (!ruta) throw new Error('El navegador no produjo un ZIP descargable.');
	const zip = readFileSync(ruta);
	const entradas = entradasStore(zip);
	const pdf = entradas.get('dossier/dossier.pdf');
	const textoPdf = pdf?.toString('latin1') ?? '';
	comprobar('consentimiento descarga el ZIP con las imágenes incorporadas al PDF',
		/\.zip$/i.test(evento.suggestedFilename()) && !!pdf
		&& /\/Subtype\s*\/Image/.test(textoPdf),
		`bytes ZIP=${zip.length}, PDF=${pdf?.length ?? 0}, subtipos=${JSON.stringify(textoPdf.match(/\/Subtype[^\r\n]{0,80}/g)?.slice(0, 4))}`);
	comprobar('el ZIP no adjunta archivos de imagen crudos',
		![...entradas.keys()].some(nombre => /(?:^|\/)(?:assets\/|[^/]+\.(?:png|jpe?g|webp|svgz))$/i.test(nombre)));
	await page.locator('.ing-doc-revisions article').first().waitFor({ state: 'visible' });
	comprobar('solo tras consentir queda una emisión preparada en el archivo',
		await page.locator('.ing-doc-revisions article').count() === 1);
	comprobar('sin errores JavaScript', erroresJS.length === 0, erroresJS.slice(0, 2).join(' | '));
} catch (error) {
	fallos++;
	console.error(error?.stack ?? error);
} finally {
	try { await page?.close(); } catch (error) { fallos++; console.error(error); }
	try { await browser?.close(); } catch (error) { fallos++; console.error(error); }
	if (servidor) try {
		servidor.closeAllConnections?.();
		await new Promise((resolve, reject) => servidor.close(error => error ? reject(error) : resolve()));
	} catch (error) { fallos++; console.error(error); }
	process.chdir(cwdAnterior);
	if (logAnterior === undefined) delete process.env.CHROME_LOG_FILE;
	else process.env.CHROME_LOG_FILE = logAnterior;
	try {
		const base = realpathSync(tmpdir()), destino = realpathSync(temporal);
		if (!destino.startsWith(base + sep)) throw new Error('Ruta temporal de QA fuera de tmpdir');
		rmSync(destino, { recursive: true, force: true });
	} catch (error) { fallos++; console.error(error); }
}
console.log(`DOC-08 activos: ${comprobaciones} comprobaciones, ${fallos} fallos, ${erroresJS.length} JS errors, ${Math.round(performance.now() - inicio)} ms`);
process.exitCode = fallos ? 1 : 0;
