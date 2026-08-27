/**
 * Vertical slice de navegador para PLC V4.
 *
 * Las acciones pasan por controles visibles. `window.qa.simulacion()` se usa solo como
 * observabilidad del resultado publicado por el motor, nunca para mutar Proyecto o runtime.
 */
import { chromium } from 'playwright-core';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const inicio = Date.now();
let servidor;
let browser;
let page;
let fallos = 0;
let comprobaciones = 0;
const erroresJS = [];
const debugLog = join(process.cwd(), 'debug.log');
const debugLogExistia = existsSync(debugLog);
const chromeLogAnterior = process.env.CHROME_LOG_FILE;
process.env.CHROME_LOG_FILE = process.platform === 'win32' ? 'NUL' : '/dev/null';

function comprobar(nombre, condicion, detalle = '') {
	comprobaciones++;
	if (!condicion) fallos++;
	console.log(`${condicion ? 'OK  ' : 'FAIL'}  ${nombre}${detalle ? ` → ${detalle}` : ''}`);
}

const observar = () => page.evaluate(() => window.qa.simulacion());

async function clickId(id) {
	const boton = page.locator(`#${id}`);
	await boton.waitFor({ state: 'visible' });
	await boton.click();
}

/**
 * El monitor se reconstruye en cada tick. Playwright no llega a declarar «estable» un nodo que
 * se reemplaza cada 200 ms, aunque el botón sea perfectamente visible. Se abre su `details` si
 * hace falta y se ejecuta el click del control visible en el mismo turno; sigue entrando por el
 * manejador de UI y nunca toca estado ni runtime directamente.
 */
async function clickControlVisible(selector) {
	const problema = await page.evaluate((css) => {
		const control = document.querySelector(css);
		if (!(control instanceof HTMLElement)) return `no existe ${css}`;
		const detalles = control.closest('details');
		if (detalles && control.tagName !== 'SUMMARY') detalles.open = true;
		const r = control.getBoundingClientRect();
		if (r.width <= 0 || r.height <= 0) return `${css} no es visible`;
		control.click();
		return '';
	}, selector);
	if (problema) throw new Error(problema);
}

async function cerrarSiVisible(modal, boton) {
	if (await page.locator(modal).isVisible().catch(() => false)) {
		await clickId(boton);
		await page.locator(modal).waitFor({ state: 'hidden' });
	}
}

async function energizar(queremos) {
	if ((await observar()).energizado !== queremos) {
		await clickId('btn-energizar');
		await page.waitForFunction((valor) => window.qa.simulacion().energizado === valor, queremos);
	}
}

async function abrirEjemplo(titulo, nombre) {
	await energizar(false);
	if (await page.locator('#inicio').isVisible().catch(() => false)) {
		await clickId('inicio-ejemplos');
	} else {
		await clickId('btn-aprender');
		await clickId('btn-ejemplos');
	}
	await page.locator('#modal-ejemplos').waitFor({ state: 'visible' });
	const tarjeta = page.locator('.tarjeta-ejemplo', { hasText: titulo }).first();
	if (!(await tarjeta.count())) throw new Error(`no aparece el ejemplo «${titulo}»`);
	await tarjeta.getByRole('button', { name: /Abrir y estudiar/i }).click();
	await Promise.race([
		page.locator('#modal-dialogo').waitFor({ state: 'visible', timeout: 800 }).then(() => true).catch(() => false),
		page.waitForFunction((esperado) => window.qa.proyecto().nombre === esperado, nombre, { timeout: 800 }).then(() => true).catch(() => false),
	]);
	if (await page.locator('#modal-dialogo').isVisible().catch(() => false)) await clickId('dialogo-ok');
	await page.waitForFunction((esperado) => window.qa.proyecto().nombre === esperado, nombre, { timeout: 30_000 });
	await cerrarSiVisible('#modal-explicacion', 'btn-cerrar-explicacion');
	if (!(await page.evaluate(() => document.body.classList.contains('modo-trabajo')))) {
		await clickId('modo-trabajo');
		await page.waitForFunction(() => document.body.classList.contains('modo-trabajo'));
	}
}

