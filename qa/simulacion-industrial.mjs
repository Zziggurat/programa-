/**
 * Regresión compacta del recorrido industrial de Energizar.
 *
 * Usa controles visibles para construir/cablear y para los gestos que se están validando. La API
 * pública `window.qa` observa el resultado y reproduce operaciones del mismo panel cuando el foco
 * es la maniobra, no la localización del botón. Nunca escribe en `window.qa.proyecto()`.
 *
 *   node qa/simulacion-industrial.mjs
 */
import { chromium } from 'playwright-core';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { abrirNavegador, servidorDeQA } from './lib/entorno.mjs';

const inicio = Date.now();
let servidor;
let browser;
let page;
let fallos = 0;
let comprobaciones = 0;
const erroresJS = [];
const chromeLogAnterior = process.env.CHROME_LOG_FILE;
const debugLog = join(process.cwd(), 'debug.log');
const debugLogExistia = existsSync(debugLog);

// Chromium/SwiftShader escribe `debug.log` en el cwd de Windows si no se le da un destino. Las
// suites no deben ensuciar el repositorio; el diagnóstico nativo se descarta y los errores de la
// página se recogen expresamente más abajo.
process.env.CHROME_LOG_FILE = process.platform === 'win32' ? 'NUL' : '/dev/null';

function comprobar(nombre, condicion, detalle = '') {
	comprobaciones++;
	if (!condicion) fallos++;
	console.log(`${condicion ? 'OK  ' : 'FAIL'}  ${nombre}${detalle ? ` → ${detalle}` : ''}`);
}

const qa = (fn, ...args) => page.evaluate(([nombre, parametros]) => {
	if (!window.qa || typeof window.qa[nombre] !== 'function') throw new Error(`window.qa.${nombre} no está disponible`);
	return window.qa[nombre](...parametros);
}, [fn, args]);

async function clickId(id) {
	await page.evaluate((identidad) => {
		const boton = document.getElementById(identidad);
		if (!boton) throw new Error(`no existe #${identidad}`);
		boton.click();
	}, id);
}

/** Cambia un select visible y dispara su evento real en un solo turno, antes del repintado periódico. */
async function elegirSelectVisible(selector, valor) {
	const problema = await page.evaluate(([css, siguiente]) => {
		const select = document.querySelector(css);
		if (!(select instanceof HTMLSelectElement)) return `no existe ${css}`;
		if (![...select.options].some((o) => o.value === siguiente)) return `no existe la opción ${siguiente}`;
		select.value = siguiente;
		select.dispatchEvent(new Event('change', { bubbles: true }));
		return '';
	}, [selector, valor]);
	if (problema) throw new Error(problema);
}

async function cerrarSiVisible(modal, boton) {
	if (await page.locator(modal).isVisible().catch(() => false)) {
		await clickId(boton);
		await page.locator(modal).waitFor({ state: 'hidden', timeout: 10_000 });
	}
}

async function energizar(queremos) {
	const actual = (await qa('simulacion')).energizado;
	if (actual !== queremos) {
		await clickId('btn-energizar');
		await page.waitForFunction((estado) => window.qa.simulacion().energizado === estado, queremos);
	}
}

async function abrirEjemplo(titulo, nombreProyecto) {
	await energizar(false);
	await clickId('btn-ejemplos');
	await page.locator('#modal-ejemplos').waitFor({ state: 'visible' });
	const tarjeta = page.locator('.tarjeta-ejemplo', { hasText: titulo }).first();
	if (!(await tarjeta.count())) throw new Error(`no aparece el ejemplo «${titulo}»`);
	await tarjeta.getByRole('button', { name: /Abrir y estudiar/i }).click();
	// Si el documento anterior necesitara confirmación, se acepta por la UI real.
	await Promise.race([
		page.locator('#modal-dialogo').waitFor({ state: 'visible', timeout: 800 }).then(() => true).catch(() => false),
		page.waitForFunction((nombre) => window.qa.proyecto().nombre === nombre, nombreProyecto, { timeout: 800 }).then(() => true).catch(() => false),
	]);
	if (await page.locator('#modal-dialogo').isVisible().catch(() => false)) await clickId('dialogo-ok');
	await page.waitForFunction((nombre) => window.qa.proyecto().nombre === nombre, nombreProyecto, { timeout: 30_000 });
	await cerrarSiVisible('#modal-explicacion', 'btn-cerrar-explicacion');
	await clickId('modo-trabajo');
	await page.waitForFunction(() => document.body.classList.contains('modo-trabajo'));
}

async function crearTableroNuevo() {
	await energizar(false);
	await page.locator('#btn-archivo').click();
	await page.locator('#btn-mis-tableros').click();
	await page.locator('#modal-tableros').waitFor({ state: 'visible' });
	await page.locator('#btn-nuevo-biblioteca').click();
	await page.locator('#modal-tableros').waitFor({ state: 'hidden' });
	await page.waitForFunction(() => window.qa.proyecto().dispositivos.length === 0
		&& !window.qa.proyecto().esEjemplo);
}

async function esperarActivo(id, activo, timeout = 4_000) {
	await page.waitForFunction(([identidad, esperado]) =>
		window.qa.simulacion().activos.includes(identidad) === esperado, [id, activo], { timeout });
}

async function velocidad(valor) {
	await page.locator('#sim-velocidad').selectOption(String(valor));
}

async function ponerSondaVisible(id, valor) {
	const selector = `#sim-sondas input[data-sonda="${id}"]`;
	await page.locator(selector).waitFor();
	await page.locator(selector).evaluate((input, siguiente) => {
		input.value = String(siguiente);
		input.dispatchEvent(new Event('input', { bubbles: true }));
	}, valor);
}

/** Resultado eléctrico y panel en el mismo turno del navegador: no mezcla lados de una transferencia. */
async function fotoConPanel() {
	return page.evaluate(() => ({
		simulacion: window.qa.simulacion(),
		cuenta: document.querySelector('#sim-funcionando .contando')?.textContent?.trim() ?? '',
		panel: document.querySelector('#sim-funcionando')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
	}));
}

async function iniciarMuestreoHz() {
	await page.evaluate(() => {
		if (window.__qaMuestreoHz) clearInterval(window.__qaMuestreoHz);
		window.__qaMuestrasHz = [];
		window.__qaMuestreoHz = setInterval(() => {
			const texto = document.querySelector('#sim-funcionando .variador')?.textContent ?? '';
			const hz = Number(texto.match(/([\d.]+)\s*Hz/i)?.[1]);
			if (Number.isFinite(hz)) window.__qaMuestrasHz.push(hz);
		}, 25);
		setTimeout(() => {
			if (window.__qaMuestreoHz) clearInterval(window.__qaMuestreoHz);
			window.__qaMuestreoHz = undefined;
		}, 20_000);
	});
}

