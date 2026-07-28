/**
 * Controladores REALES de automatización de edificios (BMS/HVAC).
 *
 * El problema de fondo: no se puede modelar en 3D, uno a uno, cada controlador del
 * mercado. La solución aquí es modelar la CLASE y describir cada equipo con una ficha
 * de datos: huella en mm, borneras (dónde están y qué bornes llevan, con los rótulos
 * serigrafiados del fabricante) y rasgos del frente. Un único constructor 3D genérico
 * (`controlador()` en dispositivos3d.ts) dibuja cualquiera de ellos con exactitud
 * suficiente para diseñar el tablero: la huella es la de verdad y los cables salen del
 * terminal que toca. Añadir un modelo nuevo son ~20 líneas de datos, no trabajo 3D.
 *
 * MEDIDAS: `medidas: 'hoja-de-datos'` significa que están tomadas de la documentación
 * del fabricante; `'nominal'` significa que son una estimación razonable de la familia
 * y HAY QUE CONTRASTARLAS con la hoja de datos antes de fabricar. En ambos casos las
 * dimensiones son editables por instancia desde el inspector.
 */
import { BloqueTerminales, TipoBorne } from '../src/modelo/tipos.js';

export interface FichaControlador {
	id: string;
	/** Nombre corto para el catálogo. */
	nombre: string;
	fabricante: string;
	/** Familia comercial: ComfortPoint Open, Desigo, Metasys, SpaceLogic… */
	familia: string;
	/** Número de pedido real del fabricante. */
	referencia: string;
	descripcion: string;
	/** Huella sobre la placa (mm) y fondo (mm). */
	ancho: number;
	alto: number;
	profundidad: number;
	/** Procedencia de las medidas: de la hoja de datos, o estimación de la familia. */
	medidas: 'hoja-de-datos' | 'nominal';
	montaje: 'riel' | 'pared' | 'riel-o-pared';
	/** Tensión de alimentación del controlador (V). */
	tension: number;
	/** Bus de campo / comunicación. */
	bus: string;
	/** Nº de puntos de E/S de la ficha del fabricante. */
	puntos: number;
	/** Desglose legible de la E/S, para el catálogo y el dossier. */
	entradasSalidas: string;
	/** Rasgos del frente que se dibujan en 3D. */
	frente: { display?: boolean; leds?: number; puertosIP?: number; puertosRS485?: number };
	bloques: BloqueTerminales[];
	color: string;
}

/** Serie de terminales correlativos: rango('UI', 1, 6) → UI1…UI6. */
const rango = (prefijo: string, desde: number, hasta: number): string[] =>
	Array.from({ length: hasta - desde + 1 }, (_, i) => `${prefijo}${desde + i}`);

/** Colores de conector más habituales, para distinguir las borneras de un vistazo. */
const CONECTOR = {
	alimentacion: '#c0392b',
	bus: '#2f7fb8',
	entradas: '#3f8f4f',
	salidas: '#c98b18',
	neutro: '#4a5158',
};

/**
 * Naturaleza eléctrica de un terminal deducida de su rótulo. La usa el DRC y la
 * numeración de potenciales: una entrada universal no es lo mismo que una fase.
 */
export function naturalezaTerminal(rotulo: string): TipoBorne {
	const t = rotulo.toUpperCase().trim();
	if (/^(PE|GND|EARTH|TIERRA|⏚)/.test(t)) return 'PE';
	if (/^(24V|~|G0|G$|HOT|COM|0V|\+24|R$|C$|24 ?VAC|24 ?VDC)/.test(t)) return 'control';
	if (/^(MS\/TP|RS485|FC|SA|SYLK|CE|A1|B1|SHLD|SHIELD|PL-LINK)/.test(t)) return 'senal';
	return 'senal';
}

