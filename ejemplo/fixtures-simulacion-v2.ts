/**
 * Fixtures pequeños y estables de Simulación Industrial V2.
 *
 * Son proyectos normales, serializables y visibles en la biblioteca. Los perfiles declaran la
 * función eléctrica; ningún id, rótulo o aspecto 3D participa en el resultado del motor.
 */
import type { ComportamientoSimulacion } from '../src/modelo/comportamiento.js';
import type { Borne, Conductor, Dispositivo, Proyecto, TipoBorne } from '../src/modelo/tipos.js';
import { crearProyecto } from '../src/modelo/proyecto.js';

const extremo = (dispositivoId: string, borneId: string) => ({ dispositivoId, borneId });
const cable = (id: string, de: [string, string], a: [string, string], seccion = 1, color = 'negro'): Conductor => ({
	id, de: extremo(...de), a: extremo(...a), seccion, color,
});
const bornes = (ids: string[], tipo: TipoBorne = 'control', maxConductores = 3): Borne[] =>
	ids.map((id) => ({ id, tipo, maxConductores }));
const perfilProteccion = (
	funcion: 'termico' | 'termomagnetico',
	polos: [string, string][],
	contactos: Extract<ComportamientoSimulacion, { clase: 'proteccion' }>['contactos'] = [],
): Extract<ComportamientoSimulacion, { clase: 'proteccion' }> => ({
	version: 1, clase: 'proteccion', funcion, rearmable: true,
	polos: polos.map(([entrada, salida]) => ({ entrada, salida })), contactos,
});

const base = (nombre: string): Proyecto => {
	const p = crearProyecto(nombre, { frecuenciaHz: 50, iccPresuntaKA: 6, temperaturaAmbienteC: 35, montajeGabinete: 'mural' });
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Simulación industrial V2' }];
	return p;
};

