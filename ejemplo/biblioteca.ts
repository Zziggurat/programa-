/**
 * Biblioteca de tableros de ejemplo REALES, para estudiar cómo funciona cada uno.
 * Cada ejemplo trae el tablero armado y cableado, más una explicación de qué hace
 * y de cómo trabaja paso a paso.
 */
import { Conductor, Dispositivo, Proyecto } from '../src/modelo/tipos.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { tableroEjemplo } from './tablero-ejemplo.js';

export interface EjemploTablero {
	id: string;
	titulo: string;
	/** Una línea: para qué sirve este tablero. */
	resumen: string;
	/** Qué hace, en lenguaje llano. */
	queHace: string;
	/** Cómo funciona, paso a paso (secuencia de maniobra). */
	comoFunciona: string[];
	/** Qué conviene mirar en el 3D para entenderlo. */
	aprender: string[];
	crear: () => Proyecto;
}

/* --------------------------- Ayudantes de construcción --------------------------- */

const L = (id: string): { id: string; tipo: 'L' } => ({ id, tipo: 'L' });
const N = (id: string): { id: string; tipo: 'N' } => ({ id, tipo: 'N' });
const C = (id: string): { id: string; tipo: 'control' } => ({ id, tipo: 'control' });
const PE = (): { id: string; tipo: 'PE' } => ({ id: 'PE', tipo: 'PE' });

let n = 0;
const cable = (
	de: [string, string],
	a: [string, string],
	seccion: number,
	color: string,
): Conductor => ({
	id: `w${++n}`,
	de: { dispositivoId: de[0], borneId: de[1] },
	a: { dispositivoId: a[0], borneId: a[1] },
	seccion,
	color,
});

/* ---------------------- 1. Arranque directo de un motor (DOL) ---------------------- */

