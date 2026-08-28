/**
 * Fixtures pequenos y calculables a mano de Fisica Electrica V5.
 *
 * La configuracion vive en las mismas entidades persistentes que usa cualquier proyecto. Ningun
 * id de estos ejemplos es conocido por el solver: solo ayudan a que una persona siga el circuito.
 */
import type { Borne, Conductor, Dispositivo, Proyecto, TipoBorne } from '../src/modelo/tipos.js';
import { crearProyecto } from '../src/modelo/proyecto.js';

const borne = (id: string, tipo: TipoBorne, maxConductores = 4): Borne => ({ id, tipo, maxConductores });
const extremo = (dispositivoId: string, borneId: string) => ({ dispositivoId, borneId });
const cable = (
	id: string,
	de: [string, string],
	a: [string, string],
	longitudManualM: number,
	seccion = 2.5,
	color = 'negro',
): Conductor => ({
	id, de: extremo(...de), a: extremo(...a), seccion, color,
	fisica: { material: 'COBRE', longitudManualM, temperaturaC: 20, xOhmPorKm: 0.08 },
});

const proteccion = (
	id: string,
	polos: [string, string][],
	inA: number,
	curva: 'B' | 'C' | 'D',
): Dispositivo => ({
	id, tipo: 'disyuntor', designacion: `-${id.toUpperCase()}`, congelado: true,
	descripcion: `Proteccion ${polos.length}P ${curva}${inA} · curva generica de ingenieria`,
	corrienteNominal: inA, curvaDisparo: curva,
	bornes: polos.flatMap(([entrada, salida]) => [borne(entrada, entrada.includes('N') ? 'N' : 'L'), borne(salida, salida.includes('N') ? 'N' : 'L')]),
	comportamiento: { version: 1, clase: 'proteccion', funcion: 'termomagnetico', rearmable: true,
		polos: polos.map(([entrada, salida]) => ({ entrada, salida })), contactos: [] },
	fisica: { version: 1, proteccion: { inA, curva } },
});

const gabinete = (colocaciones: NonNullable<Proyecto['gabinete']>['colocaciones']): Proyecto['gabinete'] => ({
	ancho: 560, alto: 420,
	rieles: [{ id: 'r1', x: 35, y: 105, largo: 490 }],
	canaletas: [{ id: 'c1', x: 25, y: 230, largo: 510, orientacion: 'h', ancho: 40, alto: 60 }],
	colocaciones,
});

/** 230 V, carga 23 ohm y tres tramos Cu de 20 m: las tendencias se comprueban sin numeros magicos. */
export function fixtureCaidaTensionV5(): Proyecto {
	const p = crearProyecto('Fixture V5 — caída de tensión', { frecuenciaHz: 50, temperaturaAmbienteC: 20, montajeGabinete: 'mural' });
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Caida de tension V5' }];
	p.dispositivos = [
		{
			id: 'red', tipo: 'otro', clase: 'W', campo: true, congelado: true, designacion: '-W1',
			descripcion: 'Fuente monofasica 230 V con Zs conocida', tensionNominal: 230,
			bornes: [borne('L', 'L', 5), borne('N', 'N', 5)],
			fisica: { version: 1, fuente: { sistema: 'AC_MONOFASICA', tensionNominalV: 230, frecuenciaHz: 50,
				referencia: 'N', fases: [{ borne: 'L', fase: 'L' }], rOhm: 0.05, xOhm: 0.02 } },
		},
		proteccion('q1', [['1', '2']], 16, 'C'),
		{
			id: 'r1', tipo: 'resistencia', designacion: '-R1', congelado: true,
			descripcion: 'Carga resistiva 23 ohm', tensionNominal: 230, corrienteNominal: 10,
			bornes: [borne('L', 'L'), borne('N', 'N')],
			comportamiento: { version: 1, clase: 'carga', efecto: 'calor',
				alimentacion: { fases: ['L'], retornos: ['N'], fasesMinimas: 1 } },
			fisica: { version: 1, carga: { modelo: 'CONSTANT_Z', terminales: ['L', 'N'], rOhm: 23 } },
		},
	];
	p.conductores = [
		cable('w-fase-entrada', ['red', 'L'], ['q1', '1'], 20, 2.5, 'marrón'),
		cable('w-fase-carga', ['q1', '2'], ['r1', 'L'], 20, 2.5, 'marrón'),
		cable('w-retorno', ['r1', 'N'], ['red', 'N'], 20, 2.5, 'azul'),
	];
	p.gabinete = gabinete([
		{ dispositivoId: 'q1', x: 90, y: 62, ancho: 45, alto: 82, rielId: 'r1' },
		{ dispositivoId: 'r1', x: 270, y: 60, ancho: 78, alto: 86, rielId: 'r1' },
	]);
	return p;
}

