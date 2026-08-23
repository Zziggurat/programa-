/**
 * FIXTURE PEQUEÑO DE SEMÁNTICA Y CABLEADO DE PUERTA.
 *
 * No pretende ser otro tablero didáctico grande. Es una escena estable donde conviven las cinco
 * fronteras que más fácilmente se confunden: mando flexible, retorno funcional de 0 V, PE
 * aislado, bonding de la chapa y cable de campo. Los ids son deliberadamente descriptivos para
 * que una regresión pueda explicar qué falló sin depender del orden de ningún array.
 */
import { Conductor, Dispositivo, Proyecto } from '../src/modelo/tipos.js';
import { crearProyecto } from '../src/modelo/proyecto.js';

const extremo = (dispositivoId: string, borneId: string) => ({ dispositivoId, borneId });

const cable = (
	id: string,
	de: [string, string],
	a: [string, string],
	seccion: number,
	color: string,
): Conductor => ({ id, de: extremo(...de), a: extremo(...a), seccion, color });

/** Construye siempre una copia nueva del fixture, lista para guardar, cargar o reordenar. */
export function fixturePuertaSemantica(): Proyecto {
	const p = crearProyecto('Fixture — semántica completa de puerta');
	p.opciones = { iccPresuntaKA: 6, temperaturaAmbienteC: 35, montajeGabinete: 'mural' };
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Mando 24 V y protección de puerta' }];

	const dispositivos: Dispositivo[] = [
		{
			id: 'g1', tipo: 'fuente', designacion: '-G1', congelado: true,
			descripcion: 'Fuente conmutada de mando 220 VAC → 24 VDC',
			fabricante: 'Mean Well', referencia: 'MDR-60-24', tensionNominal: 220,
			bornes: [
				{ id: 'L', tipo: 'L', lado: 'primario' },
				{ id: 'N', tipo: 'N', lado: 'primario' },
				{ id: 'PE', tipo: 'PE' },
				{ id: '+V', tipo: 'control', lado: 'secundario+' },
				{ id: '-V', tipo: 'control', lado: 'secundario-' },
			],
		},
		{
			id: 'x1', tipo: 'bornero', designacion: '-X1', congelado: true,
			descripcion: 'Bornera de mando 24 V y señal de campo',
			bornes: [
				{ id: '+24', tipo: 'control', maxConductores: 2 },
				{ id: '0V', tipo: 'control', maxConductores: 2 },
				{ id: 'SIG', tipo: 'senal' },
			],
		},
		{
			id: 'xpe', tipo: 'bornero', designacion: '-XPE', congelado: true,
			descripcion: 'Borna PE de distribución', fabricante: 'Phoenix Contact', referencia: 'USLKG 5',
			bornes: [{ id: 'PE', tipo: 'PE', maxConductores: 2, seccionMaxMm2: 6 }],
		},
		{
			id: 'h1', tipo: 'piloto', designacion: '-H1', congelado: true,
			descripcion: 'Piloto de puerta — mando presente', fabricante: 'Schneider Electric',
			referencia: 'XB4BVB3', tensionNominal: 24, corrienteNominal: 0.02, colorSenal: 'verde',
			bornes: [{ id: 'X1', tipo: 'control' }, { id: 'X2', tipo: 'control' }],
		},
		{
			id: 'pe-hoja', tipo: 'bornero', designacion: '-XPE.H', congelado: true,
			descripcion: 'Punto PE aislado de la hoja — perno de puesta a tierra M6',
			fabricante: '—', referencia: 'Perno soldado M6',
			bornes: [{ id: 'PE', tipo: 'PE', seccionMaxMm2: 16 }],
		},
		{
			id: 'b1', tipo: 'sensor', designacion: '-B1', congelado: true, campo: true,
			descripcion: 'Sensor inductivo PNP de campo', fabricante: 'Schneider Electric',
			referencia: 'XS612B1PAL2', tensionNominal: 24,
			bornes: [
				{ id: '+24', tipo: 'control' }, { id: '0V', tipo: 'control' },
				{ id: 'OUT', tipo: 'senal' },
			],
		},
	];
	p.dispositivos = dispositivos;

	p.conductores = [
		// Dentro de la placa: la fuente entrega los dos potenciales funcionales a la bornera.
		cable('w-int-24v', ['g1', '+V'], ['x1', '+24'], 1, 'rojo'),
		cable('w-int-0v', ['g1', '-V'], ['x1', '0V'], 1, 'azul'),
		// Mando flexible de puerta: ida de +24 V y retorno funcional de 0 V.
		cable('w-mando', ['x1', '+24'], ['h1', 'X1'], 1, 'rojo'),
		cable('w-0v-puerta', ['x1', '0V'], ['h1', 'X2'], 1, 'azul'),
		// Protección: distribución en placa y conductor aislado que cruza hacia la hoja.
		cable('w-pe-interno', ['g1', 'PE'], ['xpe', 'PE'], 2.5, 'verde/amarillo'),
		cable('w-pe-puerta', ['xpe', 'PE'], ['pe-hoja', 'PE'], 2.5, 'verde/amarillo'),
		// El instalador trae este hilo desde fuera y termina en la bornera: nunca entra al mazo.
		cable('w-campo', ['b1', 'OUT'], ['x1', 'SIG'], 1, 'violeta'),
	];

	p.gabinete = {
		ancho: 500,
		alto: 600,
		caja: {
			ancho: 560, alto: 660, profundidad: 180, bisagras: 'izquierda',
			bonding: { puesto: true, seccion: 6 },
		},
		rieles: [{ id: 'r1', x: 45, y: 170, largo: 410 }],
		canaletas: [
			{ id: 'c1', x: 35, y: 285, largo: 430, orientacion: 'h', ancho: 40, alto: 60 },
		],
		entradas: [
			{ id: 'campo-b1', cara: 'inferior', x: 405, y: 0, tipo: 'prensaestopas', diametro: 20, rosca: 'M20', nombre: 'Sensor B1' },
		],
		colocaciones: [
			{ dispositivoId: 'g1', x: 75, y: 125, ancho: 55, alto: 90, rielId: 'r1' },
			{ dispositivoId: 'x1', x: 200, y: 145, ancho: 75, alto: 56, rielId: 'r1' },
			{ dispositivoId: 'xpe', x: 335, y: 145, ancho: 18, alto: 56, rielId: 'r1' },
			{ dispositivoId: 'h1', x: 300, y: 180, ancho: 30, alto: 30, montaje: 'puerta' },
			{ dispositivoId: 'pe-hoja', x: 86, y: 455, ancho: 28, alto: 28, montaje: 'puerta' },
		],
		rotulos: [
			{ id: 'rot-mando', texto: 'MANDO 24 V', x: 270, y: 225, estilo: 'grabado', montaje: 'puerta' },
			{ id: 'rot-pe', texto: 'PE HOJA', x: 60, y: 495, estilo: 'grabado', montaje: 'puerta' },
		],
	};
	return p;
}
