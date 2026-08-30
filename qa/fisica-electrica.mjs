/**
 * Vertical slice de navegador para Fisica Electrica V5.
 *
 * Todas las mutaciones entran por controles visibles del editor. La sonda QA se limita a leer el
 * ResultadoSimulacion ya publicado, para comparar magnitudes sin copiar calculos al test.
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
	if (await page.locator('#inicio').isVisible().catch(() => false)) await clickId('inicio-ejemplos');
	else { await clickId('btn-aprender'); await clickId('btn-ejemplos'); }
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

async function esperarFisica(predicado, timeout = 10_000) {
	const limite = Date.now() + timeout;
	let ultima;
	while (Date.now() < limite) {
		ultima = (await observar()).fisica;
		if (ultima && predicado(ultima)) return ultima;
		await page.waitForTimeout(80);
	}
	throw new Error(`la fisica V5 no alcanzo el estado esperado: ${JSON.stringify(ultima)?.slice(0, 1500)}`);
}

async function accionarControlVisible(selector) {
	const problema = await page.evaluate((css) => {
		const control = document.querySelector(css);
		if (!(control instanceof HTMLElement)) return `no existe ${css}`;
		const detalles = control.closest('details');
		if (detalles) detalles.open = true;
		const r = control.getBoundingClientRect();
		if (r.width <= 0 || r.height <= 0) return `${css} no es visible`;
		control.click();
		return '';
	}, selector);
	if (problema) throw new Error(problema);
}

async function cambiarNumeroVisible(selector, valor) {
	const problema = await page.evaluate(({ css, nuevo }) => {
		const input = document.querySelector(css);
		if (!(input instanceof HTMLInputElement)) return `no existe ${css}`;
		const detalles = input.closest('details');
		if (detalles) detalles.open = true;
		const r = input.getBoundingClientRect();
		if (r.width <= 0 || r.height <= 0) return `${css} no es visible`;
		input.focus();
		input.value = String(nuevo);
		input.dispatchEvent(new Event('change', { bubbles: true }));
		return '';
	}, { css: selector, nuevo: valor });
	if (problema) throw new Error(problema);
}

async function elegirInstrumento(selector, valor) {
	const control = page.locator(selector);
	await control.waitFor({ state: 'attached' });
	await control.selectOption(valor);
}

const angulo = (v) => Math.atan2(v.im, v.re) * 180 / Math.PI;
const distanciaAngular = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

try {
	const entorno = await servidorDeQA();
	servidor = entorno.servidor;
	browser = await abrirNavegador(chromium);
	page = await browser.newPage({ viewport: { width: 1540, height: 980 } });
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

	console.log('\n=== 1. Caida, perdidas y controles runtime visibles ===');
	await abrirEjemplo('Fixture V5: caída de tensión', 'Fixture V5 — caída de tensión');
	await energizar(true);
	let fisica = await esperarFisica((f) => f.activo && f.conductores.some((c) => c.conductorId === 'w-fase-carga'));
	let conductor = fisica.conductores.find((c) => c.conductorId === 'w-fase-carga');
	comprobar('el panel visible publica PhysicsEngine V5', await page.locator('#sim-fisica').getByText('PhysicsEngine V5').isVisible());
	comprobar('fuente, carga y perdidas cierran el balance calculado',
		fisica.potenciaFuentesW > fisica.potenciaCargasW && fisica.potenciaPerdidasW > 0
		&& fisica.metricas.errorBalanceW < 0.5,
		`balance ${fisica.metricas.errorBalanceW} W`);
	comprobar('el cable publica I, R y caida no nulas', conductor.corrienteA > 9 && conductor.rOhm > 0 && conductor.caidaV > 0);
	const base = { r: conductor.rOhm, caida: conductor.caidaV };
	await cambiarNumeroVisible('[data-fisica-longitud="w-fase-carga"]', 40);
	fisica = await esperarFisica((f) => f.conductores.find((c) => c.conductorId === 'w-fase-carga')?.longitudM === 40);
	conductor = fisica.conductores.find((c) => c.conductorId === 'w-fase-carga');
	comprobar('duplicar longitud desde la UI aumenta R y caida', conductor.rOhm > base.r * 1.9 && conductor.caidaV > base.caida);
	const larga = { r: conductor.rOhm, caida: conductor.caidaV };
	await cambiarNumeroVisible('[data-fisica-seccion="w-fase-carga"]', 5);
	fisica = await esperarFisica((f) => f.conductores.find((c) => c.conductorId === 'w-fase-carga')?.seccionMm2 === 5);
	conductor = fisica.conductores.find((c) => c.conductorId === 'w-fase-carga');
	comprobar('duplicar seccion desde la UI reduce R y caida', conductor.rOhm < larga.r * 0.55 && conductor.caidaV < larga.caida);
	const persistente = await page.evaluate(() => window.qa.proyecto().conductores.find((c) => c.id === 'w-fase-carga'));
	comprobar('los ensayos runtime no mutan longitud ni seccion persistentes',
		persistente.fisica.longitudManualM === 20 && persistente.seccion === 2.5);

	console.log('\n=== 1b. Instrumentos profesionales sobre el resultado físico ===');
	await elegirInstrumento('[data-instrumento-nodo-a]', 'red::L');
	await elegirInstrumento('[data-instrumento-nodo-b]', 'red::N');
	await elegirInstrumento('[data-instrumento-modo]', 'VAC');
	let lectura = await page.locator('[data-instrumento-multimetro]').innerText();
	comprobar('multimetro VAC visible lee aproximadamente 230 V calculados', /22\d(?:[,.]\d+)? V/.test(lectura) && /CALCULADA/.test(lectura), lectura);
	await elegirInstrumento('[data-instrumento-conductor]', 'w-fase-carga');
	lectura = await page.locator('[data-instrumento-pinza]').innerText();
	comprobar('pinza visible publica corriente RMS, fase y sentido', /\d+[,.]\d+ A/.test(lectura) && /∠/.test(lectura) && /q1::2.*r1::L/.test(lectura), lectura);
	await elegirInstrumento('[data-instrumento-carga]', 'carga:r1:0');
	lectura = await page.locator('[data-instrumento-potencia]').innerText();
	comprobar('analizador visible publica P Q S PF y provenance', /P .* W.*Q .* var.*S .* VA.*PF .*CALCULADA/.test(lectura), lectura);
	await elegirInstrumento('[data-instrumento-modo]', 'OHM');
	lectura = await page.locator('[data-instrumento-multimetro]').innerText();
	comprobar('ohmios/continuidad queda bloqueado con tension presente', /NO_DISPONIBLE.*BLOQUEADA/.test(lectura), lectura);

	console.log('\n=== 2. Fuente y carga trifasicas ===');
	await abrirEjemplo('Fixture V5: motor trifásico', 'Fixture V5 — motor trifásico');
	await energizar(true);
	await accionarControlVisible('#sim-mandos button[data-mando="s-run"]');
	fisica = await esperarFisica((f) => f.cargas.filter((c) => c.id.startsWith('carga:m1:')).length === 3
		&& f.cargas.filter((c) => c.id.startsWith('carga:m1:')).every((c) => c.potenciaVA.re > 1000));
	const fases = ['U', 'V', 'W'].map((borne) => fisica.nodos.find((x) => x.id === `m1::${borne}`)?.tensionV);
	const angulos = fases.map(angulo);
	comprobar('las tres fases del motor tienen magnitud coherente', fases.every((v) => Math.hypot(v.re, v.im) > 220));
	comprobar('L1/L2/L3 conservan separacion fasorial de 120 grados',
		distanciaAngular(angulos[0], angulos[1]) > 115 && distanciaAngular(angulos[0], angulos[1]) < 125
		&& distanciaAngular(angulos[1], angulos[2]) > 115 && distanciaAngular(angulos[1], angulos[2]) < 125,
		angulos.map((x) => x.toFixed(1)).join(' / '));
	const cargasMotor = fisica.cargas.filter((c) => c.id.startsWith('carga:m1:'));
	comprobar('el panel publica P, Q, S y PF de la carga trifasica',
		cargasMotor.reduce((s, c) => s + c.potenciaVA.re, 0) > 5000
		&& cargasMotor.every((c) => c.potenciaVA.im > 0 && c.factorPotencia > 0.85 && c.factorPotencia < 0.95));
	lectura = await page.locator('[data-instrumento-trifasico]').innerText();
	comprobar('analizador trifasico visible publica V12/V23/V31 I1/I2/I3/IN y desequilibrio',
		/V12 .*V23 .*V31 .*I1 .*I2 .*I3 .*IN .*desbal/.test(lectura), lectura);

	console.log('\n=== 3. Icc y selectividad por una accion visible ===');
	await abrirEjemplo('Fixture V5: cortocircuito y selectividad', 'Fixture V5 — cortocircuito y selectividad');
	await energizar(true);
	await accionarControlVisible('[data-fisica-falla-id="cc:z1:ln"]');
	fisica = await esperarFisica((f) => f.fallas.some((x) => x.id === 'cc:z1:ln' && x.iccA));
	const falla = fisica.fallas.find((x) => x.id === 'cc:z1:ln');
	comprobar('la falla publica Vprefalla, Zth, Zf e Icc', falla.vPrefallaV && falla.zTheveninOhm && falla.zFallaOhm
		&& Math.hypot(falla.iccA.re, falla.iccA.im) > 100);
	comprobar('la ruta real identifica ambas protecciones y explica coordinacion',
		fisica.selectividad.length === 1 && fisica.selectividad[0].aguasAbajoId === 'q2'
		&& fisica.selectividad[0].aguasArribaId === 'q1' && fisica.selectividad[0].explicacion.length > 20);
	comprobar('la UI diferencia la falla prospectiva ya despejada', falla.despejada === true
		&& /DESPEJADA/.test(await page.locator('#sim-fisica').innerText()));

	console.log('\n=== 4. Compliance 4-20 mA y burden runtime ===');
	await abrirEjemplo('Fixture V3: temperatura, PLC y válvula', 'Fixture V3 — temperatura, PLC y válvula modulante');
	await energizar(true);
	await elegirInstrumento('[data-instrumento-nodo-a]', 'ps24::+24');
	await elegirInstrumento('[data-instrumento-nodo-b]', 'ps24::0V');
	await elegirInstrumento('[data-instrumento-modo]', 'VDC');
	lectura = await page.locator('[data-instrumento-multimetro]').innerText();
	comprobar('multimetro VDC visible lee la fuente funcional de 24 V', /2[34](?:[,.]\d+)? V.*CALCULADA/.test(lectura), lectura);
	const sonda = page.locator('#sim-sondas input[data-sonda="tt1"]');
	await sonda.waitFor({ state: 'visible' });
	await sonda.fill('100');
	fisica = await esperarFisica((f) => f.lazosAnalogicos.some((l) => l.fuenteId === 'tt1' && (l.corrienteMA ?? 0) > 19.5));
	let lazo = fisica.lazosAnalogicos.find((l) => l.fuenteId === 'tt1');
	comprobar('24 V, cable y burden 250 ohm permiten 20 mA', lazo.calidad === 'NORMAL' && lazo.burdenOhm === 250);
	await cambiarNumeroVisible('[data-fisica-burden="plc1"]', 1000);
	fisica = await esperarFisica((f) => f.lazosAnalogicos.some((l) => l.fuenteId === 'tt1'
		&& l.burdenOhm === 1000 && l.calidad === 'COMPLIANCE_INSUFICIENTE'));
	lazo = fisica.lazosAnalogicos.find((l) => l.fuenteId === 'tt1');
	comprobar('burden excesivo limita corriente y degrada calidad', lazo.corrienteMA < 20 && lazo.calidad === 'COMPLIANCE_INSUFICIENTE');
	const burdenPersistente = await page.evaluate(() => window.qa.proyecto().dispositivos.find((d) => d.id === 'plc1').fisica.analogica.burdenOhm);
	comprobar('el burden de ensayo tampoco muta el proyecto', burdenPersistente === 250);

	console.log('\n=== 5. Integridad de la sesion ===');
	comprobar('no hubo errores JavaScript', erroresJS.length === 0, erroresJS.slice(0, 3).join(' | '));
} catch (error) {
	fallos++;
	console.error(`ERROR NO CONTROLADO: ${error?.stack ?? error}`);
} finally {
	try { await page?.close(); } catch (error) { fallos++; console.error(`No se pudo cerrar la pagina: ${error?.message ?? error}`); }
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