/** Fuente 400 V, automatico, contactor real y motor PQ balanceado en estrella. */
export function fixtureMotorTrifasicoV5(): Proyecto {
	const p = crearProyecto('Fixture V5 — motor trifásico', { frecuenciaHz: 50, temperaturaAmbienteC: 30, montajeGabinete: 'mural' });
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Motor trifasico V5' }];
	p.dispositivos = [
		{
			id: 'red', tipo: 'otro', clase: 'W', campo: true, congelado: true, designacion: '-W1',
			descripcion: 'Fuente trifasica 400/230 V, 50 Hz', tensionNominal: 400,
			bornes: [borne('L1', 'L', 5), borne('L2', 'L', 5), borne('L3', 'L', 5), borne('N', 'N', 5), borne('PE', 'PE', 5)],
			fisica: { version: 1, fuente: { sistema: 'AC_TRIFASICA', tensionNominalV: 400, frecuenciaHz: 50,
				referencia: 'N', fases: [{ borne: 'L1', fase: 'L1' }, { borne: 'L2', fase: 'L2' }, { borne: 'L3', fase: 'L3' }],
				rOhm: 0.08, xOhm: 0.04 } },
		},
		proteccion('q1', [['1', '2'], ['3', '4'], ['5', '6']], 16, 'C'),
		{
			id: 'km1', tipo: 'contactor', designacion: '-KM1', congelado: true, tensionNominal: 230,
			descripcion: 'Contactor de linea del motor',
			bornes: ['1/L1', '3/L2', '5/L3', '2/T1', '4/T2', '6/T3'].map((id) => borne(id, 'L'))
				.concat([borne('A1', 'control'), borne('A2', 'control')]),
			comportamiento: { version: 1, clase: 'contactos-electromagneticos', bobina: { entrada: 'A1', retorno: 'A2' },
				polos: [{ entrada: '1/L1', salida: '2/T1' }, { entrada: '3/L2', salida: '4/T2' }, { entrada: '5/L3', salida: '6/T3' }],
				contactos: [] },
		},
		{
			id: 's-run', tipo: 'selector', designacion: '-S1', congelado: true, descripcion: 'Selector MARCHA',
			bornes: [borne('13', 'control'), borne('14', 'control')],
			comportamiento: { version: 1, clase: 'mando', modo: 'mantenido', posiciones: 2, reposo: 0,
				contactos: [{ entrada: '13', salida: '14', reposo: 'abierto', funcion: 'auxiliar' }] },
		},
		{
			id: 'm1', tipo: 'motor', designacion: '-M1', campo: true, congelado: true,
			descripcion: 'Motor 5,5 kW, cos phi aproximado 0,9', tensionNominal: 400, corrienteNominal: 10,
			bornes: [borne('U', 'L'), borne('V', 'L'), borne('W', 'L'), borne('PE', 'PE')],
			comportamiento: { version: 1, clase: 'carga', efecto: 'giro',
				alimentacion: { fases: ['U', 'V', 'W'], retornos: [], fasesMinimas: 3 },
				dinamicaMotor: { polos: 4, tiempoArranqueS: 1.5, tiempoParadaS: 2, deslizamiento: 0.04 } },
			/* 23,56 + j11,40 ohm por fase representa aproximadamente 5,5 kW y cos phi 0,9 a 400 V.
			 * La impedancia hace que el consumo caiga con la tension, sin fingir un motor electromagnetico. */
			fisica: { version: 1, carga: { modelo: 'CONSTANT_Z', fases: ['U', 'V', 'W'], trifasica: true,
				rOhm: 23.56, xOhm: 11.4 } },
		},
	];
	p.conductores = [
		cable('w-l1-q', ['red', 'L1'], ['q1', '1'], 8, 4, 'marrón'),
		cable('w-l2-q', ['red', 'L2'], ['q1', '3'], 8, 4, 'negro'),
		cable('w-l3-q', ['red', 'L3'], ['q1', '5'], 8, 4, 'gris'),
		cable('w-q-k1', ['q1', '2'], ['km1', '1/L1'], 5, 4, 'marrón'),
		cable('w-q-k2', ['q1', '4'], ['km1', '3/L2'], 5, 4, 'negro'),
		cable('w-q-k3', ['q1', '6'], ['km1', '5/L3'], 5, 4, 'gris'),
		cable('w-k-m1', ['km1', '2/T1'], ['m1', 'U'], 18, 4, 'marrón'),
		cable('w-k-m2', ['km1', '4/T2'], ['m1', 'V'], 18, 4, 'negro'),
		cable('w-k-m3', ['km1', '6/T3'], ['m1', 'W'], 18, 4, 'gris'),
		cable('w-mando-l', ['q1', '2'], ['s-run', '13'], 4, 2.5, 'rojo'),
		cable('w-mando-k', ['s-run', '14'], ['km1', 'A1'], 4, 2.5, 'rojo'),
		cable('w-mando-n', ['km1', 'A2'], ['red', 'N'], 4, 2.5, 'azul'),
		cable('w-pe-motor', ['red', 'PE'], ['m1', 'PE'], 18, 4, 'verde/amarillo'),
	];
	p.gabinete = gabinete([
		{ dispositivoId: 'q1', x: 55, y: 58, ancho: 58, alto: 86, rielId: 'r1' },
		{ dispositivoId: 'km1', x: 180, y: 55, ancho: 58, alto: 90, rielId: 'r1' },
		{ dispositivoId: 's-run', x: 250, y: 275, ancho: 30, alto: 30, montaje: 'puerta' },
	]);
	return p;
}

