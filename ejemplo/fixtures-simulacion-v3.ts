/**
 * Fixtures compactos de Instrumentación y Control Analógico V3.
 *
 * Son proyectos normales y serializables: el cableado y los perfiles persistentes son la única
 * fuente del comportamiento. Los ids facilitan la lectura de las regresiones, pero el motor no
 * contiene excepciones para estos proyectos.
 */
import type { Borne, Conductor, Dispositivo, Proyecto, TipoBorne } from '../src/modelo/tipos.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { fixtureVariadorV2 } from './fixtures-simulacion-v2.js';

const extremo = (dispositivoId: string, borneId: string) => ({ dispositivoId, borneId });
const cable = (id: string, de: [string, string], a: [string, string], color = 'violeta'): Conductor => ({
	id, de: extremo(...de), a: extremo(...a), seccion: 0.75, color,
});
const bornes = (ids: string[], tipo: TipoBorne = 'control', maxConductores = 3): Borne[] =>
	ids.map((id) => ({ id, tipo, maxConductores }));

const fuente24 = (): Dispositivo => ({
	id: 'ps24', tipo: 'fuente', designacion: '-G1', congelado: true,
	descripcion: 'Fuente de instrumentación 24 VDC', tensionSecundariaV: 24,
	bornes: [...bornes(['+24'], 'L', 6), ...bornes(['0V'], 'N', 6)],
	comportamiento: {
		version: 1, clase: 'fuente',
		salidas: [
			{ borne: '+24', papel: 'fase', tensionV: 24 },
			{ borne: '0V', papel: 'retorno', tensionV: 24 },
		],
	},
	fisica: { version: 1, fuente: { sistema: 'DC', tensionNominalV: 24, referencia: '0V',
		fases: [{ borne: '+24', fase: 'POSITIVO' }], rOhm: 0.2 } },
});

/** 4–20 mA de temperatura → AI → ley 20…70 °C → AO 0–10 V → válvula modulante. */
export function fixtureInstrumentacionV3(): Proyecto {
	const p = crearProyecto('Fixture V3 — temperatura, PLC y válvula modulante', {
		frecuenciaHz: 50, temperaturaAmbienteC: 25, montajeGabinete: 'mural',
	});
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Instrumentación V3' }];
	p.dispositivos = [
		fuente24(),
		{
			id: 'tt1', tipo: 'sensor', designacion: '-BT1', congelado: true, campo: true,
			descripcion: 'Transmisor de temperatura 0…100 °C / 4–20 mA, 3 hilos',
			bornes: [...bornes(['+24', '0V']), ...bornes(['OUT'], 'senal')],
			comportamiento: {
				version: 1, clase: 'sensor', contactos: [], alimentacion: { entrada: '+24', retorno: '0V' },
				transmisor: {
					modoConexion: '3-hilos', modoSalida: 'activa',
					salida: { borne: 'OUT', comun: '0V', unidad: 'mA', rango: [4, 20] },
					variable: { magnitud: 'temperatura', unidad: '°C', minimo: 0, maximo: 100 },
				},
			},
			fisica: { version: 1, analogica: { tensionComplianceV: 24, tensionMinimaTransmisorV: 10 } },
		},
		{
			id: 'plc1', tipo: 'plc', designacion: '-A1', congelado: true,
			descripcion: 'Controlador de temperatura con AI, AO y feedback',
			bornes: [
				...bornes(['+24', '0V']), ...bornes(['AI1', 'AIC1', 'AI2', 'AIC2', 'AO1', 'AOC'], 'senal'),
			],
			// A 50 °C, (50 - 20) / (70 - 20) = 60 %, por lo que AO1 entrega 6 V.
			programa: 'AO1 = 0 a 10 según AI1 de 20 a 70',
			comportamiento: {
				version: 1, clase: 'controlador',
				alimentacion: { entradas: ['+24'], retornos: ['0V'] }, salidasDigitales: [],
				entradasAnalogicas: [
					{
						borne: 'AI1', comun: 'AIC1', unidad: 'mA', rango: [4, 20], modoEntrada: 'pasiva',
						variable: { magnitud: 'temperatura', unidad: '°C', minimo: 0, maximo: 100 },
					},
					{
						borne: 'AI2', comun: 'AIC2', unidad: 'mA', rango: [4, 20], modoEntrada: 'pasiva',
						variable: { magnitud: 'posicion', unidad: '%', minimo: 0, maximo: 100 },
					},
				],
				salidasAnalogicas: [{ borne: 'AO1', referencia: 'AOC', unidad: 'V', rango: [0, 10] }],
			},
			fisica: { version: 1, analogica: { burdenOhm: 250 } },
		},
		{
			id: 'yv1', tipo: 'valvula', designacion: '-YV1', congelado: true, campo: true,
			descripcion: 'Válvula modulante 0–10 V con retorno 4–20 mA y cierre de seguridad',
			bornes: [
				...bornes(['+24', '0V']), ...bornes(['Y', 'M', 'FB', 'FBC'], 'senal'),
			],
			comportamiento: {
				version: 1, clase: 'carga', efecto: 'movimiento',
				alimentacion: { fases: ['+24'], retornos: ['0V'], fasesMinimas: 1 },
				mandoAnalogico: { borne: 'Y', comun: 'M', unidad: 'V', rango: [0, 10] },
				dinamicaActuador: {
					tipo: 'modulante', tiempoAperturaS: 10, tiempoCierreS: 8, failSafe: 'cerrar',
					feedback: { borne: 'FB', comun: 'FBC', unidad: 'mA', rango: [4, 20] },
				},
			},
		},
	];
	p.conductores = [
		cable('w-tt-p', ['ps24', '+24'], ['tt1', '+24'], 'rojo'),
		cable('w-tt-n', ['ps24', '0V'], ['tt1', '0V'], 'azul'),
		cable('w-plc-p', ['ps24', '+24'], ['plc1', '+24'], 'rojo'),
		cable('w-plc-n', ['ps24', '0V'], ['plc1', '0V'], 'azul'),
		{ ...cable('w-ai1', ['tt1', 'OUT'], ['plc1', 'AI1']),
			fisica: { material: 'COBRE', longitudManualM: 20, temperaturaC: 20 } },
		{ ...cable('w-aic1', ['tt1', '0V'], ['plc1', 'AIC1'], 'azul'),
			fisica: { material: 'COBRE', longitudManualM: 20, temperaturaC: 20 } },
		cable('w-yv-p', ['ps24', '+24'], ['yv1', '+24'], 'rojo'),
		cable('w-yv-n', ['ps24', '0V'], ['yv1', '0V'], 'azul'),
		cable('w-ao1', ['plc1', 'AO1'], ['yv1', 'Y']),
		cable('w-aoc', ['plc1', 'AOC'], ['yv1', 'M'], 'azul'),
		cable('w-fb', ['yv1', 'FB'], ['plc1', 'AI2'], 'naranja'),
		cable('w-fbc', ['yv1', 'FBC'], ['plc1', 'AIC2'], 'azul'),
	];
	p.gabinete = {
		ancho: 540, alto: 430,
		rieles: [{ id: 'r1', x: 35, y: 125, largo: 470 }],
		canaletas: [{ id: 'c1', x: 25, y: 245, largo: 490, orientacion: 'h', ancho: 40, alto: 60 }],
		colocaciones: [
			{ dispositivoId: 'ps24', x: 55, y: 68, ancho: 70, alto: 100, rielId: 'r1' },
			{ dispositivoId: 'plc1', x: 175, y: 50, ancho: 130, alto: 135, rielId: 'r1' },
			{ dispositivoId: 'tt1', x: 345, y: 72, ancho: 55, alto: 90, rielId: 'r1' },
			{ dispositivoId: 'yv1', x: 430, y: 72, ancho: 60, alto: 90, rielId: 'r1' },
		],
	};
	return p;
}

