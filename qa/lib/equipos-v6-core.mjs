/** Núcleo compartido de las regresiones públicas de Física Eléctrica V6. */
import { chromium } from 'playwright-core';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './entorno.mjs';

const inicio = Date.now();
let servidor; let browser; let page; let fallos = 0; let comprobaciones = 0;
const erroresJS = []; const debugLog = join(process.cwd(), 'debug.log'); const debugLogExistia = existsSync(debugLog);
const chromeLogAnterior = process.env.CHROME_LOG_FILE;
process.env.CHROME_LOG_FILE = process.platform === 'win32' ? 'NUL' : '/dev/null';
const alcance = process.env.QA_EQUIPOS_V6_SCOPE;
if (!['red', 'motor', 'accionamientos'].includes(alcance)) {
	console.error(`QA_EQUIPOS_V6_SCOPE inválido: ${alcance ?? 'ausente'}`);
	process.exit(2);
}

function comprobar(nombre, condicion, detalle = '') {
	comprobaciones++;
	if (!condicion) fallos++;
	console.log(`${condicion ? 'OK  ' : 'FAIL'}  ${nombre}${detalle ? ` → ${detalle}` : ''}`);
}
const observar = () => page.evaluate(() => window.qa.simulacion());
async function clickId(id) { const el = page.locator(`#${id}`); await el.waitFor({ state: 'visible' }); await el.click(); }
async function cerrarSiVisible(modal, boton) {
	if (await page.locator(modal).isVisible().catch(() => false)) {
		await clickId(boton); await page.locator(modal).waitFor({ state: 'hidden' });
	}
}
async function energizar(valor) {
	if ((await observar()).energizado !== valor) {
		await clickId('btn-energizar');
		await page.waitForFunction((v) => window.qa.simulacion().energizado === v, valor);
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
		await clickId('modo-trabajo'); await page.waitForFunction(() => document.body.classList.contains('modo-trabajo'));
	}
}
async function esperarFisica(predicado, timeout = 15_000) {
	const limite = Date.now() + timeout; let ultima;
	while (Date.now() < limite) {
		ultima = (await observar()).fisica;
		if (ultima && predicado(ultima)) return ultima;
		await page.waitForTimeout(80);
	}
	throw new Error(`V6 no alcanzó el estado esperado: ${JSON.stringify(ultima)?.slice(0, 1800)}`);
}
async function estadoEnsayoMotor() {
	return page.evaluate(() => {
		const simulacion = window.qa.simulacion();
		const estados = window.qa.estadoSim();
		return {
			energizado: simulacion.energizado,
			tiempoSimulado: document.querySelector('#sim-transcurrido')?.textContent ?? '—',
			falloMotor: estados.find((x) => x.id === 'm1'),
			motor: simulacion.motores.find((x) => x.dispositivoId === 'm1'),
			motorFisico: simulacion.fisica?.motores.find((x) => x.dispositivoId === 'm1'),
			q1: estados.find((x) => x.id === 'q1'),
			q1Fisica: simulacion.fisica?.protecciones.find((x) => x.dispositivoId === 'q1'),
			termicaProteccion: document.querySelector('.fila-sim.proteccion[data-id="q1"]')?.textContent?.trim() ?? '—',
			panelProteccion: document.querySelector('[data-mando="q1"]')?.parentElement?.textContent?.trim() ?? '—',
		};
	});
}
async function esperarEnsayoMotor(nombre, predicado, timeout) {
	const limite = Date.now() + timeout; let ultimo;
	while (Date.now() < limite) {
		ultimo = await estadoEnsayoMotor();
		if (predicado(ultimo)) return ultimo;
		await page.waitForTimeout(80);
	}
	throw new Error(`${nombre}: estado motor/protección no alcanzado en ${timeout} ms: `
		+ JSON.stringify(ultimo).slice(0, 3000));
}
async function accionar(selector) {
	const problema = await page.evaluate((css) => {
		const el = document.querySelector(css); if (!(el instanceof HTMLElement)) return `no existe ${css}`;
		const detalles = el.closest('details'); if (detalles) detalles.open = true;
		const r = el.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return `${css} no es visible`;
		el.click(); return '';
	}, selector);
	if (problema) throw new Error(problema);
}
async function seleccionar(selector, valor) {
	const el = page.locator(selector); await el.waitFor({ state: 'attached' }); await el.selectOption(valor);
}
async function moverRango(selector, valor) {
	const el = page.locator(selector); await el.waitFor({ state: 'visible' });
	await el.evaluate((input, v) => { input.value = String(v); input.dispatchEvent(new Event('input', { bubbles: true })); }, valor);
}