async function terminarMuestreoHz() {
	return page.evaluate(() => {
		if (window.__qaMuestreoHz) clearInterval(window.__qaMuestreoHz);
		window.__qaMuestreoHz = undefined;
		const muestras = [...(window.__qaMuestrasHz ?? [])];
		delete window.__qaMuestrasHz;
		return muestras;
	});
}

async function muestrearTransferencia(timeout = 10_000) {
	/*
	 * El muestreo vive en la página: cada round-trip de Playwright puede consumir cientos de ms
	 * bajo SwiftShader y dejar una transferencia de seis segundos reducida a una o dos fotos.
	 * El intervalo no bloquea el event loop, por lo que observa el mismo reloj real de la app.
	 */
	return page.evaluate((limiteMs) => new Promise((resolve) => {
		let muestras = 0;
		let solapes = 0;
		let principalAusente = 0;
		let motorAusente = 0;
		let postTransferenciaInvalidas = 0;
		let trianguloDesde;
		let estabilidadMs = 0;
		let activosFinales = [];
		const inicio = performance.now();
		let intervalo;
		const terminar = () => {
			if (intervalo !== undefined) clearInterval(intervalo);
			if (trianguloDesde !== undefined) estabilidadMs = performance.now() - trianguloDesde;
			resolve({ muestras, solapes, principalAusente, motorAusente,
				postTransferenciaInvalidas, estabilidadMs, activosFinales });
		};
		const tomar = () => {
			const ids = new Set(window.qa.simulacion().activos);
			activosFinales = [...ids];
			muestras++;
			if (ids.has('km2') && ids.has('km3')) solapes++;
			if ((ids.has('km2') || ids.has('km3')) && !ids.has('km1')) principalAusente++;
			if ((ids.has('km2') || ids.has('km3')) && !ids.has('m1')) motorAusente++;
			if (ids.has('km3') && trianguloDesde === undefined) trianguloDesde = performance.now();
			if (trianguloDesde !== undefined && (!ids.has('km3') || ids.has('km2') || !ids.has('m1'))) {
				postTransferenciaInvalidas++;
			}
			if ((trianguloDesde !== undefined && performance.now() - trianguloDesde >= 1_500)
				|| performance.now() - inicio >= limiteMs) terminar();
		};
		intervalo = setInterval(tomar, 25);
		tomar();
	}), timeout);
}

async function esperarFuncion(id, patron, timeout = 6_000) {
	await page.waitForFunction(([identidad, fuente, banderas]) => {
		const texto = window.qa.simulacion().funcionando.find((f) => f.dispositivoId === identidad)?.que ?? '';
		return new RegExp(fuente, banderas).test(texto);
	}, [id, patron.source, patron.flags], { timeout });
	return (await qa('simulacion')).funcionando.find((f) => f.dispositivoId === id)?.que ?? '';
}

async function sacarDelCatalogo(nombre) {
	await clickId('hta-anadir');
	await page.locator('#seccion-catalogo').waitFor({ state: 'visible' });
	const antes = (await qa('proyecto')).dispositivos.map((d) => d.id);
	const boton = page.locator('#catalogo button', { hasText: nombre }).first();
	if (!(await boton.count())) throw new Error(`el catálogo no ofrece «${nombre}»`);
	await boton.click();
	await page.waitForFunction((ids) => window.qa.proyecto().dispositivos.some((d) => !ids.includes(d.id)), antes);
	return (await qa('proyecto')).dispositivos.find((d) => !antes.includes(d.id));
}

/** Tiende un conductor mediante el formulario del cajón contextual. */
async function cablearPorPanel(deId, deBorne, aId, aBorne) {
	const antes = (await qa('proyecto')).conductores.length;
	await qa('seleccionarPorId', deId);
	await page.waitForFunction(() => !!document.getElementById('cable-borne-origen'));
	const problema = await page.evaluate(([origenId, destinoId, destinoBorne]) => {
		const origen = document.getElementById('cable-borne-origen');
		const destino = document.getElementById('cable-destino');
		const borneDestino = document.getElementById('cable-borne-destino');
		const conectar = document.getElementById('btn-conectar');
		if (!origen || !destino || !borneDestino || !conectar) return 'no está el formulario de cableado';
		if (![...origen.options].some((o) => o.value === origenId)) return `no existe el borne origen ${origenId}`;
		origen.value = origenId;
		if (![...destino.options].some((o) => o.value === destinoId)) return `no aparece el destino ${destinoId}`;
		destino.value = destinoId;
		destino.dispatchEvent(new Event('change', { bubbles: true }));
		if (![...borneDestino.options].some((o) => o.value === destinoBorne)) return `no existe el borne destino ${destinoBorne}`;
		borneDestino.value = destinoBorne;
		conectar.click();
		return '';
	}, [deBorne, aId, aBorne]);
	if (problema) return problema;
	await page.waitForFunction((cantidad) => window.qa.proyecto().conductores.length > cantidad, antes, { timeout: 10_000 });
	return '';
}

async function puntoVisibleDelAparato(id) {
	const p = await qa('proyecto');
	const colocacion = p.gabinete?.colocaciones.find((c) => c.dispositivoId === id);
	const d = p.dispositivos.find((x) => x.id === id);
	if (!colocacion || !d) return undefined;
	const ancho = colocacion.ancho ?? d.ancho ?? 18;
	const alto = colocacion.alto ?? d.alto ?? 45;
	return qa('puntoEnPantalla', colocacion.x + ancho / 2, colocacion.y + alto / 2, 60);
}