function arranqueDirecto(): Proyecto {
	n = 0;
	const p = crearProyecto('Arranque directo de motor 380 V');
	// Un ejemplo tiene que ser ejemplar también en lo que no se dibuja: sin la Icc de la
	// acometida el programa no puede comprobar el poder de corte de las protecciones, y sin
	// saber cómo va montado el armario no sale el balance térmico.
	p.opciones = { iccPresuntaKA: 6, temperaturaAmbienteC: 35, montajeGabinete: 'mural' };
	p.hojas = [
		{ id: 'h1', numero: 1, titulo: 'Fuerza 380 V' },
		{ id: 'h2', numero: 2, titulo: 'Mando 220 V' },
	];

	const dispositivos: Dispositivo[] = [
		{
			id: 'red', tipo: 'otro', clase: 'W', descripcion: 'Acometida 380 V 3F+N+PE', campo: true,
			tensionNominal: 380, hojaId: 'h1', bornes: [L('L1'), L('L2'), L('L3'), N('N'), PE()],
		},
		{
			id: 'q1', tipo: 'guardamotor', descripcion: 'Guardamotor 2.5–4 A (protege el motor)',
			fabricante: 'Schneider Electric', referencia: 'GV2ME08', tensionNominal: 380, hojaId: 'h1',
			poderCorteKA: 100, disipacionW: 4.5,
			bornes: [L('1'), L('2'), L('3'), L('4'), L('5'), L('6')],
			puentesInternos: [['1', '2'], ['3', '4'], ['5', '6']],
		},
		{
			id: 'km1', tipo: 'contactor', descripcion: 'Contactor de línea del motor',
			fabricante: 'Schneider Electric', referencia: 'LC1D09', tensionNominal: 220, hojaId: 'h1',
			rol: { tipo: 'maestro' },
			bornes: [L('1/L1'), L('3/L2'), L('5/L3'), L('2/T1'), L('4/T2'), L('6/T3'), C('A1'), C('A2'), C('13'), C('14')],
			puentesInternos: [['1/L1', '2/T1'], ['3/L2', '4/T2'], ['5/L3', '6/T3']],
		},
		{
			id: 'f2', tipo: 'rele', clase: 'F', descripcion: 'Relé térmico de sobrecarga',
			fabricante: 'Schneider Electric', referencia: 'LRD08', hojaId: 'h1',
			bornes: [L('1'), L('2'), L('3'), L('4'), L('5'), L('6'), C('95'), C('96')],
			puentesInternos: [['1', '2'], ['3', '4'], ['5', '6']],
		},
		{
			id: 'x1', tipo: 'bornero', descripcion: 'Bornero de fuerza al motor', hojaId: 'h1',
			bornes: [C('U'), C('V'), C('W'), PE()],
		},
		{
			id: 'm1', tipo: 'motor', descripcion: 'Motor trifásico 1,5 kW', campo: true,
			tensionNominal: 380, hojaId: 'h1', bornes: [L('U'), L('V'), L('W'), PE()],
		},
		{
			id: 'f1', tipo: 'fusible', descripcion: 'Fusible del circuito de mando', hojaId: 'h2',
			tensionNominal: 220, bornes: [C('1'), C('2')],
		},
		{
			id: 's0', tipo: 'pulsador', descripcion: 'Pulsador de PARO (contacto NC, rojo)', campo: true,
			tensionNominal: 220, hojaId: 'h2', bornes: [C('11'), C('12')],
		},
		{
			id: 's1', tipo: 'pulsador', descripcion: 'Pulsador de MARCHA (contacto NA, verde)', campo: true,
			tensionNominal: 220, hojaId: 'h2', bornes: [C('13'), C('14')],
		},
		{
			id: 'x2', tipo: 'bornero', descripcion: 'Bornero de mando (botonera)', hojaId: 'h2',
			// Cada borna admite DOS conductores. El enclavamiento del contactor va en paralelo con
			// el pulsador de marcha, así que necesita su propio par de bornas PUENTEADAS a las de
			// la botonera: es como se hace en un tablero, no metiendo tres cables en una borna.
			bornes: [C('1'), C('2'), C('3'), C('4'), C('5'), C('6')],
			puentes: [['2', '5'], ['3', '6']],
		},
	];
	p.dispositivos = dispositivos;

	p.conductores = [
		// --- Fuerza: red → guardamotor → contactor → térmico → bornero → motor ---
		cable(['red', 'L1'], ['q1', '1'], 2.5, 'marrón'),
		cable(['red', 'L2'], ['q1', '3'], 2.5, 'negro'),
		cable(['red', 'L3'], ['q1', '5'], 2.5, 'gris'),
		cable(['q1', '2'], ['km1', '1/L1'], 2.5, 'marrón'),
		cable(['q1', '4'], ['km1', '3/L2'], 2.5, 'negro'),
		cable(['q1', '6'], ['km1', '5/L3'], 2.5, 'gris'),
		cable(['km1', '2/T1'], ['f2', '1'], 2.5, 'marrón'),
		cable(['km1', '4/T2'], ['f2', '3'], 2.5, 'negro'),
		cable(['km1', '6/T3'], ['f2', '5'], 2.5, 'gris'),
		cable(['f2', '2'], ['x1', 'U'], 2.5, 'marrón'),
		cable(['f2', '4'], ['x1', 'V'], 2.5, 'negro'),
		cable(['f2', '6'], ['x1', 'W'], 2.5, 'gris'),
		cable(['x1', 'U'], ['m1', 'U'], 2.5, 'marrón'),
		cable(['x1', 'V'], ['m1', 'V'], 2.5, 'negro'),
		cable(['x1', 'W'], ['m1', 'W'], 2.5, 'gris'),
		cable(['red', 'PE'], ['x1', 'PE'], 2.5, 'verde/amarillo'),
		cable(['x1', 'PE'], ['m1', 'PE'], 2.5, 'verde/amarillo'),
		// --- Mando 220 V: fase → fusible → paro → marcha → bobina → neutro ---
		cable(['red', 'L1'], ['f1', '1'], 1, 'marrón'),
		cable(['f1', '2'], ['x2', '1'], 1, 'marrón'),
		cable(['x2', '1'], ['s0', '11'], 1, 'marrón'),   // hasta el pulsador de paro (NC)
		cable(['s0', '12'], ['x2', '2'], 1, 'negro'),
		cable(['x2', '2'], ['s1', '13'], 1, 'negro'),    // y de ahí al de marcha (NA)
		cable(['s1', '14'], ['x2', '3'], 1, 'negro'),
		cable(['x2', '3'], ['km1', 'A1'], 1, 'negro'),   // a la bobina del contactor
		cable(['km1', '13'], ['x2', '5'], 1, 'negro'),   // ENCLAVAMIENTO: en paralelo con marcha,
		cable(['km1', '14'], ['x2', '6'], 1, 'negro'),   // por las bornas puenteadas 5 y 6
		cable(['km1', 'A2'], ['f2', '95'], 1, 'azul'),   // la bobina vuelve por el térmico (NC)
		cable(['f2', '96'], ['red', 'N'], 1, 'azul'),
	];

	p.gabinete = {
		ancho: 400,
		alto: 500,
		rieles: [
			{ id: 'r1', x: 30, y: 80, largo: 340 },
			{ id: 'r2', x: 30, y: 260, largo: 340 },
			{ id: 'r3', x: 30, y: 410, largo: 340 },
		],
		canaletas: [
			{ id: 'c1', x: 20, y: 160, largo: 360, orientacion: 'h', ancho: 40, alto: 60 },
			{ id: 'c2', x: 20, y: 320, largo: 360, orientacion: 'h', ancho: 40, alto: 60 },
			{ id: 'c3', x: 20, y: 160, largo: 300, orientacion: 'v', ancho: 40, alto: 60 },
		],
		colocaciones: [
			{ dispositivoId: 'q1', x: 45, y: 36, ancho: 45, alto: 89, rielId: 'r1' },
			{ dispositivoId: 'km1', x: 120, y: 37, ancho: 45, alto: 86, rielId: 'r1' },
			{ dispositivoId: 'f2', x: 195, y: 45, ancho: 45, alto: 70, rielId: 'r1' },
			{ dispositivoId: 'f1', x: 270, y: 45, ancho: 18, alto: 70, rielId: 'r1' },
			{ dispositivoId: 'x1', x: 60, y: 235, ancho: 90, alto: 50, rielId: 'r2' },
			{ dispositivoId: 'x2', x: 190, y: 235, ancho: 90, alto: 50, rielId: 'r2' },
		],
	};
	return p;
}

