/** Focal: una base V2 conserva latest y archiva solo la revisión que realmente conoce. */
import { chromium } from 'playwright-core';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const { servidor, url } = await servidorDeQA();
let navegador;
let contexto;
let contextoV3;
let fallos = 0;
const erroresJs = [];
try {
	navegador = await abrirNavegador(chromium);
	contexto = await navegador.newContext();
	const pagina = await contexto.newPage();
	pagina.setDefaultTimeout(30_000);
	pagina.on('pageerror', (error) => erroresJs.push(error.message));
	await pagina.route(`${url}/__preparar_idb_v2__`, (ruta) => ruta.fulfill({
		status: 200, contentType: 'text/html', body: '<!doctype html><title>Preparar IndexedDB</title>',
	}));
	await pagina.goto(`${url}/__preparar_idb_v2__`);
	await pagina.evaluate(async () => {
		const definicion = {
			formato: 'tablero-studio-componente', version: 1, id: 'cmp-legacy-v2', revision: 2,
			nombre: 'Definición anterior', creadoEn: '2026-01-01T00:00:00.000Z',
			modificadoEn: '2026-01-02T00:00:00.000Z', tipoDispositivo: 'otro',
			dimensiones: { anchoMm: 20, altoMm: 30, fondoMm: 15 },
			assetId: `sha256:${'a'.repeat(64)}`, terminales: [],
			comportamiento: { version: 1, clase: 'sin-comportamiento', motivo: 'Histórico' },
		};
		const base = await new Promise((resolve, reject) => {
			const solicitud = indexedDB.open('tablerostudio-documentos', 2);
			solicitud.onupgradeneeded = () => solicitud.result.createObjectStore('customComponents');
			solicitud.onsuccess = () => resolve(solicitud.result);
			solicitud.onerror = () => reject(solicitud.error);
		});
		await new Promise((resolve, reject) => {
			const tx = base.transaction(['customComponents'], 'readwrite');
			tx.objectStore('customComponents').put(definicion, definicion.id);
			tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); tx.onerror = () => reject(tx.error);
		});
		base.close();
	});
	await pagina.goto(`${url}/?qa=1&inicio=0`, { waitUntil: 'load' });
	await esperarEditorListo(pagina);
	const estado = await pagina.evaluate(async () => {
		const base = await new Promise((resolve, reject) => {
			const solicitud = indexedDB.open('tablerostudio-documentos', 4);
			solicitud.onsuccess = () => resolve(solicitud.result);
			solicitud.onerror = () => reject(solicitud.error);
		});
		try {
			const historico = base.transaction(['customComponents', 'customComponentRevisions'], 'readonly');
			const leer = (almacen, clave) => new Promise((resolve, reject) => {
				const solicitud = historico.objectStore(almacen).get(clave);
				solicitud.onsuccess = () => resolve(solicitud.result);
				solicitud.onerror = () => reject(solicitud.error);
			});
			const [vigente, revision2, revision1] = await Promise.all([
				leer('customComponents', 'cmp-legacy-v2'),
				leer('customComponentRevisions', JSON.stringify(['cmp-legacy-v2', 2])),
				leer('customComponentRevisions', JSON.stringify(['cmp-legacy-v2', 1])),
			]);
			return { version: base.version, vigente, revision2, revision1 };
		} finally { base.close(); }
	});
	if (estado.version !== 4 || estado.vigente?.revision !== 2
		|| estado.revision2?.nombre !== estado.vigente.nombre || estado.revision1 !== undefined) {
		throw new Error(`Migración V2→V4 incorrecta: ${JSON.stringify(estado)}`);
	}
	console.log('OK  IndexedDB V2→V4 conserva latest y archiva exactamente r2; no inventa r1.');
	// La base publicada por V9 ya era V3. V4 sólo agrega el archivo documental:
	// ni el custom histórico ni metadata deben desaparecer durante esa actualización.
	contextoV3 = await navegador.newContext();
	const paginaV3 = await contextoV3.newPage();
	paginaV3.on('pageerror', (error) => erroresJs.push(error.message));
	await paginaV3.route(`${url}/__preparar_idb_v3__`, (ruta) => ruta.fulfill({
		status: 200, contentType: 'text/html', body: '<!doctype html><title>Preparar V3</title>',
	}));
	await paginaV3.goto(`${url}/__preparar_idb_v3__`);
	await paginaV3.evaluate(async () => {
		const nombres = ['projects', 'assets', 'customComponents', 'snapshots', 'metadata',
			'recovery', 'technicalData', 'customComponentRevisions'];
		const base = await new Promise((resolve, reject) => {
			const solicitud = indexedDB.open('tablerostudio-documentos', 3);
			solicitud.onupgradeneeded = () => nombres.forEach((nombre) => solicitud.result.createObjectStore(nombre));
			solicitud.onsuccess = () => resolve(solicitud.result);
			solicitud.onerror = () => reject(solicitud.error);
		});
		await new Promise((resolve, reject) => {
			const tx = base.transaction(['metadata', 'customComponentRevisions'], 'readwrite');
			tx.objectStore('metadata').put({ id: 'qa-sentinel-v3', valor: 'intacto' }, 'qa-sentinel-v3');
			tx.objectStore('customComponentRevisions').put({ id: 'cmp-v3', revision: 2 },
				JSON.stringify(['cmp-v3', 2]));
			tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); tx.onerror = () => reject(tx.error);
		});
		base.close();
	});
	await paginaV3.goto(`${url}/?qa=1&inicio=0`, { waitUntil: 'load' });
	await esperarEditorListo(paginaV3);
	const migradoV3 = await paginaV3.evaluate(async () => {
		const base = await new Promise((resolve, reject) => {
			const solicitud = indexedDB.open('tablerostudio-documentos', 4);
			solicitud.onsuccess = () => resolve(solicitud.result);
			solicitud.onerror = () => reject(solicitud.error);
		});
		try {
			const tx = base.transaction(['metadata', 'customComponentRevisions', 'documentaryRevisions'], 'readonly');
			const leer = (almacen, clave) => new Promise((resolve, reject) => {
				const solicitud = tx.objectStore(almacen).get(clave);
				solicitud.onsuccess = () => resolve(solicitud.result);
				solicitud.onerror = () => reject(solicitud.error);
			});
			const [metadata, componente] = await Promise.all([
				leer('metadata', 'qa-sentinel-v3'),
				leer('customComponentRevisions', JSON.stringify(['cmp-v3', 2])),
			]);
			return {
				version: base.version,
				metadata,
				componente,
				documentary: base.objectStoreNames.contains('documentaryRevisions'),
			};
		} finally { base.close(); }
	});
	if (migradoV3.version !== 4 || migradoV3.metadata?.valor !== 'intacto'
		|| migradoV3.componente?.revision !== 2 || !migradoV3.documentary) {
		throw new Error(`Migración V3→V4 perdió datos: ${JSON.stringify(migradoV3)}`);
	}
	console.log('OK  IndexedDB V3→V4 conserva metadata y revisiones custom; añade archivo documental.');
	if (erroresJs.length) throw new Error(`Errores JavaScript: ${erroresJs.join(' | ')}`);
	console.log('OK  0 errores JavaScript.');
} catch (error) {
	fallos++;
	console.error(error?.stack ?? error);
} finally {
	try { await contexto?.close(); } catch (error) { fallos++; console.error('Cierre de contexto:', error); }
	try { await contextoV3?.close(); } catch (error) { fallos++; console.error('Cierre de contexto V3:', error); }
	try { await navegador?.close(); } catch (error) { fallos++; console.error('Cierre de Chromium:', error); }
	servidor.closeAllConnections?.();
	try { await new Promise((resolve, reject) => servidor.close((error) => error ? reject(error) : resolve())); }
	catch (error) { fallos++; console.error('Cierre de servidor:', error); }
}
process.exitCode = fallos ? 1 : 0;