try {
	const entorno = await servidorDeQA(); servidor = entorno.servidor; browser = await abrirNavegador(chromium);
	page = await browser.newPage({ viewport: { width: 1580, height: 1000 } }); page.setDefaultTimeout(30_000);
	page.on('pageerror', (e) => erroresJS.push(`PAGEERROR: ${e.message}`));
	page.on('console', (m) => {
		const recurso = m.location().url ?? '';
		if (m.type() === 'error' && !/\/favicon\.ico(?:$|\?)/i.test(recurso)) erroresJS.push(`CONSOLE: ${m.text()}${recurso ? ` @ ${recurso}` : ''}`);
	});
	await page.goto(`${entorno.url}/?qa=1`, { waitUntil: 'load' }); await esperarEditorListo(page);
	await cerrarSiVisible('#modal-ayuda', 'btn-cerrar-ayuda');
	let fisica; let texto;

	if (alcance === 'red') {
	console.log('\n=== 1. Diferencial RMS y PE ===');
	await abrirEjemplo('Fixture V6: diferencial y fuga PE', 'Fixture V6 — diferencial y fuga PE'); await energizar(true);
	fisica = await esperarFisica((f) => f.protecciones.some((q) => q.dispositivoId === 'qf1' && q.estadoResidual === 'NORMAL'));
	let qf = fisica.protecciones.find((q) => q.dispositivoId === 'qf1');
	comprobar('servicio normal suma IΔ casi cero', qf.corrienteResidualA < 1e-6, `IΔ=${qf.corrienteResidualA}`);
	comprobar('el panel identifica el modelo RMS y el umbral de 30 mA', qf.modeloResidual === 'RESIDUAL_RMS_MODELED'
		&& qf.corrienteResidualNominalA === 0.03);
	await accionar('[data-fisica-falla-id="cc:z1:lpe"]');
	await page.waitForFunction(() => window.qa.estadoSim().some((x) => x.id === 'qf1' && x.disparado === true));
	fisica = await esperarFisica((f) => f.fallas.some((x) => x.id === 'cc:z1:lpe' && x.despejada));
	comprobar('la fuga L-PE dispara QF1 por una acción visible', (await page.locator('#sim-fisica').innerText()).includes('DESPEJADA'));
	comprobar('la red se re-resuelve con el diferencial abierto', fisica.protecciones.find((q) => q.dispositivoId === 'qf1').corrienteA < 1e-9);

	console.log('\n=== 2. Transformador acoplado ===');
	await abrirEjemplo('Fixture V6: transformador bajo carga', 'Fixture V6 — transformador bajo carga'); await energizar(true);
	fisica = await esperarFisica((f) => f.transformadores.some((t) => t.id === 'transformador:t1' && Math.hypot(t.corrienteSecundariaA.re, t.corrienteSecundariaA.im) > 0.9));
	const t1 = fisica.transformadores.find((t) => t.id === 'transformador:t1');
	comprobar('la carga secundaria se refleja al primario', Math.hypot(t1.corrientePrimariaA.re, t1.corrientePrimariaA.im) > 0.09);
	comprobar('regulación y pérdidas son finitas y conservan potencia', t1.regulacionPct > 0 && t1.perdidaCobreW >= 0
		&& t1.potenciaEntradaVA.re >= t1.potenciaSalidaVA.re);
	await seleccionar('[data-analisis-equipo]', 't1'); await accionar('[data-analisis-ejecutar]');
	texto = await page.locator('[data-analisis-resultado]').innerText();
	comprobar('ANALIZAR T1 muestra Vpri/Vsec, Ipri/Isec, Z%, regulación, carga y pérdidas',
		/Tensión primaria.*Corriente primaria.*Tensión secundaria.*Corriente secundaria.*Impedancia.*Regulación.*Pérdidas cobre.*Carga/s.test(texto), texto.slice(0, 500));
	}

	if (alcance === 'motor') {
	console.log('\n=== 3. Motor de placa y diagnóstico causal ===');
	await abrirEjemplo('Fixture V6: motor desde placa y diagnóstico', 'Fixture V6 — motor desde placa y diagnóstico'); await energizar(true);
	await accionar('#sim-mandos button[data-mando="s-run"]');
	fisica = await esperarFisica((f) => f.motores.some((m) => m.dispositivoId === 'm1'
		&& m.estado === 'marcha' && m.rpm > 1400), 20_000);
	let m1 = fisica.motores.find((m) => m.dispositivoId === 'm1');
	comprobar('el motor alcanza marcha desde placa', m1.estado === 'marcha'
		&& Math.abs(m1.rpm - 1450) / 1450 < 0.03 && m1.potenciaEntradaW > 5900,
		`estado=${m1.estado}, rpm=${m1.rpm}, Pin=${m1.potenciaEntradaW}`);
	comprobar('P/Q/S/PF son coherentes y finitos', m1.potenciaReactivaVar > 0 && m1.potenciaAparenteVA > m1.potenciaEntradaW
		&& m1.factorPotencia > 0.8 && m1.factorPotencia < 0.9);
	await seleccionar('[data-instrumento-nodo-a]', 'red::L1'); await seleccionar('[data-instrumento-nodo-b]', 'red::N');
	await seleccionar('[data-instrumento-modo]', 'VAC');
	let lectura = await page.locator('[data-instrumento-multimetro]').innerText();
	comprobar('multímetro VAC lee una fase calculada de aproximadamente 230 V', /23\d(?:[,.]\d+)? V.*CALCULADA/.test(lectura), lectura);
	await seleccionar('[data-instrumento-modo]', 'VDC'); lectura = await page.locator('[data-instrumento-multimetro]').innerText();
	comprobar('multímetro VDC rechaza explícitamente una fuente AC incompatible', /NO_DISPONIBLE.*VDC.*no corresponde/i.test(lectura), lectura);
	await seleccionar('[data-instrumento-conductor]', 'w-k-m1'); lectura = await page.locator('[data-instrumento-pinza]').innerText();
	comprobar('pinza visible publica corriente RMS, fase y sentido', /\d+[,.]\d+ A.*∠.*km1::2\/T1.*m1::U/s.test(lectura), lectura);
	await seleccionar('[data-instrumento-carga]', 'motor:m1:0'); lectura = await page.locator('[data-instrumento-potencia]').innerText();
	comprobar('analizador de potencia publica P/Q/S/PF con provenance', /P .* W.*Q .* var.*S .* VA.*PF .*CALCULADA/s.test(lectura), lectura);
	await seleccionar('[data-analisis-equipo]', 'm1'); await accionar('[data-analisis-ejecutar]'); texto = await page.locator('[data-analisis-resultado]').innerText();
	comprobar('ANALIZAR M1 muestra placa, RPM y slip', /MOTOR.*Potencia activa.*Potencia reactiva.*Potencia aparente.*Velocidad.*Velocidad síncrona.*Deslizamiento/s.test(texto), texto.slice(0, 500));
	await accionar('[data-fisica-falla-id="contacto-resistivo:interno:km1:1"]');
	fisica = await esperarFisica((f) => f.contactos.some((c) => c.ramaId === 'interno:km1:1' && c.resistenciaEfectivaOhm > 0.9)
		&& f.diagnosticoIndustrial.hallazgos.some((h) => h.codigo === 'CONTACTO_RESISTIVO'));
	const contacto = fisica.contactos.find((c) => c.ramaId === 'interno:km1:1');
	comprobar('el contacto resistivo visible produce ΔV y pérdida local', contacto.caidaV > 1 && contacto.perdidaW > 1);
	await seleccionar('[data-analisis-equipo]', 'km1'); await accionar('[data-analisis-ejecutar]'); texto = await page.locator('[data-analisis-resultado]').innerText();
	comprobar('ANALIZAR KM1 separa causa raíz y consecuencias con evidencia',
		/ROOT_CAUSE.*CONTACTO_RESISTIVO|ROOT_CAUSE.*Caída y resistencia anormales/s.test(texto)
		&& /CONFIRMADO/.test(texto) && /DELTA_V.*PERDIDA_LOCAL.*R_EFECTIVA/s.test(texto), texto.slice(0, 700));
	const descargaInforme = page.waitForEvent('download'); await accionar('[data-analisis-exportar]');
	const informe = await descargaInforme; const rutaInforme = await informe.path(); const htmlInforme = rutaInforme ? readFileSync(rutaInforme, 'utf8') : '';
	comprobar('el informe conserva Build ID, magnitudes, evidencia, provenance y limitaciones',
		/(?:DESARROLLO-|Build ID)/.test(htmlInforme) && /Magnitudes/.test(htmlInforme)
		&& /contacto-resistivo|Caída y resistencia anormales/i.test(htmlInforme)
		&& /DELTA_V/.test(htmlInforme) && /Provenance/.test(htmlInforme) && /Limitaciones/.test(htmlInforme) && !/<script\b/i.test(htmlInforme));
	/* El ensayo resistivo puede calentar/disparar Q1 si se mantiene: se abre de nuevo el fixture
	 * para que el rotor bloqueado parta de una protección limpia, como dos ensayos separados. */
	await abrirEjemplo('Fixture V6: motor desde placa y diagnóstico', 'Fixture V6 — motor desde placa y diagnóstico'); await energizar(true);
	await clickId('btn-sim-reposo');
	const inicioRotor = Date.now();
	await accionar('#sim-mandos button[data-mando="s-run"]');
	await esperarFisica((f) => f.motores.some((m) => m.dispositivoId === 'm1'
		&& m.estado === 'marcha' && m.rpm > 1400), 20_000);
	const marchaRotor = Date.now();
	await seleccionar('[data-fallo="m1"]', 'motor-bloqueado');
	const falloRotor = await esperarEnsayoMotor('aplicación visible de rotor bloqueado',
		(s) => s.falloMotor?.fallos?.includes('motor-bloqueado'), 5_000);
	const falloAplicado = Date.now();
	const sobreintensidad = await esperarEnsayoMotor('corriente de rotor bloqueado aguas arriba',
		(s) => s.motorFisico?.diagnosticos?.some((d) => d.codigo === 'ROTOR_BLOQUEADO')
			&& s.q1Fisica?.corrienteA > 50 && s.q1Fisica?.evaluacion?.region === 'TERMICA', 5_000);
	const corrienteDetectada = Date.now();
	/* Q1 es curva C de 10 A y el rotor bloqueado queda cerca de 6 In: su banda genérica es
	 * 1..60 s y el integrador usa el punto medio (30,5 s). Esperar 30 s de pared era, por
	 * construcción, más corto que el fenómeno que se quería observar. Se usa el acelerador público
	 * del panel y un límite derivado del extremo superior de la curva, no una pausa arbitraria. */
	const velocidadEnsayo = 20;
	await seleccionar('#sim-velocidad', String(velocidadEnsayo));
	const tMaxS = sobreintensidad.q1Fisica.evaluacion.tMaxS;
	const timeoutDisparo = Math.max(5_000,
		Math.ceil(((Number.isFinite(tMaxS) ? tMaxS : 60) / velocidadEnsayo) * 1000 + 5_000));
	await esperarEnsayoMotor('disparo térmico de Q1', (s) => s.q1?.disparado === true, timeoutDisparo);
	const disparoQ1 = Date.now();
	fisica = await esperarFisica((f) => f.protecciones.some((q) => q.dispositivoId === 'q1' && q.corrienteA < 1e-9));
	const estados = await page.evaluate(() => window.qa.estadoSim());
	comprobar('rotor bloqueado se introduce por la UI y la protección abre el circuito', estados.some((x) => x.id === 'm1' && x.fallos?.includes('motor-bloqueado')));
	comprobar('la actuación se propaga por Q1, no por una bandera visual del motor',
		estados.some((x) => x.id === 'q1' && x.disparado === true)
		&& (await page.locator('[data-mando="q1"]').locator('..').innerText()).includes('DISPARADO'));
	console.log(`INFO  rotor V6: marcha=${marchaRotor - inicioRotor} ms · fallo UI=${falloAplicado - inicioRotor} ms`
		+ ` · sobreintensidad=${corrienteDetectada - inicioRotor} ms · Q1=${disparoQ1 - inicioRotor} ms`
		+ ` · I=${sobreintensidad.q1Fisica.corrienteA.toFixed(2)} A · banda=${sobreintensidad.q1Fisica.evaluacion.tMinS}`
		+ `..${sobreintensidad.q1Fisica.evaluacion.tMaxS} s · sim=${falloRotor.tiempoSimulado}`);
	await clickId('btn-sim-reposo'); await accionar('#sim-mandos button[data-mando="s-run"]');
	await esperarFisica((f) => f.motores.some((m) => m.dispositivoId === 'm1'
		&& m.estado === 'marcha' && m.rpm > 1400), 20_000);
	await accionar('[data-fisica-falla-id="abierto:w-k-m2"]');
	fisica = await esperarFisica((f) => f.motores.some((m) => m.dispositivoId === 'm1'
		&& m.diagnosticos.some((d) => d.codigo === 'PERDIDA_FASE'))
		&& f.diagnosticoIndustrial.hallazgos.some((h) => h.codigo === 'CONDUCTOR_ABIERTO_PROBABLE'));
	comprobar('pérdida de fase visible localiza una rama ausente y no se confunde con rotor bloqueado',
		fisica.diagnosticoIndustrial.hallazgos.some((h) => h.codigo === 'CONDUCTOR_ABIERTO_PROBABLE'
			&& h.evidencias.some((e) => e.codigo === 'RAMA_AUSENTE'))
		&& !fisica.diagnosticoIndustrial.hallazgos.some((h) => h.codigo === 'ROTOR_BLOQUEADO' && h.estado === 'SOSTENIDA'));
	console.log(`INFO  motor V6 final=${Date.now() - inicioRotor} ms desde el inicio del ensayo de rotor`);
	}

	if (alcance === 'accionamientos') {
	console.log('\n=== 4. VFD físico hacia motor ===');
	await abrirEjemplo('Fixture V6: VFD físico y motor', 'Fixture V6 — VFD y motor'); await energizar(true);
	await accionar('#sim-mandos button[data-mando="s-run"]'); await moverRango('[data-ref-vfd="vfd"]', 100);
	fisica = await esperarFisica((f) => f.variadores.some((v) => v.dispositivoId === 'vfd' && v.frecuenciaSalidaHz > 49)
		&& f.motores.some((m) => m.dispositivoId === 'm1'
			&& m.estado === 'marcha' && m.rpm > 1400), 20_000);
	const v50 = fisica.variadores.find((v) => v.dispositivoId === 'vfd'); const rpm50 = fisica.motores.find((m) => m.dispositivoId === 'm1').rpm;
	comprobar('50 Hz publica Vout, Iout, Pin, Pout y pérdidas coherentes', Math.abs(v50.tensionSalidaV - 400) / 400 < 0.03 && v50.corrienteSalidaA > 0
		&& v50.potenciaEntradaW > 0 && v50.potenciaSalidaW > 0 && v50.perdidasW >= 0
		&& Math.abs(v50.potenciaEntradaW - v50.potenciaSalidaW - v50.perdidasW) < 1,
		`Vout=${v50.tensionSalidaV}, Iout=${v50.corrienteSalidaA}, Pin=${v50.potenciaEntradaW}, Pout=${v50.potenciaSalidaW}, loss=${v50.perdidasW}`);
	await moverRango('[data-ref-vfd="vfd"]', 50);
	fisica = await esperarFisica((f) => f.variadores.some((v) => v.dispositivoId === 'vfd' && Math.abs(v.frecuenciaSalidaHz - 25) < 0.2), 20_000);
	const v25 = fisica.variadores.find((v) => v.dispositivoId === 'vfd'); const rpm25 = fisica.motores.find((m) => m.dispositivoId === 'm1').rpm;
	comprobar('25 Hz reduce tensión, potencia y RPM frente a 50 Hz', v25.tensionSalidaV < v50.tensionSalidaV
		&& v25.potenciaSalidaW < v50.potenciaSalidaW && rpm25 < rpm50, `${rpm25}/${rpm50} rpm`);
	await seleccionar('[data-fallo="m1"]', 'motor-bloqueado');
	fisica = await esperarFisica((f) => f.variadores.some((v) => v.dispositivoId === 'vfd' && v.estado === 'falla' && v.potenciaSalidaW === 0));
	comprobar('sobrecorriente del motor enclava FAULT y despeja U/V/W', true);
	await seleccionar('[data-fallo="m1"]', '');
	const reset = page.locator('[data-reset-vfd="vfd"]'); await reset.waitFor({ state: 'visible' });
	comprobar('RESET solo se habilita al retirar la causa', await reset.isEnabled()); await reset.click();
	await page.waitForFunction(() => document.querySelector('.fila-sim.variador.listo'));
	comprobar('RESET lleva a READY y no a RUN', (await page.locator('.fila-sim.variador').innerText()).includes('READY'));
	await accionar('#sim-mandos button[data-mando="s-run"]'); await accionar('#sim-mandos button[data-mando="s-run"]');
	await esperarFisica((f) => f.variadores.some((v) => v.dispositivoId === 'vfd' && v.estado === 'marcha'));
	comprobar('una nueva transición RUN vuelve a habilitar la salida', true);

	console.log('\n=== 5. Desequilibrio y neutro abierto ===');
	await abrirEjemplo('Fixture V6: neutro y desequilibrio', 'Fixture V6 — neutro y desequilibrio'); await energizar(true);
	fisica = await esperarFisica((f) => f.trifasicos.some((t) => t.sistemaId === 'red' && t.desequilibrioCorrientePct > 40));
	let tri = fisica.trifasicos.find((t) => t.sistemaId === 'red');
	comprobar('las tres cargas distintas producen IN y desequilibrio medidos', Math.hypot(tri.corrienteNeutroA.re, tri.corrienteNeutroA.im) > 2);
	texto = await page.locator('[data-instrumento-trifasico]').innerText();
	comprobar('el instrumento visible muestra V12/V23/V31, I1/I2/I3, IN y secuencias',
		/V12 .*V23 .*V31 .*I1 .*I2 .*I3 .*IN .*V\+ .*V− .*V0/.test(texto), texto);
	await accionar('[data-fisica-falla-id="abierto:wn"]');
	fisica = await esperarFisica((f) => {
		const v = [1, 2, 3].map((i) => f.cargas.find((c) => c.id === `carga:z${i}:0`)).map((c) => Math.hypot(c.tensionV.re, c.tensionV.im));
		return Math.max(...v) - Math.min(...v) > 100;
	});
	comprobar('abrir N desplaza el punto estrella sin NaN/Infinity', fisica.fallas.some((f) => f.tipo === 'CONDUCTOR_ABIERTO' && f.id === 'abierto:wn')
		&& fisica.nodos.every((n) => n.tensionV === undefined || Number.isFinite(n.tensionV.re) && Number.isFinite(n.tensionV.im)));
	}

	console.log('\n=== 6. Integridad ===');
	comprobar('no hubo errores JavaScript', erroresJS.length === 0, erroresJS.slice(0, 3).join(' | '));
} catch (error) {
	fallos++; console.error(`ERROR NO CONTROLADO: ${error?.stack ?? error}`);
} finally {
	try { await page?.close(); } catch (e) { fallos++; console.error(`No se pudo cerrar la página: ${e?.message ?? e}`); }
	try { await browser?.close(); } catch (e) { fallos++; console.error(`No se pudo cerrar Chromium: ${e?.message ?? e}`); }
	if (servidor) try {
		servidor.closeAllConnections?.();
		await new Promise((resolve, reject) => servidor.close((e) => e ? reject(e) : resolve()));
	} catch (e) { fallos++; console.error(`No se pudo cerrar el servidor QA: ${e?.message ?? e}`); }
	if (!debugLogExistia && existsSync(debugLog)) try { unlinkSync(debugLog); }
	catch (e) { fallos++; console.error(`No se pudo limpiar debug.log: ${e.message}`); }
	if (chromeLogAnterior === undefined) delete process.env.CHROME_LOG_FILE; else process.env.CHROME_LOG_FILE = chromeLogAnterior;
}
const duracion = ((Date.now() - inicio) / 1000).toFixed(1);
console.log(`\n=== ${fallos === 0 ? 'TODO OK ✔' : `${fallos} FALLO(S) ✗`} · ${comprobaciones} comprobaciones · ${duracion} s ===`);
process.exitCode = fallos === 0 ? 0 : 1;
