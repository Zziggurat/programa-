/** DOC-03: preparar, verificar y declarar una entrega; comparar tras editar y reabrir. */
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { ARGS_NAVEGADOR, ejecutableNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const inicio = performance.now();
const { servidor, url } = await servidorDeQA();
const temporal = mkdtempSync(join(tmpdir(), 'qa-doc03-revision-'));
const cwdInicial = process.cwd();
const chromeLogAnterior = process.env.CHROME_LOG_FILE;
process.env.CHROME_LOG_FILE = join(temporal, 'chromium.log');
process.chdir(temporal);
let contexto;
let pruebas = 0, fallos = 0;
const erroresJs = [];
const ok = (nombre, condicion, detalle = '') => {
	pruebas++;
	if (!condicion) fallos++;
	console.log(`${condicion ? 'OK  ' : 'FAIL'} ${nombre}${detalle ? ` → ${detalle}` : ''}`);
};
const sha = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const guardar = page => page.evaluate(() => window.qa.esperarPersistencia());
const vigilar = page => {
	page.setDefaultTimeout(30_000);
	page.on('pageerror', error => erroresJs.push(`pageerror: ${error.message}`));
	page.on('console', mensaje => {
		if (mensaje.type() === 'error'
			&& !/\/favicon\.ico(?:$|[?#])/i.test(mensaje.location().url ?? ''))
			erroresJs.push(`console: ${mensaje.text()}`);
	});
};
const iniciar = async page => {
	await page.goto(`${url}/?qa=1&inicio=0`, { waitUntil: 'load' });
	await esperarEditorListo(page);
	if (await page.locator('#modal-ayuda').isVisible()) await page.locator('#btn-cerrar-ayuda').click();
	if (await page.locator('#bienvenida').isVisible()) await page.locator('#btn-empezar-blanco').click();
	await guardar(page);
};
const nombrar = async (page, nombre) => {
	await page.locator('#nombre-proyecto').fill(nombre);
	await page.locator('#nombre-proyecto').press('Tab');
	await guardar(page);
};
const añadir = async (page, texto) => {
	if (!(await page.locator('#modo-editor').evaluate(b => b.classList.contains('activo'))))
		await page.locator('#modo-editor').click();
	await page.locator('#hta-anadir').click();
	await page.locator('#catalogo .item-catalogo').filter({ hasText: texto }).first().click();
	await guardar(page);
};
const abrirBiblioteca = async page => {
	await page.locator('#btn-archivo').click();
	await page.locator('#btn-mis-tableros').click();
	await page.locator('#modal-tableros').waitFor({ state: 'visible' });
};
const abrirProyecto = async (page, id) => {
	await abrirBiblioteca(page);
	await page.locator(`.tarjeta-documento[data-documento-id="${id}"]`)
		.getByRole('button', { name: 'Abrir', exact: true }).click();
	await page.waitForFunction(esperado => window.qa.documentoActivo()?.id === esperado, id);
	await guardar(page);
};
const documentacion = async page => {
	if (!(await page.locator('#ingenieria-validar').isVisible())) await page.locator('#hta-ingenieria').click();
	await page.locator('#ingenieria-validar').click();
	await page.locator('[data-ing-view="documentacion"]').click();
	await page.locator('[data-ing-doc-refresh]').click();
};
const lanzarContexto = () => chromium.launchPersistentContext(join(temporal, 'perfil'), {
	...(ejecutableNavegador() ? { executablePath: ejecutableNavegador() } : {}),
	args: ARGS_NAVEGADOR, viewport: { width: 1440, height: 900 }, acceptDownloads: true,
});

try {
	contexto = await lanzarContexto();
	let page = contexto.pages()[0] ?? await contexto.newPage();
	vigilar(page);
	await iniciar(page);
	await nombrar(page, 'Tablero A DOC-03');
	await añadir(page, 'Contactor 3P 9A');
	const a = await guardar(page);
	ok('A es un tablero persistente con aparato propio', !!a?.id && a.proyecto.nombre === 'Tablero A DOC-03'
		&& a.proyecto.dispositivos.length === 1);
	await documentacion(page);
	const antes = await page.locator('[data-ing-documentation]').innerText();
	ok('A no confunde snapshots de recuperación con entregas', antes.includes('No hay revisiones preparadas'));

	const descarga = page.waitForEvent('download', { timeout: 120_000 });
	await page.locator('[data-ing-doc="paquete"]').click();
	const archivo = await descarga;
	const zip = readFileSync(await archivo.path());
	const hash = sha(zip);
	const fila = page.locator('.ing-doc-revisions article').filter({ has: page.locator(`[data-ing-doc-hash="${hash}"]`) });
	await fila.waitFor({ state: 'visible' });
	ok('ZIP preparado queda archivado con SHA real y sin entrega presunta', zip.length > 1024
		&& /\.zip$/i.test(archivo.suggestedFilename())
		&& (await fila.innerText()).includes(`r${a.revision}`)
		&& (await fila.innerText()).includes('descarga y entrega no confirmadas')
		&& await fila.locator('[data-ing-doc-compare]').count() === 0, `${zip.length} bytes`);

	const alterado = Buffer.from(zip);
	alterado[alterado.length - 1] ^= 1;
	await fila.locator('[data-ing-doc-file]').setInputFiles({
		name: 'paquete-alterado.zip', mimeType: 'application/zip', buffer: alterado,
	});
	await page.waitForFunction(() => document.getElementById('toast')?.textContent?.includes('No se declaró la entrega'));
	ok('ZIP alterado no puede declararse entregado',
		(await fila.innerText()).includes('descarga y entrega no confirmadas')
		&& await fila.locator('[data-ing-doc-compare]').count() === 0);

	await fila.locator('[data-ing-doc-file]').setInputFiles({
		name: archivo.suggestedFilename(), mimeType: 'application/zip', buffer: zip,
	});
	await page.locator('#modal-dialogo').waitFor({ state: 'visible' });
	ok('entrega requiere declaración visible tras cotejar bytes',
		(await page.locator('#modal-dialogo').innerText()).includes('entrega'));
	await page.locator('#dialogo-ok').click();
	await page.locator(`[data-ing-doc-compare][data-ing-doc-hash="${hash}"]`).waitFor({ state: 'visible' });
	ok('entrega declarada conserva SHA y habilita comparación',
		(await fila.innerText()).includes('Entrega declarada')
		&& (await fila.innerText()).includes(hash));

	await añadir(page, 'Piloto 24 V');
	const aEditado = await guardar(page);
	ok('A avanzó revisión sin cambiar su identidad', aEditado.id === a.id
		&& aEditado.revision > a.revision && aEditado.proyecto.dispositivos.length === 2);
	await documentacion(page);
	await page.locator(`[data-ing-doc-compare][data-ing-doc-hash="${hash}"]`).click();
	await page.locator('[data-ing-documentation] .ing-doc-preview').filter({ hasText: `Cambios desde r${a.revision}` })
		.waitFor({ state: 'visible' });
	const comparacion = await page.locator('[data-ing-documentation]').innerText();
	ok('diff de A identifica el aparato añadido desde la entrega',
		comparacion.includes('APARATO · AGREGADO') && comparacion.includes('Cambios desde r' + a.revision));

	await abrirBiblioteca(page);
	await page.locator('#btn-nuevo-biblioteca').click();
	await page.locator('#modal-tableros').waitFor({ state: 'hidden' });
	await nombrar(page, 'Tablero B DOC-03');
	await añadir(page, 'Pulsador marcha/paro');
	const b = await guardar(page);
	ok('B mantiene otra identidad y contenido', b?.id && b.id !== a.id && b.proyecto.dispositivos.length === 1);
	await documentacion(page);
	ok('B no ve entregas ni revisiones de A',
		(await page.locator('[data-ing-documentation]').innerText()).includes('No hay revisiones preparadas')
		&& await page.locator(`[data-ing-doc-hash="${hash}"]`).count() === 0);
	await page.locator('[data-ing-doc-global]').click();
	const archivoAEnB = page.locator('.ing-doc-revisions article').filter({ hasText: hash });
	await archivoAEnB.waitFor({ state: 'visible' });
	ok('archivo global identifica A mientras B está activo y lo deja solo para consulta',
		(await archivoAEnB.innerText()).includes(a.id)
		&& (await archivoAEnB.innerText()).includes('Tablero A DOC-03')
		&& (await archivoAEnB.innerText()).includes('Archivo de otro tablero')
		&& await archivoAEnB.locator('[data-ing-doc-file], [data-ing-doc-compare]').count() === 0);

	await page.close();
	await contexto.close();
	contexto = await lanzarContexto();
	page = contexto.pages()[0] ?? await contexto.newPage();
	vigilar(page);
	await iniciar(page);
	await abrirProyecto(page, a.id);
	await documentacion(page);
	await page.locator(`[data-ing-doc-compare][data-ing-doc-hash="${hash}"]`).waitFor({ state: 'visible' });
	ok('tras reiniciar Chromium, A conserva la entrega declarada',
		(await page.locator(`[data-ing-doc-compare][data-ing-doc-hash="${hash}"]`).count()) === 1
		&& (await guardar(page)).id === a.id);
	await page.locator(`[data-ing-doc-compare][data-ing-doc-hash="${hash}"]`).click();
	await page.locator('[data-ing-documentation]').getByText('APARATO · AGREGADO').waitFor({ state: 'visible' });
	ok('tras reiniciar Chromium, el diff usa el baseline archivado',
		(await page.locator('[data-ing-documentation]').innerText()).includes('Cambios desde r' + a.revision));
	await abrirProyecto(page, b.id);
	await documentacion(page);
	ok('tras reiniciar Chromium, B sigue sin heredar revisión de A',
		(await page.locator('[data-ing-documentation]').innerText()).includes('No hay revisiones preparadas')
		&& await page.locator(`[data-ing-doc-hash="${hash}"]`).count() === 0);

	// Una revisión declarada entregada sobrevive al borrado del tablero editable.
	await abrirBiblioteca(page);
	const tarjetaA = page.locator(`.tarjeta-documento[data-documento-id="${a.id}"]`);
	await tarjetaA.getByRole('button', { name: 'Eliminar', exact: true }).click();
	await page.locator('#modal-dialogo').waitFor({ state: 'visible' });
	ok('el diálogo avisa que el archivo documental persiste',
		(await page.locator('#modal-dialogo').innerText()).includes('permanecerán en el archivo'));
	await page.locator('#dialogo-ok').click();
	await tarjetaA.waitFor({ state: 'detached' });
	ok('eliminar A quita solo el tablero editable, B sigue en Mis Tableros',
		await page.locator(`.tarjeta-documento[data-documento-id="${b.id}"]`).count() === 1);
	await page.locator('#btn-cerrar-tableros').click();
	await page.locator('[data-ing-doc-global]').click();
	const archivoEliminado = page.locator('.ing-doc-revisions article').filter({ hasText: hash });
	await archivoEliminado.waitFor({ state: 'visible' });
	ok('A borrado conserva historial con nombre, ID, SHA y estado de entrega',
		(await archivoEliminado.innerText()).includes('Tablero A DOC-03')
		&& (await archivoEliminado.innerText()).includes(a.id)
		&& (await archivoEliminado.innerText()).includes('Entrega declarada')
		&& await archivoEliminado.locator('[data-ing-doc-file], [data-ing-doc-compare]').count() === 0);

	await page.close();
	await contexto.close();
	contexto = await lanzarContexto();
	page = contexto.pages()[0] ?? await contexto.newPage();
	vigilar(page);
	await iniciar(page);
	ok('segundo reinicio mantiene B y no resucita el tablero borrado',
		(await guardar(page)).id === b.id
		&& (await page.evaluate(() => window.qa.documentos())).every(d => d.id !== a.id));
	await documentacion(page);
	await page.locator('[data-ing-doc-global]').click();
	await page.locator('.ing-doc-revisions article').filter({ hasText: hash }).waitFor({ state: 'visible' });
	ok('segundo reinicio conserva archivo de A borrado en solo lectura',
		(await page.locator('.ing-doc-revisions article').filter({ hasText: hash }).innerText()).includes(a.id)
		&& await page.locator('.ing-doc-revisions article').filter({ hasText: hash })
			.locator('[data-ing-doc-file], [data-ing-doc-compare]').count() === 0);
	ok('sin errores JavaScript', erroresJs.length === 0, erroresJs.slice(0, 2).join(' | '));
} catch (error) {
	fallos++;
	console.error(error?.stack ?? error);
} finally {
	try { await contexto?.close(); } catch (error) { fallos++; console.error(error); }
	servidor.closeAllConnections?.();
	try { await new Promise((resolve, reject) => servidor.close(error => error ? reject(error) : resolve())); }
	catch (error) { fallos++; console.error(error); }
	process.chdir(cwdInicial);
	if (chromeLogAnterior === undefined) delete process.env.CHROME_LOG_FILE;
	else process.env.CHROME_LOG_FILE = chromeLogAnterior;
	const base = realpathSync(tmpdir());
	const destino = realpathSync(temporal);
	if (!destino.startsWith(base + sep)) throw new Error('Ruta temporal de QA fuera de tmpdir');
	rmSync(destino, { recursive: true, force: true });
}
console.log(`DOC-03 revisión: ${pruebas} comprobaciones, ${fallos} fallos, ${erroresJs.length} JS errors, ${Math.round(performance.now() - inicio)} ms`);
process.exitCode = fallos ? 1 : 0;