/** DOL cableado: START/STOP, enclavamiento, térmico, MARCHA y FALLO. */
export function fixtureFallosIndustriales(): Proyecto {
	const p = base('Fixture V2 — fallos de motor y relé térmico');
	const dispositivos: Dispositivo[] = [
		{
			id: 'red', tipo: 'otro', clase: 'W', designacion: '-W1', congelado: true, campo: true,
			descripcion: 'Red 400/230 V 3F+N', tensionNominal: 400,
			bornes: [...bornes(['L1', 'L2', 'L3'], 'L', 5), ...bornes(['N'], 'N', 5)],
		},
		{
			id: 'q1', tipo: 'disyuntor', designacion: '-Q1', congelado: true,
			descripcion: 'Disyuntor general 3P', tensionNominal: 400, corrienteNominal: 16, curvaDisparo: 'C',
			bornes: bornes(['1', '2', '3', '4', '5', '6'], 'L'),
			comportamiento: perfilProteccion('termomagnetico', [['1', '2'], ['3', '4'], ['5', '6']]),
		},
		{
			id: 'km1', tipo: 'contactor', designacion: '-KM1', congelado: true,
			descripcion: 'Contactor de línea', tensionNominal: 230,
			bornes: [...bornes(['1/L1', '3/L2', '5/L3', '2/T1', '4/T2', '6/T3'], 'L'), ...bornes(['A1', 'A2', '13', '14'])],
			comportamiento: {
				version: 1, clase: 'contactos-electromagneticos', bobina: { entrada: 'A1', retorno: 'A2' },
				polos: [
					{ entrada: '1/L1', salida: '2/T1' }, { entrada: '3/L2', salida: '4/T2' },
					{ entrada: '5/L3', salida: '6/T3' },
				],
				contactos: [{ entrada: '13', salida: '14', reposo: 'abierto', funcion: 'auxiliar' }],
			},
		},
		{
			id: 'f2', tipo: 'rele', clase: 'F', designacion: '-F2', congelado: true,
			descripcion: 'Relé térmico con alarma 95-96 / 97-98', corrienteNominal: 4, rangoRegulacionA: [2.5, 4],
			bornes: [...bornes(['1', '2', '3', '4', '5', '6'], 'L'), ...bornes(['95', '96', '97', '98'])],
			comportamiento: perfilProteccion('termico', [['1', '2'], ['3', '4'], ['5', '6']], [
				{ entrada: '95', salida: '96', reposo: 'cerrado', funcion: 'auxiliar' },
				{ entrada: '97', salida: '98', reposo: 'abierto', funcion: 'auxiliar' },
			]),
		},
		{
			id: 'm1', tipo: 'motor', designacion: '-M1', congelado: true, campo: true,
			descripcion: 'Motor trifásico 1,5 kW, 4 polos', tensionNominal: 400, corrienteNominal: 3.4,
			bornes: bornes(['U', 'V', 'W'], 'L'),
			comportamiento: {
				version: 1, clase: 'carga', efecto: 'giro',
				alimentacion: { fases: ['U', 'V', 'W'], retornos: [], fasesMinimas: 3 },
				dinamicaMotor: { polos: 4, tiempoArranqueS: 1, tiempoParadaS: 2, deslizamiento: 0.04 },
			},
		},
		{
			id: 's0', tipo: 'pulsador', designacion: '-S0', congelado: true, descripcion: 'PARO NC',
			bornes: bornes(['11', '12']),
			comportamiento: { version: 1, clase: 'mando', modo: 'momentaneo', posiciones: 2, reposo: 0,
				contactos: [{ entrada: '11', salida: '12', reposo: 'cerrado', funcion: 'auxiliar' }] },
		},
		{
			id: 's1', tipo: 'pulsador', designacion: '-S1', congelado: true, descripcion: 'MARCHA NA',
			bornes: bornes(['13', '14']),
			comportamiento: { version: 1, clase: 'mando', modo: 'momentaneo', posiciones: 2, reposo: 0,
				contactos: [{ entrada: '13', salida: '14', reposo: 'abierto', funcion: 'auxiliar' }] },
		},
		...(['marcha', 'fallo'] as const).map((funcion): Dispositivo => ({
			id: `h-${funcion}`, tipo: 'piloto', designacion: funcion === 'marcha' ? '-H1' : '-H2', congelado: true,
			descripcion: `Piloto ${funcion.toUpperCase()}`, colorSenal: funcion === 'marcha' ? 'verde' : 'rojo',
			tensionNominal: 230, corrienteNominal: 0.02, bornes: bornes(['X1', 'X2']),
			comportamiento: { version: 1, clase: 'carga', efecto: 'luz',
				alimentacion: { fases: ['X1'], retornos: ['X2'], fasesMinimas: 1 } },
		})),
	];
	p.dispositivos = dispositivos;
	p.conductores = [
		// Fuerza: red → Q1 → KM1 → F2 → motor.
		cable('w-l1-q', ['red', 'L1'], ['q1', '1'], 2.5, 'marrón'), cable('w-l2-q', ['red', 'L2'], ['q1', '3'], 2.5, 'negro'),
		cable('w-l3-q', ['red', 'L3'], ['q1', '5'], 2.5, 'gris'), cable('w-q-k1', ['q1', '2'], ['km1', '1/L1'], 2.5, 'marrón'),
		cable('w-q-k2', ['q1', '4'], ['km1', '3/L2'], 2.5, 'negro'), cable('w-q-k3', ['q1', '6'], ['km1', '5/L3'], 2.5, 'gris'),
		cable('w-k-f1', ['km1', '2/T1'], ['f2', '1'], 2.5, 'marrón'), cable('w-k-f2', ['km1', '4/T2'], ['f2', '3'], 2.5, 'negro'),
		cable('w-k-f3', ['km1', '6/T3'], ['f2', '5'], 2.5, 'gris'), cable('w-f-m1', ['f2', '2'], ['m1', 'U'], 2.5, 'marrón'),
		cable('w-f-m2', ['f2', '4'], ['m1', 'V'], 2.5, 'negro'), cable('w-f-m3', ['f2', '6'], ['m1', 'W'], 2.5, 'gris'),
		// Mando: STOP → 95-96 → START/KM1 13-14 → bobina.
		cable('w-c0', ['red', 'L1'], ['s0', '11']), cable('w-c1', ['s0', '12'], ['f2', '95']),
		cable('w-c2', ['f2', '96'], ['s1', '13']), cable('w-c3', ['s1', '14'], ['km1', 'A1']),
		cable('w-hold1', ['f2', '96'], ['km1', '13']), cable('w-hold2', ['km1', '14'], ['km1', 'A1']),
		cable('w-a2', ['km1', 'A2'], ['red', 'N'], 1, 'azul'),
		// Pilotos: MARCHA sigue la bobina; FALLO depende del 97-98 del térmico.
		cable('w-run1', ['km1', 'A1'], ['h-marcha', 'X1']), cable('w-run2', ['h-marcha', 'X2'], ['red', 'N'], 1, 'azul'),
		cable('w-fault1', ['red', 'L1'], ['f2', '97']), cable('w-fault2', ['f2', '98'], ['h-fallo', 'X1']),
		cable('w-fault3', ['h-fallo', 'X2'], ['red', 'N'], 1, 'azul'),
	];
	p.gabinete = {
		ancho: 560, alto: 460,
		rieles: [{ id: 'r1', x: 35, y: 105, largo: 490 }, { id: 'r2', x: 35, y: 295, largo: 490 }],
		canaletas: [{ id: 'c1', x: 25, y: 195, largo: 510, orientacion: 'h', ancho: 40, alto: 60 }],
		colocaciones: [
			{ dispositivoId: 'q1', x: 65, y: 55, ancho: 54, alto: 86, rielId: 'r1' },
			{ dispositivoId: 'km1', x: 175, y: 55, ancho: 52, alto: 86, rielId: 'r1' },
			{ dispositivoId: 'f2', x: 285, y: 60, ancho: 52, alto: 76, rielId: 'r1' },
			{ dispositivoId: 's0', x: 130, y: 280, ancho: 30, alto: 30, montaje: 'puerta' },
			{ dispositivoId: 's1', x: 190, y: 280, ancho: 30, alto: 30, montaje: 'puerta' },
			{ dispositivoId: 'h-marcha', x: 290, y: 280, ancho: 30, alto: 30, montaje: 'puerta' },
			{ dispositivoId: 'h-fallo', x: 350, y: 280, ancho: 30, alto: 30, montaje: 'puerta' },
		],
	};
	return p;
}

