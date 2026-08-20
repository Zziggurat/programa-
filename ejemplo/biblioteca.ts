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
		cable(['q2', '2'], ['x1', '3'], 1.5, 'marrón'),
		cable(['x1', '3'], ['b1', '1'], 1.5, 'marrón'),
		cable(['b1', '2'], ['x1', '4'], 1.5, 'negro'),
		cable(['x1', '4'], ['km1', 'A1'], 1.5, 'negro'),
		cable(['km1', 'A2'], ['q2', '4'], 1.5, 'azul'),
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
			/*
			 * El automático de los pilotos de presencia. Hace falta y no es un adorno: los pilotos
			 * se cuelgan ANTES del automático general —para que avisen de que hay tensión aunque
			 * el general esté bajado, que es justamente su trabajo— y un hilo de 1 mm² colgado de
			 * la acometida pelada no lo protege nadie. Con 2 A, el hilo queda protegido y el DRC
			 * deja de tener razón para quejarse.
			 */
			id: 'q3', tipo: 'disyuntor', descripcion: 'Automático 3P C2 (pilotos de presencia)',
			fabricante: 'Schneider Electric', referencia: 'iC60N 3P C2', tensionNominal: 380,
			hojaId: 'h2', corrienteNominal: 2, curvaDisparo: 'C', polos: 3,
			poderCorteKA: 10, disipacionW: 2, poderCorteEstimado: true, disipacionEstimada: true,
			bornes: [L('1'), L('3'), L('5'), L('2'), L('4'), L('6')],
			puentesInternos: [['1', '2'], ['3', '4'], ['5', '6']],
		},
		{
			id: 'x2', tipo: 'bornero', descripcion: 'Bornero de mando (botonera)', hojaId: 'h2',
			bornes: [C('1'), C('2'), C('3'), C('4'), C('5'), C('6')],
			puentes: [['2', '5'], ['3', '6']],
		},
		/*
		 * LOS TRES PILOTOS DE PRESENCIA DE FASE, montados EN LA PUERTA.
		 *
		 * Son aparatos normales y corrientes: `tipo: 'piloto'`, dos bornes, su tensión y su
		 * consumo. El simulador los enciende porque entre X1 y X2 hay fase y neutro, igual que
		 * haría con un piloto atornillado al carril; lo único distinto es la `Colocacion`, que
		 * dice que van en la puerta. No hay ni un estado «encendido» guardado en ninguna parte.
		 *
		 * Los colores son los de la fase que vigilan, que es como se rotula un tablero de verdad:
		 * si un día falta la S, el del medio se apaga y los otros dos siguen encendidos, y con eso
		 * ya se sabe qué fase falta sin sacar el multímetro.
		 */
		...(['R', 'S', 'T'] as const).map((fase, i) => ({
			// La designación se pone a mano —R, S, T— porque es lo que va rotulado en la puerta y
			// lo que hay que leer de un vistazo; la letra de clase la pone el proyecto (P de piloto).
			id: `h${fase.toLowerCase()}`, tipo: 'piloto' as const, congelado: true,
			designacion: fase,
			descripcion: `Piloto de presencia de fase ${fase} (puerta)`,
			fabricante: 'Schneider Electric', referencia: 'XB5AVM4',
			tensionNominal: 220, corrienteNominal: 0.02, hojaId: 'h2',
			colorSenal: (['rojo', 'ambar', 'azul'] as const)[i],
			bornes: [C('X1'), C('X2')],
		})),
	];

	p.conductores = [
		// --- Fuerza: red → automático → térmico → contactores → bornero → motor ---
		cable(['red', 'L1'], ['q1', '1'], 6, 'marrón'),
		cable(['red', 'L2'], ['q1', '3'], 6, 'negro'),
		cable(['red', 'L3'], ['q1', '5'], 6, 'gris'),
		cable(['q1', '2'], ['f2', '1'], 6, 'marrón'),
		cable(['q1', '4'], ['f2', '3'], 6, 'negro'),
		cable(['q1', '6'], ['f2', '5'], 6, 'gris'),
		// La línea sale del térmico y se reparte entre el contactor de línea y el de triángulo.
		cable(['f2', '2'], ['km1', '1/L1'], 6, 'marrón'),
		cable(['f2', '4'], ['km1', '3/L2'], 6, 'negro'),
		cable(['f2', '6'], ['km1', '5/L3'], 6, 'gris'),
		cable(['km1', '1/L1'], ['km3', '1/L1'], 6, 'marrón'),
		cable(['km1', '3/L2'], ['km3', '3/L2'], 6, 'negro'),
		cable(['km1', '5/L3'], ['km3', '5/L3'], 6, 'gris'),
		// KM1 alimenta las CABEZAS de bobinado U1 V1 W1.
		cable(['km1', '2/T1'], ['x1', 'U1'], 6, 'marrón'),
		cable(['km1', '4/T2'], ['x1', 'V1'], 6, 'negro'),
		cable(['km1', '6/T3'], ['x1', 'W1'], 6, 'gris'),
		// KM3 alimenta las COLAS U2 V2 W2, pero CRUZADAS: es eso lo que forma el triángulo.
		cable(['km3', '2/T1'], ['x1', 'V2'], 6, 'marrón'),
		cable(['km3', '4/T2'], ['x1', 'W2'], 6, 'negro'),
		cable(['km3', '6/T3'], ['x1', 'U2'], 6, 'gris'),
		// KM2 junta las tres colas en un punto: eso es la estrella. Se cuelga de las salidas de
		// KM3 —que son las mismas colas— y no de las bornas: en una borna no caben tres hilos.
		cable(['km3', '6/T3'], ['km2', '1/L1'], 6, 'marrón'),   // el nudo U2
		cable(['km3', '2/T1'], ['km2', '3/L2'], 6, 'negro'),    // el nudo V2
		cable(['km3', '4/T2'], ['km2', '5/L3'], 6, 'gris'),     // el nudo W2
		cable(['km2', '2/T1'], ['km2', '4/T2'], 6, 'azul'),   // puente de estrella
		cable(['km2', '4/T2'], ['km2', '6/T3'], 6, 'azul'),
		// Los seis hilos hasta el motor, más la tierra.
		cable(['x1', 'U1'], ['m1', 'U1'], 6, 'marrón'),
		cable(['x1', 'V1'], ['m1', 'V1'], 6, 'negro'),
		cable(['x1', 'W1'], ['m1', 'W1'], 6, 'gris'),
		cable(['x1', 'U2'], ['m1', 'U2'], 6, 'marrón'),
		cable(['x1', 'V2'], ['m1', 'V2'], 6, 'negro'),
		cable(['x1', 'W2'], ['m1', 'W2'], 6, 'gris'),
		cable(['red', 'PE'], ['x1', 'PE'], 6, 'verde/amarillo'),
		cable(['x1', 'PE'], ['m1', 'PE'], 6, 'verde/amarillo'),
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
		// --- Presencia de fase: un piloto de puerta por fase, ANTES del automático general ---
		/*
		 * Se cuelgan de las bornas de ENTRADA de Q1 (1, 3, 5), que son el mismo potencial que la
		 * acometida: por ahí llega la tensión esté Q1 subido o bajado. Es lo que se quiere de un
		 * piloto de presencia —tiene que avisar de que el tablero tiene tensión aunque el general
		 * esté abierto— y además ahorra tres tiradas desde el prensaestopas hasta arriba, que en
		 * un tablero con las canaletas ya cargadas no es un detalle: medido, tirándolos desde la
		 * acometida el peor par de conductores pasaba de −2,8 a −4,8 mm de holgura, y desde la
		 * entrada de Q1 se queda en −3,0.
		 *
		 * El hilo de 1 mm² lo protege Q3, de 2 A: colgado directamente de un automático de 16 A
		 * no lo protegería nadie, y el DRC lo dice.
		 */
		cable(['q1', '1'], ['q3', '1'], 1, 'marrón'),
		cable(['q1', '3'], ['q3', '3'], 1, 'negro'),
		cable(['q1', '5'], ['q3', '5'], 1, 'gris'),
		cable(['q3', '2'], ['hr', 'X1'], 1, 'marrón'),
		cable(['q3', '4'], ['hs', 'X1'], 1, 'negro'),
		cable(['q3', '6'], ['ht', 'X1'], 1, 'gris'),
		// Los tres X2 van ENCADENADOS hasta el neutro, no los tres a la misma borna: en una borna
		// caben dos hilos, y encadenar es lo que se hace en el tablero.
		cable(['hr', 'X2'], ['hs', 'X2'], 1, 'azul'),
		cable(['hs', 'X2'], ['ht', 'X2'], 1, 'azul'),
		cable(['ht', 'X2'], ['red', 'N'], 1, 'azul'),
		// Los cuatro retornos de bobina se encadenan y vuelven por el contacto del térmico.
		cable(['km2', 'A2'], ['km3', 'A2'], 1, 'azul'),
		cable(['km3', 'A2'], ['kt', 'A2'], 1, 'azul'),
		cable(['kt', 'A2'], ['km1', 'A2'], 1, 'azul'),
		cable(['km1', 'A2'], ['f2', '95'], 1, 'azul'),
		cable(['f2', '96'], ['red', 'N'], 1, 'azul'),
	];

	/*
	 * LA DISTRIBUCIÓN FÍSICA, REHECHA PARA QUE LA CANALIZACIÓN SIRVA DE ALGO.
	 *
	 * El montaje anterior tenía tres filas de aparatos alineadas a la izquierda, dos canaletas
	 * horizontales debajo de cada fila y una vertical arrimada al borde izquierdo del armario, a
	 * cuarenta milímetros de la pared y a doscientos de cualquier aparato. La auditoría de
	 * capacidad dejó claro que las canaletas no estaban llenas —ninguna pasaba del 7 % de su
	 * sección y quedaban 27 de 41 ranuras sin estrenar en la más cargada—: lo que faltaba era
	 * infraestructura donde hace falta.
	 *
	 * Y hace falta EN VERTICAL. Contando los conductores por parejas de aparatos, el tráfico
	 * gordo de este tablero es el que baja: nueve hilos de km1 y km3 a la bornera X1 —seis de
	 * ellos de 6 mm²— recorriendo 312 mm, cinco más de los contactores al temporizador y tres de
	 * F2 a Q1. Ninguno tenía por dónde bajar, así que los 52 conductores dejaban un 13 % de su
	 * longitud dentro de canaleta y el resto colgando por delante del tablero.
	 *
	 * No se puede poner un ducto vertical ENCIMA de ese tráfico, porque km1, Q1 y X1 comparten
	 * columna: el ducto se comería los aparatos. Lo que se hace en un tablero de verdad es otra
	 * cosa: el hilo baja veinte milímetros a la canaleta horizontal que tiene debajo, viaja por
	 * dentro hasta un ESPINAZO VERTICAL y baja por él. Así que el espinazo no tiene que estar
	 * pegado al aparato, sino cruzarse con las horizontales; y las horizontales llegan a todos.
	 *
	 *   ┌── columna A ──┬─ espinazo ─┬──────── columna B ────────┐
	 *   │      Q1       │            │  F2   KM1   KM2   KM3     │  r1  potencia
	 *   │ ═══════════ C1 ═══════════════════════════════════════ │
	 *   │      F1       │    CV1     │  KT                       │  r2  mando
	 *   │ ═══════════ C2 ═══════════════════════════════════════ │
	 *   │      X1       │            │  X2                       │  r3  borneras
	 *   │ ═══════════ C3 ═══════════════════════════════════════ │      salida a campo
	 *   └───────────────┴────────────┴───────────────────────────┘
	 *      50..180        205..245      265..530
	 *
	 * Es la partición de siempre en un armario montado como es debido: la acometida y las
	 * borneras a un lado, la potencia y el mando al otro, y entre las dos el ducto por el que
	 * sube y baja todo. Con eso, los nueve hilos que van de los contactores a X1 tienen el
	 * espinazo A MEDIO CAMINO en vez de a trescientos milímetros, que es lo que decide si al
	 * router le sale a cuenta meterse dentro: el coste de un candidato es el tramo que queda al
	 * aire, y con el ducto lejos entrar cuesta casi tanto como no entrar.
	 *
	 * El espinazo se cruza con las TRES horizontales, así que la red está de verdad conectada, y
	 * queda a 25 mm del borde derecho de X1 y del izquierdo de X2: las dos borneras, que son las
	 * que concentran conexiones, lo tienen al lado. Se añade además una tercera horizontal bajo
	 * las borneras, que es por donde sale el cableado al campo (motor, red, pulsadores) en
	 * cualquier armario montado como es debido.
	 *
	 * Los aparatos NO se apiñan para hacer sitio: los contactores mantienen un paso regular de
	 * 75 mm —se leen como el conjunto que son—, Q1/F1/KT quedan alineados bajo ellos y hay 25 mm
	 * libres a cada lado del espinazo para montar y para que el cable curve al entrar.
	 *
	 * El armario sigue siendo de 600 × 600. La lógica eléctrica no cambia ni un hilo: los mismos
	 * aparatos, los mismos bornes y las mismas conexiones; sólo se mueven de sitio.
	 */
	p.gabinete = {
		ancho: 600,
		alto: 600,
		rieles: [
			{ id: 'r1', x: 35, y: 90, largo: 530 },
			{ id: 'r2', x: 35, y: 280, largo: 530 },
			{ id: 'r3', x: 35, y: 470, largo: 530 },
		],
		/*
		 * LA SEÑALÉTICA DEL FRONTAL. Es lo que el tablero le dice a quien lo opera sin abrirlo: qué
		 * hay dentro, qué tensión trae y qué significa cada luz. No son aparatos —no consumen, no
		 * salen en el esquema— y por eso van aquí y no en `dispositivos`.
		 *
		 * Las tres letras van justo debajo de sus pilotos (R en 250, S en 330, T en 410) y a la
		 * misma altura, que es lo que hace que una fila de mandos se lea como una fila.
		 */
		rotulos: [
			// La placa de identificación arriba del todo, que es lo primero que se lee al llegar.
			{ id: 'rotIdent', texto: 'VENTILADOR DE CUBIERTA\n380 V · 4 kW', x: 330, y: 62, alto: 7, ancho: 230, estilo: 'placa' },
			// La fila de presencia de fase, con su encabezado y una letra bajo cada piloto.
			{ id: 'rotFases', texto: 'PRESENCIA DE FASE', x: 330, y: 148, alto: 4.5 },
			{ id: 'rotR', texto: 'R', x: 250, y: 232, alto: 5.5 },
			{ id: 'rotS', texto: 'S', x: 330, y: 232, alto: 5.5 },
			{ id: 'rotT', texto: 'T', x: 410, y: 232, alto: 5.5 },
			// Y el aviso de riesgo, abajo y a la vista.
			{ id: 'rotAviso', texto: 'CUIDADO\nTABLERO ELÉCTRICO', x: 330, y: 545, alto: 9, ancho: 190, estilo: 'aviso' },
		],
		canaletas: [
			{ id: 'c1', x: 30, y: 175, largo: 540, orientacion: 'h', ancho: 40, alto: 60 },
			{ id: 'c2', x: 30, y: 365, largo: 540, orientacion: 'h', ancho: 40, alto: 60 },
			{ id: 'c3', x: 30, y: 545, largo: 540, orientacion: 'h', ancho: 40, alto: 60 },
			{ id: 'cv1', x: 225, y: 150, largo: 420, orientacion: 'v', ancho: 40, alto: 60 },
		],
		colocaciones: [
			{ dispositivoId: 'f1', x: 50, y: 55, ancho: 18, alto: 70, rielId: 'r1' },
			{ dispositivoId: 'q1', x: 50, y: 238, ancho: 54, alto: 85, rielId: 'r2' },
			{ dispositivoId: 'x1', x: 50, y: 445, ancho: 130, alto: 50, rielId: 'r3' },
			{ dispositivoId: 'f2', x: 265, y: 55, ancho: 45, alto: 70, rielId: 'r1' },
			{ dispositivoId: 'km1', x: 335, y: 47, ancho: 45, alto: 86, rielId: 'r1' },
			{ dispositivoId: 'km2', x: 410, y: 47, ancho: 45, alto: 86, rielId: 'r1' },
			{ dispositivoId: 'km3', x: 485, y: 47, ancho: 45, alto: 86, rielId: 'r1' },
			{ dispositivoId: 'kt', x: 265, y: 240, ancho: 22, alto: 80, rielId: 'r2' },
			{ dispositivoId: 'x2', x: 265, y: 445, ancho: 110, alto: 50, rielId: 'r3' },
			{ dispositivoId: 'q3', x: 150, y: 47, ancho: 54, alto: 85, rielId: 'r1' },
			// En la PUERTA: x e y se miden desde su esquina superior izquierda, igual que en la
			// placa se miden desde la suya. La hoja de este armario mide 660 × 660.
			{ dispositivoId: 'hr', x: 250, y: 195, ancho: 30, alto: 30, montaje: 'puerta' },
			{ dispositivoId: 'hs', x: 330, y: 195, ancho: 30, alto: 30, montaje: 'puerta' },
			{ dispositivoId: 'ht', x: 410, y: 195, ancho: 30, alto: 30, montaje: 'puerta' },
		],
	};
	return p;
}