export const CONTROLADORES: FichaControlador[] = [
	/* ------------------------------- Honeywell ------------------------------- */
	{
		id: 'hw-spyder-pub6438s',
		nombre: 'Honeywell Spyder PUB6438S',
		fabricante: 'Honeywell',
		familia: 'Spyder BACnet',
		referencia: 'PUB6438S',
		descripcion: 'Controlador unitario programable BACnet MS/TP con bus Sylk de 2 hilos',
		ancho: 138, alto: 174, profundidad: 57,
		medidas: 'hoja-de-datos',
		montaje: 'riel-o-pared',
		tension: 24,
		bus: 'BACnet MS/TP (RS-485) + Sylk',
		puntos: 21,
		entradasSalidas: '6 UI · 4 DI · 3 AO · 8 DO triac',
		frente: { leds: 4, puertosRS485: 1 },
		color: '#3a4247',
		bloques: [
			{ rotulo: 'Alimentación', lado: 'izquierda', desde: 0, hasta: 0.42, extraible: true, color: CONECTOR.alimentacion,
				bornes: ['24V~', '24V COM', 'GND'] },
			{ rotulo: 'MS/TP + Sylk', lado: 'izquierda', desde: 0.48, hasta: 1, extraible: true, color: CONECTOR.bus,
				bornes: ['MS/TP+', 'MS/TP-', 'SHLD', 'SYLK1', 'SYLK2'] },
			{ rotulo: 'Entradas universales', lado: 'arriba', extraible: true, color: CONECTOR.entradas,
				bornes: [...rango('UI', 1, 6), 'UIC1', 'UIC2'] },
			{ rotulo: 'Entradas digitales', lado: 'abajo', desde: 0, hasta: 0.46, extraible: true, color: CONECTOR.entradas,
				bornes: [...rango('DI', 1, 4), 'DIC'] },
			{ rotulo: 'Salidas analógicas', lado: 'abajo', desde: 0.54, hasta: 1, extraible: true, color: CONECTOR.salidas,
				bornes: [...rango('AO', 1, 3), 'AOC'] },
			{ rotulo: 'Salidas triac', lado: 'derecha', extraible: true, color: CONECTOR.salidas,
				bornes: [...rango('DO', 1, 8), 'DOC'] },
		],
	},
	{
		id: 'hw-ciper-30',
		nombre: 'Honeywell CIPer Model 30',
		fabricante: 'Honeywell',
		familia: 'CIPer',
		referencia: 'WEB-C3036EPUBNH',
		descripcion: 'Controlador BMS IP con dos puertos Ethernet en anillo, ampliable con módulos de E/S',
		ancho: 144, alto: 110, profundidad: 65,
		medidas: 'nominal',
		montaje: 'riel',
		tension: 24,
		bus: 'BACnet/IP (2 × Ethernet, arquitectura en anillo)',
		puntos: 12,
		entradasSalidas: '3 UI · 3 UIO · 6 BO',
		frente: { leds: 6, puertosIP: 2, puertosRS485: 1 },
		color: '#2b3238',
		bloques: [
			{ rotulo: 'Alimentación', lado: 'izquierda', extraible: true, color: CONECTOR.alimentacion,
				bornes: ['24V~', '24V COM', 'GND'] },
			{ rotulo: 'Entradas', lado: 'arriba', extraible: true, color: CONECTOR.entradas,
				bornes: [...rango('UI', 1, 3), 'UIC', ...rango('UIO', 1, 3), 'UIOC'] },
			{ rotulo: 'Salidas binarias', lado: 'abajo', extraible: true, color: CONECTOR.salidas,
				bornes: [...rango('BO', 1, 6), 'BOC1', 'BOC2'] },
			{ rotulo: 'RS-485', lado: 'derecha', extraible: true, color: CONECTOR.bus,
				bornes: ['RS485+', 'RS485-', 'SHLD'] },
		],
	},
	{
		id: 'hw-cp-spc',
		nombre: 'Honeywell ComfortPoint CP-SPC',
		fabricante: 'Honeywell',
		familia: 'ComfortPoint Open',
		referencia: 'CP-SPC',
		descripcion: 'Controlador de planta modular BACnet nativo para UMA y VAV, borneras extraíbles',
		ancho: 144, alto: 110, profundidad: 60,
		medidas: 'nominal',
		montaje: 'riel-o-pared',
		tension: 24,
		bus: 'BACnet MS/TP (RS-485) o BACnet/IP',
		puntos: 18,
		entradasSalidas: '8 UI · 4 AO · 6 DO',
		frente: { leds: 5, puertosRS485: 1 },
		color: '#333b40',
		bloques: [
			{ rotulo: 'Alimentación', lado: 'izquierda', extraible: true, color: CONECTOR.alimentacion,
				bornes: ['24V~', '24V COM', 'GND'] },
			{ rotulo: 'Entradas universales', lado: 'arriba', extraible: true, color: CONECTOR.entradas,
				bornes: [...rango('UI', 1, 8), 'UIC1', 'UIC2'] },
			{ rotulo: 'Salidas analógicas', lado: 'abajo', desde: 0, hasta: 0.46, extraible: true, color: CONECTOR.salidas,
				bornes: [...rango('AO', 1, 4), 'AOC'] },
			{ rotulo: 'Salidas digitales', lado: 'abajo', desde: 0.54, hasta: 1, extraible: true, color: CONECTOR.salidas,
				bornes: [...rango('DO', 1, 6), 'DOC'] },
			{ rotulo: 'MS/TP', lado: 'derecha', extraible: true, color: CONECTOR.bus,
				bornes: ['MS/TP+', 'MS/TP-', 'SHLD'] },
		],
	},

	/* ---------------------------- Schneider Electric ---------------------------- */
	{
		id: 'se-aspspacelogic',
		nombre: 'Schneider SpaceLogic AS-P',
		fabricante: 'Schneider Electric',
		familia: 'SpaceLogic (EcoStruxure Building)',
		referencia: 'SXWASPXXX10002',
		descripcion: 'Servidor de automatización con gráficos web; 2 puertos IP y 2 RS-485 (BACnet/Modbus)',
		ancho: 90, alto: 114, profundidad: 64,
		medidas: 'hoja-de-datos',
		montaje: 'riel',
		tension: 24,
		bus: '2 × Ethernet 10/100 + 2 × RS-485 (BACnet MS/TP, Modbus RTU)',
		puntos: 0,
		entradasSalidas: 'Sin E/S a bordo (se amplía con módulos SpaceLogic IP-IO)',
		frente: { leds: 8, puertosIP: 2, puertosRS485: 2 },
		color: '#3c4348',
		bloques: [
			{ rotulo: 'Alimentación 24 V', lado: 'arriba', extraible: true, color: CONECTOR.alimentacion,
				bornes: ['G', 'G0', 'PE'] },
			{ rotulo: 'RS-485 A', lado: 'abajo', desde: 0, hasta: 0.46, extraible: true, color: CONECTOR.bus,
				bornes: ['A+', 'A-', 'AS'] },
			{ rotulo: 'RS-485 B', lado: 'abajo', desde: 0.54, hasta: 1, extraible: true, color: CONECTOR.bus,
				bornes: ['B+', 'B-', 'BS'] },
		],
	},
	{
		id: 'se-mp-c-18a',
		nombre: 'Schneider SpaceLogic MP-C 18A',
		fabricante: 'Schneider Electric',
		familia: 'SpaceLogic (EcoStruxure Building)',
		referencia: 'SXWMPC18A10001',
		descripcion: 'Controlador IP de sala de máquinas, 18 puntos, encadenable por Ethernet',
		ancho: 153, alto: 110, profundidad: 64,
		medidas: 'hoja-de-datos',
		montaje: 'riel',
		tension: 24,
		bus: 'BACnet/IP (2 × Ethernet en cascada)',
		puntos: 18,
		entradasSalidas: '10 E/S universales Ub · 4 salidas triac · 3 relés Form A · 1 relé de alto poder',
		frente: { leds: 6, puertosIP: 2 },
		color: '#37413f',
		bloques: [
			{ rotulo: 'Alimentación', lado: 'izquierda', extraible: true, color: CONECTOR.alimentacion,
				bornes: ['24V~', '24V COM', 'PE'] },
			{ rotulo: 'E/S universales 1-5', lado: 'arriba', desde: 0, hasta: 0.47, extraible: true, color: CONECTOR.entradas,
				bornes: [...rango('UIO', 1, 5), 'COM1'] },
			{ rotulo: 'E/S universales 6-10', lado: 'arriba', desde: 0.53, hasta: 1, extraible: true, color: CONECTOR.entradas,
				bornes: [...rango('UIO', 6, 10), 'COM2'] },
			{ rotulo: 'Salidas triac', lado: 'abajo', desde: 0, hasta: 0.47, extraible: true, color: CONECTOR.salidas,
				bornes: [...rango('DO', 1, 4), 'DOC'] },
			{ rotulo: 'Relés', lado: 'abajo', desde: 0.53, hasta: 1, extraible: true, color: CONECTOR.salidas,
				bornes: ['R1', 'R2', 'R3', 'RC', 'HP1', 'HP2'] },
		],
	},
	{
		id: 'se-se8350',
		nombre: 'Schneider SE8350 (sala)',
		fabricante: 'Schneider Electric',
		familia: 'SpaceLogic SE8000',
		referencia: 'SE8350U0B11',
		descripcion: 'Termostato táctil y DDC programable para fancoil; montaje en pared, BACnet MS/TP',
		ancho: 119, alto: 119, profundidad: 27,
		medidas: 'nominal',
		montaje: 'pared',
		tension: 24,
		bus: 'BACnet MS/TP (RS-485) o ZigBee',
		puntos: 10,
		entradasSalidas: '3 velocidades de ventilador · 2 válvulas · entradas auxiliares',
		frente: { display: true, leds: 0 },
		color: '#e6e8ea',
		bloques: [
			{ rotulo: 'Alimentación y salidas', lado: 'abajo', desde: 0, hasta: 0.62, color: CONECTOR.alimentacion,
				bornes: ['C', 'R', 'G-H', 'G-M', 'G-L', 'Y1', 'Y2', 'W1'] },
			{ rotulo: 'Bus', lado: 'abajo', desde: 0.7, hasta: 1, color: CONECTOR.bus,
				bornes: ['RS+', 'RS-'] },
		],
	},

	/* --------------------------------- Siemens --------------------------------- */
	{
		id: 'si-pxc4-e16',
		nombre: 'Siemens Desigo PXC4.E16',
		fabricante: 'Siemens',
		familia: 'Desigo',
		referencia: 'PXC4.E16',
		descripcion: 'Estación de automatización compacta BACnet/IP con Wi-Fi integrado, 16 puntos',
		ancho: 198, alto: 183, profundidad: 49,
		medidas: 'hoja-de-datos',
		montaje: 'riel-o-pared',
		tension: 24,
		bus: 'BACnet/IP (Ethernet + Wi-Fi nativo)',
		puntos: 16,
		entradasSalidas: '12 E/S universales · 4 salidas de relé',
		frente: { leds: 8, puertosIP: 2 },
		color: '#2f3a3f',
		bloques: [
			{ rotulo: 'AC 24 V', lado: 'izquierda', extraible: true, color: CONECTOR.alimentacion,
				bornes: ['G', 'G0', 'PE'] },
			{ rotulo: 'E/S universales X1', lado: 'arriba', desde: 0, hasta: 0.47, extraible: true, color: CONECTOR.entradas,
				bornes: [...rango('U', 1, 6), 'M1'] },
			{ rotulo: 'E/S universales X2', lado: 'arriba', desde: 0.53, hasta: 1, extraible: true, color: CONECTOR.entradas,
				bornes: [...rango('U', 7, 12), 'M2'] },
			{ rotulo: 'Salidas de relé', lado: 'abajo', extraible: true, color: CONECTOR.salidas,
				bornes: [...rango('Q', 1, 4), 'QC1', 'QC2'] },
		],
	},
	{
		id: 'si-pxc5-e24',
		nombre: 'Siemens Desigo PXC5.E24',
		fabricante: 'Siemens',
		familia: 'Desigo',
		referencia: 'PXC5.E24',
		descripcion: 'Estación de gestión y router maestro para plantas primarias, 24 puntos ampliables',
		ancho: 245, alto: 183, profundidad: 49,
		medidas: 'nominal',
		montaje: 'riel-o-pared',
		tension: 24,
		bus: 'BACnet/IP + router BACnet MS/TP',
		puntos: 24,
		entradasSalidas: '8 E/S universales · 8 E/S super-universales · 2 DI · 6 salidas de relé',
		frente: { display: true, leds: 10, puertosIP: 2, puertosRS485: 1 },
		color: '#2f3a3f',
		bloques: [
			{ rotulo: 'AC 24 V', lado: 'izquierda', desde: 0, hasta: 0.45, extraible: true, color: CONECTOR.alimentacion,
				bornes: ['G', 'G0', 'PE'] },
			{ rotulo: 'MS/TP', lado: 'izquierda', desde: 0.55, hasta: 1, extraible: true, color: CONECTOR.bus,
				bornes: ['MS+', 'MS-', 'MSREF'] },
			{ rotulo: 'E/S universales X1', lado: 'arriba', desde: 0, hasta: 0.47, extraible: true, color: CONECTOR.entradas,
				bornes: [...rango('U', 1, 8), 'M1'] },
			{ rotulo: 'E/S super-universales X2', lado: 'arriba', desde: 0.53, hasta: 1, extraible: true, color: CONECTOR.entradas,
				bornes: [...rango('X', 1, 8), 'M2'] },
			{ rotulo: 'Entradas digitales', lado: 'abajo', desde: 0, hasta: 0.3, extraible: true, color: CONECTOR.entradas,
				bornes: ['D1', 'D2', 'DM'] },
			{ rotulo: 'Salidas de relé', lado: 'abajo', desde: 0.38, hasta: 1, extraible: true, color: CONECTOR.salidas,
				bornes: [...rango('Q', 1, 6), 'QC1', 'QC2'] },
		],
	},
	{
		id: 'si-dxr2-e18',
		nombre: 'Siemens Desigo DXR2.E18',
		fabricante: 'Siemens',
		familia: 'Desigo Room Automation',
		referencia: 'DXR2.E18',
		descripcion: 'Estación de automatización de sala: clima, luz y persianas. BACnet/IP, KNX PL-Link',
		ancho: 180, alto: 105, profundidad: 60,
		medidas: 'hoja-de-datos',
		montaje: 'riel-o-pared',
		tension: 24,
		bus: 'BACnet/IP · KNX PL-Link',
		puntos: 18,
		entradasSalidas: '6 entradas universales · 6 salidas · 2 PL-Link',
		frente: { leds: 6, puertosIP: 2 },
		color: '#33403c',
		bloques: [
			{ rotulo: 'AC 24 V', lado: 'izquierda', extraible: true, color: CONECTOR.alimentacion,
				bornes: ['G', 'G0'] },
			{ rotulo: 'Entradas universales', lado: 'arriba', extraible: true, color: CONECTOR.entradas,
				bornes: [...rango('UI', 1, 6), 'M'] },
			{ rotulo: 'Salidas', lado: 'abajo', desde: 0, hasta: 0.62, extraible: true, color: CONECTOR.salidas,
				bornes: [...rango('Q', 1, 6), 'QC'] },
			{ rotulo: 'PL-Link', lado: 'abajo', desde: 0.7, hasta: 1, extraible: true, color: CONECTOR.bus,
				bornes: ['CE+', 'CE-'] },
		],
	},

	/* ----------------------------- Johnson Controls ----------------------------- */
	{
		id: 'jci-fec2611',
		nombre: 'JCI Metasys FEC2611',
		fabricante: 'Johnson Controls',
		familia: 'Metasys',
		referencia: 'MS-FEC2611-0',
		descripcion: 'Controlador de equipo de campo con PID adaptativo, BACnet MS/TP sobre RS-485',
		ancho: 190, alto: 150, profundidad: 53,
		medidas: 'hoja-de-datos',
		montaje: 'riel-o-pared',
		tension: 24,
		bus: 'BACnet MS/TP (FC Bus) + SA Bus, RS-485',
		puntos: 17,
		entradasSalidas: '6 UI · 2 BI · 3 BO · 4 salidas configurables · 2 AO',
		frente: { leds: 6, puertosRS485: 2 },
		color: '#3b4146',
		bloques: [
			{ rotulo: 'Alimentación 24 VAC', lado: 'izquierda', extraible: true, color: CONECTOR.alimentacion,
				bornes: ['HOT', 'COM', 'GND'] },
			{ rotulo: 'Entradas universales', lado: 'arriba', desde: 0, hasta: 0.5, extraible: true, color: CONECTOR.entradas,
				bornes: [...rango('IN', 1, 6), 'INC'] },
			{ rotulo: 'Entradas binarias', lado: 'arriba', desde: 0.57, hasta: 1, extraible: true, color: CONECTOR.entradas,
				bornes: ['IN7', 'IN8', 'INC2'] },
			{ rotulo: 'Salidas binarias', lado: 'abajo', desde: 0, hasta: 0.4, extraible: true, color: CONECTOR.salidas,
				bornes: [...rango('BO', 1, 3), 'BOC'] },
			{ rotulo: 'Salidas configurables y analógicas', lado: 'abajo', desde: 0.47, hasta: 1, extraible: true, color: CONECTOR.salidas,
				bornes: [...rango('CO', 1, 4), 'AO1', 'AO2', 'OUTC'] },
			{ rotulo: 'FC Bus / SA Bus', lado: 'derecha', extraible: true, color: CONECTOR.bus,
				bornes: ['FC+', 'FC-', 'FCREF', 'SA+', 'SA-', 'SAREF'] },
		],
	},
	{
		id: 'jci-fac3611',
		nombre: 'JCI Metasys FAC3611',
		fabricante: 'Johnson Controls',
		familia: 'Metasys',
		referencia: 'MS-FAC3611-0',
		descripcion: 'Controlador de aplicación avanzada con reloj de tiempo real para rutinas autónomas',
		ancho: 190, alto: 150, profundidad: 53,
		medidas: 'nominal',
		montaje: 'riel-o-pared',
		tension: 24,
		bus: 'BACnet MS/TP (FC Bus) + SA Bus, RS-485',
		puntos: 17,
		entradasSalidas: '6 UI · 2 BI · 3 BO · 4 salidas configurables · 2 AO · RTC',
		frente: { leds: 6, puertosRS485: 2 },
		color: '#3b4146',
		bloques: [
			{ rotulo: 'Alimentación 24 VAC', lado: 'izquierda', extraible: true, color: CONECTOR.alimentacion,
				bornes: ['HOT', 'COM', 'GND'] },
			{ rotulo: 'Entradas universales', lado: 'arriba', desde: 0, hasta: 0.5, extraible: true, color: CONECTOR.entradas,
				bornes: [...rango('IN', 1, 6), 'INC'] },
			{ rotulo: 'Entradas binarias', lado: 'arriba', desde: 0.57, hasta: 1, extraible: true, color: CONECTOR.entradas,
				bornes: ['IN7', 'IN8', 'INC2'] },
			{ rotulo: 'Salidas binarias', lado: 'abajo', desde: 0, hasta: 0.4, extraible: true, color: CONECTOR.salidas,
				bornes: [...rango('BO', 1, 3), 'BOC'] },
			{ rotulo: 'Salidas configurables y analógicas', lado: 'abajo', desde: 0.47, hasta: 1, extraible: true, color: CONECTOR.salidas,
				bornes: [...rango('CO', 1, 4), 'AO1', 'AO2', 'OUTC'] },
			{ rotulo: 'FC Bus / SA Bus', lado: 'derecha', extraible: true, color: CONECTOR.bus,
				bornes: ['FC+', 'FC-', 'FCREF', 'SA+', 'SA-', 'SAREF'] },
		],
	},
	{
		id: 'jci-iom3731',
		nombre: 'JCI Metasys IOM3731',
		fabricante: 'Johnson Controls',
		familia: 'Metasys',
		referencia: 'MS-IOM3731-0',
		descripcion: 'Módulo de ampliación de campo: 8 entradas y 8 salidas binarias por SA Bus',
		ancho: 164, alto: 150, profundidad: 53,
		medidas: 'hoja-de-datos',
		montaje: 'riel-o-pared',
		tension: 24,
		bus: 'SA Bus (RS-485)',
		puntos: 16,
		entradasSalidas: '8 entradas binarias · 8 salidas binarias',
		frente: { leds: 4, puertosRS485: 1 },
		color: '#41474c',
		bloques: [
			{ rotulo: 'Alimentación 24 VAC', lado: 'izquierda', extraible: true, color: CONECTOR.alimentacion,
				bornes: ['HOT', 'COM', 'GND'] },
			{ rotulo: 'Entradas binarias', lado: 'arriba', extraible: true, color: CONECTOR.entradas,
				bornes: [...rango('IN', 1, 8), 'INC'] },
			{ rotulo: 'Salidas binarias', lado: 'abajo', extraible: true, color: CONECTOR.salidas,
				bornes: [...rango('BO', 1, 8), 'BOC'] },
			{ rotulo: 'SA Bus', lado: 'derecha', extraible: true, color: CONECTOR.bus,
				bornes: ['SA+', 'SA-', 'SAREF'] },
		],
	},
];

/** Todos los bornes de un controlador, en el orden en que van sus borneras. */
export function bornesDeControlador(f: FichaControlador): { id: string; tipo: TipoBorne }[] {
	const vistos = new Set<string>();
	const salida: { id: string; tipo: TipoBorne }[] = [];
	for (const bloque of f.bloques) {
		for (const id of bloque.bornes) {
			if (vistos.has(id)) continue; // un rótulo repetido rompería el cableado por id
			vistos.add(id);
			salida.push({ id, tipo: naturalezaTerminal(id) });
		}
	}
	return salida;
}

/** Aviso de fiabilidad de las medidas, para el catálogo y el dossier del cliente. */
export function notaMedidas(f: FichaControlador): string {
	return f.medidas === 'hoja-de-datos'
		? 'Medidas de la hoja de datos del fabricante.'
		: 'Medidas NOMINALES estimadas de la familia: contrástalas con la hoja de datos antes de fabricar.';
}

export const CONTROLADOR_POR_ID = new Map(CONTROLADORES.map((c) => [c.id, c]));
