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

test('fixture secuencial: START → llenar → agitar → vaciar → reposo por cableado', () => {
	const s = sesion(fixtureAutomatizacionSecuencialV4());
	let r = s.paso(0);
	assert.equal(plc(r).secuencias.PROCESO, 'REPOSO'); assert.equal(funciona(r, 'agitador'), false);
	r = s.paso(100, { start: { activo: true } });
	assert.equal(plc(r).secuencias.PROCESO, 'LLENANDO'); assert.equal(funciona(r, 'valvula-llenado'), true);
	r = s.paso(200);
	r = s.paso(300, { 'nivel-alto': { activo: true } });
	assert.equal(plc(r).secuencias.PROCESO, 'AGITANDO'); assert.equal(funciona(r, 'agitador'), true);
	r = s.paso(2400, { 'nivel-alto': { activo: true } });
	assert.equal(plc(r).secuencias.PROCESO, 'VACIANDO'); assert.equal(funciona(r, 'valvula-vaciado'), true);
	r = s.paso(2500, { 'nivel-bajo': { activo: true } });
	assert.equal(plc(r).secuencias.PROCESO, 'REPOSO'); assert.equal(funciona(r, 'valvula-vaciado'), false);
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
	r = s.paso(500, { reset: { activo: true }, plc: { plc: { resetAlarmas: ['PARADA_PROCESO'] } } });
	assert.equal(plc(r).secuencias.PROCESO, 'REPOSO');
	assert.equal(plc(r).alarmas.PARADA_PROCESO.activa, false);
	assert.equal(funciona(r, 'agitador'), false, 'rearmar no crea una orden START');
});

test('interlock de nivel inhibe llenado y publica diagnóstico, no un fallo oculto', () => {
	const s = sesion(fixtureAutomatizacionSecuencialV4());
	s.paso(0);
	const r = s.paso(100, { start: { activo: true }, 'nivel-alto': { activo: true } });
	assert.equal(funciona(r, 'valvula-llenado'), false);
	assert.equal(plc(r).interlocks.find((i) => i.salida === 'DO_FILL')?.activo, true);
	assert.match(plc(r).interlocks.find((i) => i.salida === 'DO_FILL')!.mensaje, /Nivel alto/);
});

test('programa, tags y scan sobreviven guardar/cargar; runtime y fuerzas no se persisten', () => {
	const original = fixturePIDV4();
	const json = JSON.stringify(original);
	assert.doesNotMatch(json, /primerScanPendiente|temporizadores|forzadas/);
	const cargado = cargarProyecto(json).proyecto;
	const a = original.dispositivos.find((d) => d.id === 'plc')!.programaPLC!;
	const b = cargado.dispositivos.find((d) => d.id === 'plc')!.programaPLC!;
	assert.deepEqual(JSON.parse(JSON.stringify(b)), JSON.parse(JSON.stringify(a)));
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

test('programa inválido integrado deja PLC en FAULT y sus salidas seguras', () => {
	const p = fixtureAutomatizacionSecuencialV4();
	p.dispositivos.find((d) => d.id === 'plc')!.programaPLC!.FUENTE += '\nDO_FILL := DESCONOCIDA';
	const r = sesion(p).paso(0, { start: { activo: true } });
	assert.equal(plc(r).estado, 'FAULT'); assert.deepEqual(plc(r).salidas, []);
	assert.ok(r.avisos.some((a) => /DESCONOCIDA|desconocida/i.test(a)));
});
