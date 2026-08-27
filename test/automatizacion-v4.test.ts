import test from 'node:test';
import assert from 'node:assert/strict';

import { fixtureAutomatizacionSecuencialV4, fixturePIDV4 } from '../ejemplo/fixtures-automatizacion-v4.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import type { Dispositivo, Proyecto } from '../src/modelo/tipos.js';
import { memoriaVacia, simular, type EstadoTablero, type ResultadoSimulacion } from '../src/motores/simulacion.js';

function sesion(proyecto: Proyecto) {
	const reloj = { ahora: 0, memoria: memoriaVacia() };
	let previos = new Set<string>();
	let ultimo: ResultadoSimulacion;
	return {
		paso(ahora: number, estado: EstadoTablero = {}) {
			reloj.ahora = ahora;
			ultimo = simular(proyecto, estado, previos, reloj);
			previos = ultimo.activos;
			return ultimo;
		},
		memoria: reloj.memoria,
	};
}

const plc = (r: ResultadoSimulacion) => r.controladores.find((c) => c.dispositivoId === 'plc')!;
const funciona = (r: ResultadoSimulacion, id: string) => r.funcionando.some((x) => x.dispositivoId === id);

test('fixture secuencial: START → llenar → mezclar → vaciar → completo, con TON y lote por cableado', () => {
	const s = sesion(fixtureAutomatizacionSecuencialV4());
	let r = s.paso(0);
	assert.equal(plc(r).secuencias.PROCESO, 'IDLE'); assert.equal(funciona(r, 'agitador'), false);
	r = s.paso(100, { start: { activo: true } });
	assert.equal(plc(r).secuencias.PROCESO, 'LLENANDO'); assert.equal(funciona(r, 'valvula-llenado'), true);
	assert.equal(funciona(r, 'piloto-marcha'), true);
	r = s.paso(200);
	r = s.paso(300, { 'nivel-alto': { activo: true } });
	assert.equal(plc(r).secuencias.PROCESO, 'MEZCLANDO'); assert.equal(funciona(r, 'agitador'), true);
	r = s.paso(400, { 'nivel-alto': { activo: true } });
	assert.equal(plc(r).temporizadores.T_MEZCLA.IN, true);
	assert.equal(plc(r).temporizadores.T_MEZCLA.PT, 5000);
	r = s.paso(5400, { 'nivel-alto': { activo: true } });
	assert.equal(plc(r).secuencias.PROCESO, 'VACIANDO'); assert.equal(funciona(r, 'valvula-vaciado'), true);
	r = s.paso(5500, { 'nivel-alto': { activo: false }, 'nivel-bajo': { activo: true } });
	assert.equal(plc(r).secuencias.PROCESO, 'COMPLETO'); assert.equal(funciona(r, 'valvula-vaciado'), false);
	assert.equal(funciona(r, 'piloto-completo'), true);
	r = s.paso(5600, { 'nivel-bajo': { activo: true } });
	assert.equal(plc(r).contadores.LOTES.CV, 1);
	assert.equal(plc(r).contadores.LOTES.PV, 3);
	assert.equal(plc(r).detalleSecuencias.PROCESO.anterior, 'VACIANDO');
	assert.match(plc(r).detalleSecuencias.PROCESO.transicion!, /VACIANDO.*COMPLETO/);
});

test('STOP prioritario lleva a fallo, alarma y salida física; ACK/reset no arrancan el ciclo', () => {
	const s = sesion(fixtureAutomatizacionSecuencialV4());
	s.paso(0); s.paso(100, { start: { activo: true } }); s.paso(200);
	let r = s.paso(300, { stop: { activo: true } });
	assert.equal(plc(r).secuencias.PROCESO, 'FALLO');
	assert.equal(plc(r).alarmas.PARADA_PROCESO.activa, true);
	assert.equal(funciona(r, 'piloto-fallo'), true);
	r = s.paso(400, { plc: { plc: { ackAlarmas: ['PARADA_PROCESO'] } } });
	assert.equal(plc(r).alarmas.PARADA_PROCESO.reconocida, true);
	r = s.paso(500, { reset: { activo: true } });
	assert.equal(plc(r).secuencias.PROCESO, 'IDLE');
	assert.equal(plc(r).alarmas.PARADA_PROCESO.activa, true, 'la alarma enclavada espera reset tras desaparecer la causa');
	r = s.paso(600, { plc: { plc: { resetAlarmas: ['PARADA_PROCESO'] } } });
	assert.equal(plc(r).alarmas.PARADA_PROCESO.activa, false);
	assert.equal(funciona(r, 'agitador'), false, 'rearmar no crea una orden START');
});