/** VFD cableado: protección, selector RUN, referencia runtime, motor y contacto de FAULT. */
export function fixtureVariadorV2(): Proyecto {
	const p = base('Fixture V2 — VFD, velocidad y FAULT');
	p.dispositivos = [
		{
			id: 'red', tipo: 'otro', clase: 'W', designacion: '-W1', congelado: true, campo: true,
			descripcion: 'Red monofásica 230 V', tensionNominal: 230,
			bornes: [...bornes(['L'], 'L', 5), ...bornes(['N'], 'N', 5)],
		},
		{
			id: 'q1', tipo: 'disyuntor', designacion: '-Q1', congelado: true, corrienteNominal: 6, curvaDisparo: 'C',
			bornes: [...bornes(['1', '2'], 'L'), ...bornes(['3', '4'], 'N')],
			comportamiento: perfilProteccion('termomagnetico', [['1', '2'], ['3', '4']]),
		},
		{
			id: 's-run', tipo: 'selector', designacion: '-S1', congelado: true, descripcion: 'Selector RUN',
			bornes: bornes(['13', '14']),
			comportamiento: { version: 1, clase: 'mando', modo: 'mantenido', posiciones: 2, reposo: 0,
				contactos: [{ entrada: '13', salida: '14', reposo: 'abierto', funcion: 'auxiliar' }] },
		},
		{
			id: 'vfd', tipo: 'variador', designacion: '-U1', congelado: true, descripcion: 'VFD funcional 230 V / 3~',
			bornes: [...bornes(['L'], 'L'), ...bornes(['N'], 'N'), ...bornes(['RUN', 'AI', 'COM', 'AL1', 'AL2']), ...bornes(['U', 'V', 'W'], 'L')],
			comportamiento: {
				version: 1, clase: 'variador', alimentacion: { fases: ['L'], retornos: ['N'], fasesMinimas: 1 },
				mando: { run: 'RUN' }, referencia: { borne: 'AI', comun: 'COM', unidad: 'V', rango: [0, 10] },
				salida: { u: 'U', v: 'V', w: 'W', tensionV: 400 },
				frecuencia: { minimaHz: 0, maximaHz: 50, rampaHzS: 10 },
				contactoFallo: { entrada: 'AL1', salida: 'AL2', reposo: 'abierto', funcion: 'auxiliar' },
			},
		},
		{
			id: 'm1', tipo: 'motor', designacion: '-M1', congelado: true, campo: true, tensionNominal: 400, corrienteNominal: 3,
			descripcion: 'Motor 4 polos gobernado por VFD', bornes: bornes(['U1', 'V1', 'W1'], 'L'),
			comportamiento: { version: 1, clase: 'carga', efecto: 'giro',
				alimentacion: { fases: ['U1', 'V1', 'W1'], retornos: [], fasesMinimas: 3 },
				dinamicaMotor: { polos: 4, tiempoArranqueS: 2, tiempoParadaS: 2 } },
		},
		{
			id: 'h-fallo', tipo: 'piloto', designacion: '-H1', congelado: true, descripcion: 'Piloto FAULT VFD',
			colorSenal: 'rojo', tensionNominal: 230, corrienteNominal: 0.02, bornes: bornes(['X1', 'X2']),
			comportamiento: { version: 1, clase: 'carga', efecto: 'luz',
				alimentacion: { fases: ['X1'], retornos: ['X2'], fasesMinimas: 1 } },
		},
	];
	p.conductores = [
		cable('w-l-q', ['red', 'L'], ['q1', '1'], 2.5, 'marrón'), cable('w-n-q', ['red', 'N'], ['q1', '3'], 2.5, 'azul'),
		cable('w-q-l', ['q1', '2'], ['vfd', 'L'], 2.5, 'marrón'), cable('w-q-n', ['q1', '4'], ['vfd', 'N'], 2.5, 'azul'),
		cable('w-run1', ['q1', '2'], ['s-run', '13']), cable('w-run2', ['s-run', '14'], ['vfd', 'RUN']),
		cable('w-u', ['vfd', 'U'], ['m1', 'U1'], 2.5, 'marrón'), cable('w-v', ['vfd', 'V'], ['m1', 'V1'], 2.5, 'negro'),
		cable('w-w', ['vfd', 'W'], ['m1', 'W1'], 2.5, 'gris'),
		cable('w-al1', ['q1', '2'], ['vfd', 'AL1']), cable('w-al2', ['vfd', 'AL2'], ['h-fallo', 'X1']),
		cable('w-aln', ['h-fallo', 'X2'], ['q1', '4'], 1, 'azul'),
	];
	p.gabinete = {
		ancho: 520, alto: 420,
		rieles: [{ id: 'r1', x: 35, y: 120, largo: 450 }],
		canaletas: [{ id: 'c1', x: 25, y: 245, largo: 470, orientacion: 'h', ancho: 40, alto: 60 }],
		colocaciones: [
			{ dispositivoId: 'q1', x: 65, y: 72, ancho: 40, alto: 82, rielId: 'r1' },
			{ dispositivoId: 'vfd', x: 175, y: 42, ancho: 110, alto: 142, rielId: 'r1' },
			{ dispositivoId: 's-run', x: 170, y: 270, ancho: 30, alto: 30, montaje: 'puerta' },
			{ dispositivoId: 'h-fallo', x: 270, y: 270, ancho: 30, alto: 30, montaje: 'puerta' },
		],
	};
	return p;
}