/** Fixture VFD V2 enriquecido con una referencia 4–20 mA físicamente cableada. */
export function fixtureReferenciaVfdV3(): Proyecto {
	const p = fixtureVariadorV2();
	p.nombre = 'Fixture V3 — referencia 4–20 mA hacia VFD';
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'VFD con referencia analógica V3' }];
	// El fixture V3 añade aparatos y, por tanto, carga térmica al gabinete. Los hilos protegidos
	// por Q1 se declaran en 1,5 mm² para que el ejemplo siga siendo constructivamente válido.
	p.conductores = p.conductores.map((c) => c.seccion === 1 ? { ...c, seccion: 1.5 } : c);
	const vfd = p.dispositivos.find((d) => d.id === 'vfd')!;
	if (vfd.comportamiento?.clase !== 'variador') throw new Error('El fixture V2 perdió su perfil VFD');
	vfd.comportamiento.referencia = {
		borne: 'AI', comun: 'COM', unidad: 'mA', rango: [4, 20], perdidaSenal: 'fallo',
	};
	p.dispositivos.push(
		fuente24(),
		{
			id: 'ref1', tipo: 'sensor', designacion: '-BR1', congelado: true,
			descripcion: 'Referencia de velocidad 0…100 % / 4–20 mA',
			bornes: [...bornes(['+24', '0V']), ...bornes(['OUT'], 'senal')],
			comportamiento: {
				version: 1, clase: 'sensor', contactos: [], alimentacion: { entrada: '+24', retorno: '0V' },
				transmisor: {
					modoConexion: '3-hilos', modoSalida: 'activa',
					salida: { borne: 'OUT', comun: '0V', unidad: 'mA', rango: [4, 20] },
					variable: { magnitud: 'referencia-velocidad', unidad: '%', minimo: 0, maximo: 100 },
				},
			},
		},
	);
	p.conductores.push(
		cable('w-ref-p', ['ps24', '+24'], ['ref1', '+24'], 'rojo'),
		cable('w-ref-n', ['ps24', '0V'], ['ref1', '0V'], 'azul'),
		cable('w-ref-ai', ['ref1', 'OUT'], ['vfd', 'AI']),
		cable('w-ref-com', ['ref1', '0V'], ['vfd', 'COM'], 'azul'),
	);
	p.gabinete!.colocaciones.push(
		{ dispositivoId: 'ps24', x: 315, y: 58, ancho: 65, alto: 100, rielId: 'r1' },
		{ dispositivoId: 'ref1', x: 410, y: 72, ancho: 55, alto: 86, rielId: 'r1' },
	);
	return p;
}
