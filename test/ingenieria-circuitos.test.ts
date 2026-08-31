import assert from 'node:assert/strict';
import test from 'node:test';
import { descubrirCircuitos } from '../src/ingenieria/circuitos.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import type { ComportamientoSimulacion } from '../src/modelo/comportamiento.js';
import type { Dispositivo, Proyecto, TipoBorne } from '../src/modelo/tipos.js';

const gabinete = { ancho: 400, alto: 400, rieles: [], canaletas: [], colocaciones: [] };
const borne = (id: string, tipo: TipoBorne = 'L') => ({ id, tipo });
const proyecto = (dispositivos: Dispositivo[], conductores: Proyecto['conductores']): Proyecto => ({
	formato: 'tablero-studio', version: 1, nombre: 'Gate A', hojas: [], gabinete,
	dispositivos, conductores,
});
const cable = (id: string, de: string, a: string): Proyecto['conductores'][number] => {
	const [dd, db] = de.split('::'); const [ad, ab] = a.split('::');
	return { id, de: { dispositivoId: dd, borneId: db }, a: { dispositivoId: ad, borneId: ab } };
};
const fuente = (id: string, sistema: 'AC_MONOFASICA' | 'DC' = 'AC_MONOFASICA'): Dispositivo => ({
	id, tipo: 'fuente', bornes: [borne('L'), borne('N', 'N')],
	comportamiento: { version: 1, clase: 'fuente', salidas: [
		{ borne: 'L', papel: 'fase', tensionV: sistema === 'DC' ? 24 : 230 },
		{ borne: 'N', papel: 'retorno', tensionV: 0 },
	] },
	fisica: { version: 1, fuente: { sistema, tensionNominalV: sistema === 'DC' ? 24 : 230,
		referencia: 'N', fases: [{ borne: 'L', fase: sistema === 'DC' ? 'POSITIVO' : 'L' }] } },
});
const proteccion = (id: string): Dispositivo => ({
	id, tipo: 'disyuntor', bornes: [borne('1'), borne('2')],
	/* Un proyecto legacy puede conservar el mismo polo en ambos contratos. */
	puentesInternos: [['1', '2']],
	comportamiento: { version: 1, clase: 'proteccion', polos: [{ entrada: '1', salida: '2' }],
		contactos: [], rearmable: true, funcion: 'termomagnetico' },
});
const mando = (id: string): Dispositivo => ({
	id, tipo: 'selector', bornes: [borne('13', 'control'), borne('14', 'control')],
	comportamiento: { version: 1, clase: 'mando', modo: 'mantenido', posiciones: 2, reposo: 0,
		contactos: [{ entrada: '13', salida: '14', reposo: 'abierto', funcion: 'auxiliar' }] },
});
const contactor = (id: string): Dispositivo => ({
	id, tipo: 'contactor', bornes: [borne('1'), borne('2'), borne('A1', 'control'), borne('A2', 'control')],
	comportamiento: { version: 1, clase: 'contactos-electromagneticos', bobina: { entrada: 'A1', retorno: 'A2' },
		polos: [{ entrada: '1', salida: '2' }], contactos: [] },
});
const carga = (id: string, tipo: 'motor' | 'piloto' = 'motor'): Dispositivo => ({
	id, tipo, bornes: [borne('U', tipo === 'piloto' ? 'control' : 'L'), borne('N', 'N')],
	comportamiento: { version: 1, clase: 'carga', alimentacion: { fases: ['U'], retornos: ['N'], fasesMinimas: 1 },
		efecto: tipo === 'motor' ? 'giro' : 'luz' },
});
const pasivo = (id: string): Dispositivo => ({
	id, tipo: 'bornero', bornes: [borne('a'), borne('b')],
	comportamiento: { version: 1, clase: 'pasivo', conexiones: [{ entrada: 'a', salida: 'b' }] },
});
const perfilVfd = (): ComportamientoSimulacion => ({ version: 1, clase: 'variador',
	alimentacion: { fases: ['L'], retornos: ['N'], fasesMinimas: 1 }, mando: { run: 'RUN' },
	referencia: { borne: 'AI', comun: 'COM', unidad: 'V', rango: [0, 10] },
	salida: { u: 'U', v: 'V', w: 'W', tensionV: 400 }, frecuencia: { minimaHz: 0, maximaHz: 50, rampaHzS: 10 } });

function tableroMotor(): Proyecto {
	return proyecto([fuente('red'), fuente('ps', 'DC'), proteccion('q1'), contactor('km1'), mando('s1'), carga('m1')], [
		cable('w1', 'red::L', 'q1::1'), cable('w2', 'q1::2', 'km1::1'), cable('w3', 'km1::2', 'm1::U'),
		cable('wn', 'red::N', 'm1::N'), cable('wc1', 'ps::L', 's1::13'), cable('wc2', 's1::14', 'km1::A1'),
		cable('wc0', 'ps::N', 'km1::A2'),
	]);
}