test('interlock de nivel inhibe llenado y publica diagnóstico, no un fallo oculto', () => {
	const s = sesion(fixtureAutomatizacionSecuencialV4());
	s.paso(0);
	const r = s.paso(100, { start: { activo: true }, 'nivel-alto': { activo: true } });
	assert.equal(funciona(r, 'valvula-llenado'), false);
	assert.equal(plc(r).interlocks.find((i) => i.salida === 'DO_FILL')?.activo, true);
	assert.match(plc(r).interlocks.find((i) => i.salida === 'DO_FILL')!.mensaje, /nivel alto/i);
});

test('sensores de nivel contradictorios generan fallo seguro y alarma de origen explícito', () => {
	const s = sesion(fixtureAutomatizacionSecuencialV4());
	s.paso(0);
	const r = s.paso(100, { 'nivel-alto': { activo: true }, 'nivel-bajo': { activo: true } });
	assert.equal(plc(r).secuencias.PROCESO, 'FALLO');
	assert.equal(plc(r).alarmas.FALLO_SENSOR.activa, true);
	assert.deepEqual(plc(r).salidas.sort(), ['DO_ALARM']);
	assert.equal(funciona(r, 'piloto-fallo'), true);
});

test('programa, tags y scan sobreviven guardar/cargar; runtime y fuerzas no se persisten', () => {
	const original = fixturePIDV4();
	const json = JSON.stringify(original);
	assert.doesNotMatch(json, /primerScanPendiente|temporizadores|forzadas/);
	const cargado = cargarProyecto(json).proyecto;
	const a = original.dispositivos.find((d) => d.id === 'plc')!.programaPLC!;
	const b = cargado.dispositivos.find((d) => d.id === 'plc')!.programaPLC!;
	assert.deepEqual(JSON.parse(JSON.stringify(b)), JSON.parse(JSON.stringify(a)));
	assert.equal(b.etiquetas?.find((e) => e.nombre === 'CV')?.seguro, 0);
	const r = sesion(cargado).paso(0, { lt: { valor: 0 } });
	assert.equal(plc(r).estado, 'RUN'); assert.equal(plc(r).salidasAnalogicas.AO1, 100);
});

test('PID cableado lleva PV con calidad a AO y a la válvula; lazo abierto aplica valor seguro', () => {
	const p = fixturePIDV4(); const s = sesion(p);
	let r = s.paso(0, { lt: { valor: 0 } });
	assert.equal(plc(r).sondas.PV, 0); assert.equal(plc(r).salidasAnalogicas.AO1, 100);
	assert.equal(r.salidasAnalogicas.get('plc::AO1')?.valor, 10);
	assert.equal(r.actuadores.find((a) => a.dispositivoId === 'yv')?.posicionObjetivo, 100);
	r = s.paso(100, { lt: { valor: 50, fallos: ['circuito-analogico-abierto'] } });
	assert.equal(plc(r).salidasAnalogicas.AO1, 0);
	assert.equal(plc(r).entradasAnalogicas[0].senal.calidad, 'circuito-abierto');
});

test('PLC personalizado con imagen y el mismo perfil ejecuta el mismo runtime', () => {
	const nativo = fixtureAutomatizacionSecuencialV4();
	const personalizado = fixtureAutomatizacionSecuencialV4();
	const d = personalizado.dispositivos.find((x) => x.id === 'plc')!;
	d.tipo = 'otro'; d.imagen = 'data:image/png;base64,iVBORw0KGgo=';
	const a = sesion(nativo); const b = sesion(personalizado);
	a.paso(0); b.paso(0);
	const ra = a.paso(100, { start: { activo: true } });
	const rb = b.paso(100, { start: { activo: true } });
	assert.deepEqual({ estado: plc(rb).estado, secuencia: plc(rb).secuencias, salidas: plc(rb).salidas },
		{ estado: plc(ra).estado, secuencia: plc(ra).secuencias, salidas: plc(ra).salidas });
});

