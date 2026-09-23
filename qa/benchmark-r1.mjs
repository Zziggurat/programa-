/**
 * INI-06 · Perfil exploratorio R1, deliberadamente FUERA del gate funcional.
 * Después de `tsc` y `editor:build --mode qa`:
 *   node qa/benchmark-r1.mjs
 *   R1_GL=hardware node qa/benchmark-r1.mjs   # opt-in: comprobar renderer real en el informe
 *
 * Importa un JSON por la misma entrada de archivo visible que usa una persona; el QA hook solo
 * observa identidad, picking, geometría y métricas. Selección/drag/guardar/validar usan ratón real.
 * Los tiempos Playwright son extremo a extremo, NO latencia pura del handler ni certificado GPU.
 */
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, cpus, totalmem, platform, release, arch } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { ARGS_NAVEGADOR, ejecutableNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';
import { crearDensidadR1, MANIFIESTO_R1, verificarDensidadR1 } from './lib/densidad-r1.mjs';

const numeroMuestras = (nombre, valor, minimo, maximo) => {
	const n = Number(process.env[nombre] ?? valor);
	if (!Number.isInteger(n) || n < minimo || n > maximo)
		throw new Error(`${nombre} exige un entero entre ${minimo} y ${maximo}`);
	return n;
};
const repeticiones = numeroMuestras('R1_MUESTRAS', 5, 2, 20);
const aperturas = numeroMuestras('R1_APERTURAS', 5, 2, 20);
const glSolicitado = process.env.R1_GL === 'hardware' ? 'hardware' : 'swiftshader';
const require = createRequire(import.meta.url);
const entorno = {
	so: `${platform()} ${release()} ${arch()}`,
	cpu: cpus()[0]?.model ?? 'NO VERIFICADA', hilos: cpus().length,
	ramGiB: Math.round(totalmem() / 2 ** 30 * 10) / 10,
	node: process.version, playwright: require('playwright-core/package.json').version,
	glSolicitado, aceleracionArtificial: 'ninguna', calidad: 'predeterminada del editor',
};
const fixture = crearDensidadR1();
const invariantes = verificarDensidadR1(fixture);
const bytesFixture = Buffer.from(JSON.stringify(fixture));
const hashFixture = createHash('sha256').update(bytesFixture).digest('hex');
const resultado = {
	metodo: 'R1 sintético · exploratorio · navegador local',
	manifiesto: MANIFIESTO_R1, fixtureSha256: hashFixture,
	entorno, muestras: { aperturas, operaciones: repeticiones },
	mediciones: {}, advertencias: [], erroresJs: [],
};
const redondear = (n) => Math.round(n * 10) / 10;
const resumen = (valores) => {
	const ordenados = [...valores].sort((a, b) => a - b);
	const cuantil = (q) => ordenados[Math.min(ordenados.length - 1, Math.ceil(ordenados.length * q) - 1)];
	return { n: valores.length, p50Ms: redondear(cuantil(0.5)), p95Ms: redondear(cuantil(0.95)),
		peorMs: redondear(ordenados.at(-1)), muestrasMs: valores.map(redondear) };
};
const ahora = () => performance.now();
const msDesde = (inicio) => performance.now() - inicio;
const temporal = mkdtempSync(join(tmpdir(), 'tablerostudio-r1-'));
const cwdInicial = process.cwd();
const chromeLogAnterior = process.env.CHROME_LOG_FILE;
process.env.CHROME_LOG_FILE = join(temporal, 'chromium.log');
process.chdir(temporal);
let servidor;
let navegador;
let contexto;
let pagina;
let fallo;

async function abrirChromium() {
	const executablePath = ejecutableNavegador();
	return chromium.launch({ ...(executablePath ? { executablePath } : {}),
		args: glSolicitado === 'hardware' ? [] : ARGS_NAVEGADOR });
}

async function listoR1() {
	await esperarEditorListo(pagina, { timeout: 180_000 });
	await pagina.waitForFunction(() => {
		const p = window.qa?.proyecto?.();
		return p?.nombre === 'R1 sintético · 30 aparatos / 100 conductores'
			&& p.dispositivos.length === 30 && p.conductores.length === 100
			&& !!document.querySelector('#escena canvas')
			&& !document.body.inert;
	}, null, { timeout: 180_000 });
	await pagina.waitForFunction(() => window.qa.cablesDibujados() === 100,
		null, { timeout: 60_000 });
	const persistido = await pagina.evaluate(() => window.qa.esperarPersistencia());
	if (!persistido?.id || persistido.proyecto?.conductores?.length !== 100)
		throw new Error('La escena R1 no quedó confirmada en el repositorio local');
	return persistido;
}

async function cerrarSuperficies() {
	for (const [modal, cerrar] of [
		['#modal-ayuda', '#btn-cerrar-ayuda'], ['#bienvenida', '#btn-empezar-blanco'],
		['#modal-explicacion', '#btn-cerrar-explicacion'],
	]) {
		if (await pagina.locator(modal).isVisible()) await pagina.locator(cerrar).click();
	}
}

async function puntoAparato(id) {
	return pagina.evaluate((buscado) => {
		const p = window.qa.proyecto();
		const c = p.gabinete.colocaciones.find((x) => x.dispositivoId === buscado);
		if (!c) return null;
		const lienzo = document.querySelector('#escena canvas')?.getBoundingClientRect();
		for (const z of [60, 45, 30, 70]) for (const u of [0.5, 0.3, 0.7]) for (const v of [0.5, 0.3, 0.7]) {
			const q = window.qa.puntoEnPantalla(c.x + c.ancho * u, c.y + c.alto * v, z);
			if (!q || !lienzo || q.x < lienzo.left + 3 || q.x > lienzo.right - 3
				|| q.y < lienzo.top + 3 || q.y > lienzo.bottom - 3) continue;
			if (window.qa.queSeleccionaEnPixel(q.x, q.y) === `dispositivo:${buscado}`) return q;
		}
		return null;
	}, id);
}

async function posicion(id) {
	return pagina.evaluate((buscado) => {
		const c = window.qa.proyecto().gabinete.colocaciones.find((x) => x.dispositivoId === buscado);
		return c ? { x: c.x, y: c.y } : null;
	}, id);
}

try {
	const inicioTotal = ahora();
	({ servidor, url: resultado.urlLocal } = await servidorDeQA());
	navegador = await abrirChromium();
	contexto = await navegador.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
	pagina = await contexto.newPage();
	pagina.setDefaultTimeout(180_000);
	pagina.on('pageerror', (e) => resultado.erroresJs.push(`pageerror: ${e.message}`));
	pagina.on('console', (m) => {
		if (m.type() === 'error' && !/favicon\.ico/i.test(m.location().url ?? ''))
			resultado.erroresJs.push(`console: ${m.text()}`);
	});
	entorno.chromium = navegador.version();
	await pagina.goto(`${resultado.urlLocal}/?qa=1&inicio=0`, { waitUntil: 'load' });
	await esperarEditorListo(pagina);
	await cerrarSuperficies();
	const tImportar = ahora();
	await pagina.locator('#btn-archivo').click();
	const selectorArchivo = pagina.waitForEvent('filechooser');
	await pagina.locator('#btn-abrir').click();
	await (await selectorArchivo).setFiles({
		name: 'r1-densidad-sintetica.tablero.json', mimeType: 'application/json', buffer: bytesFixture,
	});
	const documento = await listoR1();
	resultado.mediciones.importarArchivoMs = redondear(msDesde(tImportar));
	resultado.documento = { id: documento.id, revisionInicial: documento.revision, ...invariantes };
	await cerrarSuperficies();
	const dibujados = await pagina.evaluate(() => window.qa.cablesDibujados());
	if (dibujados !== 100) throw new Error(`Geometrías fantasma/no montadas: ${dibujados}/100 conductores dibujados`);
	resultado.geometrias = { dibujados, esperados: 100 };
	console.log(`R1 importado: 30 aparatos, 100 conductores, ${dibujados} trazados visibles · ${resultado.mediciones.importarArchivoMs} ms`);

	const tiemposApertura = [];
	for (let i = 0; i < aperturas; i++) {
		const inicio = ahora();
		await pagina.reload({ waitUntil: 'load' });
		const activo = await listoR1();
		if (activo.id !== documento.id) throw new Error('Reapertura cambió la identidad del documento R1');
		tiemposApertura.push(msDesde(inicio));
		console.log(`Apertura ${i + 1}/${aperturas}: ${redondear(tiemposApertura.at(-1))} ms`);
	}
	resultado.mediciones.aperturaPersistida = resumen(tiemposApertura);
	await cerrarSuperficies();
	const metadatos = await pagina.evaluate(() => {
		const canvas = document.querySelector('#escena canvas');
		const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
		const debug = gl?.getExtension('WEBGL_debug_renderer_info');
		return {
			viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
			userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
			dispositivoMemoriaGiB: navigator.deviceMemory ?? null,
			webglVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : 'NO VERIFICADO',
			webglRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'NO VERIFICADO',
			heapJsMiB: performance.memory
				? Math.round(performance.memory.usedJSHeapSize / 2 ** 20 * 10) / 10 : null,
		};
	});
	resultado.entorno = { ...entorno, ...metadatos };
	if (/swiftshader|software/i.test(metadatos.webglRenderer))
		resultado.advertencias.push('WebGL por software: esta ejecución NO acredita rendimiento con GPU física.');
	else if (metadatos.webglRenderer === 'NO VERIFICADO')
		resultado.advertencias.push('Backend WebGL no verificable; no afirmar GPU física.');
	if (glSolicitado === 'hardware' && /swiftshader|software/i.test(metadatos.webglRenderer))
		resultado.advertencias.push('Se solicitó hardware pero Chromium siguió usando software.');

	await pagina.locator('#hta-seleccionar').click();
	await pagina.locator('#btn-centrar').click();
	const candidatos = ['aux-a', 'aux-b', 'aux-c', 'dol-km1', 'et-km1'];
	const agarrables = [];
	for (const id of candidatos) {
		const q = await puntoAparato(id);
		if (q) agarrables.push({ id, q });
		if (agarrables.length >= 2) break;
	}
	if (agarrables.length < 2) throw new Error('No se encontraron dos aparatos seleccionables dentro del visor R1');
	const tiemposSeleccion = [];
	for (let i = 0; i < repeticiones; i++) {
		const elegido = agarrables[i % 2];
		const q = await puntoAparato(elegido.id);
		if (!q) throw new Error(`Se perdió el punto seleccionable de ${elegido.id}`);
		const inicio = ahora();
		await pagina.mouse.click(q.x, q.y);
		await pagina.waitForFunction((id) => window.qa.seleccion()?.id === id, elegido.id);
		tiemposSeleccion.push(msDesde(inicio));
	}
	resultado.mediciones.seleccionExtremoAExtremo = resumen(tiemposSeleccion);
	console.log(`Selección p50/p95 ${resultado.mediciones.seleccionExtremoAExtremo.p50Ms}/${resultado.mediciones.seleccionExtremoAExtremo.p95Ms} ms`);

	// El bornero auxiliar tiene un corredor libre. Cada muestra alterna el sentido, sin acumular
	// desplazamientos ni llevar el objeto a otro circuito. Un drag sin cambio real NO se cuenta.
	const dragId = agarrables.find((a) => a.id === 'aux-b')?.id ?? agarrables[0].id;
	const tiemposDrag = [];
	const tiemposPersistencia = [];
	const tareasDrag = [];
	for (let i = 0; i < repeticiones; i++) {
		const antes = await posicion(dragId);
		const q = await puntoAparato(dragId);
		if (!q) throw new Error(`No hay punto visible para arrastrar ${dragId}`);
		// El contrato del editor es «primero elegir, luego mover»; arrastrar un aparato NO elegido
		// orbita la cámara. La preparación se hace con un clic humano fuera del tiempo medido.
		if ((await pagina.evaluate(() => window.qa.seleccion()))?.id !== dragId) {
			await pagina.mouse.click(q.x, q.y);
			await pagina.waitForFunction((id) => window.qa.seleccion()?.id === id, dragId);
		}
		const avance = i % 2 ? -12 : 12;
		await pagina.evaluate(() => window.qa.olvidarTareasLargas());
		const t = ahora();
		await pagina.mouse.move(q.x, q.y);
		await pagina.mouse.down();
		try { await pagina.mouse.move(q.x + avance, q.y, { steps: 6 }); }
		finally { await pagina.mouse.up(); }
		tiemposDrag.push(msDesde(t));
		const despues = await posicion(dragId);
		if (!despues || (despues.x === antes.x && despues.y === antes.y))
			throw new Error(`Drag ${i + 1} no cambió la colocación de ${dragId}`);
		const tGuardar = ahora();
		const activo = await pagina.evaluate(() => window.qa.esperarPersistencia());
		if (activo.proyecto.gabinete.colocaciones.find((c) => c.dispositivoId === dragId)?.x !== despues.x)
			throw new Error(`El gesto ${i + 1} no quedó persistido`);
		tiemposPersistencia.push(msDesde(tGuardar));
		tareasDrag.push(...await pagina.evaluate(() => window.qa.contadores().tareasLargas));
		console.log(`Drag ${i + 1}/${repeticiones}: ${redondear(tiemposDrag.at(-1))} ms; flush ${redondear(tiemposPersistencia.at(-1))} ms`);
	}
	resultado.mediciones.dragExtremoAExtremo = resumen(tiemposDrag);
	resultado.mediciones.confirmacionPersistencia = resumen(tiemposPersistencia);
	resultado.mediciones.tareasLargas = {
		n: tareasDrag.length,
		peorMs: Math.max(0, ...tareasDrag.map((e) => e.ms)),
	};

	const tiemposExportacion = [];
	for (let i = 0; i < repeticiones; i++) {
		const inicio = ahora();
		await pagina.locator('#btn-archivo').click();
		const descarga = pagina.waitForEvent('download');
		await pagina.locator('#btn-guardar').click();
		const archivo = await descarga;
		if (!archivo.suggestedFilename().endsWith('.json')) throw new Error('Guardar no descargó JSON');
		tiemposExportacion.push(msDesde(inicio));
	}
	resultado.mediciones.guardarJsonExtremoAExtremo = resumen(tiemposExportacion);

	const dibujado = [];
	for (let i = 0; i < 30; i++) dibujado.push((await pagina.evaluate(() => window.qa.medirDibujado(1))).mediana);
	resultado.mediciones.renderDirecto = resumen(dibujado);

	const tiemposValidacion = [];
	await pagina.locator('#hta-ingenieria').click();
	for (let i = 0; i < Math.min(3, repeticiones); i++) {
		const inicio = ahora();
		await pagina.locator('#ingenieria-validar').click();
		await pagina.locator('[data-ing-circuit-inspector]').waitFor({ state: 'visible' });
		tiemposValidacion.push(msDesde(inicio));
	}
	resultado.mediciones.validacionExtremoAExtremo = resumen(tiemposValidacion);
	resultado.mediciones.totalMs = redondear(msDesde(inicioTotal));
	resultado.documento.revisionFinal = (await pagina.evaluate(() => window.qa.esperarPersistencia())).revision;
	if (resultado.documento.revisionFinal <= resultado.documento.revisionInicial)
		throw new Error('El drag no produjo una nueva revisión persistente');
	if (resultado.erroresJs.length) throw new Error(`${resultado.erroresJs.length} errores JavaScript`);
} catch (error) {
	fallo = error;
	console.error(`BENCHMARK R1 INCOMPLETO: ${error?.stack ?? error}`);
} finally {
	try { await contexto?.close(); } catch (e) { fallo ??= e; console.error('Cierre de contexto:', e); }
	try { await navegador?.close(); } catch (e) { fallo ??= e; console.error('Cierre de Chromium:', e); }
	if (servidor) {
		servidor.closeAllConnections?.();
		try { await new Promise((ok, no) => servidor.close((e) => e ? no(e) : ok())); }
		catch (e) { fallo ??= e; console.error('Cierre de servidor:', e); }
	}
	process.chdir(cwdInicial);
	if (chromeLogAnterior === undefined) delete process.env.CHROME_LOG_FILE;
	else process.env.CHROME_LOG_FILE = chromeLogAnterior;
	// Únicamente la carpeta temporal exacta creada por mkdtemp, nunca una ruta de trabajo.
	const bajoTemp = resolve(temporal).startsWith(resolve(tmpdir()) + sep);
	if (bajoTemp) try { rmSync(temporal, { recursive: true, force: true }); }
	catch (e) { fallo ??= e; console.error('Limpieza temporal:', e); }
	delete resultado.urlLocal;
	resultado.completo = !fallo;
	resultado.error = fallo ? String(fallo?.message ?? fallo) : null;
	console.log(JSON.stringify(resultado, null, 2));
	process.exitCode = fallo ? 1 : 0;
}
