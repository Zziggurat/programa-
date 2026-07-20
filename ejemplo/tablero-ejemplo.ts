/**
 * Proyecto de ejemplo: tablero de control pequeño.
 *
 * Réplica aproximada de un tablero real: acometida 220 V → interruptor automático →
 * transformador 220/24 V → fusible → controlador (PLC), un relé comandado por el PLC,
 * bornero de fuerza X y bornero de control, con sensor y válvula en campo.
 */
import { Proyecto } from '../src/modelo/tipos.js';
import { crearProyecto } from '../src/modelo/proyecto.js';

export function tableroEjemplo(): Proyecto {
	const p = crearProyecto('Tablero de control — ejemplo');

	p.hojas = [
		{ id: 'h1', numero: 1, titulo: 'Alimentación 220 V / 24 V' },
		{ id: 'h2', numero: 2, titulo: 'Control y salidas' },
	];

	p.dispositivos = [
		{
			id: 'aco', tipo: 'otro', clase: 'W', descripcion: 'Acometida 220 V', campo: true,
			funcion: '', ubicacion: '', hojaId: 'h1', posicion: { x: 0, y: 0 },
			bornes: [
				{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' }, { id: 'PE', tipo: 'PE' },
			],
		},
		{
			id: 'x1', tipo: 'bornero', descripcion: 'Bornero de fuerza',
			fabricante: 'Phoenix Contact', referencia: 'UT 4',
			hojaId: 'h1', posicion: { x: 1, y: 0 },
			bornes: [
				{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' }, { id: 'PE', tipo: 'PE' },
			],
		},
		{
			id: 'q1', tipo: 'disyuntor', descripcion: 'Interruptor automático 2P 6 A',
			fabricante: 'Schneider Electric', referencia: 'iC60N 2P C6', tensionNominal: 220,
			hojaId: 'h1', posicion: { x: 2, y: 0 },
			bornes: [
				{ id: '1', tipo: 'L', obligatorio: true }, { id: '2', tipo: 'L', obligatorio: true },
				{ id: '3', tipo: 'N', obligatorio: true }, { id: '4', tipo: 'N', obligatorio: true },
			],
		},
		{
			id: 't1', tipo: 'transformador', descripcion: 'Transformador 220/24 V 3 A',
			fabricante: 'Genérico', referencia: 'TRF-220-24-72VA',
			hojaId: 'h1', posicion: { x: 4, y: 0 },
			bornes: [
				{ id: 'P1', tipo: 'L' }, { id: 'P2', tipo: 'N' },
				{ id: 'S1', tipo: 'control' }, { id: 'S2', tipo: 'control' },
			],
		},
		{
			id: 'f1', tipo: 'fusible', descripcion: 'Portafusible 24 V 3 A',
			fabricante: 'Phoenix Contact', referencia: 'UT 4-HESI', tensionNominal: 24,
			hojaId: 'h1', posicion: { x: 6, y: 0 },
			bornes: [{ id: '1', tipo: 'control' }, { id: '2', tipo: 'control' }],
		},
		{
			id: 'a1', tipo: 'plc', descripcion: 'Controlador programable 24 V',
			fabricante: 'Genérico', referencia: 'CTRL-24DC', tensionNominal: 24,
			hojaId: 'h2', posicion: { x: 1, y: 0 },
			bornes: [
				{ id: '+24', tipo: 'control', obligatorio: true },
				{ id: '0V', tipo: 'control', obligatorio: true },
				{ id: 'PE', tipo: 'PE' },
				{ id: 'DI1', tipo: 'senal' },
				{ id: 'DO1', tipo: 'senal' },
			],
		},
		{
			id: 'k1', tipo: 'rele', descripcion: 'Relé auxiliar 24 V', rol: { tipo: 'maestro' },
			fabricante: 'Finder', referencia: '40.52 24VDC', tensionNominal: 24,
			hojaId: 'h2', posicion: { x: 3, y: 2 },
			bornes: [{ id: 'A1', tipo: 'control' }, { id: 'A2', tipo: 'control' }],
		},
		{
			id: 'k1na', tipo: 'rele', descripcion: 'Contacto NA de K1',
			rol: { tipo: 'esclavo', maestroId: 'k1', contacto: 'NA' },
			hojaId: 'h2', posicion: { x: 5, y: 1 },
			bornes: [{ id: '13', tipo: 'control' }, { id: '14', tipo: 'control' }],
		},
		{
			id: 'x2', tipo: 'bornero', descripcion: 'Bornero de control',
			fabricante: 'Phoenix Contact', referencia: 'UT 2,5',
			hojaId: 'h2', posicion: { x: 7, y: 0 },
			bornes: [
				{ id: '1', tipo: 'control' }, { id: '2', tipo: 'control' },
				{ id: '3', tipo: 'senal' }, { id: '4', tipo: 'control' },
				{ id: '5', tipo: 'senal' }, { id: '6', tipo: 'control' },
				{ id: '7', tipo: 'control' }, // borna de reserva (el plan la marcará "sin uso")
			],
			puentes: [['1', '6'], ['2', '4']],
		},
		{
			id: 's1', tipo: 'sensor', descripcion: 'Sensor inductivo 24 V PNP', campo: true,
			fabricante: 'ifm', referencia: 'IFT200', tensionNominal: 24,
			hojaId: 'h2', posicion: { x: 7, y: 2 },
			bornes: [
				{ id: '+', tipo: 'control' }, { id: '-', tipo: 'control' }, { id: 'OUT', tipo: 'senal' },
			],
		},
		{
			id: 'y1', tipo: 'valvula', descripcion: 'Electroválvula 24 V', campo: true,
			fabricante: 'SMC', referencia: 'SY5120', tensionNominal: 24,
			hojaId: 'h2', posicion: { x: 7, y: 3 },
			bornes: [{ id: '+', tipo: 'control' }, { id: '-', tipo: 'control' }],
		},
	];

	let n = 0;
	const c = (
		de: [string, string], a: [string, string],
		seccion?: number, color?: string,
	) => ({
		id: `c${++n}`,
		de: { dispositivoId: de[0], borneId: de[1] },
		a: { dispositivoId: a[0], borneId: a[1] },
		seccion, color,
	});

	p.conductores = [
		// Acometida → bornero de fuerza (lado campo)
		c(['aco', 'L'], ['x1', 'L'], 6, 'negro'),
		c(['aco', 'N'], ['x1', 'N'], 6, 'azul'),
		c(['aco', 'PE'], ['x1', 'PE'], 6, 'verde/amarillo'),
		// Fuerza 220 V
		c(['x1', 'L'], ['q1', '1'], 2.5, 'negro'),
		c(['x1', 'N'], ['q1', '3'], 2.5, 'azul'),
		c(['q1', '2'], ['t1', 'P1'], 2.5, 'negro'),
		c(['q1', '4'], ['t1', 'P2'], 2.5, 'azul'),
		// Secundario 24 V
		c(['t1', 'S1'], ['f1', '1'], 1, 'rojo'),
		c(['f1', '2'], ['a1', '+24'], 1, 'rojo'),
		c(['t1', 'S2'], ['a1', '0V'], 1, 'blanco'),
		c(['a1', 'PE'], ['x1', 'PE'], 1.5, 'verde/amarillo'),
		// Distribución 24 V al bornero de control
		c(['f1', '2'], ['x2', '1'], 1, 'rojo'),
		c(['a1', '0V'], ['x2', '2'], 1, 'blanco'),
		// Mando del relé
		c(['a1', 'DO1'], ['k1', 'A1'], 0.75, 'gris'),
		c(['k1', 'A2'], ['x2', '2'], 0.75, 'blanco'),
		// Contacto del relé → válvula en campo
		c(['x2', '1'], ['k1na', '13'], 0.75, 'rojo'),
		c(['k1na', '14'], ['x2', '5'], 0.75, 'gris'),
		c(['x2', '5'], ['y1', '+'], 0.75, 'gris'),
		c(['y1', '-'], ['x2', '4'], 0.75, 'blanco'),
		// Sensor en campo
		c(['s1', '+'], ['x2', '6'], 0.5, 'marrón'),
		c(['s1', '-'], ['x2', '4'], 0.5, 'azul'),
		c(['s1', 'OUT'], ['x2', '3'], 0.5, 'negro'),
		c(['x2', '3'], ['a1', 'DI1'], 0.5, 'negro'),
	];

	// Gabinete 400×600 mm: tres filas de aparatos sobre rieles DIN, tres canaletas
	// horizontales y una vertical que las une (como el tablero de la foto).
	p.gabinete = {
		ancho: 380,
		alto: 580,
		rieles: [
			{ id: 'riel1', x: 30, y: 40, largo: 320 },
			{ id: 'riel2', x: 30, y: 200, largo: 320 },
			{ id: 'riel3', x: 30, y: 370, largo: 320 },
		],
		canaletas: [
			{ id: 'ch1', x: 20, y: 110, largo: 340, orientacion: 'h', ancho: 40, alto: 60 },
			{ id: 'ch2', x: 20, y: 270, largo: 340, orientacion: 'h', ancho: 40, alto: 60 },
			{ id: 'ch3', x: 20, y: 440, largo: 340, orientacion: 'h', ancho: 40, alto: 60 },
			{ id: 'cv1', x: 20, y: 110, largo: 330, orientacion: 'v', ancho: 40, alto: 60 },
		],
		colocaciones: [
			{ dispositivoId: 'x1', x: 40, y: 30, ancho: 60, alto: 60, rielId: 'riel1' },
			{ dispositivoId: 'q1', x: 110, y: 25, ancho: 36, alto: 70, rielId: 'riel1' },
			{ dispositivoId: 't1', x: 220, y: 25, ancho: 90, alto: 75, rielId: 'riel1' },
			{ dispositivoId: 'a1', x: 60, y: 190, ancho: 200, alto: 60, rielId: 'riel2' },
			{ dispositivoId: 'k1', x: 280, y: 190, ancho: 30, alto: 60, rielId: 'riel2' },
			{ dispositivoId: 'k1na', x: 315, y: 190, ancho: 20, alto: 60, rielId: 'riel2' },
			{ dispositivoId: 'f1', x: 40, y: 360, ancho: 20, alto: 60, rielId: 'riel3' },
			{ dispositivoId: 'x2', x: 80, y: 360, ancho: 140, alto: 55, rielId: 'riel3' },
		],
	};

	return p;
}