test('Gate A descubre circuito motor y control 24 VDC desde perfiles y conexiones reales', () => {
	const r = descubrirCircuitos(tableroMotor());
	const motor = r.circuitos.find((c) => c.cargas.includes('m1'))!;
	assert.equal(motor.estadoTopologia, 'INEQUIVOCA'); assert.equal(motor.fuenteId, 'red');
	assert.equal(motor.tipo, 'MOTOR'); assert.deepEqual(motor.protecciones, ['q1']);
	assert.deepEqual(motor.maniobra, ['km1']); assert.deepEqual(motor.conductores, ['w1', 'w2', 'w3']);
	const bobina = r.circuitos.find((c) => c.cargas.includes('km1'))!;
	assert.equal(bobina.tipo, 'CONTROL_DC'); assert.equal(bobina.fuenteId, 'ps');
	assert.deepEqual(bobina.maniobra, ['km1', 's1']);
});

test('Gate A identifica VFD como frontera energética y enlaza su circuito de motor como subcircuito', () => {
	const vfd: Dispositivo = { id: 'vfd', tipo: 'variador', bornes: ['L', 'N', 'RUN', 'AI', 'COM', 'U', 'V', 'W']
		.map((id) => borne(id, ['AI', 'COM'].includes(id) ? 'senal' : id === 'N' ? 'N' : 'L')),
		comportamiento: perfilVfd() };
	const p = proyecto([fuente('red'), vfd, carga('m1')], [
		cable('in', 'red::L', 'vfd::L'), cable('ret', 'red::N', 'vfd::N'), cable('out', 'vfd::U', 'm1::U'),
	]);
	const r = descubrirCircuitos(p); const entrada = r.circuitos.find((c) => c.cargas.includes('vfd'))!;
	const motor = r.circuitos.find((c) => c.cargas.includes('m1'))!;
	assert.equal(entrada.tipo, 'VFD'); assert.equal(entrada.fuenteId, 'red');
	assert.equal(motor.tipo, 'VFD'); assert.equal(motor.fuenteId, 'vfd');
	assert.deepEqual(entrada.subcircuitos, [motor.id]);
});

test('Gate A separa ramas por carga aunque compartan fuente y protección', () => {
	const p = proyecto([fuente('red'), proteccion('q1'), carga('m1'), carga('h1', 'piloto')], [
		cable('w1', 'red::L', 'q1::1'), cable('w2', 'q1::2', 'm1::U'), cable('w3', 'q1::2', 'h1::U'),
	]);
	const r = descubrirCircuitos(p); const ramas = r.circuitos.filter((c) => c.fuenteId === 'red');
	assert.deepEqual(ramas.map((c) => c.cargas[0]).sort(), ['h1', 'm1']);
	assert.ok(ramas.every((c) => c.protecciones.includes('q1')));
});

test('Gate A no inventa jerarquía ante múltiples fuentes o caminos paralelos', () => {
	const multi = proyecto([fuente('f1'), fuente('f2'), carga('m1')], [
		cable('a', 'f1::L', 'm1::U'), cable('b', 'f2::L', 'm1::U'),
	]);
	const cm = descubrirCircuitos(multi).circuitos[0];
	assert.equal(cm.estadoTopologia, 'AMBIGUA'); assert.equal(cm.fuenteId, undefined);
	assert.deepEqual(cm.fuentes, ['f1', 'f2']); assert.match(cm.ambiguedades.join(), /MULTIPLE_SOURCES/);

	const loop = proyecto([fuente('f1'), pasivo('x1'), pasivo('x2'), carga('m1')], [
		cable('a1', 'f1::L', 'x1::a'), cable('a2', 'x1::b', 'm1::U'),
		cable('b1', 'f1::L', 'x2::a'), cable('b2', 'x2::b', 'm1::U'),
	]);
	const cl = descubrirCircuitos(loop).circuitos[0];
	assert.equal(cl.estadoTopologia, 'AMBIGUA'); assert.match(cl.ambiguedades.join(), /CAMINOS_PARALELOS/);
});

test('Gate A es determinista al invertir arrays y conserva IDs basados en identidades', () => {
	const p = tableroMotor(); const a = descubrirCircuitos(p);
	const invertido = structuredClone(p); invertido.dispositivos.reverse(); invertido.conductores.reverse();
	const b = descubrirCircuitos(invertido);
	assert.deepEqual(b, a);
	assert.ok(a.circuitos.every((c) => !/circuito:\d/.test(c.id)));
});

test('Gate A abre proyectos V6 sin metadata y persiste solo decisiones V7', () => {
	const v6 = cargarProyecto(JSON.stringify(tableroMotor())).proyecto;
	assert.equal(v6.ingenieria, undefined); const circuito = descubrirCircuitos(v6).circuitos.find((c) => c.cargas[0] === 'm1')!;
	v6.ingenieria = { version: 1, criterios: { maxVoltageDropPercent: 3 }, circuitos: {
		[circuito.id]: { version: 1, nombre: 'Bomba principal', tipo: 'MOTOR', criterios: { maxLossW: 12 } },
	} };
	const recargado = cargarProyecto(JSON.stringify(v6)).proyecto;
	const resultado = descubrirCircuitos(recargado).circuitos.find((c) => c.id === circuito.id)!;
	assert.equal(resultado.nombre, 'Bomba principal'); assert.equal(resultado.tipo, 'MOTOR');
	assert.deepEqual(resultado.criterios, { maxVoltageDropPercent: 3, maxLossW: 12 });
	assert.doesNotMatch(JSON.stringify(recargado.ingenieria), /trayectos|conductores|issues|magnitudes/);
});
