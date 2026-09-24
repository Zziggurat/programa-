/**
 * INI-06 · Perfil exploratorio R1, deliberadamente FUERA del gate funcional.
 * Después de `tsc` y `editor:build --mode qa`:
 *   node qa/benchmark-r1.mjs
 *   R1_GL=hardware node qa/benchmark-r1.mjs   # opt-in: comprobar renderer real en el informe
 *   R1_FOCAL=1 node qa/benchmark-r1.mjs         # una selección + un drag para perfilar causas
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
const focal = process.env.R1_FOCAL === '1';
const repeticiones = numeroMuestras('R1_MUESTRAS', focal ? 1 : 5, focal ? 1 : 2, 20);
const aperturas = numeroMuestras('R1_APERTURAS', focal ? 0 : 5, focal ? 0 : 2, 20);
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
	metodo: `R1 sintético · exploratorio · ${focal ? 'perfil causal corto' : 'navegador local'}`,
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
const faseHost = async (accion) => {
	const inicio = ahora();
	const valor = await accion();
	return { valor, ms: redondear(msDesde(inicio)) };
};
const resumirEventos = (eventos) => Object.fromEntries(
	['pointerdown', 'pointermove', 'pointerup'].map((tipo) => {
		const duraciones = eventos.filter((e) => e.tipo === tipo).map((e) => e.ms);
		return [tipo, duraciones.length ? resumen(duraciones) : { n: 0 }];
	}),
);
const resumenCampo = (muestras, campo) => resumen(muestras.map((m) => m[campo]));
const deltaCDP = (antes, despues) => {
	if (!antes || !despues) return null;
	return Object.fromEntries([
		['tareasMs', 'TaskDuration', 1000],
		['scriptMs', 'ScriptDuration', 1000],
		['layoutMs', 'LayoutDuration', 1000],
		['recalcularEstilosMs', 'RecalcStyleDuration', 1000],
		['heapJsMiB', 'JSHeapUsedSize', 1 / 2 ** 20],
	].map(([salida, nombre, escala]) => [salida,
		Number.isFinite(antes[nombre]) && Number.isFinite(despues[nombre])
			? redondear((despues[nombre] - antes[nombre]) * escala) : null]));
};
const temporal = mkdtempSync(join(tmpdir(), 'tablerostudio-r1-'));
const cwdInicial = process.cwd();
const chromeLogAnterior = process.env.CHROME_LOG_FILE;
process.env.CHROME_LOG_FILE = join(temporal, 'chromium.log');
process.chdir(temporal);
let servidor;
let navegador;
let contexto;
let pagina;
let sesionCDP;
let fallo;

async function metricasCDP() {
	if (!sesionCDP) return null;
	const { metrics } = await sesionCDP.send('Performance.getMetrics');
	return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

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

async function instantaneaRutas() {
	return pagina.evaluate(() => {
		const colorPorId = new Map(window.qa.proyecto().conductores.map((c) => [c.id, c.color ?? null]));
		return window.qa.rutas().map((r) => ({ ...r, colorDeclarado: colorPorId.get(r.id) ?? null }));
	});
}

function diferenciarRutas(antes, despues) {
	const iniciales = new Map(antes.map((r) => [r.id, r]));
	const finales = new Map(despues.map((r) => [r.id, r]));
	const ids = [...new Set([...iniciales.keys(), ...finales.keys()])].sort();
	const cambio = (id, clave) => JSON.stringify(iniciales.get(id)?.[clave]) !== JSON.stringify(finales.get(id)?.[clave]);
	const cambiadas = ids.filter((id) => ['puntos', 'radio', 'colorDeclarado'].some((clave) => cambio(id, clave)));
	return { antes: antes.length, despues: despues.length,
		cambiadas: cambiadas.length, estables: ids.length - cambiadas.length, idsCambiados: cambiadas,
		puntosCambiados: ids.filter((id) => cambio(id, 'puntos')).length,
		radioCambiado: ids.filter((id) => cambio(id, 'radio')).length,
		colorDeclaradoCambiado: ids.filter((id) => cambio(id, 'colorDeclarado')).length,
		precision: 'puntos del hook QA redondeados a 0,1 mm; color declarado, no material WebGL' };
}

/**
 * Cronometra únicamente los listeners del canvas, en el reloj del navegador.
 * El listener capture antecede a los handlers del editor y el de burbuja se instala después;
 * no convierte los tiempos de Playwright en "latencia pura" ni modifica ninguna acción UX.
 */