/* ------------------- 2. Bomba con boya de nivel y marcha/paro ------------------- */

function bombaConBoya(): Proyecto {
	n = 0;
	const p = crearProyecto('Bomba de agua con boya de nivel');
	p.opciones = { iccPresuntaKA: 6, temperaturaAmbienteC: 35, montajeGabinete: 'mural' };
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Fuerza y mando 220 V' }];

	p.dispositivos = [
		{
			id: 'red', tipo: 'otro', clase: 'W', descripcion: 'Acometida 220 V + PE', campo: true,
			tensionNominal: 220, hojaId: 'h1', bornes: [L('L'), N('N'), PE()],
		},
		{
			id: 'q1', tipo: 'diferencial', descripcion: 'Diferencial 2P 25 A 30 mA (protege a las personas)',
			fabricante: 'Schneider Electric', referencia: 'iID', tensionNominal: 220, hojaId: 'h1',
			// Un diferencial puro no corta cortocircuitos por sí solo: 6 kA es su corriente
			// condicional respaldada por el automático que lleva detrás.
			poderCorteKA: 6, disipacionW: 2,
			bornes: [L('1'), N('3'), L('2'), N('4')],
			puentesInternos: [['1', '2'], ['3', '4']],
		},
		{
			id: 'q2', tipo: 'disyuntor', descripcion: 'Automático 2P C10 (protege el cable y la bomba)',
			fabricante: 'Schneider Electric', referencia: 'iC60N', tensionNominal: 220, hojaId: 'h1',
			poderCorteKA: 6, disipacionW: 2.5,
			bornes: [L('1'), N('3'), L('2'), N('4')],
			puentesInternos: [['1', '2'], ['3', '4']],
		},
		{
			id: 'km1', tipo: 'contactor', descripcion: 'Contactor de la bomba',
			fabricante: 'Schneider Electric', referencia: 'LC1D09', tensionNominal: 220, hojaId: 'h1',
			rol: { tipo: 'maestro' },
			// Ojo: en monofásico el 2.º polo del contactor corta el NEUTRO, no otra fase. Tiparlo
			// como fase hacía que la verificación viera una fase unida al neutro (cortocircuito).
			bornes: [L('1/L1'), N('3/L2'), L('2/T1'), N('4/T2'), C('A1'), C('A2')],
			puentesInternos: [['1/L1', '2/T1'], ['3/L2', '4/T2']],
		},
		{
			id: 'x1', tipo: 'bornero', descripcion: 'Bornero de salida a la bomba y a la boya', hojaId: 'h1',
			// Cada borna se tipa por lo que de verdad lleva: 1 fase, 2 neutro, 3 y 4 el mando.
			bornes: [L('1'), N('2'), C('3'), C('4'), PE()],
		},
		{
			id: 'b1', tipo: 'sensor', descripcion: 'Boya de nivel del estanque (cierra si falta agua)',
			campo: true, tensionNominal: 220, hojaId: 'h1', bornes: [C('1'), C('2')],
		},
		{
			id: 'm1', tipo: 'motor', descripcion: 'Bomba monofásica 0,75 kW', campo: true,
			tensionNominal: 220, hojaId: 'h1', bornes: [L('L'), N('N'), PE()],
		},
	];

	p.conductores = [
		// Fuerza: red → diferencial → automático → contactor → bornero → bomba
		cable(['red', 'L'], ['q1', '1'], 4, 'marrón'),
		cable(['red', 'N'], ['q1', '3'], 4, 'azul'),
		cable(['q1', '2'], ['q2', '1'], 2.5, 'marrón'),
		cable(['q1', '4'], ['q2', '3'], 2.5, 'azul'),
		cable(['q2', '2'], ['km1', '1/L1'], 2.5, 'marrón'),
		cable(['q2', '4'], ['km1', '3/L2'], 2.5, 'azul'),
		cable(['km1', '2/T1'], ['x1', '1'], 2.5, 'marrón'),
		cable(['km1', '4/T2'], ['x1', '2'], 2.5, 'azul'),
		cable(['x1', '1'], ['m1', 'L'], 2.5, 'marrón'),
		cable(['x1', '2'], ['m1', 'N'], 2.5, 'azul'),
		cable(['red', 'PE'], ['x1', 'PE'], 4, 'verde/amarillo'),
		cable(['x1', 'PE'], ['m1', 'PE'], 2.5, 'verde/amarillo'),
		// Mando: la boya, en serie con la bobina, decide si la bomba anda
		cable(['q2', '2'], ['x1', '3'], 1, 'marrón'),
		cable(['x1', '3'], ['b1', '1'], 1, 'marrón'),
		cable(['b1', '2'], ['x1', '4'], 1, 'negro'),
		cable(['x1', '4'], ['km1', 'A1'], 1, 'negro'),
		cable(['km1', 'A2'], ['q2', '4'], 1, 'azul'),
	];

	p.gabinete = {
		ancho: 300,
		alto: 400,
		rieles: [
			{ id: 'r1', x: 25, y: 80, largo: 250 },
			{ id: 'r2', x: 25, y: 280, largo: 250 },
		],
		canaletas: [
			{ id: 'c1', x: 15, y: 170, largo: 270, orientacion: 'h', ancho: 40, alto: 60 },
			{ id: 'c2', x: 15, y: 170, largo: 160, orientacion: 'v', ancho: 40, alto: 60 },
		],
		colocaciones: [
			{ dispositivoId: 'q1', x: 40, y: 40, ancho: 36, alto: 80, rielId: 'r1' },
			{ dispositivoId: 'q2', x: 95, y: 40, ancho: 36, alto: 80, rielId: 'r1' },
			{ dispositivoId: 'km1', x: 155, y: 37, ancho: 45, alto: 86, rielId: 'r1' },
			{ dispositivoId: 'x1', x: 60, y: 255, ancho: 110, alto: 50, rielId: 'r2' },
		],
	};
	return p;
}