/* ------------ 4. Climatizador de cubierta (UMA) gobernado por programa ------------ */

/**
 * El tablero que de verdad se monta en una cubierta: una unidad de tratamiento de aire.
 *
 * Aquí el que manda no es un enredo de relés, es el CONTROLADOR, y su programa está escrito en el
 * propio aparato —tres renglones que se leen en voz alta—. La secuencia es la de siempre en clima:
 * primero abre la compuerta de aire exterior, unos segundos después arranca el ventilador (nunca
 * al revés: un ventilador empujando contra una compuerta cerrada revienta conductos), y la válvula
 * de la batería de calor solo entra si el ventilador está en marcha y la sonda de retorno pide.
 *
 * Y lo que NO está en el programa importa igual: el contacto del térmico va cableado EN SERIE con
 * la bobina del contactor. Si el motor se sobrecarga, el ventilador para aunque el controlador
 * siga diciendo que sí. Una seguridad no se programa, se cablea.
 */
function climatizadorCubierta(): Proyecto {
	n = 0;
	const p = crearProyecto('Climatizador de cubierta (UMA) con controlador');
	p.opciones = {
		iccPresuntaKA: 10, temperaturaAmbienteC: 40, montajeGabinete: 'mural',
		usoPrevisto: 'intemperie',
	};
	p.hojas = [
		{ id: 'h1', numero: 1, titulo: 'Fuerza 380 V — ventilador de impulsión' },
		{ id: 'h2', numero: 2, titulo: 'Mando 220 V y alimentación 24 V CC' },
		{ id: 'h3', numero: 3, titulo: 'Entradas y salidas del controlador' },
	];

	p.dispositivos = [
		{
			id: 'red', tipo: 'otro', clase: 'W', descripcion: 'Acometida 380 V 3F+N+PE', campo: true,
			tensionNominal: 380, hojaId: 'h1', bornes: [L('L1'), L('L2'), L('L3'), N('N'), PE()],
		},
		{
			id: 'q1', tipo: 'disyuntor', descripcion: 'Automático 3P C16 (ventilador de impulsión)',
			fabricante: 'Schneider Electric', referencia: 'iC60N 3P C16', tensionNominal: 380,
			hojaId: 'h1', corrienteNominal: 16, curvaDisparo: 'C', polos: 3,
			poderCorteKA: 10, disipacionW: 6, poderCorteEstimado: true, disipacionEstimada: true,
			bornes: [L('1'), L('3'), L('5'), L('2'), L('4'), L('6')],
			puentesInternos: [['1', '2'], ['3', '4'], ['5', '6']],
		},
		{
			id: 'km1', tipo: 'contactor', descripcion: 'Contactor del ventilador de impulsión',
			fabricante: 'Schneider Electric', referencia: 'LC1D12', tensionNominal: 220, hojaId: 'h1',
			rol: { tipo: 'maestro' }, disipacionW: 4, disipacionEstimada: true,
			bornes: [L('1/L1'), L('3/L2'), L('5/L3'), L('2/T1'), L('4/T2'), L('6/T3'), C('A1'), C('A2')],
			puentesInternos: [['1/L1', '2/T1'], ['3/L2', '4/T2'], ['5/L3', '6/T3']],
		},
		{
			id: 'f2', tipo: 'rele', clase: 'F', descripcion: 'Relé térmico 7–10 A (regulado a 8,5 A)',
			fabricante: 'Schneider Electric', referencia: 'LRD14', hojaId: 'h1',
			rangoRegulacionA: [7, 10], disipacionW: 5, disipacionEstimada: true,
			bornes: [L('1'), L('3'), L('5'), L('2'), L('4'), L('6'), C('95'), C('96')],
			puentesInternos: [['1', '2'], ['3', '4'], ['5', '6']],
		},
		{
			id: 'x1', tipo: 'bornero', descripcion: 'Bornero de fuerza al ventilador', hojaId: 'h1',
			fabricante: 'Phoenix Contact', referencia: 'UT 6',
			bornes: [C('U'), C('V'), C('W'), PE()],
		},
		{
			id: 'm1', tipo: 'motor', descripcion: 'Ventilador de impulsión 4 kW', campo: true,
			// 4 kW a 380 V con cos φ 0,84 y rendimiento 0,85: ~8,5 A por fase.
			tensionNominal: 380, corrienteNominal: 8.5, polos: 3, hojaId: 'h1',
			bornes: [L('U'), L('V'), L('W'), PE()],
		},
		{
			id: 'x0', tipo: 'bornero', descripcion: 'Bornera de tierra (PE)', hojaId: 'h1',
			fabricante: 'Phoenix Contact', referencia: 'USLKG 6',
			// Una bornera de tierra es una sola pletina con varios tornillos: por eso van puenteadas
			// todas entre sí. Sin ella, la tierra del motor, la de la fuente y la del controlador
			// tendrían que entrar en la misma borna, y en una borna caben dos hilos.
			bornes: [
				{ id: 'PE1', tipo: 'PE' }, { id: 'PE2', tipo: 'PE' },
				{ id: 'PE3', tipo: 'PE' }, { id: 'PE4', tipo: 'PE' },
			],
			puentes: [['PE1', 'PE2', 'PE3', 'PE4']],
		},
		{
			id: 'q2', tipo: 'disyuntor', descripcion: 'Automático 2P C6 (mando y alimentación 24 V)',
			fabricante: 'Schneider Electric', referencia: 'iC60N 2P C6', tensionNominal: 220,
			hojaId: 'h2', corrienteNominal: 6, curvaDisparo: 'C',
			poderCorteKA: 10, disipacionW: 2.5, poderCorteEstimado: true, disipacionEstimada: true,
			bornes: [L('1'), N('3'), L('2'), N('4')],
			puentesInternos: [['1', '2'], ['3', '4']],
		},
		{
			id: 'g1', tipo: 'fuente', descripcion: 'Fuente de alimentación 220/24 V CC 2,5 A',
			fabricante: 'Phoenix Contact', referencia: 'STEP-PS/1AC/24DC/2.5',
			tensionNominal: 220, tensionSecundariaV: 24, corrienteNominal: 0.4,
			disipacionW: 6, disipacionEstimada: true, hojaId: 'h2',
			bornes: [L('L'), N('N'), PE(), C('+V'), C('-V')],
		},
		{
			id: 'f1', tipo: 'fusible', descripcion: 'Portafusible 24 V CC 2 A (bus de control)',
			fabricante: 'Phoenix Contact', referencia: 'UT 4-HESI', tensionNominal: 24,
			corrienteNominal: 2, curvaDisparo: 'gG', hojaId: 'h2',
			bornes: [C('1'), C('2')],
		},
		{
			id: 'k1', tipo: 'rele', descripcion: 'Relé de interposición 24 V CC → mando 220 V',
			fabricante: 'Finder', referencia: '40.52 24VDC', tensionNominal: 24,
			corrienteNominal: 0.017, disipacionW: 0.4, rol: { tipo: 'maestro' }, hojaId: 'h2',
			bornes: [C('A1'), C('A2')],
		},
		{
			id: 'k1na', tipo: 'rele', descripcion: 'Contacto NA de K1 (mete el contactor)',
			rol: { tipo: 'esclavo', maestroId: 'k1', contacto: 'NA' }, hojaId: 'h2',
			bornes: [C('13'), C('14')],
		},
		{
			id: 'a1', tipo: 'plc', descripcion: 'Controlador programable de clima (DDC) 24 V CC',
			fabricante: 'Honeywell', referencia: 'CLM-24DC-6ES', tensionNominal: 24,
			corrienteNominal: 0.2, disipacionW: 4.8, disipacionEstimada: true, hojaId: 'h3',
			/*
			 * LA MANIOBRA ENTERA, EN TRES RENGLONES.
			 *
			 * Léelos de arriba abajo como se lee un esquema de mando. El ventilador (DO1) no mira la
			 * marcha: mira la compuerta (DO2). Eso es lo que ordena la secuencia, y es la diferencia
			 * entre una UMA que arranca bien y una que se lleva por delante los conductos.
			 */
			programa: [
				'DO2 = DI1 Y NO DI2               ; compuerta: abre si se pide marcha y el filtro está limpio',
				'DO1 = DO2 retardo 8 minimo 30    ; ventilador: 8 s después, y una vez en marcha aguanta 30 s',
				'DO3 = DO1 Y UI1 < 21             ; válvula de calor: solo con ventilador y retorno bajo 21 °C',
			].join('\n'),
			bornes: [
				{ id: '+24', tipo: 'control', obligatorio: true },
				{ id: '0V', tipo: 'control', obligatorio: true },
				PE(),
				{ id: 'DI1', tipo: 'senal' }, { id: 'DI2', tipo: 'senal' },
				{ id: 'UI1', tipo: 'senal' },
				{ id: 'DO1', tipo: 'senal' }, { id: 'DO2', tipo: 'senal' }, { id: 'DO3', tipo: 'senal' },
			],
		},
		{
			id: 'x2', tipo: 'bornero', descripcion: 'Bornero de control 24 V CC', hojaId: 'h3',
			fabricante: 'Phoenix Contact', referencia: 'UT 2,5',
			bornes: [
				C('1'), C('2'), C('3'), C('4'), C('5'), C('6'), { id: '7', tipo: 'senal' },
				C('8'), { id: '9', tipo: 'senal' }, C('10'), { id: '11', tipo: 'senal' },
				C('12'), C('13'),
			],
			// Dos peines: el de +24 V (1-3-5) y el de 0 V (2-8-10-12-13). Es literalmente el pontet
			// de latón que se pincha encima de las bornas en el tablero.
			puentes: [['1', '3', '5'], ['2', '8', '10', '12', '13']],
		},
		{
			id: 's0', tipo: 'selector', descripcion: 'Selector MARCHA/PARO de la UMA', campo: true,
			tensionNominal: 24, hojaId: 'h3', bornes: [C('13'), C('14')],
		},
		{
			id: 's1', tipo: 'sensor', descripcion: 'Presostato diferencial de filtro sucio (cierra si se ensucia)',
			fabricante: 'Huba Control', referencia: '604', campo: true,
			tensionNominal: 24, hojaId: 'h3', bornes: [C('13'), C('14')],
		},
		{
			id: 'b1', tipo: 'sensor', descripcion: 'Sonda de temperatura de retorno (Pt1000)',
			fabricante: 'Siemens', referencia: 'QAM2120.040', campo: true, hojaId: 'h3',
			// Lo que la convierte en SONDA y no en contacto: entrega un número, y por eso la
			// simulación le pone un mando con el que mover la temperatura.
			rangoSonda: [-10, 50], unidadSonda: '°C',
			bornes: [{ id: '1', tipo: 'senal' }, C('2')],
		},
		{
			id: 'y1', tipo: 'valvula', descripcion: 'Servomotor de la compuerta de aire exterior 24 V',
			fabricante: 'Belimo', referencia: 'LM24A', campo: true,
			tensionNominal: 24, corrienteNominal: 0.1, hojaId: 'h3',
			bornes: [C('+'), C('-')],
		},
		{
			id: 'y2', tipo: 'valvula', descripcion: 'Válvula de 3 vías de la batería de calor 24 V',
			fabricante: 'Belimo', referencia: 'NR24A', campo: true,
			tensionNominal: 24, corrienteNominal: 0.1, hojaId: 'h3',
			bornes: [C('+'), C('-')],
		},
	];

	p.conductores = [
		// --- Fuerza: red → automático → contactor → térmico → bornero → ventilador ---
		cable(['red', 'L1'], ['q1', '1'], 6, 'marrón'),
		cable(['red', 'L2'], ['q1', '3'], 6, 'negro'),
		cable(['red', 'L3'], ['q1', '5'], 6, 'gris'),
		cable(['q1', '2'], ['km1', '1/L1'], 6, 'marrón'),
		cable(['q1', '4'], ['km1', '3/L2'], 6, 'negro'),
		cable(['q1', '6'], ['km1', '5/L3'], 6, 'gris'),
		cable(['km1', '2/T1'], ['f2', '1'], 6, 'marrón'),
		cable(['km1', '4/T2'], ['f2', '3'], 6, 'negro'),
		cable(['km1', '6/T3'], ['f2', '5'], 6, 'gris'),
		cable(['f2', '2'], ['x1', 'U'], 6, 'marrón'),
		cable(['f2', '4'], ['x1', 'V'], 6, 'negro'),
		cable(['f2', '6'], ['x1', 'W'], 6, 'gris'),
		cable(['x1', 'U'], ['m1', 'U'], 6, 'marrón'),
		cable(['x1', 'V'], ['m1', 'V'], 6, 'negro'),
		cable(['x1', 'W'], ['m1', 'W'], 6, 'gris'),
		// --- Tierras: todo cuelga de la bornera de tierra ---
		cable(['red', 'PE'], ['x0', 'PE1'], 6, 'verde/amarillo'),
		cable(['x0', 'PE2'], ['x1', 'PE'], 6, 'verde/amarillo'),
		cable(['x1', 'PE'], ['m1', 'PE'], 6, 'verde/amarillo'),
		cable(['x0', 'PE3'], ['g1', 'PE'], 1.5, 'verde/amarillo'),
		cable(['x0', 'PE4'], ['a1', 'PE'], 1.5, 'verde/amarillo'),
		// --- Mando 220 V: automático de mando → fuente, y bobina del contactor ---
		// La derivación del mando sale de la acometida, o sea de un tramo que todavía no protege
		// nada del tablero: hasta Q2 tiene que aguantar lo mismo que la entrada, y por eso va en
		// 2,5 mm² y no en 1,5. De Q2 hacia abajo ya manda su calibre de 6 A.
		cable(['red', 'L1'], ['q2', '1'], 2.5, 'marrón'),
		cable(['red', 'N'], ['q2', '3'], 2.5, 'azul'),
		cable(['q2', '2'], ['g1', 'L'], 1.5, 'marrón'),
		cable(['q2', '4'], ['g1', 'N'], 1.5, 'azul'),
		// El contacto del relé de interposición mete la bobina de 220 V, y el retorno pasa POR EL
		// TÉRMICO: esa es la seguridad que no depende del programa.
		cable(['q2', '2'], ['k1na', '13'], 1.5, 'marrón'),
		cable(['k1na', '14'], ['km1', 'A1'], 1.5, 'negro'),
		cable(['km1', 'A2'], ['f2', '95'], 1.5, 'azul'),
		cable(['f2', '96'], ['q2', '4'], 1.5, 'azul'),
		// --- Bus de 24 V CC: fuente → fusible → bornero de control → controlador ---
		cable(['g1', '+V'], ['f1', '1'], 1, 'rojo'),
		cable(['f1', '2'], ['x2', '1'], 1, 'rojo'),
		cable(['g1', '-V'], ['x2', '2'], 1, 'blanco'),
		cable(['x2', '1'], ['a1', '+24'], 1, 'rojo'),
		cable(['x2', '2'], ['a1', '0V'], 1, 'blanco'),
		// --- Entradas digitales: selector de marcha y presostato de filtro ---
		cable(['x2', '3'], ['s0', '13'], 0.75, 'rojo'),
		cable(['s0', '14'], ['x2', '4'], 0.75, 'gris'),
		cable(['x2', '4'], ['a1', 'DI1'], 0.75, 'gris'),
		cable(['x2', '5'], ['s1', '13'], 0.75, 'rojo'),
		cable(['s1', '14'], ['x2', '6'], 0.75, 'gris'),
		cable(['x2', '6'], ['a1', 'DI2'], 0.75, 'gris'),
		// --- Entrada analógica: la sonda de retorno, apantallada ---
		cable(['x2', '7'], ['b1', '1'], 0.5, 'blanco'),
		cable(['b1', '2'], ['x2', '8'], 0.5, 'blanco'),
		cable(['x2', '7'], ['a1', 'UI1'], 0.5, 'blanco'),
		// --- Salidas: relé de interposición, compuerta y válvula ---
		cable(['a1', 'DO1'], ['k1', 'A1'], 0.75, 'gris'),
		cable(['k1', 'A2'], ['x2', '10'], 0.75, 'blanco'),
		cable(['a1', 'DO2'], ['x2', '9'], 0.75, 'gris'),
		cable(['x2', '9'], ['y1', '+'], 0.75, 'gris'),
		cable(['y1', '-'], ['x2', '12'], 0.75, 'blanco'),
		cable(['a1', 'DO3'], ['x2', '11'], 0.75, 'gris'),
		cable(['x2', '11'], ['y2', '+'], 0.75, 'gris'),
		cable(['y2', '-'], ['x2', '13'], 0.75, 'blanco'),
	];

	p.gabinete = {
		ancho: 600,
		alto: 700,
		rieles: [
			{ id: 'r1', x: 30, y: 90, largo: 540 },
			{ id: 'r2', x: 30, y: 280, largo: 540 },
			{ id: 'r3', x: 30, y: 460, largo: 540 },
			{ id: 'r4', x: 30, y: 620, largo: 540 },
		],
		canaletas: [
			{ id: 'c1', x: 20, y: 180, largo: 560, orientacion: 'h', ancho: 40, alto: 60 },
			{ id: 'c2', x: 20, y: 360, largo: 560, orientacion: 'h', ancho: 40, alto: 60 },
			{ id: 'c3', x: 20, y: 540, largo: 560, orientacion: 'h', ancho: 40, alto: 60 },
			{ id: 'c4', x: 20, y: 180, largo: 420, orientacion: 'v', ancho: 40, alto: 60 },
		],
		colocaciones: [
			{ dispositivoId: 'q1', x: 70, y: 47, ancho: 54, alto: 85, rielId: 'r1' },
			{ dispositivoId: 'km1', x: 160, y: 47, ancho: 45, alto: 86, rielId: 'r1' },
			{ dispositivoId: 'f2', x: 240, y: 55, ancho: 45, alto: 70, rielId: 'r1' },
			{ dispositivoId: 'q2', x: 330, y: 50, ancho: 36, alto: 80, rielId: 'r1' },
			{ dispositivoId: 'g1', x: 70, y: 235, ancho: 55, alto: 90, rielId: 'r2' },
			{ dispositivoId: 'f1', x: 160, y: 245, ancho: 18, alto: 70, rielId: 'r2' },
			{ dispositivoId: 'k1', x: 200, y: 245, ancho: 30, alto: 70, rielId: 'r2' },
			{ dispositivoId: 'k1na', x: 235, y: 245, ancho: 20, alto: 70, rielId: 'r2' },
			{ dispositivoId: 'a1', x: 290, y: 235, ancho: 200, alto: 90, rielId: 'r2' },
			{ dispositivoId: 'x1', x: 60, y: 435, ancho: 80, alto: 50, rielId: 'r3' },
			{ dispositivoId: 'x0', x: 160, y: 435, ancho: 80, alto: 50, rielId: 'r3' },
			{ dispositivoId: 'x2', x: 60, y: 595, ancho: 230, alto: 50, rielId: 'r4' },
		],
	};
	return p;
}

