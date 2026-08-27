import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { ConfiguracionProgramaPLC, ImagenEntradasPLC } from '../src/modelo/programa-plc.js';
import { compilarProgramaPLC, type IOProgramaPLC } from '../src/motores/plc-compilador.js';
import { actualizarRuntimePLC, crearRuntimePLC } from '../src/motores/plc-runtime.js';

const io: IOProgramaPLC = { DI: ['START', 'STOP', 'RESET', 'PULSO'], DO: ['MOTOR', 'VALVULA', 'ALARMA'], AI: ['PV'], AO: ['AO1'] };
const entradas = (digitales: Record<string, boolean> = {}, valor = 0): ImagenEntradasPLC => ({
	digitales, analogicas: { PV: { valor, calidad: 'normal', origen: 'calculado' } },
});
const config = (FUENTE: string, extra: Partial<ConfiguracionProgramaPLC> = {}): ConfiguracionProgramaPLC => ({
	version: 1, lenguaje: 'tablerostudio-plc-v4', FUENTE, modoInicial: 'RUN', periodoScanMs: 100, ...extra,
});

test('PLC V4 compila IR tipada y rechaza etiquetas desconocidas, tipos y dobles escrituras', () => {
	assert.deepEqual(compilarProgramaPLC(config('MOTOR := START AND NOT STOP'), io).errores, []);
	assert.match(compilarProgramaPLC(config('MOTOR := PV'), io).errores[0].mensaje, /esperaba BOOL/);
	assert.match(compilarProgramaPLC(config('MOTOR := DESCONOCIDA'), io).errores[0].mensaje, /desconocida/);
	assert.match(compilarProgramaPLC(config('MOTOR := START\nMOTOR := STOP'), io).errores[0].mensaje, /doble escritura/);
	assert.ok(compilarProgramaPLC(config('TON T1 IN START PT 1s\nTON T1 IN STOP PT 2s'), io).errores.some((e) => /duplicad/i.test(e.mensaje)));
	assert.ok(compilarProgramaPLC(config([
		'SEQUENCE S INITIAL IDLE',
		'TRANS S IDLE -> A WHEN START PRIORITY 10',
		'TRANS S IDLE -> B WHEN STOP PRIORITY 10',
	].join('\n')), io).errores.some((e) => /transición ambigua/i.test(e.mensaje)));
	assert.ok(compilarProgramaPLC(config('', { etiquetas: [
		{ nombre: 'TAG', tipo: 'BOOL' }, { nombre: 'tag', tipo: 'BOOL' },
	] }), io).errores.some((e) => /declarada dos veces/i.test(e.mensaje)));
	assert.ok(compilarProgramaPLC(config('', { etiquetas: [
		{ nombre: 'MALA', tipo: 'REAL', io: { clase: 'AI', borne: 'NO_EXISTE' } },
	] }), io).errores.some((e) => /borne inexistente/i.test(e.mensaje)));
});