/* --------------------------------- La biblioteca --------------------------------- */

export const EJEMPLOS: EjemploTablero[] = [
	{
		id: 'arranque-directo',
		titulo: 'Arranque directo de motor (380 V)',
		resumen: 'El montaje más común en la industria: poner en marcha un motor con botonera.',
		queHace: 'Arranca y para un motor trifásico de 1,5 kW con dos pulsadores (marcha y paro), '
			+ 'protegido por guardamotor y relé térmico. Es el circuito base de casi toda automatización.',
		comoFunciona: [
			'Al apretar MARCHA (S1) la corriente de mando llega a la bobina A1 del contactor KM1.',
			'KM1 cierra sus tres contactos de fuerza y el motor arranca.',
			'A la vez cierra su contacto auxiliar 13-14, puesto EN PARALELO con el pulsador de marcha: '
			+ 'por ahí sigue pasando la corriente cuando sueltas el botón. Eso es el ENCLAVAMIENTO.',
			'Al apretar PARO (S0), que es un contacto normalmente cerrado, se corta el mando, '
			+ 'la bobina se desexcita y el motor para.',
			'Si el motor consume de más, el relé térmico F2 abre su contacto 95-96 y corta la bobina: '
			+ 'el motor para solo, aunque nadie apriete nada.',
		],
		aprender: [
			'Sigue la fuerza de arriba a abajo: red → guardamotor → contactor → térmico → bornero → motor.',
			'Fíjate en los dos cables de KM1 13-14: son los que mantienen la marcha (autorretención).',
			'El circuito de mando va con cable de 1 mm² y la fuerza con 2,5 mm²: mira el grosor en el 3D.',
		],
		crear: arranqueDirecto,
	},
	{
		id: 'bomba-boya',
		titulo: 'Bomba de agua con boya de nivel',
		resumen: 'Automatismo doméstico/agrícola: la bomba se maneja sola según el nivel del estanque.',
		queHace: 'Llena un estanque automáticamente. Una boya de nivel manda al contactor: '
			+ 'cuando falta agua, la bomba arranca; cuando el estanque se llena, para.',
		comoFunciona: [
			'El diferencial Q1 protege a las personas (corta si hay fuga a tierra) y el automático Q2 '
			+ 'protege el cable y la bomba.',
			'La boya B1 va EN SERIE con la bobina del contactor KM1: es el interruptor que manda.',
			'Con el estanque vacío la boya cierra, la bobina recibe tensión y KM1 arranca la bomba.',
			'Al llenarse, la boya abre, la bobina se queda sin tensión y la bomba para sola.',
			'No lleva enclavamiento a propósito: aquí NO queremos que quede retenida, tiene que seguir '
			+ 'siempre lo que diga la boya.',
		],
		aprender: [
			'Compara con el arranque directo: aquí el mando es un contacto de campo, no una botonera.',
			'La tierra (verde/amarillo) recorre red → bornero → bomba: nunca debe faltar.',
			'Mira que la bobina A2 vuelve al neutro pasando por el automático: todo el mando queda protegido.',
		],
		crear: bombaConBoya,
	},
	{
		id: 'control-24v',
		titulo: 'Tablero de control con PLC y 24 V',
		resumen: 'Tablero de automatización con transformador, PLC, relé y aparatos de campo.',
		queHace: 'Alimenta un controlador programable a 24 V desde la red de 220 V y le conecta '
			+ 'un sensor de entrada y una electroválvula de salida a través de un relé.',
		comoFunciona: [
			'La acometida de 220 V entra por el interruptor automático Q1.',
			'El transformador T1 baja de 220 V a 24 V para todo el circuito de control.',
			'El fusible F1 protege el secundario de 24 V y alimenta al PLC A1.',
			'El sensor B1 entra al PLC por una entrada digital (DI1) a través del bornero de control.',
			'Cuando el programa lo decide, la salida DO1 excita el relé K1, y su contacto NA '
			+ 'alimenta la electroválvula Y1 que está en campo.',
		],
		aprender: [
			'Fíjate en la separación de tensiones: 220 V arriba y 24 V abajo, con borneros distintos.',
			'Todo lo que va a campo (sensor, válvula, red) sale por los prensaestopas del borde inferior.',
			'Activa «Colorear por voltaje» en el panel Vista para ver de un golpe qué corre a 220 y qué a 24.',
		],
		crear: tableroEjemplo,
	},
];
