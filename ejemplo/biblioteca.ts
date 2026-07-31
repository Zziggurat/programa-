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
			poderCorteKA: 100, disipacionW: 4.5, poderCorteEstimado: true, disipacionEstimada: true,
			// Regulación real del GV2ME08, ajustada al motor: con esto la simulación puede decir a
			// qué porcentaje del calibre va y si el guardamotor está bien elegido.
			rangoRegulacionA: [2.5, 4],
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
			rangoRegulacionA: [2.5, 4],
			bornes: [L('1'), L('2'), L('3'), L('4'), L('5'), L('6'), C('95'), C('96')],
			puentesInternos: [['1', '2'], ['3', '4'], ['5', '6']],
		},
		{
			id: 'x1', tipo: 'bornero', descripcion: 'Bornero de fuerza al motor', hojaId: 'h1',
			bornes: [C('U'), C('V'), C('W'), PE()],
		},
		{
			id: 'm1', tipo: 'motor', descripcion: 'Motor trifásico 1,5 kW', campo: true,
			// 1,5 kW a 380 V trifásicos con cos φ 0,8 y rendimiento 0,85 son ~3,4 A por fase.
			// Es el dato que hace que la simulación pueda decir cuánto consume el tablero.
			tensionNominal: 380, corrienteNominal: 3.4, hojaId: 'h1',
			bornes: [L('U'), L('V'), L('W'), PE()],
		},
		{
			id: 'f1', tipo: 'fusible', descripcion: 'Fusible del circuito de mando', hojaId: 'h2',
			tensionNominal: 220, corrienteNominal: 2, curvaDisparo: 'gG', bornes: [C('1'), C('2')],
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
			poderCorteKA: 6, disipacionW: 2, poderCorteEstimado: true, disipacionEstimada: true,
			corrienteNominal: 25, sensibilidadMA: 30, claseDiferencial: 'AC',
			bornes: [L('1'), N('3'), L('2'), N('4')],
			puentesInternos: [['1', '2'], ['3', '4']],
		},
		{
			id: 'q2', tipo: 'disyuntor', descripcion: 'Automático 2P C10 (protege el cable y la bomba)',
			fabricante: 'Schneider Electric', referencia: 'iC60N', tensionNominal: 220, hojaId: 'h1',
			poderCorteKA: 6, disipacionW: 2.5, poderCorteEstimado: true, disipacionEstimada: true,
			corrienteNominal: 10, curvaDisparo: 'C',
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
			// 0,75 kW a 220 V monofásicos con cos φ 0,8 y rendimiento 0,75 son ~5,7 A.
			tensionNominal: 220, corrienteNominal: 5.7, hojaId: 'h1',
			bornes: [L('L'), N('N'), PE()],
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

/* --------------- 3. Arranque estrella-triángulo con temporizador --------------- */

/**
 * El arranque de un ventilador de cubierta: en estrella cada bobinado recibe 220 V en vez de
 * 380 y el motor tira un tercio de la punta; a los pocos segundos, cuando ya ha cogido vueltas,
 * el temporizador pasa a triángulo y el motor queda a plena tensión.
 *
 * Es el ejemplo que hace visible el reloj de la simulación: hay una cuenta atrás de verdad y
 * los contactores se relevan solos, sin que nadie toque nada.
 */
function estrellaTriangulo(): Proyecto {
	n = 0;
	const p = crearProyecto('Arranque estrella-triángulo (ventilador de cubierta)');
	p.opciones = { iccPresuntaKA: 10, temperaturaAmbienteC: 40, montajeGabinete: 'mural' };
	p.hojas = [
		{ id: 'h1', numero: 1, titulo: 'Fuerza 380 V' },
		{ id: 'h2', numero: 2, titulo: 'Mando 220 V y temporización' },
	];

	const contactor = (
		id: string, descripcion: string, referencia: string, aux: string[],
	): Dispositivo => ({
		id, tipo: 'contactor', descripcion, fabricante: 'Schneider Electric', referencia,
		tensionNominal: 220, hojaId: 'h1', rol: { tipo: 'maestro' },
		disipacionW: 4, disipacionEstimada: true,
		bornes: [
			L('1/L1'), L('3/L2'), L('5/L3'), L('2/T1'), L('4/T2'), L('6/T3'),
			C('A1'), C('A2'), ...aux.map(C),
		],
		puentesInternos: [['1/L1', '2/T1'], ['3/L2', '4/T2'], ['5/L3', '6/T3']],
	});

	p.dispositivos = [
		{
			id: 'red', tipo: 'otro', clase: 'W', descripcion: 'Acometida 380 V 3F+N+PE', campo: true,
			tensionNominal: 380, hojaId: 'h1', bornes: [L('L1'), L('L2'), L('L3'), N('N'), PE()],
		},
		{
			id: 'q1', tipo: 'disyuntor', descripcion: 'Automático 3P C16 (protege el cable)',
			fabricante: 'Schneider Electric', referencia: 'iC60N 3P C16', tensionNominal: 380,
			hojaId: 'h1', corrienteNominal: 16, curvaDisparo: 'C', polos: 3,
			poderCorteKA: 10, disipacionW: 6, poderCorteEstimado: true, disipacionEstimada: true,
			bornes: [L('1'), L('3'), L('5'), L('2'), L('4'), L('6')],
			puentesInternos: [['1', '2'], ['3', '4'], ['5', '6']],
		},
		{
			id: 'f2', tipo: 'rele', clase: 'F', descripcion: 'Relé térmico 7–10 A (regulado a 8,5 A)',
			fabricante: 'Schneider Electric', referencia: 'LRD14', hojaId: 'h1',
			rangoRegulacionA: [7, 10], disipacionW: 5, disipacionEstimada: true,
			bornes: [L('1'), L('3'), L('5'), L('2'), L('4'), L('6'), C('95'), C('96')],
			puentesInternos: [['1', '2'], ['3', '4'], ['5', '6']],
		},
		// KM1 lleva el contacto 13-14 de autorretención; KM2 y KM3 llevan el 21-22 con el que se
		// bloquean el uno al otro: si los dos cerraran a la vez sería un cortocircuito entre fases.
		contactor('km1', 'Contactor de LÍNEA', 'LC1D12', ['13', '14']),
		contactor('km2', 'Contactor de ESTRELLA', 'LC1D09', ['21', '22']),
		contactor('km3', 'Contactor de TRIÁNGULO', 'LC1D12', ['21', '22']),
		{
			id: 'x1', tipo: 'bornero', descripcion: 'Bornero de fuerza al motor (6 hilos + tierra)',
			hojaId: 'h1',
			bornes: [C('U1'), C('V1'), C('W1'), C('U2'), C('V2'), C('W2'), PE()],
		},
		{
			id: 'm1', tipo: 'motor', descripcion: 'Ventilador trifásico 4 kW, 6 bornes', campo: true,
			// 4 kW a 380 V con cos φ 0,84 y rendimiento 0,85 son ~8,5 A por fase en triángulo.
			tensionNominal: 380, corrienteNominal: 8.5, polos: 3, hojaId: 'h1',
			bornes: [L('U1'), L('V1'), L('W1'), L('U2'), L('V2'), L('W2'), PE()],
		},
		{
			id: 'f1', tipo: 'fusible', descripcion: 'Fusible del circuito de mando', hojaId: 'h2',
			tensionNominal: 220, corrienteNominal: 2, curvaDisparo: 'gG', bornes: [C('1'), C('2')],
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
			id: 'kt', tipo: 'rele', descripcion: 'Temporizador a la conexión, 6 s (estrella→triángulo)',
			fabricante: 'Schneider Electric', referencia: 'RE22R1', tensionNominal: 220, hojaId: 'h2',
			rol: { tipo: 'maestro' }, disipacionW: 2, disipacionEstimada: true,
			// Aquí está la gracia: al meterle tensión NO conmuta. Cuenta 6 s con los contactos en
			// reposo —11-12 cerrado, o sea estrella— y al cumplirse los da vuelta: abre la estrella
			// y cierra el triángulo.
			temporizacion: { tipo: 'trabajo', segundos: 6 },
			bornes: [C('A1'), C('A2'), C('11'), C('12'), C('13'), C('14')],
		},
		{
			id: 'x2', tipo: 'bornero', descripcion: 'Bornero de mando (botonera)', hojaId: 'h2',
			bornes: [C('1'), C('2'), C('3'), C('4'), C('5'), C('6')],
			puentes: [['2', '5'], ['3', '6']],
		},
	];

	p.conductores = [
		// --- Fuerza: red → automático → térmico → contactores → bornero → motor ---
		cable(['red', 'L1'], ['q1', '1'], 4, 'marrón'),
		cable(['red', 'L2'], ['q1', '3'], 4, 'negro'),
		cable(['red', 'L3'], ['q1', '5'], 4, 'gris'),
		cable(['q1', '2'], ['f2', '1'], 4, 'marrón'),
		cable(['q1', '4'], ['f2', '3'], 4, 'negro'),
		cable(['q1', '6'], ['f2', '5'], 4, 'gris'),
		// La línea sale del térmico y se reparte entre el contactor de línea y el de triángulo.
		cable(['f2', '2'], ['km1', '1/L1'], 4, 'marrón'),
		cable(['f2', '4'], ['km1', '3/L2'], 4, 'negro'),
		cable(['f2', '6'], ['km1', '5/L3'], 4, 'gris'),
		cable(['km1', '1/L1'], ['km3', '1/L1'], 4, 'marrón'),
		cable(['km1', '3/L2'], ['km3', '3/L2'], 4, 'negro'),
		cable(['km1', '5/L3'], ['km3', '5/L3'], 4, 'gris'),
		// KM1 alimenta las CABEZAS de bobinado U1 V1 W1.
		cable(['km1', '2/T1'], ['x1', 'U1'], 4, 'marrón'),
		cable(['km1', '4/T2'], ['x1', 'V1'], 4, 'negro'),
		cable(['km1', '6/T3'], ['x1', 'W1'], 4, 'gris'),
		// KM3 alimenta las COLAS U2 V2 W2, pero CRUZADAS: es eso lo que forma el triángulo.
		cable(['km3', '2/T1'], ['x1', 'V2'], 4, 'marrón'),
		cable(['km3', '4/T2'], ['x1', 'W2'], 4, 'negro'),
		cable(['km3', '6/T3'], ['x1', 'U2'], 4, 'gris'),
		// KM2 junta las tres colas en un punto: eso es la estrella. Se cuelga de las salidas de
		// KM3 —que son las mismas colas— y no de las bornas: en una borna no caben tres hilos.
		cable(['km3', '6/T3'], ['km2', '1/L1'], 4, 'marrón'),   // el nudo U2
		cable(['km3', '2/T1'], ['km2', '3/L2'], 4, 'negro'),    // el nudo V2
		cable(['km3', '4/T2'], ['km2', '5/L3'], 4, 'gris'),     // el nudo W2
		cable(['km2', '2/T1'], ['km2', '4/T2'], 4, 'azul'),   // puente de estrella
		cable(['km2', '4/T2'], ['km2', '6/T3'], 4, 'azul'),
		// Los seis hilos hasta el motor, más la tierra.
		cable(['x1', 'U1'], ['m1', 'U1'], 4, 'marrón'),
		cable(['x1', 'V1'], ['m1', 'V1'], 4, 'negro'),
		cable(['x1', 'W1'], ['m1', 'W1'], 4, 'gris'),
		cable(['x1', 'U2'], ['m1', 'U2'], 4, 'marrón'),
		cable(['x1', 'V2'], ['m1', 'V2'], 4, 'negro'),
		cable(['x1', 'W2'], ['m1', 'W2'], 4, 'gris'),
		cable(['red', 'PE'], ['x1', 'PE'], 4, 'verde/amarillo'),
		cable(['x1', 'PE'], ['m1', 'PE'], 4, 'verde/amarillo'),
		// --- Mando 220 V: fase → fusible → paro → marcha → bobinas → térmico → neutro ---
		// El mando se saca de la SALIDA del automático, no de la acometida pelada: así el tramo
		// hasta el fusible ya va protegido, y de F1 para abajo protege el fusible de 2 A.
		cable(['q1', '2'], ['f1', '1'], 2.5, 'marrón'),
		cable(['f1', '2'], ['x2', '1'], 1, 'marrón'),
		cable(['x2', '1'], ['s0', '11'], 1, 'marrón'),
		cable(['s0', '12'], ['x2', '2'], 1, 'negro'),
		cable(['x2', '2'], ['s1', '13'], 1, 'negro'),
		cable(['s1', '14'], ['x2', '3'], 1, 'negro'),
		// Desde aquí, el punto de mando: alimenta KM1 y el temporizador. Va EN CADENA de un borne
		// al siguiente y no todo al mismo: en una borna caben dos hilos, no cuatro.
		cable(['x2', '3'], ['km1', 'A1'], 1, 'negro'),
		cable(['km1', 'A1'], ['kt', 'A1'], 1, 'negro'),
		cable(['km1', '13'], ['x2', '5'], 1, 'negro'),   // autorretención por las bornas puenteadas
		cable(['km1', '14'], ['x2', '6'], 1, 'negro'),
		// El temporizador reparte: 11-12 (cerrado en reposo) → estrella; 13-14 → triángulo.
		cable(['kt', 'A1'], ['kt', '11'], 1, 'negro'),
		cable(['kt', '11'], ['kt', '13'], 1, 'negro'),
		cable(['kt', '12'], ['km3', '21'], 1, 'negro'),  // pasando por el bloqueo del triángulo
		cable(['km3', '22'], ['km2', 'A1'], 1, 'negro'),
		cable(['kt', '14'], ['km2', '21'], 1, 'negro'),  // pasando por el bloqueo de la estrella
		cable(['km2', '22'], ['km3', 'A1'], 1, 'negro'),
		// Los cuatro retornos de bobina se encadenan y vuelven por el contacto del térmico.
		cable(['km2', 'A2'], ['km3', 'A2'], 1, 'azul'),
		cable(['km3', 'A2'], ['kt', 'A2'], 1, 'azul'),
		cable(['kt', 'A2'], ['km1', 'A2'], 1, 'azul'),
		cable(['km1', 'A2'], ['f2', '95'], 1, 'azul'),
		cable(['f2', '96'], ['red', 'N'], 1, 'azul'),
	];

	p.gabinete = {
		ancho: 600,
		alto: 600,
		rieles: [
			{ id: 'r1', x: 30, y: 90, largo: 540 },
			{ id: 'r2', x: 30, y: 280, largo: 540 },
			{ id: 'r3', x: 30, y: 470, largo: 540 },
		],
		canaletas: [
			{ id: 'c1', x: 20, y: 175, largo: 560, orientacion: 'h', ancho: 40, alto: 60 },
			{ id: 'c2', x: 20, y: 365, largo: 560, orientacion: 'h', ancho: 40, alto: 60 },
			{ id: 'c3', x: 20, y: 175, largo: 250, orientacion: 'v', ancho: 40, alto: 60 },
		],
		colocaciones: [
			{ dispositivoId: 'km1', x: 80, y: 47, ancho: 45, alto: 86, rielId: 'r1' },
			{ dispositivoId: 'km2', x: 175, y: 47, ancho: 45, alto: 86, rielId: 'r1' },
			{ dispositivoId: 'km3', x: 270, y: 47, ancho: 45, alto: 86, rielId: 'r1' },
			{ dispositivoId: 'f2', x: 380, y: 55, ancho: 45, alto: 70, rielId: 'r1' },
			{ dispositivoId: 'q1', x: 80, y: 238, ancho: 54, alto: 85, rielId: 'r2' },
			{ dispositivoId: 'f1', x: 180, y: 245, ancho: 18, alto: 70, rielId: 'r2' },
			{ dispositivoId: 'kt', x: 240, y: 240, ancho: 22, alto: 80, rielId: 'r2' },
			{ dispositivoId: 'x1', x: 80, y: 445, ancho: 130, alto: 50, rielId: 'r3' },
			{ dispositivoId: 'x2', x: 280, y: 445, ancho: 110, alto: 50, rielId: 'r3' },
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
		id: 'estrella-triangulo',
		titulo: 'Arranque estrella-triángulo con temporizador',
		resumen: 'Arrancar un motor grande sin que dé el tirón: primero en estrella, luego en triángulo.',
		queHace: 'Pone en marcha un ventilador de 4 kW en dos tiempos. Arranca con los bobinados en '
			+ 'estrella (cada uno a 220 V, un tercio de la punta de corriente) y a los 6 segundos, '
			+ 'cuando ya tiene vueltas, pasa a triángulo y queda a plena potencia.',
		comoFunciona: [
			'Al apretar MARCHA (S1) entra la bobina de KM1 (línea) y, a la vez, la del temporizador KT.',
			'KM1 se autorretiene por su contacto 13-14 y alimenta las cabezas U1 V1 W1 del motor.',
			'El temporizador NO conmuta todavía: sus contactos siguen en reposo, o sea 11-12 cerrado, '
			+ 'y por ahí entra KM2, que junta las tres colas en un punto. Eso es la ESTRELLA.',
			'Pasados los 6 segundos KT da vuelta sus contactos: abre 11-12 y KM2 se cae; cierra 13-14 '
			+ 'y entra KM3, que alimenta las colas CRUZADAS. Eso es el TRIÁNGULO.',
			'Los contactos 21-22 de KM2 y KM3 se bloquean mutuamente: si los dos cerraran a la vez, '
			+ 'la estrella y el triángulo juntos serían un cortocircuito entre fases.',
			'PARO (S0) corta todo el mando de golpe, y el térmico F2 hace lo mismo si hay sobrecarga.',
		],
		aprender: [
			'Energiza y aprieta MARCHA con el panel de simulación abierto: verás la cuenta atrás de KT '
			+ 'correr y a KM2 apagarse y KM3 encenderse solos, sin tocar nada.',
			'Sigue los seis hilos del bornero X1 al motor: U1 V1 W1 son las cabezas, U2 V2 W2 las colas. '
			+ 'Un motor de 380/660 V se conecta así; uno de 220/380 no admite este arranque a 380 V.',
			'Mira el cruce de KM3: su salida 2/T1 va a V2, no a U2. Ese cruce es el triángulo.',
			'El puente azul entre las tres salidas de KM2 es el punto de estrella; en el tablero real '
			+ 'suele ser una pletina o tres pontets, no cable.',
		],
		crear: estrellaTriangulo,
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