/** Dos protecciones en serie y un PE real enlazado localmente a N para ensayos L-N/L-PE. */
export function fixtureSelectividadV5(): Proyecto {
	const p = crearProyecto('Fixture V5 — cortocircuito y selectividad', { frecuenciaHz: 50, temperaturaAmbienteC: 20, montajeGabinete: 'mural' });
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Icc y selectividad V5' }];
	p.dispositivos = [
		{
			id: 'red', tipo: 'otro', clase: 'W', campo: true, congelado: true, designacion: '-W1',
			descripcion: 'Fuente 230 V con union local N-PE declarada', tensionNominal: 230,
			bornes: [borne('L', 'L', 6), borne('N', 'N', 6), borne('PE', 'PE', 6)],
			fisica: { version: 1, fuente: { sistema: 'AC_MONOFASICA', tensionNominalV: 230, frecuenciaHz: 50,
				referencia: 'N', referenciaPe: 'PE', fases: [{ borne: 'L', fase: 'L' }], rOhm: 0.5, xOhm: 0.1 } },
		},
		proteccion('q1', [['1', '2']], 32, 'D'),
		proteccion('q2', [['1', '2']], 10, 'B'),
		{
			id: 'z1', tipo: 'resistencia', designacion: '-Z1', congelado: true, descripcion: 'Carga y punto de falla',
			tensionNominal: 230, bornes: [borne('L', 'L'), borne('N', 'N'), borne('PE', 'PE')],
			comportamiento: { version: 1, clase: 'carga', efecto: 'calor',
				alimentacion: { fases: ['L'], retornos: ['N'], fasesMinimas: 1 } },
			fisica: { version: 1, carga: { modelo: 'CONSTANT_Z', terminales: ['L', 'N'], rOhm: 46 } },
		},
	];
	p.conductores = [
		cable('w-red-q1', ['red', 'L'], ['q1', '1'], 10, 2.5, 'marrón'),
		cable('w-q1-q2', ['q1', '2'], ['q2', '1'], 10, 2.5, 'marrón'),
		cable('w-q2-z1', ['q2', '2'], ['z1', 'L'], 10, 2.5, 'marrón'),
		cable('w-z1-n', ['z1', 'N'], ['red', 'N'], 10, 2.5, 'azul'),
		cable('w-z1-pe', ['z1', 'PE'], ['red', 'PE'], 10, 2.5, 'verde/amarillo'),
	];
	p.gabinete = gabinete([
		{ dispositivoId: 'q1', x: 60, y: 60, ancho: 45, alto: 82, rielId: 'r1' },
		{ dispositivoId: 'q2', x: 175, y: 60, ancho: 45, alto: 82, rielId: 'r1' },
		{ dispositivoId: 'z1', x: 310, y: 62, ancho: 74, alto: 80, rielId: 'r1' },
	]);
	return p;
}