test('el compilador/runtime no evalúan JavaScript dinámico', () => {
	const compilador = readFileSync(new URL('../src/motores/plc-compilador.js', import.meta.url), 'utf8');
	const runtime = readFileSync(new URL('../src/motores/plc-runtime.js', import.meta.url), 'utf8');
	assert.doesNotMatch(`${compilador}\n${runtime}`, /\beval\s*\(|new\s+Function\s*\(/);
});

test('un scan congela entradas y publica salidas atómicamente', () => {
	const p = compilarProgramaPLC(config('MOTOR := START\nVALVULA := MOTOR'), io);
	let r = crearRuntimePLC(p);
	r = actualizarRuntimePLC(p, r, entradas({ START: true }), 0, true).runtime;
	assert.equal(r.salidas.digitales.MOTOR, true);
	assert.equal(r.salidas.digitales.VALVULA, false,
		'VALVULA ve la imagen de salidas anterior, no una escritura parcial del mismo scan');
	r = actualizarRuntimePLC(p, r, entradas({ START: true }), 100, true).runtime;
	assert.equal(r.salidas.digitales.VALVULA, true);
});

test('scheduler respeta periodo, limita catch-up, pausa y ejecuta un solo paso', () => {
	const p = compilarProgramaPLC(config('MOTOR := START', { limites: { catchUpMaximo: 3 } }), io);
	let r = actualizarRuntimePLC(p, undefined, entradas({ START: true }), 0, true);
	assert.equal(r.scansEjecutados, 1);
	r = actualizarRuntimePLC(p, r.runtime, entradas({ START: true }), 50, true);
	assert.equal(r.scansEjecutados, 0);
	r = actualizarRuntimePLC(p, r.runtime, entradas({ START: true }), 1000, true);
	assert.equal(r.scansEjecutados, 3);
	r = actualizarRuntimePLC(p, r.runtime, entradas({ START: false }), 1100, true, { pausado: true });
	assert.equal(r.scansEjecutados, 0);
	r = actualizarRuntimePLC(p, r.runtime, entradas({ START: false }), 1100, true, { paso: true });
	assert.equal(r.scansEjecutados, 1);
	assert.equal(r.runtime.salidas.digitales.MOTOR, false);
});

test('FIRST_SCAN solo está activo una vez al entrar en RUN', () => {
	const p = compilarProgramaPLC(config('MOTOR := FIRST_SCAN'), io);
	let r = actualizarRuntimePLC(p, undefined, entradas(), 0, true).runtime;
	assert.equal(r.salidas.digitales.MOTOR, true);
	r = actualizarRuntimePLC(p, r, entradas(), 100, true).runtime;
	assert.equal(r.salidas.digitales.MOTOR, false);
	r = actualizarRuntimePLC(p, r, entradas(), 200, true, { modo: 'STOP' }).runtime;
	assert.equal(r.estado, 'STOP');
	r = actualizarRuntimePLC(p, r, entradas(), 300, true, { modo: 'RUN' }).runtime;
	assert.equal(r.salidas.digitales.MOTOR, true);
	r = actualizarRuntimePLC(p, r, entradas(), 400, false).runtime;
	const scanSinAlimentacion = r.scan;
	r = actualizarRuntimePLC(p, r, entradas(), 1400, false).runtime;
	assert.equal(r.scan, scanSinAlimentacion, 'sin 24 V no avanza scans');
	r = actualizarRuntimePLC(p, r, entradas(), 1500, true).runtime;
	assert.equal(r.salidas.digitales.MOTOR, true, 'recuperar alimentación produce exactamente un FIRST_SCAN');
	r = actualizarRuntimePLC(p, r, entradas(), 1600, true).runtime;
	assert.equal(r.salidas.digitales.MOTOR, false);
});

test('SET/RESET es determinista y RESET domina si ambos se cumplen', () => {
	const p = compilarProgramaPLC(config([
		'VAR BOOL MARCHA',
		'SET MARCHA WHEN START',
		'RESET MARCHA WHEN STOP',
		'MOTOR := MARCHA',
	].join('\n')), io);
	let r = actualizarRuntimePLC(p, undefined, entradas({ START: true }), 0, true).runtime;
	assert.equal(r.variables.MARCHA, true);
	r = actualizarRuntimePLC(p, r, entradas({ START: true, STOP: true }), 100, true).runtime;
	assert.equal(r.variables.MARCHA, false);
	assert.equal(r.salidas.digitales.MOTOR, false);
});

test('RETAIN sobrevive una pérdida de alimentación de sesión y el resto se reinicia', () => {
	const p = compilarProgramaPLC(config([
		'VAR BOOL R RETAIN', 'VAR BOOL N',
		'SET R WHEN START', 'SET N WHEN START',
	].join('\n')), io);
	let r = actualizarRuntimePLC(p, undefined, entradas({ START: true }), 0, true).runtime;
	assert.equal(r.variables.R, true); assert.equal(r.variables.N, true);
	r = actualizarRuntimePLC(p, r, entradas(), 100, false).runtime;
	assert.equal(r.variables.R, true); assert.equal(r.variables.N, false);
	assert.equal(r.diagnosticos[0]?.codigo, 'POWER_LOSS');
	const nuevo = crearRuntimePLC(p);
	assert.equal(nuevo.variables.R, false, 'reiniciar la simulación también limpia RETAIN');
});

test('STOP, FAULT y pérdida de alimentación publican valores seguros configurados por canal', () => {
	const cfg = config('MOTOR := START\nAO1 := PV', { etiquetas: [
		{ nombre: 'MOTOR', tipo: 'BOOL', io: { clase: 'DO', borne: 'MOTOR' }, seguro: true },
		{ nombre: 'AO1', tipo: 'REAL', io: { clase: 'AO', borne: 'AO1' }, seguro: 12.5 },
	] });
	const p = compilarProgramaPLC(cfg, io); assert.deepEqual(p.errores, []);
	let r = actualizarRuntimePLC(p, undefined, entradas({ START: false }, 80), 0, true, { modo: 'STOP' }).runtime;
	assert.equal(r.salidas.digitales.MOTOR, true); assert.equal(r.salidas.analogicas.AO1, 12.5);
	r = actualizarRuntimePLC(p, r, entradas({ START: true }, 80), 100, false, { modo: 'RUN' }).runtime;
	assert.equal(r.estado, 'SIN_ALIMENTACION'); assert.equal(r.salidas.digitales.MOTOR, true); assert.equal(r.salidas.analogicas.AO1, 12.5);
	const fault = compilarProgramaPLC({ ...cfg, FUENTE: 'AO1 := 1 / PV' }, io);
	r = actualizarRuntimePLC(fault, undefined, entradas({}, 0), 0, true).runtime;
	assert.equal(r.estado, 'FAULT'); assert.equal(r.salidas.digitales.MOTOR, true); assert.equal(r.salidas.analogicas.AO1, 12.5);
});

test('RISING/FALLING y CTU cuentan flancos, no niveles sostenidos', () => {
	const p = compilarProgramaPLC(config([
		'CTU C1 CU PULSO RESET RESET PV 2',
		'MOTOR := C1.Q',
		'VALVULA := RISING(START) OR FALLING(STOP)',
	].join('\n')), io);
	let r = actualizarRuntimePLC(p, undefined, entradas({ PULSO: true, START: true }), 0, true).runtime;
	assert.equal(r.contadores.C1.CV, 1); assert.equal(r.salidas.digitales.VALVULA, true);
	r = actualizarRuntimePLC(p, r, entradas({ PULSO: true, START: true }), 100, true).runtime;
	assert.equal(r.contadores.C1.CV, 1); assert.equal(r.salidas.digitales.VALVULA, false);
	r = actualizarRuntimePLC(p, r, entradas({ PULSO: false }), 200, true).runtime;
	r = actualizarRuntimePLC(p, r, entradas({ PULSO: true }), 300, true).runtime;
	assert.equal(r.contadores.C1.CV, 2); assert.equal(r.salidas.digitales.MOTOR, true);
});

test('CTD carga PV y descuenta únicamente flancos', () => {
	const p = compilarProgramaPLC(config('CTD C1 CD PULSO LOAD RESET PV 2\nMOTOR := C1.Q'), io);
	let r = actualizarRuntimePLC(p, undefined, entradas({ RESET: true }), 0, true).runtime;
	assert.equal(r.contadores.C1.CV, 2); assert.equal(r.contadores.C1.Q, false);
	r = actualizarRuntimePLC(p, r, entradas({ PULSO: true }), 100, true).runtime;
	r = actualizarRuntimePLC(p, r, entradas({ PULSO: false }), 200, true).runtime;
	r = actualizarRuntimePLC(p, r, entradas({ PULSO: true }), 300, true).runtime;
	assert.equal(r.contadores.C1.CV, 0); assert.equal(r.salidas.digitales.MOTOR, true);
});

test('TON/TOF/TP usan tiempo de scan determinista', () => {
	const p = compilarProgramaPLC(config([
		'TON T1 IN START PT 0.2s', 'TOF T2 IN START PT 0.2s', 'TP T3 IN PULSO PT 0.2s',
		'MOTOR := T1.Q', 'VALVULA := T2.Q', 'ALARMA := T3.Q',
	].join('\n')), io);
	let r = actualizarRuntimePLC(p, undefined, entradas({ START: true, PULSO: true }), 0, true).runtime;
	assert.equal(r.salidas.digitales.MOTOR, false); assert.equal(r.salidas.digitales.VALVULA, true); assert.equal(r.salidas.digitales.ALARMA, true);
	r = actualizarRuntimePLC(p, r, entradas({ START: true, PULSO: true }), 100, true).runtime;
	assert.equal(r.salidas.digitales.MOTOR, true); assert.equal(r.salidas.digitales.ALARMA, true);
	r = actualizarRuntimePLC(p, r, entradas({ START: false }), 200, true).runtime;
	assert.equal(r.salidas.digitales.ALARMA, false);
	assert.equal(r.salidas.digitales.VALVULA, true);
	r = actualizarRuntimePLC(p, r, entradas({ START: false }), 300, true).runtime;
	assert.equal(r.salidas.digitales.VALVULA, false);
});

test('una secuencia toma una transición por scan con prioridad explícita', () => {
	const p = compilarProgramaPLC(config([
		'SEQUENCE CICLO INITIAL REPOSO',
		'TRANS CICLO REPOSO -> LLENANDO WHEN START PRIORITY 10',
		'TRANS CICLO REPOSO -> FALLO WHEN STOP PRIORITY 100',
		'TRANS CICLO LLENANDO -> AGITANDO WHEN PV >= 80 PRIORITY 10',
		'VALVULA := CICLO.LLENANDO',
		'MOTOR := CICLO.AGITANDO',
	].join('\n')), io);
	let r = actualizarRuntimePLC(p, undefined, entradas({ START: true, STOP: true }), 0, true).runtime;
	assert.equal(r.secuencias.CICLO, 'FALLO');
	assert.equal(r.detalleSecuencias.CICLO.anterior, 'REPOSO');
	assert.match(r.detalleSecuencias.CICLO.transicion!, /prioridad 100/);
	assert.ok(r.eventos.some((e) => /CICLO: REPOSO.*FALLO/.test(e.mensaje)));
	r = crearRuntimePLC(p);
	r = actualizarRuntimePLC(p, r, entradas({ START: true }, 0), 0, true).runtime;
	assert.equal(r.secuencias.CICLO, 'LLENANDO'); assert.equal(r.salidas.digitales.VALVULA, true);
	r = actualizarRuntimePLC(p, r, entradas({}, 90), 100, true).runtime;
	assert.equal(r.secuencias.CICLO, 'AGITANDO'); assert.equal(r.salidas.digitales.MOTOR, true);
	r = actualizarRuntimePLC(p, r, entradas({}, 90), 300, true).runtime;
	assert.equal(r.detalleSecuencias.CICLO.actual, 'AGITANDO');
	assert.equal(r.detalleSecuencias.CICLO.tiempoEnEstadoMs, 200);
});

test('interlock explica el permisivo faltante y lleva la salida a estado seguro', () => {
	const p = compilarProgramaPLC(config('MOTOR := START\nINTERLOCK MOTOR REQUIRE NOT STOP MESSAGE "Paro activo"'), io);
	const r = actualizarRuntimePLC(p, undefined, entradas({ START: true, STOP: true }), 0, true).runtime;
	assert.equal(r.salidas.digitales.MOTOR, false);
	assert.deepEqual(r.interlocks, [{ salida: 'MOTOR', mensaje: 'Paro activo', activo: true }]);
});

test('alarmas enclavadas requieren ACK y reset con la condición ausente', () => {
	const p = compilarProgramaPLC(config('ALARM ALTO WHEN PV > 80 SEVERITY TRIP LATCHED MESSAGE "Nivel alto"'), io);
	let r = actualizarRuntimePLC(p, undefined, entradas({}, 90), 0, true).runtime;
	assert.equal(r.alarmas.ALTO.activa, true); assert.equal(r.alarmas.ALTO.reconocida, false);
	assert.equal(r.alarmas.ALTO.condicionActiva, true); assert.equal(r.alarmas.ALTO.origen, 'PV > 80');
	r = actualizarRuntimePLC(p, r, entradas({}, 90), 50, true, { pausado: true, ackAlarmas: ['ALTO'], resetAlarmas: ['ALTO'] }).runtime;
	assert.equal(r.alarmas.ALTO.activa, true, 'ACK/reset en pausa no borra una causa todavía activa');
	r = actualizarRuntimePLC(p, r, entradas({}, 10), 100, true, { pausado: false, ackAlarmas: ['ALTO'] }).runtime;
	assert.equal(r.alarmas.ALTO.activa, true); assert.equal(r.alarmas.ALTO.reconocida, true);
	r = actualizarRuntimePLC(p, r, entradas({}, 10), 200, true, { resetAlarmas: ['ALTO'] }).runtime;
	assert.equal(r.alarmas.ALTO.activa, false);
});

test('PID limita, evita windup, permite manual y aplica salida segura con PV mala', () => {
	const p = compilarProgramaPLC(config([
		'VAR REAL SP = 50', 'VAR BOOL AUTO = TRUE', 'VAR REAL MAN = 20',
		'PID LAZO PV PV SP SP OUT AO1 KP 2 TI 10 TD 0 MIN 0 MAX 100 AUTO AUTO MANUAL MAN BAD SAFE',
	].join('\n')), io);
	let r = actualizarRuntimePLC(p, undefined, entradas({}, 0), 0, true).runtime;
	assert.equal(r.salidas.analogicas.AO1, 100); assert.equal(r.pids.LAZO.saturado, true);
	const mala: ImagenEntradasPLC = { digitales: {}, analogicas: { PV: { calidad: 'circuito-abierto', origen: 'calculado' } } };
	r = actualizarRuntimePLC(p, r, mala, 100, true).runtime;
	assert.equal(r.salidas.analogicas.AO1, 0); assert.equal(r.pids.LAZO.calidadPV, 'circuito-abierto');
	assert.equal(r.diagnosticos[0]?.codigo, 'BAD_ANALOG_QUALITY');
});

test('PID conmuta manual/auto sin salto de tipo y conserva AO acotada', () => {
	const p = compilarProgramaPLC(config([
		'VAR REAL SP = 50',
		'PID LAZO PV PV SP SP OUT AO1 KP 1 TI 10 TD 0 MIN 0 MAX 100 AUTO AUTO MANUAL MAN BAD HOLD',
	].join('\n'), { etiquetas: [
		{ nombre: 'AUTO', tipo: 'BOOL', io: { clase: 'DI', borne: 'START' } },
		{ nombre: 'MAN', tipo: 'REAL', io: { clase: 'AI', borne: 'PV' } },
	] }), io);
	let r = actualizarRuntimePLC(p, undefined, entradas({ START: false }, 35), 0, true).runtime;
	assert.equal(r.pids.LAZO.manual, true); assert.equal(r.salidas.analogicas.AO1, 35);
	r = actualizarRuntimePLC(p, r, entradas({ START: true }, 35), 100, true).runtime;
	assert.equal(r.pids.LAZO.manual, false); assert.ok(r.salidas.analogicas.AO1 >= 0 && r.salidas.analogicas.AO1 <= 100);
});

test('comparaciones y matemática REAL soportan MIN/MAX/CLAMP', () => {
	const p = compilarProgramaPLC(config('AO1 := CLAMP(MAX(PV * 2, MIN(10, 20)), 0, 100)\nMOTOR := PV >= 50'), io);
	const r = actualizarRuntimePLC(p, undefined, entradas({}, 60), 0, true).runtime;
	assert.equal(r.salidas.analogicas.AO1, 100); assert.equal(r.salidas.digitales.MOTOR, true);
});

test('VALID/BAD conserva calidad V3 y nunca convierte circuito abierto en cero normal', () => {
	const p = compilarProgramaPLC(config('MOTOR := VALID(PV)\nVALVULA := BAD(PV)'), io);
	const mala: ImagenEntradasPLC = { digitales: {}, analogicas: {
		PV: { calidad: 'circuito-abierto', origen: 'calculado' },
	} };
	const r = actualizarRuntimePLC(p, undefined, mala, 0, true).runtime;
	assert.equal(r.entradas.analogicas.PV.valor, undefined);
	assert.equal(r.salidas.digitales.MOTOR, false); assert.equal(r.salidas.digitales.VALVULA, true);
});

test('PID V1 cubre P, I y D con sample time simulado y anti-windup', () => {
	const base = (kp: number, ti: number, td: number, max = 1_000) => compilarProgramaPLC(config([
		'VAR REAL SP = 50',
		`PID LAZO PV PV SP SP OUT AO1 KP ${kp} TI ${ti} TD ${td} MIN -1000 MAX ${max} BAD SAFE`,
	].join('\n')), io);
	let p = base(2, 0, 0); let r = actualizarRuntimePLC(p, undefined, entradas({}, 40), 0, true).runtime;
	assert.equal(r.salidas.analogicas.AO1, 20, 'término proporcional');
	p = base(1, 10, 0); r = actualizarRuntimePLC(p, undefined, entradas({}, 40), 0, true).runtime;
	const i1 = r.pids.LAZO.integral; r = actualizarRuntimePLC(p, r, entradas({}, 40), 100, true).runtime;
	assert.ok(r.pids.LAZO.integral > i1, 'integral acumula con dt de scan');
	p = base(1, 0, 1); r = actualizarRuntimePLC(p, undefined, entradas({}, 50), 0, true).runtime;
	r = actualizarRuntimePLC(p, r, entradas({}, 40), 100, true).runtime;
	assert.equal(r.salidas.analogicas.AO1, 110, 'derivada reacciona al cambio de error usando dt simulado');
	p = base(2, 10, 0, 100); r = actualizarRuntimePLC(p, undefined, entradas({}, 0), 0, true).runtime;
	assert.equal(r.pids.LAZO.saturado, true); assert.equal(r.pids.LAZO.integral, 0, 'anti-windup no integra contra saturación');
});

test('fuerzas quedan marcadas, no contaminan programa y se limpian al reiniciar runtime', () => {
	const p = compilarProgramaPLC(config('MOTOR := START\nAO1 := PV'), io);
	let r = actualizarRuntimePLC(p, undefined, entradas({}, 10), 0, true, { fuerzas: { DI: { START: true }, AO: { AO1: 75 } } }).runtime;
	assert.equal(r.salidas.digitales.MOTOR, true); assert.equal(r.salidas.analogicas.AO1, 75);
	assert.deepEqual(r.forzadas, ['AO:AO1', 'DI:START']);
	r = crearRuntimePLC(p);
	assert.deepEqual(r.fuerzas, {});
});

test('fuerzas DI/DO/AI/AO tienen precedencia explícita y trazable', () => {
	const p = compilarProgramaPLC(config('MOTOR := START\nAO1 := PV'), io);
	const r = actualizarRuntimePLC(p, undefined, entradas({}, 10), 0, true, { fuerzas: {
		DI: { START: true }, DO: { MOTOR: false }, AI: { PV: 33 }, AO: { AO1: 44 },
	} }).runtime;
	assert.equal(r.entradas.digitales.START, true); assert.equal(r.entradas.analogicas.PV.valor, 33);
	assert.equal(r.salidas.digitales.MOTOR, false); assert.equal(r.salidas.analogicas.AO1, 44);
	assert.deepEqual(r.forzadas, ['AI:PV', 'AO:AO1', 'DI:START', 'DO:MOTOR']);
	const parado = actualizarRuntimePLC(p, r, entradas({}, 10), 100, true, { modo: 'STOP', fuerzas: r.fuerzas }).runtime;
	assert.deepEqual(parado.forzadas, []); assert.deepEqual(parado.fuerzas, {});
	const reiniciado = actualizarRuntimePLC(p, r, entradas({}, 10), 100, true, { reiniciar: true, fuerzas: r.fuerzas }).runtime;
	assert.deepEqual(reiniciado.forzadas, []); assert.deepEqual(reiniciado.fuerzas, {});
});

test('event log omite scans normales y queda acotado a 200 eventos de tiempo simulado', () => {
	const p = compilarProgramaPLC(config('MOTOR := START'), io);
	let r = actualizarRuntimePLC(p, undefined, entradas(), 0, true).runtime;
	for (let i = 1; i <= 230; i++) {
		r = actualizarRuntimePLC(p, r, entradas(), i * 100, true, { modo: i % 2 ? 'STOP' : 'RUN' }).runtime;
	}
	assert.equal(r.eventos.length, 200);
	assert.ok(r.eventos.every((e) => e.tipo !== 'SCAN'));
	assert.ok(r.eventos.every((e, i, a) => i === 0 || e.instanteMs >= a[i - 1].instanteMs));
});

test('un error de runtime entra en FAULT con salidas seguras', () => {
	const p = compilarProgramaPLC(config('AO1 := 10 / PV\nMOTOR := START'), io);
	const r = actualizarRuntimePLC(p, undefined, entradas({ START: true }, 0), 0, true).runtime;
	assert.equal(r.estado, 'FAULT'); assert.equal(r.salidas.digitales.MOTOR, false); assert.equal(r.salidas.analogicas.AO1, 0);
	assert.match(r.errores[0], /División por cero/);
	assert.equal(r.diagnosticos[0]?.codigo, 'PROGRAM_ERROR');
});

test('watchdog de operaciones acota programas patológicos sin ejecutar código dinámico', () => {
	const suma = Array.from({ length: 70 }, () => '1').join(' + ');
	const p = compilarProgramaPLC(config(`AO1 := ${suma}`, { limites: { operacionesPorScan: 50 } }), io);
	const r = actualizarRuntimePLC(p, undefined, entradas(), 0, true).runtime;
	assert.equal(r.estado, 'FAULT'); assert.match(r.errores[0], /Watchdog/); assert.equal(r.salidas.analogicas.AO1, 0);
	assert.equal(r.diagnosticos[0]?.codigo, 'WATCHDOG');
});

test('varios PLC con cientos de tags reutilizan IR y completan miles de scans con memoria acotada', () => {
	const variables = Array.from({ length: 160 }, (_, i) => `VAR REAL M${i} = ${i}`);
	const asignaciones = Array.from({ length: 160 }, (_, i) => `M${i} := PV + ${i}`);
	const p = compilarProgramaPLC(config([...variables, ...asignaciones, 'AO1 := M159'].join('\n'),
		{ limites: { operacionesPorScan: 2_000, catchUpMaximo: 1 } }), io);
	assert.deepEqual(p.errores, []);
	const runtimes = Array.from({ length: 4 }, () => crearRuntimePLC(p));
	const inicio = performance.now();
	for (let scan = 0; scan < 1_000; scan++) for (let i = 0; i < runtimes.length; i++) {
		runtimes[i] = actualizarRuntimePLC(p, runtimes[i], entradas({}, scan % 100), scan * 100, true).runtime;
	}
	const duracion = performance.now() - inicio;
	assert.ok(runtimes.every((r) => r.scan === 1_000 && r.eventos.length <= 200));
	assert.ok(duracion < 15_000, `4 PLC × 160 tags × 1000 scans tardaron ${duracion.toFixed(0)} ms`);
});

test('programa inválido no ejecuta parcialmente: FAULT y salidas seguras', () => {
	const p = compilarProgramaPLC(config('MOTOR := START\nESTO NO EXISTE'), io);
	const r = actualizarRuntimePLC(p, undefined, entradas({ START: true }), 0, true).runtime;
	assert.equal(r.estado, 'FAULT'); assert.equal(r.salidas.digitales.MOTOR, false);
	assert.equal(r.diagnosticos[0]?.codigo, 'CONFIG_ERROR');
});

test('el adaptador legacy conserva el lenguaje histórico', () => {
	const p = compilarProgramaPLC({ version: 1, lenguaje: 'legacy', FUENTE: 'MOTOR = START', modoInicial: 'RUN' }, io);
	assert.equal(p.legacy?.reglas.length, 1);
	const r = actualizarRuntimePLC(p, undefined, entradas({ START: true }), 0, true).runtime;
	assert.equal(r.salidas.digitales.MOTOR, true);
});

test('bornes físicos con puntuación industrial no invalidan el adaptador legacy', () => {
	const industrial: IOProgramaPLC = { DI: ['MS/TP+', 'MS/TP-', 'UI1'], DO: [], AI: [], AO: ['AO1'] };
	const p = compilarProgramaPLC({
		version: 1, lenguaje: 'legacy', FUENTE: 'AO1 = 0 a 10 según UI1 de -40 a 80', modoInicial: 'RUN',
	}, industrial);
	assert.deepEqual(p.errores, []);
	assert.equal(p.etiquetas['MS/TP+'], undefined, 'el rótulo físico no se convierte en identificador ejecutable');
	assert.ok(p.etiquetas.UI1); assert.ok(p.etiquetas.AO1);
	const r = actualizarRuntimePLC(p, undefined, {
		digitales: {}, analogicas: { UI1: { valor: 80, calidad: 'normal', origen: 'calculado' } },
	}, 0, true).runtime;
	assert.equal(r.salidas.analogicas.AO1, 10);
});
