/** Focal: una base V2 conserva latest y archiva solo la revisión que realmente conoce. */
import { chromium } from 'playwright-core';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const { servidor, url } = await servidorDeQA();
let navegador;
let contexto;
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
			const solicitud = indexedDB.open('tablerostudio-documentos', 3);
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
	if (estado.version !== 3 || estado.vigente?.revision !== 2
		|| estado.revision2?.nombre !== estado.vigente.nombre || estado.revision1 !== undefined) {
		throw new Error(`Migración V2→V3 incorrecta: ${JSON.stringify(estado)}`);
	}
	console.log('OK  IndexedDB V2→V3 conserva latest y archiva exactamente r2; no inventa r1.');
	if (erroresJs.length) throw new Error(`Errores JavaScript: ${erroresJs.join(' | ')}`);
	console.log('OK  0 errores JavaScript.');
} catch (error) {
	fallos++;
	console.error(error?.stack ?? error);
} finally {
	try { await contexto?.close(); } catch (error) { fallos++; console.error('Cierre de contexto:', error); }
	try { await navegador?.close(); } catch (error) { fallos++; console.error('Cierre de Chromium:', error); }
	servidor.closeAllConnections?.();
	try { await new Promise((resolve, reject) => servidor.close((error) => error ? reject(error) : resolve())); }
	catch (error) { fallos++; console.error('Cierre de servidor:', error); }
}
process.exitCode = fallos ? 1 : 0;