test('invertir dispositivos y conductores no cambia el scan ni las salidas', () => {
	const a = fixtureAutomatizacionSecuencialV4();
	const b = fixtureAutomatizacionSecuencialV4(); b.dispositivos.reverse(); b.conductores.reverse();
	const sa = sesion(a); const sb = sesion(b); sa.paso(0); sb.paso(0);
	const ra = sa.paso(100, { start: { activo: true } });
	const rb = sb.paso(100, { start: { activo: true } });
	assert.deepEqual({ secuencia: plc(rb).secuencias, salidas: plc(rb).salidas, scan: plc(rb).scan },
		{ secuencia: plc(ra).secuencias, salidas: plc(ra).salidas, scan: plc(ra).scan });
});

function agregarSegundoPLC(p: Proyecto): void {
	const plc2: Dispositivo = {
		id: 'plc2', tipo: 'plc', designacion: '-A2', bornes: ['+24', '0V', 'CASCADE', 'DO2'].map((id) => ({ id, tipo: 'control' })),
		comportamiento: { version: 1, clase: 'controlador', alimentacion: { entradas: ['+24'], retornos: ['0V'] },
			salidasDigitales: [{ borne: 'DO2', comun: '+24' }], salidasAnalogicas: [] },
		programaPLC: { version: 1, lenguaje: 'tablerostudio-plc-v4', FUENTE: 'DO2 := CASCADE', periodoScanMs: 100, modoInicial: 'RUN' },
	};
	p.dispositivos.push(plc2, {
		id: 'h2', tipo: 'piloto', designacion: '-H2', tensionNominal: 24, bornes: [{ id: '+' }, { id: '-' }],
		comportamiento: { version: 1, clase: 'carga', alimentacion: { fases: ['+'], retornos: ['-'], fasesMinimas: 1 }, efecto: 'luz' },
	});
	p.conductores.push(
		{ id: 'm1', de: { dispositivoId: 'ps24', borneId: '+24' }, a: { dispositivoId: 'plc2', borneId: '+24' } },
		{ id: 'm2', de: { dispositivoId: 'ps24', borneId: '0V' }, a: { dispositivoId: 'plc2', borneId: '0V' } },
		{ id: 'm3', de: { dispositivoId: 'plc', borneId: 'DO_FILL' }, a: { dispositivoId: 'plc2', borneId: 'CASCADE' } },
		{ id: 'm4', de: { dispositivoId: 'plc2', borneId: 'DO2' }, a: { dispositivoId: 'h2', borneId: '+' } },
		{ id: 'm5', de: { dispositivoId: 'h2', borneId: '-' }, a: { dispositivoId: 'ps24', borneId: '0V' } },
	);
}

test('dos PLC capturan juntos: el segundo no ve la DO nueva hasta el scan siguiente y el orden no influye', () => {
	const a = fixtureAutomatizacionSecuencialV4(); const b = fixtureAutomatizacionSecuencialV4();
	agregarSegundoPLC(a); agregarSegundoPLC(b); b.dispositivos.reverse(); b.conductores.reverse();
	const sa = sesion(a); const sb = sesion(b); sa.paso(0); sb.paso(0);
	let ra = sa.paso(100, { start: { activo: true } }); let rb = sb.paso(100, { start: { activo: true } });
	assert.deepEqual(ra.controladores.find((c) => c.dispositivoId === 'plc2')!.salidas, []);
	assert.deepEqual(rb.controladores.find((c) => c.dispositivoId === 'plc2')!.salidas, []);
	ra = sa.paso(200); rb = sb.paso(200);
	assert.deepEqual(ra.controladores.find((c) => c.dispositivoId === 'plc2')!.salidas, ['DO2']);
	assert.deepEqual(rb.controladores.find((c) => c.dispositivoId === 'plc2')!.salidas, ['DO2']);
});

test('RUN/STOP, pausa, scan único y fuerzas se operan como runtime de Energizar', () => {
	const s = sesion(fixtureAutomatizacionSecuencialV4());
	let r = s.paso(0, { plc: { plc: { modo: 'STOP' } } });
	assert.equal(plc(r).estado, 'STOP'); assert.deepEqual(plc(r).salidas, []);
	r = s.paso(100, { plc: { plc: { modo: 'RUN', pausado: true } } });
	const scan = plc(r).scan;
	r = s.paso(200, { plc: { plc: { modo: 'RUN', pausado: true, fuerzas: { DI: { START: true } } } } });
	assert.equal(plc(r).scan, scan); assert.ok(plc(r).forzadas.includes('DI:START'));
	r = s.paso(200, { plc: { plc: { modo: 'RUN', pausado: true, paso: true, fuerzas: { DI: { START: true } } } } });
	assert.equal(plc(r).scan, scan + 1); assert.equal(plc(r).secuencias.PROCESO, 'LLENANDO');
});