/* --------------------------------- Los rótulos --------------------------------- */

/**
 * LOS RÓTULOS DEL TABLERO SON LOS QUE USA SU EXPLICACIÓN, NO OTROS.
 *
 * Es el punto entero de un ejemplo para aprender. La numeración automática reparte letras IEC por
 * orden de aparición, y eso dejaba los cinco tableros contando una cosa y rotulando otra:
 *
 *     la explicación dice        el tablero rotulaba
 *     «la bobina de KM1»         -K1
 *     «el temporizador KT»       -K4
 *     «PARO (S0)»                -S1        ← y -S1 era la MARCHA para quien leyera
 *     «MARCHA (S1)»              -S2
 *     «el térmico F2»            -F1
 *
 * Quien lo lee busca KM1, no lo encuentra, y lo peor: encuentra -S1 y aprieta el botón que no era.
 * Un ejemplo que enseña mal hace más daño que no tener ejemplo.
 *
 * Se fijan a mano con `congelado`, que es exactamente para lo que está —«este rótulo lo elegí yo,
 * no me lo renumeres»—, y con los nombres que se escriben en un tablero de verdad: KM para un
 * contactor, KT para un temporizador, F para una protección, S para un mando.
 */
function rotular(p: Proyecto, rotulos: Record<string, string>): Proyecto {
	for (const [id, designacion] of Object.entries(rotulos)) {
		const d = p.dispositivos.find((x) => x.id === id);
		if (!d) throw new Error(`rotular: el ejemplo no tiene ningún aparato «${id}»`);
		d.designacion = designacion;
		d.congelado = true;
		// El número reservado evita que un aparato sin rotular se lleve el mismo de su clase.
		const n = /(\d+)$/.exec(designacion);
		if (n) d.numero = Number(n[1]);
	}
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
		crear: () => rotular(arranqueDirecto(), {
			red: '-W1', q1: '-Q1', km1: '-KM1', f2: '-F2', x1: '-X1', m1: '-M1',
			f1: '-F1', s0: '-S0', s1: '-S1', x2: '-X2',
		}),
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
		crear: () => rotular(bombaConBoya(), {
			red: '-W1', q1: '-Q1', q2: '-Q2', km1: '-KM1', x1: '-X1', b1: '-B1', m1: '-M1',
		}),
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
		crear: () => rotular(estrellaTriangulo(), {
			red: '-W1', q1: '-Q1', f2: '-F2', km1: '-KM1', km2: '-KM2', km3: '-KM3',
			x1: '-X1', m1: '-M1', f1: '-F1', s0: '-S0', s1: '-S1', kt: '-KT', x2: '-X2',
		}),
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
		crear: () => rotular(tableroEjemplo(), {
			aco: '-W1', x1: '-X1', q1: '-Q1', t1: '-T1', f1: '-F1', a1: '-A1',
			k1: '-K1', k1na: '-K1.1', x2: '-X2', s1: '-B1', y1: '-Y1',
		}),
	},
	{
		id: 'uma-cubierta',
		titulo: 'Climatizador de cubierta (UMA) con controlador',
		resumen: 'El tablero de clima de verdad: la maniobra la lleva el programa del controlador.',
		queHace: 'Gobierna una unidad de tratamiento de aire de cubierta. Al pedir marcha abre la '
			+ 'compuerta de aire exterior, ocho segundos después arranca el ventilador de 4 kW, y abre '
			+ 'la válvula de la batería de calor cuando la sonda de retorno baja de 21 °C. Si el filtro '
			+ 'se ensucia o el térmico dispara, todo se para.',
		comoFunciona: [
			'El automático Q2 alimenta la fuente G1, que reparte 24 V CC por el fusible F1 y el '
			+ 'bornero X2. Con eso vive el controlador A1 y todo lo que va a campo.',
			'El selector S0 pone 24 V en la entrada DI1: es la petición de marcha. El presostato de '
			+ 'filtro S1 hace lo mismo en DI2, pero para avisar de que el filtro está sucio.',
			'Renglón 1 del programa — «DO2 = DI1 Y NO DI2»: con marcha pedida y sin alarma, la salida '
			+ 'DO2 abre el servomotor de la compuerta Y1.',
			'Renglón 2 — «DO1 = DO2 retardo 8 minimo 30»: el ventilador mira a la COMPUERTA, no al '
			+ 'selector, y espera 8 s a que termine de abrir. Una vez en marcha aguanta 30 s aunque le '
			+ 'quiten la orden: es el tiempo mínimo que evita que el motor arranque y pare sin parar.',
			'DO1 no mueve el motor directamente: excita el relé de interposición K1 (24 V CC), y el '
			+ 'contacto de K1 es el que mete la bobina de 220 V del contactor KM1.',
			'Renglón 3 — «DO3 = DO1 Y UI1 < 21»: con el ventilador en marcha, si la sonda B1 marca '
			+ 'menos de 21 °C, DO3 abre la válvula de la batería de calor Y2.',
			'El retorno de la bobina de KM1 pasa por el contacto 95-96 del térmico F2. Si el motor se '
			+ 'sobrecarga, el ventilador para AUNQUE el programa siga diciendo que sí: una seguridad '
			+ 'no se programa, se cablea.',
		],
		aprender: [
			'Abre la ficha del controlador A1: el programa está ahí, en tres renglones que se editan '
			+ 'como texto. Cámbiale el retardo o los 21 °C y vuelve a simular.',
			'Energiza, gira el selector S0 y mira el panel de simulación: verás la cuenta atrás de los '
			+ '8 segundos, y a DO1 encenderse solo cuando se cumple.',
			'Mueve el mando de la sonda B1 por encima de 21 °C: DO3 se cae y la válvula cierra. Bájalo '
			+ 'otra vez y vuelve a abrir. Eso es la regulación funcionando.',
			'Activa el presostato S1 (filtro sucio) con el ventilador en marcha: la compuerta cierra '
			+ 'de inmediato, pero el ventilador aguanta hasta cumplir sus 30 s de mínimo.',
			'Compara con el estrella-triángulo: allí la secuencia estaba hecha con relés y un '
			+ 'temporizador; aquí está escrita. El tablero tiene la mitad de aparatos y hace más.',
		],
		crear: () => rotular(climatizadorCubierta(), {
			red: '-W1', q1: '-Q1', km1: '-KM1', f2: '-F2', x1: '-X1', m1: '-M1', x0: '-X0',
			q2: '-Q2', g1: '-G1', f1: '-F1', k1: '-K1', k1na: '-K1.1', a1: '-A1', x2: '-X2',
			s0: '-S0', s1: '-S1', b1: '-B1', y1: '-Y1', y2: '-Y2',
		}),
	},
];
