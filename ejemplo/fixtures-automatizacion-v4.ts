/** Fixtures pequeños de PLC V4. No hay excepciones por id: todo deriva de perfiles, programa y cables. */
import type { Borne, Conductor, Dispositivo, Proyecto, TipoBorne } from '../src/modelo/tipos.js';
import { crearProyecto } from '../src/modelo/proyecto.js';

const bornes = (ids: string[], tipo: TipoBorne = 'control', maxConductores = 4): Borne[] =>
	ids.map((id) => ({ id, tipo, maxConductores }));
const cable = (id: string, de: [string, string], a: [string, string], color = 'violeta'): Conductor => ({
	id, de: { dispositivoId: de[0], borneId: de[1] }, a: { dispositivoId: a[0], borneId: a[1] },
	seccion: 0.75, color,
});

const fuente24 = (): Dispositivo => ({
	id: 'ps24', tipo: 'fuente', designacion: '-G1', congelado: true, tensionSecundariaV: 24,
	descripcion: 'Fuente 24 VDC de automatización', bornes: [...bornes(['+24'], 'L', 12), ...bornes(['0V'], 'N', 12)],
	comportamiento: { version: 1, clase: 'fuente', salidas: [
		{ borne: '+24', papel: 'fase', tensionV: 24 }, { borne: '0V', papel: 'retorno', tensionV: 24 },
	] },
});

const mando = (id: string, designacion: string, descripcion: string): Dispositivo => ({
	id, tipo: 'pulsador', designacion, descripcion, campo: true, congelado: true,
	bornes: bornes(['1', '2']),
	comportamiento: { version: 1, clase: 'mando', modo: 'momentaneo', posiciones: 2, reposo: 0,
		contactos: [{ entrada: '1', salida: '2', reposo: 'abierto', funcion: 'auxiliar' }] },
});

const sensorNivel = (id: string, designacion: string, descripcion: string): Dispositivo => ({
	id, tipo: 'sensor', designacion, descripcion, campo: true, congelado: true,
	bornes: bornes(['1', '2']),
	comportamiento: { version: 1, clase: 'sensor', contactos: [
		{ entrada: '1', salida: '2', reposo: 'abierto', funcion: 'auxiliar' },
	] },
});

const carga24 = (id: string, tipo: 'motor' | 'valvula' | 'piloto', designacion: string, descripcion: string): Dispositivo => ({
	id, tipo, designacion, descripcion, campo: tipo !== 'piloto', congelado: true, tensionNominal: 24,
	corrienteNominal: tipo === 'motor' ? 1.2 : 0.15,
	bornes: bornes(['+', '-']),
	comportamiento: { version: 1, clase: 'carga', alimentacion: { fases: ['+'], retornos: ['-'], fasesMinimas: 1 },
		efecto: tipo === 'motor' ? 'giro' : tipo === 'piloto' ? 'luz' : 'movimiento',
		...(tipo === 'valvula' ? { dinamicaActuador: { tipo: 'on-off' as const, tiempoAperturaS: 1,
			tiempoCierreS: 1, failSafe: 'cerrar' as const } } : {}),
	},
});