async function esperarPLC(predicado, timeout = 8_000) {
	const limite = Date.now() + timeout;
	let ultimo;
	while (Date.now() < limite) {
		const plc = (await observar()).controladores.find((c) => c.dispositivoId === 'plc');
		ultimo = plc;
		if (plc && predicado(plc)) return plc;
		await page.waitForTimeout(80);
	}
	throw new Error(`el PLC no alcanzó el estado esperado en ${timeout} ms: ${JSON.stringify(ultimo)}`);
}

async function esperarPaso(paso, timeout = 8_000) {
	return esperarPLC((plc) => plc.secuencias.PROCESO === paso, timeout);
}

async function accionarMando(id) {
	await clickControlVisible(`#sim-mandos button[data-mando="${id}"]`);
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

	await page.goto(`${entorno.url}/?qa=1`, { waitUntil: 'load' });
	await esperarEditorListo(page);
	await cerrarSiVisible('#modal-ayuda', 'btn-cerrar-ayuda');

	console.log('\n=== 1. Secuencia, scan, alarma e interacción visible ===');
	await abrirEjemplo('Fixture V4: PLC y proceso secuencial', 'Fixture V4 — proceso secuencial de tanque');
	await energizar(true);
	let plc = await esperarPaso('IDLE');
	comprobar('el PLC energizado entra en RUN y publica scans', plc.estado === 'RUN' && plc.scan >= 1,
		`${plc.estado}, scan ${plc.scan}`);
	comprobar('el monitor muestra runtime, periodo e imágenes E/S',
		await page.locator('#sim-controladores .plc-runtime').isVisible()
		&& await page.locator('#sim-controladores .plc-fuerzas').count() === 1);
	await clickControlVisible('#sim-controladores details[data-plc-panel="tags"] summary');
	await page.waitForTimeout(450);
	comprobar('la watch table queda abierta entre repintados y muestra alias/canal/valor',
		await page.locator('#sim-controladores details[data-plc-panel="tags"]').getAttribute('open') !== null
		&& /START[\s\S]*DI/.test(await page.locator('#sim-controladores details[data-plc-panel="tags"]').innerText()));
	comprobar('los niveles binarios no aparecen duplicados como sliders analógicos legacy',
		await page.locator('#sim-sondas input[data-sonda]').count() === 0);

	await accionarMando('start');
	await esperarPaso('LLENANDO');
	comprobar('START humano lleva IDLE → LLENANDO y abre la válvula',
		(await observar()).activos.includes('valvula-llenado'));

	await accionarMando('stop');
	plc = await esperarPaso('FALLO');
	comprobar('STOP prioritario lleva la secuencia a FALLO y apaga proceso',
		!plc.salidas.includes('DO_FILL') && !plc.salidas.includes('DO_AGITATE') && !plc.salidas.includes('DO_DRAIN'));
	comprobar('la salida de alarma cableada enciende el piloto físico', (await observar()).activos.includes('piloto-fallo'));
	comprobar('la alarma TRIP queda enclavada y sin ACK',
		plc.alarmas.PARADA_PROCESO?.activa && !plc.alarmas.PARADA_PROCESO?.reconocida);

	await clickControlVisible('#sim-controladores button[data-plc-ack="PARADA_PROCESO"]');
	plc = await esperarPLC((x) => x.alarmas.PARADA_PROCESO?.reconocida === true);
	comprobar('ACK visible reconoce sin borrar una alarma todavía presente', plc.alarmas.PARADA_PROCESO.activa);
	await accionarMando('reset');
	await esperarPaso('IDLE');
	comprobar('RESET no inicia automáticamente un nuevo ciclo', !(await observar()).activos.includes('agitador'));
	await clickControlVisible('#sim-controladores button[data-plc-reset-alarm="PARADA_PROCESO"]');
	plc = await esperarPLC((x) => x.alarmas.PARADA_PROCESO?.activa === false);
	comprobar('tras retirar la causa, Reset de alarma borra el enclavamiento', !plc.alarmas.PARADA_PROCESO.activa);

	console.log('\n=== 2. Pausa, scan único y fuerza de sesión ===');
	await clickControlVisible('#sim-controladores button[data-plc-action="pausa"]');
	plc = await esperarPLC((x) => x.pausado === true);
	const scanPausado = plc.scan;
	await clickControlVisible('#sim-controladores button[data-plc-force-digital="DI"][data-borne="START"]');
	plc = await esperarPLC((x) => x.forzadas.includes('DI:START'));
	comprobar('la fuerza DI se aplica desde el monitor y queda identificada', plc.forzadas.includes('DI:START'));
	await page.waitForTimeout(450);
	comprobar('el panel de fuerzas permanece abierto durante el refresco del monitor',
		await page.locator('#sim-controladores details[data-plc-panel="fuerzas"]').getAttribute('open') !== null);
	await clickControlVisible('#sim-controladores button[data-plc-action="paso"]');
	plc = await esperarPaso('LLENANDO');
	comprobar('1 scan avanza exactamente una imagen mientras permanece en pausa', plc.pausado && plc.scan === scanPausado + 1,
		`${scanPausado} → ${plc.scan}`);
	// Ciclo explícito de la fuerza: 1 → 0 → libre.
	await clickControlVisible('#sim-controladores button[data-plc-force-digital="DI"][data-borne="START"]');
	await clickControlVisible('#sim-controladores button[data-plc-force-digital="DI"][data-borne="START"]');
	plc = await esperarPLC((x) => !x.forzadas.includes('DI:START'));
	comprobar('liberar la fuerza devuelve START a la imagen cableada', !plc.forzadas.includes('DI:START'));
	await clickControlVisible('#sim-controladores button[data-plc-action="pausa"]');
	await esperarPLC((x) => x.pausado === false);

	console.log('\n=== 3. Recorrido físico completo de la secuencia ===');
	await accionarMando('nivel-alto');
	await esperarPaso('MEZCLANDO');
	comprobar('nivel alto lleva a MEZCLANDO y el motor recibe la DO cableada', (await observar()).activos.includes('agitador'));
	plc = await esperarPLC((x) => x.temporizadores.T_MEZCLA?.IN && x.temporizadores.T_MEZCLA.ET > 0);
	comprobar('el monitor expone TON con IN/Q/ET/PT reales',
		plc.temporizadores.T_MEZCLA.IN && plc.temporizadores.T_MEZCLA.PT === 5000
		&& plc.temporizadores.T_MEZCLA.ET > 0 && !plc.temporizadores.T_MEZCLA.Q,
		JSON.stringify(plc.temporizadores.T_MEZCLA));
	await esperarPaso('VACIANDO', 9_000);
	comprobar('TON lleva MEZCLANDO → VACIANDO y abre la válvula correspondiente',
		(await observar()).activos.includes('valvula-vaciado'));
	await accionarMando('nivel-alto');
	await accionarMando('nivel-bajo');
	plc = await esperarPaso('COMPLETO');
	plc = await esperarPLC((x) => x.contadores.LOTES?.CV === 1);
	const finalSecuencia = await observar();
	comprobar('nivel bajo cierra el ciclo en COMPLETO sin actuadores de proceso fantasma',
		!['valvula-llenado', 'agitador', 'valvula-vaciado', 'piloto-marcha', 'piloto-fallo']
			.some((id) => finalSecuencia.activos.includes(id)) && finalSecuencia.activos.includes('piloto-completo'));
	comprobar('CTU LOTES cuenta un flanco de ciclo y publica CV/PV/Q',
		plc.contadores.LOTES.CV === 1 && plc.contadores.LOTES.PV === 3 && !plc.contadores.LOTES.Q,
		JSON.stringify(plc.contadores.LOTES));
	comprobar('la secuencia publica estado anterior, tiempo y transición',
		plc.detalleSecuencias.PROCESO.anterior === 'VACIANDO'
		&& /VACIANDO.*COMPLETO/.test(plc.detalleSecuencias.PROCESO.transicion ?? ''));
	await accionarMando('reset');
	await esperarPaso('IDLE');
	await accionarMando('nivel-bajo');

	console.log('\n=== 4. Fallo de sensores, ACK y recuperación segura ===');
	await accionarMando('nivel-alto');
	await accionarMando('nivel-bajo');
	plc = await esperarPaso('FALLO');
	comprobar('sensores contradictorios provocan FALLO_SENSOR y salidas seguras',
		plc.alarmas.FALLO_SENSOR?.activa
		&& !['DO_FILL', 'DO_MIX', 'DO_DRAIN'].some((salida) => plc.salidas.includes(salida)));
	await clickControlVisible('#sim-controladores button[data-plc-ack="FALLO_SENSOR"]');
	plc = await esperarPLC((x) => x.alarmas.FALLO_SENSOR?.reconocida === true);
	comprobar('ACK no corrige la causa física ni borra la alarma', plc.alarmas.FALLO_SENSOR.activa);
	await accionarMando('nivel-alto');
	await accionarMando('reset');
	await esperarPaso('IDLE');
	await clickControlVisible('#sim-controladores button[data-plc-reset-alarm="FALLO_SENSOR"]');
	plc = await esperarPLC((x) => x.alarmas.FALLO_SENSOR?.activa === false);
	comprobar('retirar causa y resetear limpia la alarma sin arrancar',
		!plc.alarmas.FALLO_SENSOR.activa && !(await observar()).activos.includes('agitador'));
	await energizar(false);

	console.log('\n=== 5. PID, calidad y AO hacia actuador ===');
	await abrirEjemplo('Fixture V4: PID de nivel', 'Fixture V4 — PID de nivel');
	await energizar(true);
	const sonda = page.locator('#sim-sondas input[data-sonda="lt"]');
	await sonda.waitFor({ state: 'visible' });
	await sonda.evaluate((input) => {
		input.value = '40';
		input.dispatchEvent(new Event('input', { bubbles: true }));
	});
	plc = await esperarPLC((x) => Math.abs((x.sondas.PV ?? -999) - 40) < 0.1
		&& (x.salidasAnalogicas.AO1 ?? 0) > 0);
	const fotoPID = await observar();
	const valvula = fotoPID.actuadores.find((a) => a.dispositivoId === 'yv');
	comprobar('la imagen AI escala 12 mA a PV=40 % con calidad normal',
		Math.abs(plc.sondas.PV - 40) < 0.1 && plc.entradasAnalogicas[0]?.senal.calidad === 'normal');
	comprobar('PID publica AO y la válvula consume ese resultado sin estado visual paralelo',
		plc.salidasAnalogicas.AO1 > 0 && Math.abs(valvula.posicionObjetivo - plc.salidasAnalogicas.AO1) < 0.1,
		`AO=${plc.salidasAnalogicas.AO1.toFixed(1)} %, objetivo=${valvula?.posicionObjetivo?.toFixed(1)} %`);
	await clickControlVisible('#sim-controladores button[data-plc-action="modo"]');
	plc = await esperarPLC((x) => x.estado === 'STOP');
	comprobar('STOP visible lleva AO al valor seguro', plc.salidasAnalogicas.AO1 === 0);
	await clickControlVisible('#sim-controladores button[data-plc-action="modo"]');
	plc = await esperarPLC((x) => x.estado === 'RUN');
	comprobar('RUN visible exige un nuevo scan y recupera el cálculo', plc.scan > 0 && plc.salidasAnalogicas.AO1 > 0);
	await energizar(false);

	console.log('\n=== 6. Integridad de la sesión ===');
	comprobar('no hubo errores JavaScript', erroresJS.length === 0, erroresJS.slice(0, 3).join(' | '));
} catch (error) {
	fallos++;
	console.error(`ERROR NO CONTROLADO: ${error?.stack ?? error}`);
} finally {
	try { await page?.close(); } catch (error) { fallos++; console.error(`No se pudo cerrar la página: ${error?.message ?? error}`); }
	try { await browser?.close(); } catch (error) { fallos++; console.error(`No se pudo cerrar Chromium: ${error?.message ?? error}`); }
	if (servidor) {
		try {
			servidor.closeAllConnections?.();
			await new Promise((resolve, reject) => servidor.close((error) => error ? reject(error) : resolve()));
		} catch (error) { fallos++; console.error(`No se pudo cerrar el servidor QA: ${error?.message ?? error}`); }
	}
	if (!debugLogExistia && existsSync(debugLog)) {
		try { unlinkSync(debugLog); } catch (error) { fallos++; console.error(`No se pudo limpiar debug.log: ${error.message}`); }
	}
	if (chromeLogAnterior === undefined) delete process.env.CHROME_LOG_FILE;
	else process.env.CHROME_LOG_FILE = chromeLogAnterior;
}

const duracion = ((Date.now() - inicio) / 1000).toFixed(1);
console.log(`\n=== ${fallos === 0 ? 'TODO OK ✔' : `${fallos} FALLO(S) ✗`} · ${comprobaciones} comprobaciones · ${duracion} s ===`);
process.exitCode = fallos === 0 ? 0 : 1;