try {
	const entorno = await servidorDeQA();
	servidor = entorno.servidor;
	browser = await abrirNavegador(chromium);
	page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
	page.setDefaultTimeout(30_000);
	page.on('pageerror', (error) => erroresJS.push(`PAGEERROR: ${error.message}`));
	page.on('console', (mensaje) => {
		const recurso = mensaje.location().url ?? '';
		if (mensaje.type() === 'error' && !/\/favicon\.ico(?:$|\?)/i.test(recurso)) {
			erroresJS.push(`CONSOLE: ${mensaje.text()}${recurso ? ` @ ${recurso}` : ''}`);
		}
	});

	await page.goto(`${entorno.url}/?qa=1&inicio=0`, { waitUntil: 'load' });
	await page.waitForFunction(() => !!window.qa?.esperarPersistencia);
	await qa('esperarPersistencia');
	await cerrarSiVisible('#modal-ayuda', 'btn-cerrar-ayuda');

	console.log('\n=== 1. Arranque directo y mando momentáneo ===');
	await abrirEjemplo('Arranque directo de motor', 'Arranque directo de motor 380 V');
	await energizar(true);
	const proyectoDOL = await qa('proyecto');
	const conecta = (c, dispositivoId, borneId) => [c.de, c.a]
		.some((e) => e.dispositivoId === dispositivoId && e.borneId === borneId);
	const cablesDePolos = ['2/T1', '4/T2', '6/T3'].map((borne) =>
		proyectoDOL.conductores.find((c) => conecta(c, 'km1', borne))?.id).filter(Boolean);
	const cableAuxiliarNA = proyectoDOL.conductores.find((c) => conecta(c, 'km1', '14'))?.id;
	comprobar('el fixture DOL expone tres salidas de polo y el auxiliar NA',
		cablesDePolos.length === 3 && !!cableAuxiliarNA,
		`${cablesDePolos.join(', ')} · ${cableAuxiliarNA ?? 'sin 14'}`);
	const simEnReposo = await qa('simulacion');
	const vivosEnReposo = simEnReposo.conductoresVivos;
	const idsVivosEnReposo = new Set(simEnReposo.conductoresVivosIds);
	const kmReposo = await qa('piezas', 'km1');
	comprobar('energizar no arranca el motor por sí solo', !(await qa('simulacion')).activos.includes('m1'));
	comprobar('MARCHA admite presión momentánea', await qa('presionar', 's1') === true);
	await esperarActivo('m1', true);
	let simDOL = await qa('simulacion');
	const arranqueMotor = simDOL.funcionando.find((f) => f.dispositivoId === 'm1')?.que ?? '';
	comprobar('al mantener MARCHA el motor entra en ARRANCANDO o ya alcanzó MARCHA',
		/^(?:arrancando|girando)/i.test(arranqueMotor), arranqueMotor);
	comprobar('la maniobra energiza nuevos conductores de fuerza y mando',
		simDOL.conductoresVivos > vivosEnReposo, `${vivosEnReposo} → ${simDOL.conductoresVivos}`);
	const idsVivosEnMarcha = new Set(simDOL.conductoresVivosIds);
	const esperadosTrasKM1 = [...cablesDePolos, cableAuxiliarNA].filter(Boolean);
	comprobar('los tres polos principales y el auxiliar NA energizan sus conductores exactos',
		esperadosTrasKM1.every((id) => idsVivosEnMarcha.has(id) && !idsVivosEnReposo.has(id)),
		esperadosTrasKM1.map((id) => `${id}:${idsVivosEnMarcha.has(id) ? 'ON' : 'OFF'}`).join(', '));
	const kmMetido = await qa('piezas', 'km1');
	comprobar('el resultado del motor baja la armadura 3D del contactor',
		(kmMetido?.armadura?.[0]?.z ?? Infinity) < (kmReposo?.armadura?.[0]?.z ?? -Infinity),
		`z ${kmReposo?.armadura?.[0]?.z} → ${kmMetido?.armadura?.[0]?.z}`);
	const marchaMotor = await esperarFuncion('m1', /girando/i);
	comprobar('el transitorio estimado termina en MARCHA', /girando/i.test(marchaMotor), marchaMotor);
	const giroMotor1 = (await qa('piezas', 'm1'))?.eje?.[0]?.giro;
	await page.waitForTimeout(450);
	const giroMotor2 = (await qa('piezas', 'm1'))?.eje?.[0]?.giro;
	comprobar('el eje 3D gira cuando el motor está en MARCHA',
		giroMotor1 !== undefined && giroMotor2 !== undefined && giroMotor1 !== giroMotor2,
		`${giroMotor1} → ${giroMotor2}`);
	comprobar('el estado público conserva MARCHA pulsado', (await qa('estadoSim')).find((e) => e.id === 's1')?.activo === true);
	comprobar('MARCHA admite soltar', await qa('soltar', 's1') === true);
	comprobar('el pulsador vuelve a reposo', (await qa('estadoSim')).find((e) => e.id === 's1')?.activo === false);
	comprobar('el enclavamiento mantiene el motor tras soltar', (await qa('simulacion')).activos.includes('m1'));
	await qa('presionar', 's0'); await esperarActivo('m1', false); await qa('soltar', 's0');
	comprobar('PARO momentáneo tira el enclavamiento', !(await qa('simulacion')).activos.includes('m1'));
	const kmTrasParo = await qa('piezas', 'km1');
	comprobar('al parar, la armadura 3D vuelve a reposo',
		Math.abs((kmTrasParo?.armadura?.[0]?.z ?? 999) - (kmReposo?.armadura?.[0]?.z ?? 0)) < 0.2,
		`z ${kmTrasParo?.armadura?.[0]?.z}`);
	const giroQuieto1 = (await qa('piezas', 'm1'))?.eje?.[0]?.giro;
	await page.waitForTimeout(450);
	const giroQuieto2 = (await qa('piezas', 'm1'))?.eje?.[0]?.giro;
	comprobar('al parar, el eje 3D deja de girar', giroQuieto1 !== undefined && giroQuieto1 === giroQuieto2,
		`${giroQuieto1} → ${giroQuieto2}`);
	// El segundo arranque usa el gesto primario real sobre el botón visible. El panel reemplaza el
	// nodo durante pointerdown, por eso el pointerup global debe soltarlo sin perder el enclavamiento.
	const marchaVisible = page.locator('#sim-mandos button[data-mando="s1"]');
	await marchaVisible.scrollIntoViewIfNeeded();
	const cajaMarcha = await marchaVisible.boundingBox();
	if (!cajaMarcha) throw new Error('el botón visible de MARCHA no tiene caja clicable');
	await page.mouse.click(cajaMarcha.x + cajaMarcha.width / 2, cajaMarcha.y + cajaMarcha.height / 2);
	await esperarActivo('m1', true);
	await page.waitForFunction(() => window.qa.estadoSim().find((e) => e.id === 's1')?.activo === false);
	comprobar('START vuelve a arrancar después de STOP', (await qa('simulacion')).activos.includes('m1'));
	comprobar('el click primario completo no deja pegado el pulsador',
		(await qa('estadoSim')).find((e) => e.id === 's1')?.activo === false);
	comprobar('el térmico admite disparo seguro', await qa('accionar', 'f2') === true);
	await esperarActivo('m1', false);
	let estadoF2 = (await qa('estadoSim')).find((e) => e.id === 'f2');
	comprobar('el disparo térmico abre potencia y mando', estadoF2?.disparado === true
		&& !(await qa('simulacion')).activos.includes('km1'));
	comprobar('el térmico admite rearme', await qa('accionar', 'f2') === true);
	estadoF2 = (await qa('estadoSim')).find((e) => e.id === 'f2');
	comprobar('rearmar no provoca rearranque espontáneo', estadoF2?.disparado !== true
		&& !(await qa('simulacion')).activos.includes('m1'));
	await qa('presionar', 's1'); await esperarActivo('m1', true); await qa('soltar', 's1');
	comprobar('tras rearmar, un nuevo START sí vuelve a arrancar', (await qa('simulacion')).activos.includes('m1'));
	await qa('presionar', 's0'); await esperarActivo('m1', false); await qa('soltar', 's0');
	comprobar('el ejemplo queda detenido antes de continuar', !(await qa('simulacion')).activos.includes('m1'));
	comprobar('arranque directo se estabiliza sin oscilación', !(await qa('simulacion')).oscila);

	// La protección montada permite probar el camino REAL del canvas sin tocar el Proyecto por hook.
	// Derecho no opera; un arrastre izquierdo orbita; solo un click izquierdo corto acciona.
	let puntoQ1 = await puntoVisibleDelAparato('q1');
	comprobar('la protección tiene un punto visible para probar el gesto real', !!puntoQ1,
		puntoQ1 ? `${Math.round(puntoQ1.x)},${Math.round(puntoQ1.y)}` : 'sin proyección');
	if (puntoQ1) {
		await page.mouse.click(puntoQ1.x, puntoQ1.y, { button: 'right' });
		comprobar('el botón derecho no acciona la protección',
			!(await qa('estadoSim')).some((e) => e.id === 'q1'));
		const posicionAntes = (await qa('proyecto')).gabinete.colocaciones
			.find((c) => c.dispositivoId === 'q1');
		await page.mouse.move(puntoQ1.x, puntoQ1.y);
		await page.mouse.down({ button: 'left' });
		await page.mouse.move(puntoQ1.x + 45, puntoQ1.y + 18, { steps: 4 });
		await page.mouse.up({ button: 'left' });
		const posicionDespues = (await qa('proyecto')).gabinete.colocaciones
			.find((c) => c.dispositivoId === 'q1');
		comprobar('arrastrar con el tablero energizado no acciona ni mueve el aparato',
			!(await qa('estadoSim')).some((e) => e.id === 'q1')
			&& JSON.stringify(posicionDespues) === JSON.stringify(posicionAntes));
		await clickId('btn-centrar');
		puntoQ1 = await puntoVisibleDelAparato('q1');
		if (!puntoQ1) throw new Error('Q1 dejó de tener proyección después de centrar la cámara');
		await page.mouse.click(puntoQ1.x, puntoQ1.y, { button: 'left' });
		await page.waitForFunction(() => window.qa.estadoSim().some((e) => e.id === 'q1'
			&& (e.disparado === true || e.cerrado === false)));
		comprobar('un click izquierdo corto sí acciona la protección',
			(await qa('estadoSim')).some((e) => e.id === 'q1'
				&& (e.disparado === true || e.cerrado === false)));
		await page.mouse.click(puntoQ1.x, puntoQ1.y, { button: 'left' });
		await page.waitForFunction(() => window.qa.estadoSim().some((e) => e.id === 'q1'
			&& (e.disparado === false || e.cerrado === true)));
		comprobar('el segundo click real rearma sin dejar un gesto anterior pegado',
			(await qa('estadoSim')).some((e) => e.id === 'q1'
				&& (e.disparado === false || e.cerrado === true)));
	}

	console.log('\n=== 2. Estrella–triángulo y reloj real ===');
	await abrirEjemplo('Arranque estrella-triángulo', 'Arranque estrella-triángulo (ventilador de cubierta)');
	await energizar(true);
	await velocidad(1);
	await qa('presionar', 's1'); await esperarActivo('km2', true);
	const inicioEstrella = await fotoConPanel();
	await qa('soltar', 's1');
	let activos = inicioEstrella.simulacion.activos;
	comprobar('al arrancar entra estrella KM2', activos.includes('km2'), activos.join(', '));
	comprobar('triángulo KM3 aún está bloqueado', !activos.includes('km3'), activos.join(', '));
	comprobar('el motor recibe tres fases durante la etapa estrella', activos.includes('m1'), activos.join(', '));
	comprobar('la cuenta atrás del temporizador es visible', inicioEstrella.cuenta.length > 0,
		inicioEstrella.panel.slice(0, 180));
	/* Una foto contiene ambos contactores: dos consultas separadas fabricarían falsos solapes. */
	const primeraTransferencia = await muestrearTransferencia();
	activos = primeraTransferencia.activosFinales;
	comprobar('cumplido el tiempo entra triángulo KM3', activos.includes('km3'), activos.join(', '));
	comprobar('estrella KM2 cae antes de triángulo', !activos.includes('km2'), activos.join(', '));
	comprobar('el motor continúa alimentado después de la transferencia', activos.includes('m1'), activos.join(', '));
	comprobar('estrella y triángulo nunca coinciden durante la conmutación', primeraTransferencia.solapes === 0,
		`${primeraTransferencia.solapes}/${primeraTransferencia.muestras} muestras`);
	comprobar('el contactor principal permanece durante la transferencia', primeraTransferencia.principalAusente === 0,
		`${primeraTransferencia.principalAusente}/${primeraTransferencia.muestras} muestras sin KM1`);
	comprobar('el motor no pierde alimentación durante la transferencia lógica', primeraTransferencia.motorAusente === 0,
		`${primeraTransferencia.motorAusente}/${primeraTransferencia.muestras} muestras sin motor`);
	comprobar('la transferencia incluye entrada y estado estabilizado, no una única foto',
		primeraTransferencia.muestras >= 2 && primeraTransferencia.estabilidadMs >= 1_400,
		`${primeraTransferencia.muestras} muestras · ${Math.round(primeraTransferencia.estabilidadMs)} ms estable`);
	comprobar('triángulo permanece estable después de entrar', primeraTransferencia.postTransferenciaInvalidas === 0,
		`${primeraTransferencia.postTransferenciaInvalidas} muestras inestables`);
	comprobar('la secuencia no oscila', !(await qa('simulacion')).oscila);
	await qa('presionar', 's0'); await esperarActivo('m1', false); await qa('soltar', 's0');
	activos = (await qa('simulacion')).activos;
	comprobar('STOP cae línea, estrella y triángulo',
		['km1', 'km2', 'km3', 'm1'].every((id) => !activos.includes(id)), activos.join(', '));
	// La aceleración usada para muestrear la transferencia terminaría los 6 s antes de que el DOM
	// pueda exhibirlos. Se vuelve deliberadamente a tiempo real para verificar el reinicio visible.
	await velocidad(1);
	await qa('presionar', 's1'); await esperarActivo('km2', true);
	const reinicioEstrella = await fotoConPanel();
	await qa('soltar', 's1');
	activos = reinicioEstrella.simulacion.activos;
	const cuentaReiniciada = reinicioEstrella.cuenta.replace(',', '.');
	const segundosRestantes = Number(cuentaReiniciada.match(/([\d.]+)\s*s\s+de/i)?.[1]);
	comprobar('un nuevo START reinicia la secuencia en estrella',
		activos.includes('km2') && !activos.includes('km3'), activos.join(', '));
	comprobar('el temporizador vuelve a estar contando desde el nuevo START',
		Number.isFinite(segundosRestantes) && segundosRestantes > 0, cuentaReiniciada);
	comprobar('el térmico estrella-triángulo admite disparo', await qa('accionar', 'f2') === true);
	await esperarActivo('m1', false);
	activos = (await qa('simulacion')).activos;
	comprobar('el fallo térmico cae todos los contactores',
		['km1', 'km2', 'km3', 'm1'].every((id) => !activos.includes(id)), activos.join(', '));
	await qa('accionar', 'f2');
	comprobar('rearmar el térmico no rearma la maniobra', !(await qa('simulacion')).activos.includes('m1'));
	await qa('presionar', 's1'); await esperarActivo('km2', true); await qa('soltar', 's1');
	activos = (await qa('simulacion')).activos;
	comprobar('tras rearmar, START reinicia otra vez en estrella',
		activos.includes('km2') && !activos.includes('km3') && activos.includes('m1'), activos.join(', '));
	const segundaTransferencia = await muestrearTransferencia();
	activos = segundaTransferencia.activosFinales;
	comprobar('el segundo ciclo también se muestrea completo sin solape ni pérdida de motor',
		activos.includes('km3') && !activos.includes('km2') && activos.includes('m1')
			&& segundaTransferencia.muestras >= 2 && segundaTransferencia.estabilidadMs >= 1_400
			&& segundaTransferencia.solapes === 0 && segundaTransferencia.motorAusente === 0
			&& segundaTransferencia.principalAusente === 0
			&& segundaTransferencia.postTransferenciaInvalidas === 0 && !(await qa('simulacion')).oscila,
		`${activos.join(', ')} · ${segundaTransferencia.muestras} muestras`);
	await qa('presionar', 's0'); await esperarActivo('m1', false); await qa('soltar', 's0');

	console.log('\n=== 3. Selector mantenido, PLC y entrada analógica ===');
	await abrirEjemplo('Climatizador de cubierta', 'Climatizador de cubierta (UMA) con controlador');
	await energizar(true);
	await velocidad(1);
	comprobar('el controlador tiene diagnóstico visible', await page.locator('#sim-controladores .ctrl-sim[data-id="a1"]').count() === 1);
	comprobar('el selector mantenido acepta cambio', await qa('accionar', 's0') === true);
	const posicion = (await qa('estadoSim')).find((e) => e.id === 's0')?.posicion;
	await page.waitForTimeout(350);
	comprobar('el selector conserva su posición sin mantener el botón', posicion === 1
		&& (await qa('estadoSim')).find((e) => e.id === 's0')?.posicion === 1, `posición ${posicion}`);
	await page.waitForFunction(() => window.qa.simulacion().activos.includes('a1::DO2'));
	const plcTrasMarcha = await qa('simulacion');
	comprobar('el programa del PLC activa DO2 desde DI1', plcTrasMarcha.activos.includes('a1::DO2'), plcTrasMarcha.activos.join(', '));
	comprobar('DO2 mueve la compuerta Y1 por el cableado real', plcTrasMarcha.activos.includes('y1'), plcTrasMarcha.activos.join(', '));
	comprobar('la salida DO2 está visible en el diagnóstico del controlador',
		await page.locator('#sim-controladores .ctrl-sim[data-id="a1"] .pin.on', { hasText: 'DO2' }).count() === 1);
	const sonda = page.locator('#sim-sondas input[data-sonda="b1"]');
	comprobar('la sonda analógica se presenta como control range', await sonda.count() === 1);
	await sonda.evaluate((input) => { input.value = '10'; input.dispatchEvent(new Event('input', { bubbles: true })); });
	await page.waitForFunction(() => document.querySelector('#sim-controladores .ctrl-sim[data-id="a1"]')?.textContent.includes('UI1=10'));
	comprobar('el PLC lee 10 °C desde la UI', (await page.locator('#sim-controladores .ctrl-sim[data-id="a1"]').innerText()).includes('UI1=10'));
	await sonda.evaluate((input) => { input.value = '30'; input.dispatchEvent(new Event('input', { bubbles: true })); });
	await page.waitForFunction(() => document.querySelector('#sim-controladores .ctrl-sim[data-id="a1"]')?.textContent.includes('UI1=30'));
	comprobar('el PLC actualiza la entrada analógica end-to-end', (await page.locator('#sim-controladores .ctrl-sim[data-id="a1"]').innerText()).includes('UI1=30'));
	comprobar('la protección queda disparada antes del ciclo de alimentación', await qa('accionar', 'f2') === true
		&& (await qa('estadoSim')).find((e) => e.id === 'f2')?.disparado === true);
	await energizar(false);
	comprobar('OFF borra todo el estado runtime', (await qa('estadoSim')).length === 0,
		JSON.stringify(await qa('estadoSim')));
	await energizar(true);
	const estadoTrasCiclo = await qa('estadoSim');
	comprobar('ON conserva selector, protección y sensor en reposo',
		!estadoTrasCiclo.some((e) => ['s0', 'f2', 'b1'].includes(e.id)), JSON.stringify(estadoTrasCiclo));
	const sondaTrasCiclo = page.locator('#sim-sondas input[data-sonda="b1"]');
	await sondaTrasCiclo.waitFor({ state: 'attached' });
	const valorReposo = await sondaTrasCiclo.evaluate((input) => Number(input.value));
	comprobar('la sonda vuelve a su valor inicial tras OFF→ON', valorReposo === 20, `valor ${valorReposo}`);
	comprobar('el selector limpio no arranca la UMA', !(await qa('simulacion')).activos.includes('m1'));
	comprobar('PLC y analógicas se estabilizan sin oscilación', !(await qa('simulacion')).oscila);

	console.log('\n=== 4. Variador desde catálogo, cableado por la UI ===');
	await crearTableroNuevo();
	await clickId('modo-editor');
	const red = await sacarDelCatalogo('Acometida 220 V');
	const fuente = await sacarDelCatalogo('Fuente 24 V 2.5 A');
	const variador = await sacarDelCatalogo('Variador 0.75 kW');
	const motor = await sacarDelCatalogo('Motor 3F 380 V');
	const controlador = await sacarDelCatalogo('Honeywell Spyder PUB6438S');
	const sensor = await sacarDelCatalogo('Sonda de temperatura (conducto)');
	comprobar('red, fuente, variador, motor, controlador y sonda entran desde el catálogo',
		!!red && !!fuente && !!variador && !!motor && !!controlador && !!sensor,
		[red?.id, fuente?.id, variador?.id, motor?.id, controlador?.id, sensor?.id].join(', '));

	/*
	 * La referencia del VFD tiene que proceder de una AO de verdad. Aplicar 24 V de la fuente a
	 * AI1 haría arrancar el variador, pero no probaría la cadena analógica: el motor distingue
	 * deliberadamente una señal 0–10 V de un conductor meramente vivo. El programa se escribe en
	 * el inspector, igual que lo haría una persona, y se guarda al abandonar el cuadro.
	 */
	await qa('seleccionarPorId', controlador.id);
	const programa = 'AO1 = 0 a 10 según UI1 de -40 a 80';
	const cajaPrograma = page.locator('#dev-programa');
	await cajaPrograma.waitFor({ state: 'visible' });
	await cajaPrograma.fill(programa);
	await cajaPrograma.blur();
	await page.waitForFunction(([id, texto]) =>
		window.qa.proyecto().dispositivos.find((d) => d.id === id)?.programa === texto,
		[controlador.id, programa]);
	comprobar('el programa AO se configura por el inspector',
		(await qa('proyecto')).dispositivos.find((d) => d.id === controlador.id)?.programa === programa);

	await clickId('modo-trabajo'); await clickId('btn-centrar');
	await energizar(true);
	await page.waitForFunction(() => /SIN ALIMENTACIÓN/i.test(
		document.querySelector('#sim-funcionando .variador')?.textContent ?? ''));
	let textoVfd = (await page.locator('#sim-funcionando .variador').innerText()).replace(/\s+/g, ' ');
	comprobar('sin potencia cableada, el variador declara SIN ALIMENTACIÓN',
		/SIN ALIMENTACIÓN/i.test(textoVfd) && !(await qa('simulacion')).activos.includes(motor.id), textoVfd);
	await energizar(false);
	const conexiones = [
		[red.id, 'L', fuente.id, 'L'], [red.id, 'N', fuente.id, 'N'],
		[red.id, 'L', variador.id, 'L1'], [red.id, 'N', variador.id, 'N'],
		[fuente.id, '+V', controlador.id, '24V~'], [fuente.id, '-V', controlador.id, '24V COM'],
		[controlador.id, 'AO1', variador.id, 'AI1'], [controlador.id, 'AOC', variador.id, '0V'],
		[sensor.id, '1', controlador.id, 'UI1'], [sensor.id, '2', controlador.id, 'UIC1'],
		[variador.id, 'U', motor.id, 'U'], [variador.id, 'V', motor.id, 'V'], [variador.id, 'W', motor.id, 'W'],
	];
	for (const [de, borneDe, a, borneA] of conexiones) {
		const problema = await cablearPorPanel(de, borneDe, a, borneA);
		comprobar(`cable ${borneDe} → ${borneA}`, !problema, problema);
	}
	await energizar(true);
	await velocidad(1);
	const mandoSonda = page.locator(`#sim-sondas input[data-sonda="${sensor.id}"]`);
	await mandoSonda.waitFor({ state: 'attached' });
	await mandoSonda.evaluate((input) => {
		input.value = input.max;
		input.dispatchEvent(new Event('input', { bubbles: true }));
	});
	await page.waitForFunction((id) => {
		const fila = document.querySelector(`#sim-controladores .ctrl-sim[data-id="${id}"]`);
		return fila?.textContent.includes('UI1=80');
	}, controlador.id);
	comprobar('el controlador recibe el extremo de escala por UI1',
		(await page.locator(`#sim-controladores .ctrl-sim[data-id="${controlador.id}"]`).innerText()).includes('UI1=80'));
	await page.waitForFunction(() => /READY/.test(document.querySelector('#sim-funcionando .variador')?.textContent ?? ''));
	textoVfd = (await page.locator('#sim-funcionando .variador').innerText()).replace(/\s+/g, ' ');
	comprobar('alimentado pero sin orden, el variador queda READY', /READY/.test(textoVfd) && /0\.0 Hz/.test(textoVfd), textoVfd);
	comprobar('READY no entrega potencia al motor', !(await qa('simulacion')).activos.includes(motor.id));
	const conductoresEnReady = (await qa('simulacion')).conductoresVivos;
	comprobar('el VFD no expone un falso gesto genérico para fabricar FAULT', await qa('accionar', variador.id) === false);

	/* RUN entra por DI1 desde 24 V, mediante el mismo formulario que usa una persona. */
	await energizar(false);
	const problemaRun = await cablearPorPanel(fuente.id, '+V', variador.id, 'DI1');
	comprobar('la orden RUN se cablea físicamente a DI1', !problemaRun, problemaRun);
	await iniciarMuestreoHz();
	await energizar(true);
	const mandoSondaRun = page.locator(`#sim-sondas input[data-sonda="${sensor.id}"]`);
	await mandoSondaRun.waitFor({ state: 'attached' });
	await mandoSondaRun.evaluate((input) => {
		input.value = input.max;
		input.dispatchEvent(new Event('input', { bubbles: true }));
	});
	await page.waitForFunction(() => /50\.0 Hz/.test(document.querySelector('#sim-funcionando .variador')?.textContent ?? ''),
		undefined, { timeout: 12_000 });
	const muestrasHz = await terminarMuestreoHz();
	comprobar('la frecuencia atraviesa valores intermedios: la rampa no es un salto',
		muestrasHz.some((hz) => hz > 0 && hz < 50), muestrasHz.slice(0, 12).join(', ') + ' Hz');
	comprobar('la rampa es monótona hacia la referencia',
		muestrasHz.every((hz, i) => i === 0 || hz + 0.11 >= muestrasHz[i - 1]), muestrasHz.join(', ') + ' Hz');
	textoVfd = (await page.locator('#sim-funcionando .variador').innerText()).replace(/\s+/g, ' ');
	comprobar('el variador alcanza estado RUN', /RUN/.test(textoVfd), textoVfd);
	comprobar('el variador muestra frecuencia y referencia', /50\.0 Hz/.test(textoVfd) && /100 %/.test(textoVfd), textoVfd);
	comprobar('el variador queda activo en el resultado público', (await qa('simulacion')).activos.includes(variador.id));
	await esperarActivo(motor.id, true, 5_000);
	comprobar('U/V/W del variador alimentan funcionalmente el motor', (await qa('simulacion')).activos.includes(motor.id));
	comprobar('RUN energiza más conductores que READY', (await qa('simulacion')).conductoresVivos > conductoresEnReady,
		`${conductoresEnReady} → ${(await qa('simulacion')).conductoresVivos}`);
	const marchaMotorVfd = await esperarFuncion(motor.id, /girando/i, 6_000);
	comprobar('el motor alimentado por el VFD termina su arranque', /girando/i.test(marchaMotorVfd), marchaMotorVfd);
	const giroVfd1 = (await qa('piezas', motor.id))?.eje?.[0]?.giro;
	await page.waitForTimeout(450);
	const giroVfd2 = (await qa('piezas', motor.id))?.eje?.[0]?.giro;
	comprobar('el estado RUN del VFD se refleja en el giro 3D del motor',
		giroVfd1 !== undefined && giroVfd2 !== undefined && giroVfd1 !== giroVfd2,
		`${giroVfd1} → ${giroVfd2}`);
	comprobar('variador y motor se estabilizan sin oscilación', !(await qa('simulacion')).oscila);

	await energizar(false);
	await energizar(true);
	const frecuenciaTrasReenergizar = Number(((await page.locator('#sim-funcionando .variador').innerText())
		.match(/([\d.]+)\s*Hz/i) ?? [])[1]);
	comprobar('OFF→ON limpia la memoria de rampa del VFD', Number.isFinite(frecuenciaTrasReenergizar) && frecuenciaTrasReenergizar < 5,
		`${frecuenciaTrasReenergizar} Hz`);
	comprobar('OFF→ON no conserva el valor manual de la sonda', (await qa('estadoSim')).length === 0,
		JSON.stringify(await qa('estadoSim')));
	await energizar(false);

	console.log('\n=== 5. Fixture V2: sobrecarga, térmico y rearme por la UI ===');
	await abrirEjemplo('Fixture V2: motor, térmico y fallos', 'Fixture V2 — fallos de motor y relé térmico');
	await energizar(true);
	await velocidad(20);
	const startV2 = page.locator('#sim-mandos button[data-mando="s1"]');
	await startV2.click();
	await esperarActivo('m1', true, 8_000);
	comprobar('el START visible arranca el fixture V2', (await qa('simulacion')).activos.includes('km1'));
	const falloMotor = page.locator('#sim-fallos select[data-fallo="m1"]');
	comprobar('el motor ofrece Sobrecarga como fallo compatible visible',
		await falloMotor.locator('option[value="sobrecarga"]').count() === 1);
	await elegirSelectVisible('#sim-fallos select[data-fallo="m1"]', 'sobrecarga');
	await page.waitForFunction(() => window.qa.estadoSim().some((e) => e.id === 'f2' && e.disparado === true),
		undefined, { timeout: 15_000 });
	comprobar('la sobrecarga visible termina en F2 DISPARADO',
		await page.locator('#sim-funcionando .proteccion.disparado[data-id="f2"]').count() === 1);
	const simTrasTermico = await qa('simulacion');
	comprobar('95-96 hace caer KM1 y el motor por el circuito',
		!simTrasTermico.activos.includes('km1') && !simTrasTermico.activos.includes('m1'),
		simTrasTermico.activos.join(', '));
	comprobar('97-98 enciende el piloto de FALLO cableado', simTrasTermico.activos.includes('h-fallo'));
	await elegirSelectVisible('#sim-fallos select[data-fallo="m1"]', '');
	const rearmarF2 = page.locator('#sim-mandos button[data-mando="f2"]');
	await rearmarF2.click();
	await page.waitForFunction(() => !window.qa.estadoSim().some((e) => e.id === 'f2' && e.disparado === true));
	comprobar('REARMAR visible apaga FALLO pero no rearranca',
		!(await qa('simulacion')).activos.includes('h-fallo') && !(await qa('simulacion')).activos.includes('m1'));
	await page.locator('#sim-mandos button[data-mando="s1"]').click();
	await esperarActivo('m1', true, 8_000);
	comprobar('un nuevo START visible vuelve a arrancar', (await qa('simulacion')).activos.includes('m1'));
	await energizar(false);

	console.log('\n=== 6. Fixture V2: referencia, velocidad, FAULT y RESET por la UI ===');
	await abrirEjemplo('Fixture V2: VFD, velocidad y FAULT', 'Fixture V2 — VFD, velocidad y FAULT');
	await energizar(true);
	await velocidad(20);
	comprobar('el fixture VFD empieza en READY',
		/READY/.test(await page.locator('#sim-funcionando .variador[data-id="vfd"]').innerText()));
	const referencia100 = page.locator('#sim-referencias-vfd input[data-ref-vfd="vfd"]');
	await referencia100.evaluate((input) => {
		input.value = '100'; input.dispatchEvent(new Event('input', { bubbles: true }));
	});
	await page.locator('#sim-mandos button[data-mando="s-run"]').click();
	await page.waitForFunction(() => /50\.0 Hz/.test(
		document.querySelector('#sim-funcionando .variador[data-id="vfd"]')?.textContent ?? ''),
		undefined, { timeout: 12_000 });
	const giro50a = (await qa('piezas', 'm1'))?.eje?.[0]?.giro;
	await page.waitForTimeout(500);
	const giro50b = (await qa('piezas', 'm1'))?.eje?.[0]?.giro;
	const referencia50 = page.locator('#sim-referencias-vfd input[data-ref-vfd="vfd"]');
	await referencia50.evaluate((input) => {
		input.value = '50'; input.dispatchEvent(new Event('input', { bubbles: true }));
	});
	await page.waitForFunction(() => /25\.0 Hz/.test(
		document.querySelector('#sim-funcionando .variador[data-id="vfd"]')?.textContent ?? ''),
		undefined, { timeout: 12_000 });
	const giro25a = (await qa('piezas', 'm1'))?.eje?.[0]?.giro;
	await page.waitForTimeout(500);
	const giro25b = (await qa('piezas', 'm1'))?.eje?.[0]?.giro;
	const avance50 = Math.abs((giro50b ?? 0) - (giro50a ?? 0));
	const avance25 = Math.abs((giro25b ?? 0) - (giro25a ?? 0));
	comprobar('el control visible produce 50 Hz y después 25 Hz',
		/25\.0 Hz/.test(await page.locator('#sim-funcionando .variador[data-id="vfd"]').innerText()));
	comprobar('la velocidad visual a 50 Hz supera claramente la de 25 Hz',
		avance50 > avance25 * 1.5, `${avance50.toFixed(3)} → ${avance25.toFixed(3)} rad/0,5 s`);
	await elegirSelectVisible('#sim-fallos select[data-fallo="vfd"]', 'fallo-externo');
	await page.locator('#sim-funcionando .variador.falla[data-id="vfd"]').waitFor();
	const simVfdFault = await qa('simulacion');
	comprobar('FAULT visible corta la salida normal y enciende AL1-AL2',
		!simVfdFault.activos.includes('m1') && simVfdFault.activos.includes('h-fallo'),
		simVfdFault.activos.join(', '));
	comprobar('RESET está bloqueado mientras existe la causa',
		await page.locator('button[data-reset-vfd="vfd"]:disabled').count() === 1);
	await elegirSelectVisible('#sim-fallos select[data-fallo="vfd"]', '');
	const resetVfd = page.locator('button[data-reset-vfd="vfd"]:not(:disabled)');
	await resetVfd.waitFor();
	await resetVfd.click();
	await page.waitForFunction(() => /READY/.test(
		document.querySelector('#sim-funcionando .variador[data-id="vfd"]')?.textContent ?? ''));
	comprobar('RESET lleva a READY, no a RUN, con la orden todavía alta',
		/READY/.test(await page.locator('#sim-funcionando .variador[data-id="vfd"]').innerText()));
	await page.locator('#sim-mandos button[data-mando="s-run"]').click();
	await page.locator('#sim-mandos button[data-mando="s-run"]').click();
	await page.waitForFunction(() => /RUN/.test(
		document.querySelector('#sim-funcionando .variador[data-id="vfd"]')?.textContent ?? ''),
		undefined, { timeout: 8_000 });
	comprobar('soltar y dar una nueva orden RUN restaura la marcha',
		/RUN/.test(await page.locator('#sim-funcionando .variador[data-id="vfd"]').innerText()));
	await energizar(false);

	console.log('\n=== 7. Fixture V3: 4–20 mA, AI/AO, válvula y fail-safe visibles ===');
	await abrirEjemplo('Fixture V3: temperatura, PLC y válvula',
		'Fixture V3 — temperatura, PLC y válvula modulante');
	await energizar(true);
	await velocidad(20);
	await ponerSondaVisible('tt1', 50);
	await page.waitForFunction(() => {
		const panel = document.querySelector('#sim-controladores')?.textContent ?? '';
		return /AI1:\s*12\.00 mA\s*→\s*50\.0 °C/.test(panel);
	});
	const panelAi = (await page.locator('#sim-controladores').innerText()).replace(/\s+/g, ' ');
	const salidaAo = (await page.locator('#sim-funcionando .analogica', { hasText: '-A1:AO1' }).innerText())
		.replace(/\s+/g, ' ');
	comprobar('el control humano de BT1 muestra simultáneamente 12 mA y AI1=50 °C',
		/AI1:\s*12\.00 mA\s*→\s*50\.0 °C/.test(panelAi), panelAi);
	comprobar('la ley visible entrega AO1=6 V / 60 %', /6\.00 V\s*·\s*60 %/.test(salidaAo), salidaAo);
	await page.waitForFunction(() => /comando 60 %/.test(
		document.querySelector('#sim-funcionando .posicion-carga')?.textContent ?? ''));
	const textoValvula = (await page.locator('#sim-funcionando .posicion-carga').innerText()).replace(/\s+/g, ' ');
	comprobar('la válvula recibe 60 % y su posición se publica desde el runtime',
		/comando 60 %/.test(textoValvula) && /posición \d+ %/.test(textoValvula), textoValvula);
	const falloTx = page.locator('#sim-fallos select[data-fallo="tt1"]');
	comprobar('el transmisor ofrece Circuito analógico abierto en la UI',
		await falloTx.locator('option[value="circuito-analogico-abierto"]').count() === 1);
	await elegirSelectVisible('#sim-fallos select[data-fallo="tt1"]', 'circuito-analogico-abierto');
	await page.waitForFunction(() => {
		const panel = document.querySelector('#sim-controladores')?.textContent ?? '';
		const valvula = document.querySelector('#sim-funcionando .posicion-carga')?.textContent ?? '';
		return /AI1:.*sin valor.*CIRCUITO ABIERTO/i.test(panel) && /comando 0 %/i.test(valvula);
	});
	const panelAbierto = (await page.locator('#sim-controladores').innerText()).replace(/\s+/g, ' ');
	const valvulaSegura = (await page.locator('#sim-funcionando .posicion-carga').innerText()).replace(/\s+/g, ' ');
	comprobar('abrir el lazo deja AI1 sin valor y calidad CIRCUITO ABIERTO',
		/AI1:.*sin valor.*CIRCUITO ABIERTO/i.test(panelAbierto), panelAbierto);
	comprobar('la pérdida de señal ordena el cierre seguro, sin conservar 60 %',
		/comando 0 %/i.test(valvulaSegura), valvulaSegura);
	await energizar(false);

	console.log('\n=== 8. Fixture V3: referencia 4–20 mA cableada hacia VFD ===');
	await abrirEjemplo('Fixture V3: referencia 4–20 mA hacia VFD',
		'Fixture V3 — referencia 4–20 mA hacia VFD');
	await energizar(true);
	await velocidad(20);
	await ponerSondaVisible('ref1', 50);
	await page.locator('#sim-mandos button[data-mando="s-run"]').click();
	await page.waitForFunction(() => {
		const texto = document.querySelector('#sim-funcionando .variador[data-id="vfd"]')?.textContent ?? '';
		return /25\.0 Hz/.test(texto) && /12\.00 mA/.test(texto);
	}, undefined, { timeout: 12_000 });
	const vfdAnalogico = (await page.locator('#sim-funcionando .variador[data-id="vfd"]').innerText())
		.replace(/\s+/g, ' ');
	comprobar('12 mA cableados producen 25 Hz y una referencia NORMAL visible',
		/25\.0 Hz/.test(vfdAnalogico) && /12\.00 mA/.test(vfdAnalogico) && /NORMAL/.test(vfdAnalogico),
		vfdAnalogico);
	await elegirSelectVisible('#sim-fallos select[data-fallo="ref1"]', 'circuito-analogico-abierto');
	await page.locator('#sim-funcionando .variador.falla[data-id="vfd"]').waitFor();
	const vfdSinReferencia = (await page.locator('#sim-funcionando .variador[data-id="vfd"]').innerText())
		.replace(/\s+/g, ' ');
	comprobar('la pérdida visible de referencia lleva el VFD a FAULT',
		/FAULT/.test(vfdSinReferencia) && /CIRCUITO ABIERTO/.test(vfdSinReferencia), vfdSinReferencia);
	await energizar(false);

	console.log('\n=== 9. Integridad de la sesión ===');
	comprobar('no hubo errores JavaScript', erroresJS.length === 0, erroresJS.slice(0, 3).join(' | '));
} catch (error) {
	fallos++;
	console.error(`ERROR NO CONTROLADO: ${error?.stack ?? error}`);
} finally {
	for (const [nombre, cerrar] of [
		['página Chromium', async () => page?.close()],
		['navegador Chromium', async () => browser?.close()],
	]) {
		try { await cerrar(); } catch (error) {
			fallos++;
			console.error(`No se pudo cerrar ${nombre}: ${error?.message ?? error}`);
		}
	}
	if (servidor) {
		try {
			servidor.closeAllConnections?.();
			await new Promise((resolve, reject) => servidor.close((error) => error ? reject(error) : resolve()));
		} catch (error) {
			fallos++;
			console.error(`No se pudo cerrar el servidor QA: ${error?.message ?? error}`);
		}
	}
	// En Windows Chromium puede ignorar CHROME_LOG_FILE y crear el archivo igualmente. Solo se
	// elimina si no existía antes de esta suite: nunca se toca un log previo del usuario.
	if (!debugLogExistia && existsSync(debugLog)) {
		try { unlinkSync(debugLog); }
		catch (error) { fallos++; console.error(`No se pudo limpiar ${debugLog}: ${error.message}`); }
	}
	if (chromeLogAnterior === undefined) delete process.env.CHROME_LOG_FILE;
	else process.env.CHROME_LOG_FILE = chromeLogAnterior;
}

const duracion = ((Date.now() - inicio) / 1000).toFixed(1);
console.log(`\n=== ${fallos === 0 ? 'TODO OK ✔' : `${fallos} FALLO(S) ✗`} · ${comprobaciones} comprobaciones · ${duracion} s ===`);
process.exitCode = fallos === 0 ? 0 : 1;