/** START → llenar → agitar por tiempo → vaciar; STOP tiene prioridad y genera alarma enclavada. */
export function fixtureAutomatizacionSecuencialV4(): Proyecto {
	const p = crearProyecto('Fixture V4 — proceso secuencial de tanque', { frecuenciaHz: 50, temperaturaAmbienteC: 25 });
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'PLC V4 · secuencia de tanque' }];
	const salidas = ['DO_FILL', 'DO_AGITATE', 'DO_DRAIN', 'DO_ALARM'];
	const plc: Dispositivo = {
		id: 'plc', tipo: 'plc', designacion: '-A1', congelado: true,
		descripcion: 'PLC V4 · secuencia, temporizador, interlocks y alarmas',
		bornes: [...bornes(['+24', '0V']), ...bornes(['START', 'STOP', 'RESET', 'NIVEL_ALTO', 'NIVEL_BAJO'], 'senal'), ...bornes(salidas, 'senal')],
		comportamiento: {
			version: 1, clase: 'controlador', alimentacion: { entradas: ['+24'], retornos: ['0V'] },
			salidasDigitales: salidas.map((borne) => ({ borne, comun: '+24' })), salidasAnalogicas: [],
		},
		programaPLC: {
			version: 1, lenguaje: 'tablerostudio-plc-v4', periodoScanMs: 100, modoInicial: 'RUN',
			FUENTE: [
				'SEQUENCE PROCESO INITIAL REPOSO',
				'TRANS PROCESO REPOSO -> LLENANDO WHEN RISING(START) AND NOT STOP PRIORITY 10',
				'TRANS PROCESO LLENANDO -> AGITANDO WHEN NIVEL_ALTO PRIORITY 10',
				'TON T_AGITA IN PROCESO.AGITANDO PT 2s',
				'TRANS PROCESO AGITANDO -> VACIANDO WHEN T_AGITA.Q PRIORITY 10',
				'TRANS PROCESO VACIANDO -> REPOSO WHEN NIVEL_BAJO PRIORITY 10',
				'TRANS PROCESO LLENANDO -> FALLO WHEN STOP PRIORITY 100',
				'TRANS PROCESO AGITANDO -> FALLO WHEN STOP PRIORITY 100',
				'TRANS PROCESO VACIANDO -> FALLO WHEN STOP PRIORITY 100',
				'TRANS PROCESO FALLO -> REPOSO WHEN RESET PRIORITY 100',
				'DO_FILL := PROCESO.LLENANDO',
				'DO_AGITATE := PROCESO.AGITANDO',
				'DO_DRAIN := PROCESO.VACIANDO',
				'DO_ALARM := PROCESO.FALLO',
				'INTERLOCK DO_FILL REQUIRE NOT NIVEL_ALTO MESSAGE "Nivel alto: llenado inhibido"',
				'INTERLOCK DO_DRAIN REQUIRE NOT NIVEL_BAJO MESSAGE "Nivel bajo: vaciado inhibido"',
				'ALARM PARADA_PROCESO WHEN PROCESO.FALLO SEVERITY TRIP LATCHED MESSAGE "Proceso detenido por STOP"',
			].join('\n'),
		},
	};
	p.dispositivos = [
		fuente24(), plc,
		mando('start', '-S1', 'START'), mando('stop', '-S0', 'STOP'), mando('reset', '-S2', 'RESET / rearme'),
		sensorNivel('nivel-alto', '-B1', 'Nivel alto'), sensorNivel('nivel-bajo', '-B2', 'Nivel bajo'),
		carga24('valvula-llenado', 'valvula', '-Y1', 'Válvula de llenado'),
		carga24('agitador', 'motor', '-M1', 'Agitador'),
		carga24('valvula-vaciado', 'valvula', '-Y2', 'Válvula de vaciado'),
		{ ...carga24('piloto-fallo', 'piloto', '-H1', 'Piloto rojo de fallo'), colorSenal: 'rojo' },
	];
	p.conductores = [
		cable('w-plc-p', ['ps24', '+24'], ['plc', '+24'], 'rojo'), cable('w-plc-n', ['ps24', '0V'], ['plc', '0V'], 'azul'),
		...(['start', 'stop', 'reset', 'nivel-alto', 'nivel-bajo'] as const).flatMap((id, i) => [
			cable(`w-${id}-p`, ['ps24', '+24'], [id, '1'], 'rojo'),
			cable(`w-${id}-di`, [id, '2'], ['plc', ['START', 'STOP', 'RESET', 'NIVEL_ALTO', 'NIVEL_BAJO'][i]]),
		]),
		cable('w-fill', ['plc', 'DO_FILL'], ['valvula-llenado', '+']), cable('w-fill-n', ['valvula-llenado', '-'], ['ps24', '0V'], 'azul'),
		cable('w-agit', ['plc', 'DO_AGITATE'], ['agitador', '+']), cable('w-agit-n', ['agitador', '-'], ['ps24', '0V'], 'azul'),
		cable('w-drain', ['plc', 'DO_DRAIN'], ['valvula-vaciado', '+']), cable('w-drain-n', ['valvula-vaciado', '-'], ['ps24', '0V'], 'azul'),
		cable('w-alarm', ['plc', 'DO_ALARM'], ['piloto-fallo', '+']), cable('w-alarm-n', ['piloto-fallo', '-'], ['ps24', '0V'], 'azul'),
	];
	p.gabinete = {
		ancho: 760, alto: 480, rieles: [{ id: 'r1', x: 35, y: 135, largo: 690 }],
		canaletas: [{ id: 'c1', x: 25, y: 275, largo: 710, orientacion: 'h', ancho: 42, alto: 60 }],
		colocaciones: [
			{ dispositivoId: 'ps24', x: 50, y: 75, ancho: 70, alto: 105, rielId: 'r1' },
			{ dispositivoId: 'plc', x: 155, y: 55, ancho: 170, alto: 145, rielId: 'r1' },
			{ dispositivoId: 'start', x: 355, y: 80, ancho: 42, alto: 80, rielId: 'r1' },
			{ dispositivoId: 'stop', x: 410, y: 80, ancho: 42, alto: 80, rielId: 'r1' },
			{ dispositivoId: 'reset', x: 465, y: 80, ancho: 42, alto: 80, rielId: 'r1' },
			{ dispositivoId: 'nivel-alto', x: 525, y: 80, ancho: 48, alto: 80, rielId: 'r1' },
			{ dispositivoId: 'nivel-bajo', x: 585, y: 80, ancho: 48, alto: 80, rielId: 'r1' },
			{ dispositivoId: 'piloto-fallo', x: 650, y: 85, ancho: 42, alto: 72, rielId: 'r1' },
			{ dispositivoId: 'valvula-llenado', x: 125, y: 345, ancho: 60, alto: 80 },
			{ dispositivoId: 'agitador', x: 345, y: 340, ancho: 76, alto: 90 },
			{ dispositivoId: 'valvula-vaciado', x: 565, y: 345, ancho: 60, alto: 80 },
		],
	};
	return p;
}