test('power cycle físico detiene scans, publica seguro y recupera con FIRST_SCAN sin salida vieja', () => {
	const p = fixtureAutomatizacionSecuencialV4(); const s = sesion(p);
	let r = s.paso(0); const inicial = plc(r).scan;
	r = s.paso(100, { start: { activo: true } });
	assert.equal(plc(r).secuencias.PROCESO, 'LLENANDO'); assert.ok(plc(r).scan > inicial);
	const alimentacion = p.conductores.find((c) => c.id === 'w-plc-p')!;
	p.conductores = p.conductores.filter((c) => c !== alimentacion);
	r = s.paso(200); const sin24 = plc(r).scan;
	assert.equal(plc(r).estado, 'SIN_ALIMENTACION'); assert.deepEqual(plc(r).salidas, []);
	r = s.paso(1_200); assert.equal(plc(r).scan, sin24); assert.deepEqual(plc(r).temporizadores, {});
	p.conductores.push(alimentacion);
	r = s.paso(1_300);
	assert.equal(plc(r).estado, 'RUN'); assert.equal(plc(r).variables.FIRST_SCAN, true);
	assert.equal(plc(r).secuencias.PROCESO, 'IDLE'); assert.deepEqual(plc(r).salidas, []);
	r = s.paso(1_400); assert.equal(plc(r).variables.FIRST_SCAN, false);
});

test('watch table integrada publica aliases, canales físicos, calidad y estado forzado', () => {
	const p = fixturePIDV4(); const s = sesion(p);
	const r = s.paso(0, { lt: { valor: 50 }, plc: { plc: { fuerzas: { AO: { AO1: 25 } } } } });
	const c = plc(r); const pv = c.tags.find((t) => t.nombre === 'PV')!; const cv = c.tags.find((t) => t.nombre === 'CV')!;
	assert.deepEqual({ clase: pv.clase, borne: pv.borne, valor: pv.valor, calidad: pv.calidad },
		{ clase: 'AI', borne: 'AI1', valor: 50, calidad: 'normal' });
	assert.deepEqual({ clase: cv.clase, borne: cv.borne, valor: cv.valor, forzada: cv.forzada },
		{ clase: 'AO', borne: 'AO1', valor: 25, forzada: true });
	assert.equal(c.pids.NIVEL.salida >= 0, true);
	assert.equal(r.salidasAnalogicas.get('plc::AO1')?.senal.origen, 'inyectado');
});

test('watch table proyecta valores runtime de timers, counters, secuencias y alarmas', () => {
	const s = sesion(fixtureAutomatizacionSecuencialV4()); let r = s.paso(0);
	const valor = (nombre: string) => plc(r).tags.find((t) => t.nombre === nombre)?.valor;
	assert.equal(valor('PROCESO.IDLE'), true); assert.equal(valor('PROCESO.LLENANDO'), false);
	r = s.paso(100, { start: { activo: true } });
	assert.equal(valor('PROCESO.IDLE'), false); assert.equal(valor('PROCESO.LLENANDO'), true);
	r = s.paso(200, { 'nivel-alto': { activo: true } }); r = s.paso(300, { 'nivel-alto': { activo: true } });
	assert.equal(valor('T_MEZCLA.Q'), false); assert.equal(valor('T_MEZCLA.ET'), 0.1);
	r = s.paso(400, { stop: { activo: true } });
	assert.equal(valor('ALARM.PARADA_PROCESO'), true);
});

test('programa inválido integrado deja PLC en FAULT y sus salidas seguras', () => {
	const p = fixtureAutomatizacionSecuencialV4();
	p.dispositivos.find((d) => d.id === 'plc')!.programaPLC!.FUENTE += '\nDO_FILL := DESCONOCIDA';
	const r = sesion(p).paso(0, { start: { activo: true } });
	assert.equal(plc(r).estado, 'FAULT'); assert.deepEqual(plc(r).salidas, []);
	assert.ok(r.avisos.some((a) => /DESCONOCIDA|desconocida/i.test(a)));
});
