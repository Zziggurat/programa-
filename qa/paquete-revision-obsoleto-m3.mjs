/** DOC-02: un ZIP en preparación no debe sobrevivir a una edición ni a un cambio A/B. */
import { chromium } from 'playwright-core';
import { readFileSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const inicio = performance.now();
const { servidor, url } = await servidorDeQA();
const temporal = mkdtempSync(join(tmpdir(), 'qa-paquete-obsoleto-'));
const cwdPrevio = process.cwd();
process.chdir(temporal);
let browser;
let fallos = 0;
let pruebas = 0;
const erroresJs = [];
const descargas = [];
const ok = (nombre, cierto, detalle = '') => {
	pruebas++;
	if (!cierto) fallos++;
	console.log(`${cierto ? 'OK  ' : 'FAIL'} ${nombre}${detalle ? ` → ${detalle}` : ''}`);
};

// Lector independiente y mínimo de las entradas STORE del ZIP32. No importa el escritor del producto.
function leerZipStore(bytes) {
	const archivos = new Map();
	let p = 0;
	while (p + 4 <= bytes.length && bytes.readUInt32LE(p) === 0x04034b50) {
		if (bytes.readUInt16LE(p + 8) !== 0 || bytes.readUInt16LE(p + 6) !== 0x0800) {
			throw new Error('ZIP inesperado: método distinto de STORE o sin ruta UTF-8');
		}
		const largo = bytes.readUInt32LE(p + 18);
		const nombreLargo = bytes.readUInt16LE(p + 26);
		const extraLargo = bytes.readUInt16LE(p + 28);
		const nombre = bytes.subarray(p + 30, p + 30 + nombreLargo).toString('utf8');
		const comienzo = p + 30 + nombreLargo + extraLargo;
		const fin = comienzo + largo;
		if (!nombre || fin > bytes.length || archivos.has(nombre)) throw new Error('ZIP truncado o con ruta duplicada');
		archivos.set(nombre, bytes.subarray(comienzo, fin));
		p = fin;
	}
	if (!archivos.size || bytes.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP sin directorio central');
	return archivos;
}

const guardar = (page) => page.evaluate(() => window.qa.esperarPersistencia());
const nombrar = async (page, nombre) => {
	await page.locator('#nombre-proyecto').fill(nombre);
	await page.locator('#nombre-proyecto').press('Tab');
	await guardar(page);
};
const abrirBiblioteca = async (page) => {
	await page.locator('#btn-archivo').click();
	await page.locator('#btn-mis-tableros').click();
	await page.locator('#modal-tableros').waitFor({ state: 'visible' });
};
const abrirDocumento = async (page, id) => {
	await abrirBiblioteca(page);
	await page.locator(`.tarjeta-documento[data-documento-id="${id}"]`)
		.getByRole('button', { name: 'Abrir', exact: true }).click();
	await page.waitForFunction((esperado) => window.qa.documentoActivo()?.id === esperado, id);
	await guardar(page);
};
const mostrarPaquete = async (page) => {
	if (!(await page.locator('#ingenieria-validar').isVisible())) await page.locator('#hta-ingenieria').click();
	await page.locator('#ingenieria-validar').click();
	await page.locator('[data-ing-view="documentacion"]').click();
	await page.locator('[data-ing-doc="paquete"]').waitFor({ state: 'visible' });
};

/**
 * El clic y las ediciones son operaciones humanas. Se pausa una sola digestión SHA-256
 * del empaquetado para forzar el entrelazado; sin esta barrera la carrera sería aleatoria.
 * No se falsea ni modifica el hash: al liberar se ejecuta el Web Crypto original.
 */
const prepararPausaHash = (page) => page.evaluate(() => {
	const s = crypto.subtle;
	const anterior = Object.getOwnPropertyDescriptor(s, 'digest');
	const original = s.digest.bind(s);
	const puerta = { esperando: false, soltar: undefined, liberar() {
		if (anterior) Object.defineProperty(s, 'digest', anterior);
		else delete s.digest;
		this.soltar?.();
	} };
	Object.defineProperty(s, 'digest', { configurable: true, value(...args) {
		if (!puerta.esperando) {
			puerta.esperando = true;
			return new Promise((resolver) => { puerta.soltar = () => resolver(original(...args)); });
		}
		return original(...args);
	} });
	window.__qaPausaPaquete = puerta;
});
const soltarPausaHash = (page) => page.evaluate(() => window.__qaPausaPaquete.liberar());

try {
	browser = await abrirNavegador(chromium);
	const contexto = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
	const page = await contexto.newPage();
	page.setDefaultTimeout(30_000);
	page.on('pageerror', (e) => erroresJs.push(e.message));
	page.on('console', (m) => { if (m.type() === 'error'
		&& !/\/favicon\.ico(?:$|[?#])|favicon/i.test(`${m.location().url} ${m.text()}`))
		erroresJs.push(`${m.text()} [${m.location().url || 'sin URL'}]`); });
	page.on('download', (d) => descargas.push(d));
	await page.goto(`${url}/?qa=1&inicio=0`, { waitUntil: 'load' });
	await esperarEditorListo(page);
	if (await page.locator('#modal-ayuda').isVisible()) await page.locator('#btn-cerrar-ayuda').click();
	if (await page.locator('#bienvenida').isVisible()) await page.locator('#btn-empezar-blanco').click();
	await nombrar(page, 'Proyecto A DOC-02');
	await page.locator('#hta-anadir').click();
	await page.locator('#catalogo .item-catalogo').filter({ hasText: 'Contactor 3P 9A' }).first().click();
	const a = await guardar(page);
	ok('A tiene identidad y contenido propios', !!a?.id && a.proyecto?.dispositivos?.length === 1);

	await abrirBiblioteca(page);
	await page.locator('#btn-nuevo-biblioteca').click();
	await page.locator('#modal-tableros').waitFor({ state: 'hidden' });
	await nombrar(page, 'Proyecto B DOC-02');
	await page.locator('#catalogo .item-catalogo').filter({ hasText: 'Piloto 24 V' }).first().click();
	const b = await guardar(page);
	ok('B tiene otra identidad y contenido diferente', b?.id !== a?.id
		&& b.proyecto?.dispositivos?.length === 1
		&& b.proyecto.dispositivos[0]?.tipo === 'piloto');
	await abrirDocumento(page, a.id);
	await mostrarPaquete(page);

	// Caso 1: cambia el contenido después de congelar A y antes de completar el ZIP.
	await prepararPausaHash(page);
	await page.locator('[data-ing-doc="paquete"]').click();
	await page.waitForFunction(() => window.__qaPausaPaquete?.esperando === true, null, { timeout: 90_000 });
	await nombrar(page, 'Proyecto A editado DOC-02');
	const revisionAEditada = await guardar(page);
	await soltarPausaHash(page);
	await page.waitForFunction(() => document.getElementById('toast')?.textContent?.includes('cambió durante el paquete'),
		null, { timeout: 30_000 });
	ok('edición durante preparación rechaza ZIP obsoleto', descargas.length === 0
		&& revisionAEditada.revision > a.revision && revisionAEditada.proyecto.nombre === 'Proyecto A editado DOC-02');

	// Caso 2: A y B son documentos independientes; cambiar al otro no puede descargar una mezcla.
	await mostrarPaquete(page);
	await prepararPausaHash(page);
	await page.locator('[data-ing-doc="paquete"]').click();
	await page.waitForFunction(() => window.__qaPausaPaquete?.esperando === true, null, { timeout: 90_000 });
	await abrirDocumento(page, b.id);
	await soltarPausaHash(page);
	await page.waitForFunction(() => document.getElementById('toast')?.textContent?.includes('cambió durante el paquete'),
		null, { timeout: 30_000 });
	ok('cambio A→B durante preparación rechaza ZIP de A', descargas.length === 0
		&& (await guardar(page)).id === b.id);

	// La negativa no deja el exportador bloqueado: una nueva acción visible entrega B solamente.
	await mostrarPaquete(page);
	const descargaB = page.waitForEvent('download', { timeout: 120_000 });
	await page.locator('[data-ing-doc="paquete"]').click();
	const zip = readFileSync(await (await descargaB).path());
	const archivos = leerZipStore(zip);
	const manifiesto = JSON.parse(archivos.get('manifiesto.json')?.toString('utf8') ?? 'null');
	const texto = [...archivos].filter(([ruta]) => /\.(?:json|csv|html|svg)$/.test(ruta))
		.map(([, bytes]) => bytes.toString('utf8')).join('\n');
	ok('exportación posterior solo contiene B y revisión confirmada',
		manifiesto?.procedencia?.estado === 'confirmado'
		&& manifiesto.procedencia.projectId === b.id
		&& manifiesto.proyecto === 'Proyecto B DOC-02'
		&& manifiesto.archivos?.length === archivos.size - 1
		&& texto.includes(b.id) && !texto.includes(a.id)
		&& texto.includes('Proyecto B DOC-02') && !texto.includes('Proyecto A editado DOC-02'),
		`${archivos.size} entradas`);
	ok('sin errores JavaScript', erroresJs.length === 0, erroresJs.slice(0, 2).join(' | '));
	await contexto.close();
} catch (error) {
	fallos++;
	console.error(error?.stack ?? error);
} finally {
	try { await browser?.close(); } catch (error) { fallos++; console.error(error); }
	servidor.closeAllConnections?.();
	try { await new Promise((resolve, reject) => servidor.close((error) => error ? reject(error) : resolve())); }
	catch (error) { fallos++; console.error(error); }
	process.chdir(cwdPrevio);
	const base = realpathSync(tmpdir());
	const ruta = realpathSync(temporal);
	if (!ruta.startsWith(base + sep)) throw new Error('Ruta temporal fuera del directorio QA');
	rmSync(ruta, { recursive: true, force: true });
}
console.log(`DOC-02 obsoleto: ${pruebas} comprobaciones, ${fallos} fallos, ${erroresJs.length} JS errors, ${Math.round(performance.now() - inicio)} ms`);
process.exitCode = fallos ? 1 : 0;