async function instalarSondaDeEventos() {
	await pagina.evaluate(() => {
		const canvas = document.querySelector('#escena canvas');
		if (!canvas) throw new Error('R1: falta el canvas para instrumentar gestos');
		const inicio = new WeakMap();
		const eventos = [];
		const manejadores = [];
		for (const tipo of ['pointerdown', 'pointermove', 'pointerup']) {
			const antes = (e) => { inicio.set(e, performance.now()); };
			const despues = (e) => {
				const t = inicio.get(e);
				if (t !== undefined) eventos.push({ tipo, ms: performance.now() - t });
			};
			canvas.addEventListener(tipo, antes, { capture: true });
			canvas.addEventListener(tipo, despues);
			manejadores.push({ tipo, antes, despues });
		}
		window.__r1SondaEventos = {
			tomar: () => eventos.splice(0),
			cerrar: () => {
				for (const { tipo, antes, despues } of manejadores) {
					canvas.removeEventListener(tipo, antes, { capture: true });
					canvas.removeEventListener(tipo, despues);
				}
				delete window.__r1SondaEventos;
			},
		};
	});
}
const tomarEventos = () => pagina.evaluate(() => window.__r1SondaEventos.tomar());
const iniciarCronometroEditor = () => pagina.evaluate(() => window.qa.cronometro(true));
const leerCronometroEditor = async () => {
	const lectura = await pagina.evaluate(() => window.qa.cronometroLeer());
	await pagina.evaluate(() => window.qa.cronometro(false));
	return lectura;
};

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
	if (tiemposApertura.length) resultado.mediciones.aperturaPersistida = resumen(tiemposApertura);
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
	resultado.mediciones.instrumentacion = {
		host: 'Playwright/Node performance.now(): incluye protocolo y espera de respuesta',
		navegador: 'performance.now() entre listeners capture/burbuja del canvas; no es una traza CPU completa',
		etapas: 'cronómetro QA ya existente del editor y contadores, observación solamente',
		cdp: 'deltas Performance.getMetrics por operación; proceso renderer, no perfil CPU granular',
	};
	try {
		sesionCDP = await contexto.newCDPSession(pagina);
		await sesionCDP.send('Performance.enable');
	} catch (e) {
		sesionCDP = undefined;
		resultado.advertencias.push(`CDP Performance no disponible: ${e?.message ?? e}`);
	}
	await instalarSondaDeEventos();

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
	const detalleSeleccion = [];
	for (let i = 0; i < repeticiones; i++) {
		const elegido = agarrables[i % 2];
		const q = await puntoAparato(elegido.id);
		if (!q) throw new Error(`Se perdió el punto seleccionable de ${elegido.id}`);
		await tomarEventos();
		await iniciarCronometroEditor();
		const cdpAntes = await metricasCDP();
		const inicio = ahora();
		const hover = await faseHost(() => pagina.mouse.move(q.x, q.y));
		const clic = await faseHost(async () => {
			await pagina.mouse.down();
			await pagina.mouse.up();
			await pagina.waitForFunction((id) => window.qa.seleccion()?.id === id, elegido.id);
		});
		const totalMs = msDesde(inicio);
		const cdpDespues = await metricasCDP();
		tiemposSeleccion.push(totalMs);
		const eventos = await tomarEventos();
		detalleSeleccion.push({ id: elegido.id, totalHostMs: redondear(totalMs),
			hoverHostMs: hover.ms, clicYConfirmacionHostMs: clic.ms,
			canvas: resumirEventos(eventos), editor: await leerCronometroEditor(),
			cdp: deltaCDP(cdpAntes, cdpDespues) });
	}
	resultado.mediciones.seleccionExtremoAExtremo = resumen(tiemposSeleccion);
	resultado.mediciones.seleccionPorFase = detalleSeleccion;
	resultado.mediciones.seleccionFases = {
		hoverHost: resumenCampo(detalleSeleccion, 'hoverHostMs'),
		clicYConfirmacionHost: resumenCampo(detalleSeleccion, 'clicYConfirmacionHostMs'),
	};
	console.log(`Selección p50/p95 ${resultado.mediciones.seleccionExtremoAExtremo.p50Ms}/${resultado.mediciones.seleccionExtremoAExtremo.p95Ms} ms`);

	// El bornero auxiliar tiene un corredor libre. Cada muestra alterna el sentido, sin acumular
	// desplazamientos ni llevar el objeto a otro circuito. Un drag sin cambio real NO se cuenta.
	const dragId = agarrables.find((a) => a.id === 'aux-b')?.id ?? agarrables[0].id;
	const tiemposDrag = [];
	const tiemposPersistencia = [];
	const tareasDrag = [];
	const detalleDrag = [];
	let controlFocal;
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
		const rutasAntes = await instantaneaRutas();
		await pagina.evaluate(() => window.qa.olvidarTareasLargas());
		await tomarEventos();
		await iniciarCronometroEditor();
		const cdpAntes = await metricasCDP();
		const t = ahora();
		const hover = await faseHost(() => pagina.mouse.move(q.x, q.y));
		const bajar = await faseHost(() => pagina.mouse.down());
		let seisMovimientos;
		let soltar;
		try { seisMovimientos = await faseHost(() => pagina.mouse.move(q.x + avance, q.y, { steps: 6 })); }
		finally { soltar = await faseHost(() => pagina.mouse.up()); }
		const totalDragMs = msDesde(t);
		const cdpDespues = await metricasCDP();
		tiemposDrag.push(totalDragMs);
		const eventos = await tomarEventos();
		const editor = await leerCronometroEditor();
		const rutasDespues = await instantaneaRutas();
		const movimientosCanvas = eventos.filter((e) => e.tipo === 'pointermove');
		const despues = await posicion(dragId);
		if (!despues || (despues.x === antes.x && despues.y === antes.y))
			throw new Error(`Drag ${i + 1} no cambió la colocación de ${dragId}`);
		if (focal) controlFocal = { antes, despues, rutasAntes, rutasDespues };
		const tGuardar = ahora();
		const { activo, msNavegador } = await pagina.evaluate(async () => {
			const inicio = performance.now();
			const activo = await window.qa.esperarPersistencia();
			return { activo, msNavegador: performance.now() - inicio };
		});
		if (activo.proyecto.gabinete.colocaciones.find((c) => c.dispositivoId === dragId)?.x !== despues.x)
			throw new Error(`El gesto ${i + 1} no quedó persistido`);
		const persistenciaMs = msDesde(tGuardar);
		tiemposPersistencia.push(persistenciaMs);
		detalleDrag.push({ id: dragId, totalHostMs: redondear(totalDragMs),
			hoverHostMs: hover.ms, pointerdownHostMs: bajar.ms,
			seisMovimientosHostMs: seisMovimientos?.ms ?? null, pointerupHostMs: soltar?.ms ?? null,
			canvas: resumirEventos(eventos),
			seisMovimientosCanvas: movimientosCanvas.length > 1
				? resumen(movimientosCanvas.slice(1).map((e) => e.ms)) : { n: 0 },
			editor, cdp: deltaCDP(cdpAntes, cdpDespues),
			rutas: diferenciarRutas(rutasAntes, rutasDespues),
			flushHostMs: redondear(persistenciaMs), flushNavegadorMs: redondear(msNavegador) });
		tareasDrag.push(...await pagina.evaluate(() => window.qa.contadores().tareasLargas));
		console.log(`Drag ${i + 1}/${repeticiones}: ${redondear(tiemposDrag.at(-1))} ms; flush ${redondear(tiemposPersistencia.at(-1))} ms`);
	}
	resultado.mediciones.dragExtremoAExtremo = resumen(tiemposDrag);
	resultado.mediciones.dragPorFase = detalleDrag;
	resultado.mediciones.dragFases = Object.fromEntries(
		['hoverHostMs', 'pointerdownHostMs', 'seisMovimientosHostMs', 'pointerupHostMs',
			'flushHostMs', 'flushNavegadorMs'].map((campo) => [campo, resumenCampo(detalleDrag, campo)]),
	);
	resultado.mediciones.confirmacionPersistencia = resumen(tiemposPersistencia);
	resultado.mediciones.tareasLargas = {
		n: tareasDrag.length,
		peorMs: Math.max(0, ...tareasDrag.map((e) => e.ms)),
	};
	if (focal && controlFocal) {
		// En Editor los cables son deliberadamente no seleccionables. El rail visible
		// activa Trabajo mediante Cablear; las pastillas antiguas de modo están ocultas.
		// Un clic humano no necesita la espera implícita de navegación de locator.click:
		// el cambio de modo recompone la escena R1 y esa espera puede agotarse después
		// de que el botón ya recibió el gesto. La precondición se comprueba explícitamente.
		const botonCablear = pagina.locator('#hta-conectar');
		await botonCablear.waitFor({ state: 'visible', timeout: 10_000 });
		if (!await botonCablear.isEnabled()) throw new Error('Cablear no está habilitado');
		const cajaCablear = await botonCablear.boundingBox();
		if (!cajaCablear) throw new Error('Cablear no tiene área visible para el clic humano');
		await pagina.mouse.click(cajaCablear.x + cajaCablear.width / 2,
			cajaCablear.y + cajaCablear.height / 2);
		await pagina.waitForFunction(() => document.body.classList.contains('modo-trabajo'),
			null, { timeout: 10_000 });
		const puntoCable = await pagina.evaluate(() => {
			for (const id of ['dol-w3', 'dol-w28', 'reserva-w1', 'reserva-w2', 'reserva-w4']) {
				const p = window.qa.puntoParaAgarrar(id, 31);
				if (p && window.qa.queSeleccionaEnPixel(p.x, p.y) === `cable:${id}`) return { id, p };
			}
			return null;
		});
		if (!puntoCable) throw new Error('Tras reconciliar no hay cable seleccionable entre los candidatos R1');
		await pagina.mouse.move(puntoCable.p.x, puntoCable.p.y);
		const cursorHover = await pagina.locator('#escena canvas').evaluate((canvas) => canvas.style.cursor);
		await pagina.mouse.click(puntoCable.p.x, puntoCable.p.y);
		await pagina.waitForFunction((id) => window.qa.seleccion()?.tipo === 'cable'
			&& window.qa.seleccion()?.id === id, puntoCable.id, { timeout: 10_000 });
		if (cursorHover !== 'grab') throw new Error(`Hover de ${puntoCable.id} sin cursor de cable: ${cursorHover}`);
		await pagina.locator('#btn-deshacer').click();
		await pagina.waitForFunction(({ id, antes }) => {
			const c = window.qa.proyecto().gabinete.colocaciones.find((x) => x.dispositivoId === id);
			return c?.x === antes.x && c?.y === antes.y;
		}, { id: dragId, antes: controlFocal.antes });
		const rutasDeshechas = await instantaneaRutas();
		if (JSON.stringify(rutasDeshechas) !== JSON.stringify(controlFocal.rutasAntes))
			throw new Error('Deshacer el drag no restauró las rutas R1');
		await pagina.locator('#btn-rehacer').click();
		await pagina.waitForFunction(({ id, despues }) => {
			const c = window.qa.proyecto().gabinete.colocaciones.find((x) => x.dispositivoId === id);
			return c?.x === despues.x && c?.y === despues.y;
		}, { id: dragId, despues: controlFocal.despues });
		const rutasRehechas = await instantaneaRutas();
		if (JSON.stringify(rutasRehechas) !== JSON.stringify(controlFocal.rutasDespues))
			throw new Error('Rehacer el drag no recuperó las rutas R1');
		if (await pagina.evaluate(() => window.qa.cablesDibujados()) !== 100)
			throw new Error('Undo/redo dejó geometrías de cable faltantes o fantasma');
		resultado.mediciones.verificacionFocal = {
			cableSeleccionado: puntoCable.id, hover: cursorHover,
			undoRutasIdenticas: true, redoRutasIdenticas: true, geometriaTrasRedo: 100,
		};
	}

	if (!focal) {
	const tiemposExportacion = [];
	const detalleExportacion = [];
	for (let i = 0; i < repeticiones; i++) {
		const inicioNavegador = await pagina.evaluate(() => performance.now());
		const inicio = ahora();
		const menu = await faseHost(() => pagina.locator('#btn-archivo').click());
		const descarga = pagina.waitForEvent('download');
		const guardar = await faseHost(() => pagina.locator('#btn-guardar').click());
		const entrega = await faseHost(() => descarga);
		const archivo = entrega.valor;
		if (!archivo.suggestedFilename().endsWith('.json')) throw new Error('Guardar no descargó JSON');
		const totalMs = msDesde(inicio);
		tiemposExportacion.push(totalMs);
		const finNavegador = await pagina.evaluate(() => performance.now());
		detalleExportacion.push({ totalHostMs: redondear(totalMs), menuHostMs: menu.ms,
			guardarHostMs: guardar.ms, descargaPendienteHostMs: entrega.ms,
			intervaloNavegadorMs: redondear(finNavegador - inicioNavegador) });
	}
	resultado.mediciones.guardarJsonExtremoAExtremo = resumen(tiemposExportacion);
	resultado.mediciones.guardarJsonPorFase = detalleExportacion;
	resultado.mediciones.guardarJsonFases = Object.fromEntries(
		['menuHostMs', 'guardarHostMs', 'descargaPendienteHostMs', 'intervaloNavegadorMs']
			.map((campo) => [campo, resumenCampo(detalleExportacion, campo)]),
	);

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
	} else {
		resultado.mediciones.omitidoEnPerfilCorto = [
			'exportación JSON', 'render directo repetido', 'validación ingeniería', 'reaperturas',
		];
	}
	resultado.mediciones.totalMs = redondear(msDesde(inicioTotal));
	resultado.documento.revisionFinal = (await pagina.evaluate(() => window.qa.esperarPersistencia())).revision;
	if (resultado.documento.revisionFinal <= resultado.documento.revisionInicial)
		throw new Error('El drag no produjo una nueva revisión persistente');
	if (resultado.erroresJs.length) throw new Error(`${resultado.erroresJs.length} errores JavaScript`);
} catch (error) {
	fallo = error;
	console.error(`BENCHMARK R1 INCOMPLETO: ${error?.stack ?? error}`);
} finally {
	try { await pagina?.evaluate(() => window.__r1SondaEventos?.cerrar()); }
	catch (e) { fallo ??= e; console.error('Cierre de sonda R1:', e); }
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