/** Transmisor 4–20 mA → PID V1 → AO 0–10 V → válvula modulante. */
export function fixturePIDV4(): Proyecto {
	const p = crearProyecto('Fixture V4 — PID de nivel', { frecuenciaHz: 50, temperaturaAmbienteC: 25 });
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'PLC V4 · PID' }];
	p.dispositivos = [
		fuente24(),
		{
			id: 'lt', tipo: 'sensor', designacion: '-BL1', campo: true, congelado: true, rangoSonda: [0, 100], unidadSonda: '%',
			descripcion: 'Transmisor de nivel 4–20 mA', bornes: bornes(['+24', '0V', 'OUT']),
			comportamiento: { version: 1, clase: 'sensor', contactos: [], alimentacion: { entrada: '+24', retorno: '0V' },
				transmisor: { modoConexion: '3-hilos', modoSalida: 'activa', salida: { borne: 'OUT', comun: '0V', unidad: 'mA', rango: [4, 20] },
					variable: { magnitud: 'nivel', unidad: '%', minimo: 0, maximo: 100 } } },
		},
		{
			id: 'plc', tipo: 'plc', designacion: '-A1', congelado: true, descripcion: 'PLC V4 · PID de nivel',
			bornes: [...bornes(['+24', '0V']), ...bornes(['AI1', 'AIC', 'AO1', 'AOC'], 'senal')],
			comportamiento: { version: 1, clase: 'controlador', alimentacion: { entradas: ['+24'], retornos: ['0V'] }, salidasDigitales: [],
				entradasAnalogicas: [{ borne: 'AI1', comun: 'AIC', unidad: 'mA', rango: [4, 20], modoEntrada: 'pasiva',
					variable: { magnitud: 'nivel', unidad: '%', minimo: 0, maximo: 100 } }],
				salidasAnalogicas: [{ borne: 'AO1', referencia: 'AOC', unidad: 'V', rango: [0, 10] }] },
			programaPLC: { version: 1, lenguaje: 'tablerostudio-plc-v4', periodoScanMs: 100, modoInicial: 'RUN',
				etiquetas: [
					{ nombre: 'PV', tipo: 'REAL', io: { clase: 'AI', borne: 'AI1' } },
					{ nombre: 'CV', tipo: 'REAL', io: { clase: 'AO', borne: 'AO1' } },
				],
				FUENTE: ['VAR REAL SP = 60', 'PID NIVEL PV PV SP SP OUT CV KP 2 TI 8 TD 0 MIN 0 MAX 100 BAD SAFE'].join('\n') },
		},
		{
			id: 'yv', tipo: 'valvula', designacion: '-Y1', campo: true, congelado: true,
			descripcion: 'Válvula modulante de aporte', bornes: bornes(['+24', '0V', 'Y', 'M']),
			comportamiento: { version: 1, clase: 'carga', efecto: 'movimiento', alimentacion: { fases: ['+24'], retornos: ['0V'], fasesMinimas: 1 },
				mandoAnalogico: { borne: 'Y', comun: 'M', unidad: 'V', rango: [0, 10] },
				dinamicaActuador: { tipo: 'modulante', tiempoAperturaS: 5, tiempoCierreS: 5, failSafe: 'cerrar' } },
		},
	];
	p.conductores = [
		cable('p1', ['ps24', '+24'], ['lt', '+24'], 'rojo'), cable('p2', ['ps24', '0V'], ['lt', '0V'], 'azul'),
		cable('p3', ['ps24', '+24'], ['plc', '+24'], 'rojo'), cable('p4', ['ps24', '0V'], ['plc', '0V'], 'azul'),
		cable('p5', ['lt', 'OUT'], ['plc', 'AI1']), cable('p6', ['lt', '0V'], ['plc', 'AIC'], 'azul'),
		cable('p7', ['ps24', '+24'], ['yv', '+24'], 'rojo'), cable('p8', ['ps24', '0V'], ['yv', '0V'], 'azul'),
		cable('p9', ['plc', 'AO1'], ['yv', 'Y']), cable('p10', ['plc', 'AOC'], ['yv', 'M'], 'azul'),
	];
	p.gabinete = { ancho: 560, alto: 390, rieles: [{ id: 'r1', x: 35, y: 125, largo: 490 }], canaletas: [], colocaciones: [
		{ dispositivoId: 'ps24', x: 50, y: 70, ancho: 70, alto: 100, rielId: 'r1' },
		{ dispositivoId: 'plc', x: 175, y: 55, ancho: 145, alto: 130, rielId: 'r1' },
		{ dispositivoId: 'lt', x: 365, y: 75, ancho: 55, alto: 90, rielId: 'r1' },
		{ dispositivoId: 'yv', x: 460, y: 75, ancho: 55, alto: 90, rielId: 'r1' },
	] };
	return p;
}
