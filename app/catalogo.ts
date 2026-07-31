/**
 * Catálogo de aparatos: plantillas listas para colocar en la placa.
 * Cada plantilla define el aparato eléctrico completo (bornes con su naturaleza,
 * tensión, referencia comercial) y su huella física en mm.
 */
import { BloqueTerminales, Borne, Dispositivo, LetraClase, Proyecto, Rol, TipoDispositivo, CLASE_POR_TIPO } from '../src/modelo/tipos.js';
import { aplicarPlantilla } from '../src/motores/numeracion.js';
import { opcionesDe } from '../src/modelo/proyecto.js';
import { bornesDeControlador, CONTROLADORES, disipacionDeControlador, FichaControlador, notaMedidas } from './controladores.js';

export interface PlantillaAparato {
	id: string;
	nombre: string;
	tipo: TipoDispositivo;
	clase?: LetraClase;
	descripcion: string;
	fabricante: string;
	referencia: string;
	tensionNominal?: number;
	/** Calibre In (A) de una protección, o corriente de empleo Ib (A) de un consumo. */
	corrienteNominal?: number;
	/** Nº de polos (1, 2, 3 o 4). A partir de 3 el circuito se calcula como trifásico. */
	polos?: number;
	/* --- Ficha eléctrica. Es lo que hace que el DRC verifique de verdad en vez de estimar. --- */
	/** Poder de corte Icu/Icn en kA. Valor habitual de la familia: confírmalo en la hoja. */
	poderCorteKA?: number;
	/** Curva de disparo (B/C/D/K/Z) o clase de fusible (gG/aM). */
	curvaDisparo?: Dispositivo['curvaDisparo'];
	/** Sensibilidad de un diferencial en mA. */
	sensibilidadMA?: number;
	/** Clase de un diferencial (AC/A/F/B). */
	claseDiferencial?: Dispositivo['claseDiferencial'];
	/** Rango de regulación de un guardamotor o relé térmico, en A. */
	rangoRegulacionA?: [number, number];
	/** Disipación en servicio (W). Siempre entra al proyecto marcada como ESTIMACIÓN. */
	disipacionW?: number;
	/**
	 * De dónde salen calibre, polos, curva y sensibilidad:
	 *  - `referencia`: van codificados en la propia referencia comercial («iC60N 2P C16» es,
	 *    sin lugar a discusión, 16 A curva C a 2 polos). Son fiables.
	 *  - `tipico`: valores corrientes de ese tipo de aparato, para no dejar el hueco en blanco.
	 *
	 * El poder de corte y la disipación NO entran aquí: esos dos siempre llegan al proyecto
	 * marcados como estimación, porque no salen de la referencia sino de la hoja de datos, y esa
	 * no la tiene el programa. El dossier lo dice y el usuario los corrige en la ficha del aparato.
	 */
	datosElectricos?: 'referencia' | 'tipico';
	/** Huella sobre la placa, en mm. */
	ancho: number;
	alto: number;
	bornes: Borne[];
	puentesInternos?: [string, string][];
	rol?: Rol;
	/** Color del chip en el catálogo (coincide con el cuerpo 3D). */
	color: string;
	grupo: 'Protección' | 'Maniobra' | 'Control' | 'Alimentación' | 'Conexión' | 'Campo';
	/**
	 * Aparato DE CAMPO: no se atornilla a la placa, está fuera del tablero (la red que lo
	 * alimenta, el motor que gobierna, la ampolleta que enciende). Se dibuja como el
	 * prensaestopas por el que sale su cable, y por eso no tiene hueco ni riel.
	 */
	campo?: boolean;
	/** Fondo real del aparato en mm (equipos de catálogo con ficha de datos). */
	profundidad?: number;
	/** Borneras reales del equipo (controladores): dónde está cada terminal. */
	terminales?: BloqueTerminales[];
	/** Rasgos del frente que dibuja el modelo 3D (pantalla, LEDs, puertos). */
	rasgosFrente?: Dispositivo['rasgosFrente'];
	/** Nota de fiabilidad de las medidas, si el aparato viene de una ficha de datos. */
	nota?: string;
}

const L = (id: string): Borne => ({ id, tipo: 'L' });
const N = (id: string): Borne => ({ id, tipo: 'N' });
const C = (id: string): Borne => ({ id, tipo: 'control' });
const S = (id: string): Borne => ({ id, tipo: 'senal' });

/** Aparatos del catálogo con su geometría y sus borneras. La ficha eléctrica se les añade
 *  más abajo, al construir `PLANTILLAS`. */
const PLANTILLAS_BASE: PlantillaAparato[] = [
	{
		id: 'disyuntor-1p', nombre: 'Disyuntor 1P C10', tipo: 'disyuntor', grupo: 'Protección',
		descripcion: 'Interruptor automático 1P C10', fabricante: 'Schneider Electric',
		referencia: 'iC60N 1P C10', tensionNominal: 220, ancho: 18, alto: 85, color: '#e8e8e4',
		corrienteNominal: 10, polos: 1, bornes: [L('1'), L('2')],
	},
	{
		id: 'disyuntor-2p', nombre: 'Disyuntor 2P C6', tipo: 'disyuntor', grupo: 'Protección',
		descripcion: 'Interruptor automático 2P C6', fabricante: 'Schneider Electric',
		referencia: 'iC60N 2P C6', tensionNominal: 220, ancho: 36, alto: 85, color: '#e8e8e4',
		corrienteNominal: 6, polos: 2, bornes: [L('1'), L('2'), N('3'), N('4')],
	},
	{
		id: 'disyuntor-3p', nombre: 'Disyuntor 3P C20', tipo: 'disyuntor', grupo: 'Protección',
		descripcion: 'Interruptor automático 3P C20', fabricante: 'Schneider Electric',
		referencia: 'iC60N 3P C20', tensionNominal: 380, ancho: 54, alto: 85, color: '#e8e8e4',
		corrienteNominal: 20, polos: 3, bornes: [L('1'), L('2'), L('3'), L('4'), L('5'), L('6')],
	},
	{
		id: 'diferencial-2p', nombre: 'Diferencial 2P 40A', tipo: 'diferencial', grupo: 'Protección',
		descripcion: 'Interruptor diferencial 2P 40 A 30 mA', fabricante: 'Schneider Electric',
		referencia: 'iID 2P 40A 30mA', tensionNominal: 220, ancho: 36, alto: 85, color: '#e8e8e4',
		corrienteNominal: 40, polos: 2, bornes: [L('1'), L('2'), N('N1'), N('N2')],
	},
	{
		id: 'guardamotor', nombre: 'Guardamotor 3P', tipo: 'guardamotor', grupo: 'Protección',
		descripcion: 'Guardamotor magnetotérmico 2.5–4 A', fabricante: 'Schneider Electric',
		referencia: 'GV2ME08', tensionNominal: 380, ancho: 45, alto: 89, color: '#3d4348',
		corrienteNominal: 4, polos: 3, bornes: [L('1'), L('2'), L('3'), L('4'), L('5'), L('6')],
	},
	{
		id: 'portafusible', nombre: 'Portafusible 10×38', tipo: 'fusible', grupo: 'Protección',
		descripcion: 'Portafusible seccionable 10×38 mm', fabricante: 'Phoenix Contact',
		referencia: 'UT 4-HESI', ancho: 18, alto: 70, color: '#5d666e',
		corrienteNominal: 3, polos: 1, bornes: [C('1'), C('2')],
	},
	{
		id: 'contactor-3p', nombre: 'Contactor 3P 9A', tipo: 'contactor', grupo: 'Maniobra',
		descripcion: 'Contactor tripolar 9 A, bobina 24 V + NA auxiliar', fabricante: 'Schneider Electric',
		referencia: 'LC1D09B7', tensionNominal: 24, ancho: 45, alto: 86, color: '#2f3437',
		rol: { tipo: 'maestro' },
		corrienteNominal: 9, polos: 3, bornes: [L('1/L1'), L('3/L2'), L('5/L3'), L('2/T1'), L('4/T2'), L('6/T3'), C('A1'), C('A2'), C('13'), C('14')],
	},
	{
		id: 'rele-termico', nombre: 'Relé térmico', tipo: 'rele', grupo: 'Maniobra',
		descripcion: 'Relé térmico de sobrecarga 2.5–4 A', fabricante: 'Schneider Electric',
		referencia: 'LRD08', ancho: 45, alto: 70, color: '#4a545c',
		corrienteNominal: 4, polos: 3, bornes: [L('1'), L('2'), L('3'), L('4'), L('5'), L('6'), C('95'), C('96'), C('97'), C('98')],
	},
	{
		id: 'rele-aux', nombre: 'Relé auxiliar 24 V', tipo: 'rele', grupo: 'Maniobra',
		descripcion: 'Relé enchufable 2 inversores con zócalo', fabricante: 'Finder',
		referencia: '40.52 + 95.05', tensionNominal: 24, ancho: 27, alto: 78, color: '#3b6ea5',
		rol: { tipo: 'maestro' },
		bornes: [C('A1'), C('A2'), C('11'), C('12'), C('14'), C('21'), C('22'), C('24')],
	},
	{
		id: 'variador', nombre: 'Variador 0.75 kW', tipo: 'variador', grupo: 'Maniobra',
		descripcion: 'Variador de frecuencia monofásico 0.75 kW', fabricante: 'Schneider Electric',
		referencia: 'ATV12H075M2', tensionNominal: 220, ancho: 72, alto: 143, color: '#26292c',
		corrienteNominal: 4.2, polos: 1, bornes: [L('L1'), N('N'), { id: 'PE', tipo: 'PE' }, L('U'), L('V'), L('W'), S('AI1'), S('DI1'), C('+24'), C('0V')],
	},
	{
		id: 'plc', nombre: 'PLC 8E/4S', tipo: 'plc', grupo: 'Control',
		descripcion: 'Controlador lógico 24 V, 8 entradas / 4 salidas', fabricante: 'Siemens',
		referencia: 'LOGO! 8.4', tensionNominal: 24, ancho: 107, alto: 90, color: '#23272b',
		bornes: [
			C('+24'), C('0V'), { id: 'PE', tipo: 'PE' },
			S('I1'), S('I2'), S('I3'), S('I4'), S('I5'), S('I6'), S('I7'), S('I8'),
			S('Q1'), S('Q2'), S('Q3'), S('Q4'),
		],
	},
	{
		id: 'fuente-24', nombre: 'Fuente 24 V 2.5 A', tipo: 'fuente', grupo: 'Alimentación',
		descripcion: 'Fuente conmutada 220 VAC → 24 VDC 2.5 A', fabricante: 'Mean Well',
		referencia: 'MDR-60-24', tensionNominal: 220, ancho: 40, alto: 90, color: '#b9bec2',
		corrienteNominal: 2.5, polos: 1, bornes: [L('L'), N('N'), { id: 'PE', tipo: 'PE' }, C('+V'), C('-V')],
	},
	{
		id: 'trafo-220-24', nombre: 'Transformador 220/24', tipo: 'transformador', grupo: 'Alimentación',
		descripcion: 'Transformador de mando 220/24 V 72 VA', fabricante: 'Genérico',
		referencia: 'TRF-220-24-72VA', ancho: 90, alto: 80, color: '#86673f',
		bornes: [L('P1'), N('P2'), C('S1'), C('S2')],
	},
	// Bornas sueltas y en grupos pequeños. Un tablero real lleva muchas: un puente, una reserva,
	// un PE aislado, dos bornas para una señal. Antes solo había bloques de 4 en adelante y no
	// había forma de poner una sola.
	{
		id: 'borna-1', nombre: 'Borna suelta 4 mm²', tipo: 'bornero', grupo: 'Conexión',
		descripcion: 'Una borna de paso de 4 mm² (puente, reserva o señal suelta)',
		fabricante: 'Phoenix Contact', referencia: 'UT 4', ancho: 8, alto: 56, color: '#9aa0a6',
		bornes: [C('1')],
	},
	{
		id: 'borna-2', nombre: 'Bornas 2 × 4 mm²', tipo: 'bornero', grupo: 'Conexión',
		descripcion: 'Dos bornas de paso de 4 mm² (una señal de ida y vuelta)',
		fabricante: 'Phoenix Contact', referencia: 'UT 4', ancho: 15, alto: 56, color: '#9aa0a6',
		bornes: [C('1'), C('2')],
	},
	{
		id: 'borna-4', nombre: 'Bornas 4 × 4 mm²', tipo: 'bornero', grupo: 'Conexión',
		descripcion: 'Cuatro bornas de paso de 4 mm²', fabricante: 'Phoenix Contact',
		referencia: 'UT 4', ancho: 29, alto: 56, color: '#9aa0a6',
		bornes: [C('1'), C('2'), C('3'), C('4')],
	},
	{
		id: 'borna-pe-1', nombre: 'Borna de tierra suelta', tipo: 'bornero', grupo: 'Conexión',
		descripcion: 'Una borna de puesta a tierra (verde/amarillo), unida al riel',
		fabricante: 'Phoenix Contact', referencia: 'USLKG 5', ancho: 9, alto: 56, color: '#7cb342',
		bornes: [{ id: 'PE', tipo: 'PE' }],
	},
	{
		id: 'bornero-8', nombre: 'Bornero 8 bornas 4 mm²', tipo: 'bornero', grupo: 'Conexión',
		descripcion: 'Bornero de paso 8 × UT 4 + tierra', fabricante: 'Phoenix Contact',
		referencia: 'UT 4', ancho: 55, alto: 56, color: '#9aa0a6',
		bornes: [C('1'), C('2'), C('3'), C('4'), C('5'), C('6'), C('7'), { id: 'PE', tipo: 'PE' }],
	},
	{
		id: 'bornero-12', nombre: 'Bornero 12 bornas 2.5 mm²', tipo: 'bornero', grupo: 'Conexión',
		descripcion: 'Bornero de paso 12 × UT 2,5', fabricante: 'Phoenix Contact',
		referencia: 'UT 2,5', ancho: 62, alto: 50, color: '#9aa0a6',
		bornes: Array.from({ length: 12 }, (_, i) => C(String(i + 1))),
	},
	{
		id: 'disyuntor-2p-16', nombre: 'Disyuntor 2P C16', tipo: 'disyuntor', grupo: 'Protección',
		descripcion: 'Interruptor automático 2P C16 (enchufes y tomas)', fabricante: 'Schneider Electric',
		referencia: 'iC60N 2P C16', tensionNominal: 220, corrienteNominal: 16, polos: 2,
		ancho: 36, alto: 85, color: '#e8e8e4',
		bornes: [L('1'), L('2'), N('3'), N('4')],
	},
	{
		id: 'diferencial-4p', nombre: 'Diferencial 4P 40A', tipo: 'diferencial', grupo: 'Protección',
		descripcion: 'Interruptor diferencial 4P 40 A 30 mA', fabricante: 'Schneider Electric',
		referencia: 'iID 4P 40A 30mA', tensionNominal: 380, corrienteNominal: 40, polos: 4,
		ancho: 72, alto: 85, color: '#e8e8e4',
		bornes: [L('1'), L('2'), L('3'), L('4'), L('5'), L('6'), N('N1'), N('N2')],
	},
	{
		id: 'guardamotor-9', nombre: 'Guardamotor 3P 6–10 A', tipo: 'guardamotor', grupo: 'Protección',
		descripcion: 'Guardamotor magnetotérmico 6–10 A (motor 3 kW)', fabricante: 'Schneider Electric',
		referencia: 'GV2ME14', tensionNominal: 380, corrienteNominal: 10, polos: 3,
		ancho: 45, alto: 89, color: '#3d4348',
		bornes: [L('1'), L('2'), L('3'), L('4'), L('5'), L('6')],
	},
	{
		id: 'contactor-3p-18', nombre: 'Contactor 3P 18A', tipo: 'contactor', grupo: 'Maniobra',
		descripcion: 'Contactor tripolar 18 A, bobina 24 V + NA auxiliar', fabricante: 'Schneider Electric',
		referencia: 'LC1D18B7', tensionNominal: 24, corrienteNominal: 18, polos: 3,
		ancho: 45, alto: 86, color: '#2f3437', rol: { tipo: 'maestro' },
		bornes: [L('1/L1'), L('3/L2'), L('5/L3'), L('2/T1'), L('4/T2'), L('6/T3'), C('A1'), C('A2'), C('13'), C('14')],
	},
	{
		id: 'rele-estado-solido', nombre: 'Relé de estado sólido 25 A', tipo: 'rele', grupo: 'Maniobra',
		descripcion: 'SSR monofásico 25 A, mando 3–32 VDC (resistencias, hornos)', fabricante: 'Carlo Gavazzi',
		referencia: 'RM1A23D25', tensionNominal: 220, corrienteNominal: 25, polos: 1,
		ancho: 45, alto: 88, color: '#33383c',
		bornes: [L('1'), L('2'), C('A1'), C('A2')],
	},
	{
		id: 'fuente-24-5a', nombre: 'Fuente 24 V 5 A', tipo: 'fuente', grupo: 'Alimentación',
		descripcion: 'Fuente conmutada 220 VAC → 24 VDC 5 A', fabricante: 'Mean Well',
		referencia: 'MDR-120-24', tensionNominal: 220, corrienteNominal: 5, polos: 1,
		ancho: 55, alto: 90, color: '#b9bec2',
		bornes: [L('L'), N('N'), { id: 'PE', tipo: 'PE' }, C('+V'), C('-V')],
	},
	{
		id: 'fuente-24-10a', nombre: 'Fuente 24 V 10 A', tipo: 'fuente', grupo: 'Alimentación',
		descripcion: 'Fuente conmutada 220 VAC → 24 VDC 10 A', fabricante: 'Mean Well',
		referencia: 'NDR-240-24', tensionNominal: 220, corrienteNominal: 10, polos: 1,
		ancho: 65, alto: 125, color: '#b9bec2',
		bornes: [L('L'), N('N'), { id: 'PE', tipo: 'PE' }, C('+V'), C('-V')],
	},
	{
		id: 'bornero-seccionable', nombre: 'Bornero seccionable 6 bornas', tipo: 'bornero', grupo: 'Conexión',
		descripcion: 'Bornero seccionable con cuchilla, para medir sin desconectar', fabricante: 'Phoenix Contact',
		referencia: 'UT 4-MTD', ancho: 45, alto: 56, color: '#c9a227',
		bornes: [C('1'), C('2'), C('3'), C('4'), C('5'), C('6')],
	},
	{
		id: 'bornero-portafusible', nombre: 'Bornero portafusible 4 bornas', tipo: 'bornero', grupo: 'Conexión',
		descripcion: 'Bornas con portafusible 5×20 y testigo de fundido', fabricante: 'Phoenix Contact',
		referencia: 'UK 5-HESI', ancho: 32, alto: 62, color: '#8d5a2b',
		bornes: [C('1'), C('2'), C('3'), C('4')],
	},
	{
		id: 'bornero-pe', nombre: 'Bornero de tierra 6 bornas', tipo: 'bornero', grupo: 'Conexión',
		descripcion: 'Bornas de puesta a tierra (verde/amarillo) unidas al riel', fabricante: 'Phoenix Contact',
		referencia: 'USLKG 5', ancho: 42, alto: 56, color: '#7cb342',
		bornes: Array.from({ length: 6 }, (_, i) => ({ id: `PE${i + 1}`, tipo: 'PE' as const })),
		puentesInternos: [['PE1', 'PE2'], ['PE2', 'PE3'], ['PE3', 'PE4'], ['PE4', 'PE5'], ['PE5', 'PE6']],
	},
	{
		id: 'pulsador-emergencia', nombre: 'Seta de emergencia', tipo: 'pulsador', grupo: 'Control',
		descripcion: 'Pulsador de emergencia con enclavamiento y 2 contactos NC', fabricante: 'Schneider Electric',
		referencia: 'XB4BS8445', ancho: 40, alto: 40, color: '#c62828',
		bornes: [C('11'), C('12'), C('21'), C('22')],
	},
	{
		id: 'pulsador-marcha', nombre: 'Pulsador marcha/paro', tipo: 'pulsador', grupo: 'Control',
		descripcion: 'Pulsador doble marcha (NA verde) y paro (NC rojo)', fabricante: 'Schneider Electric',
		referencia: 'XB4BL73415', ancho: 30, alto: 40, color: '#2e7d32',
		bornes: [C('13'), C('14'), C('21'), C('22')],
	},
	{
		id: 'selector-2pos', nombre: 'Selector 2 posiciones', tipo: 'selector', grupo: 'Control',
		descripcion: 'Selector manual/automático de 2 posiciones, 1 NA + 1 NC', fabricante: 'Schneider Electric',
		referencia: 'XB4BD21', ancho: 30, alto: 40, color: '#37474f',
		bornes: [C('13'), C('14'), C('21'), C('22')],
	},
	{
		id: 'final-carrera', nombre: 'Final de carrera', tipo: 'sensor', grupo: 'Control',
		descripcion: 'Final de carrera de rodillo, 1 NA + 1 NC', fabricante: 'Schneider Electric',
		referencia: 'XCKN2121P20', ancho: 40, alto: 60, color: '#455a64',
		bornes: [C('11'), C('12'), C('13'), C('14')],
	},
	{
		id: 'sensor-inductivo', nombre: 'Sensor inductivo PNP', tipo: 'sensor', grupo: 'Control',
		descripcion: 'Detector inductivo M12 PNP NA, 24 VDC 3 hilos', fabricante: 'Schneider Electric',
		referencia: 'XS612B1PAL2', tensionNominal: 24, ancho: 30, alto: 50, color: '#546e7a',
		bornes: [C('+24'), C('0V'), S('OUT')],
	},
	{
		id: 'piloto-24', nombre: 'Piloto 24 V', tipo: 'piloto', grupo: 'Control',
		descripcion: 'Piloto luminoso LED 24 V (señalización de marcha/falla)', fabricante: 'Schneider Electric',
		referencia: 'XB4BVB3', tensionNominal: 24, ancho: 30, alto: 30, color: '#fdd835',
		bornes: [C('X1'), C('X2')],
	},
	{
		id: 'horometro', nombre: 'Horómetro / contador', tipo: 'otro', grupo: 'Control',
		descripcion: 'Contador de horas de funcionamiento 24 VDC', fabricante: 'Bauser',
		referencia: '632.2', tensionNominal: 24, ancho: 48, alto: 48, color: '#263238',
		bornes: [C('+'), C('-')],
	},

	/* ------------------------------- CAMPO -------------------------------
	 *
	 * Lo que está FUERA del tablero: la red que lo alimenta y las cargas que gobierna. Hasta
	 * ahora solo existían dentro de los tableros de ejemplo, así que quien empezaba con la placa
	 * en blanco no tenía por dónde meter la tensión —y sin acometida, «Energizar» no enciende
	 * nada por muy bien cableado que esté todo—. Ni tenía un motor ni una ampolleta que encender,
	 * que es justo lo que se pide comprobar.
	 *
	 * No se atornillan a un riel: se dibujan como el prensaestopas por donde su cable sale del
	 * gabinete, que es lo que se ve de ellos desde dentro del tablero.
	 */
	{
		id: 'acometida-mono', nombre: 'Acometida 220 V (red)', tipo: 'otro', clase: 'W', grupo: 'Campo',
		campo: true,
		descripcion: 'Acometida monofásica 220 V — de aquí entra la tensión al tablero',
		fabricante: '—', referencia: 'Red 1F+N+PE', tensionNominal: 220, polos: 1,
		ancho: 40, alto: 40, color: '#b23b3b',
		bornes: [L('L'), N('N'), { id: 'PE', tipo: 'PE' }],
	},
	{
		id: 'acometida-tri', nombre: 'Acometida 380 V trifásica', tipo: 'otro', clase: 'W', grupo: 'Campo',
		campo: true,
		descripcion: 'Acometida trifásica 380 V — de aquí entra la tensión al tablero',
		fabricante: '—', referencia: 'Red 3F+N+PE', tensionNominal: 380, polos: 3,
		ancho: 40, alto: 40, color: '#b23b3b',
		bornes: [L('L1'), L('L2'), L('L3'), N('N'), { id: 'PE', tipo: 'PE' }],
	},
	{
		id: 'ampolleta-220', nombre: 'Ampolleta 220 V', tipo: 'piloto', grupo: 'Campo', campo: true,
		descripcion: 'Ampolleta / luminaria 220 V gobernada desde el tablero',
		fabricante: '—', referencia: 'E27 LED 9 W', tensionNominal: 220, corrienteNominal: 0.05,
		polos: 1, ancho: 40, alto: 40, color: '#fdd835',
		bornes: [L('L'), N('N'), { id: 'PE', tipo: 'PE' }],
	},
	{
		id: 'motor-mono', nombre: 'Motor 1F 220 V', tipo: 'motor', grupo: 'Campo', campo: true,
		descripcion: 'Motor monofásico 220 V (bomba, ventilador pequeño)',
		fabricante: '—', referencia: 'M 1F 0,37 kW', tensionNominal: 220, corrienteNominal: 2.6,
		polos: 1, ancho: 40, alto: 40, color: '#546e7a',
		bornes: [L('U1'), N('N'), { id: 'PE', tipo: 'PE' }],
	},
	{
		id: 'motor-tri', nombre: 'Motor 3F 380 V', tipo: 'motor', grupo: 'Campo', campo: true,
		descripcion: 'Motor trifásico 380 V (el motor típico de una UMA)',
		fabricante: '—', referencia: 'M 3F 1,5 kW', tensionNominal: 380, corrienteNominal: 3.5,
		polos: 3, ancho: 40, alto: 40, color: '#546e7a',
		bornes: [L('U'), L('V'), L('W'), { id: 'PE', tipo: 'PE' }],
	},
	{
		id: 'resistencia-campo', nombre: 'Resistencia calefactora', tipo: 'resistencia', grupo: 'Campo',
		campo: true,
		descripcion: 'Batería de resistencias 220 V (recalentamiento de aire)',
		fabricante: '—', referencia: 'R 1,5 kW', tensionNominal: 220, corrienteNominal: 6.8,
		polos: 1, ancho: 40, alto: 40, color: '#c1440e',
		bornes: [L('R1'), N('R2'), { id: 'PE', tipo: 'PE' }],
	},
];

/**
 * Ficha eléctrica de cada aparato del catálogo, en una sola tabla para poder auditarla de un
 * vistazo. Va aparte de la plantilla a propósito: la geometría y las borneras de arriba están
 * comprobadas contra el aparato real, y no quiero mezclarlas con datos de otra procedencia.
 *
 * DE DÓNDE SALE CADA COSA, que es lo que de verdad importa aquí:
 *
 *  - `corrienteNominal`, `polos`, `curvaDisparo`, `sensibilidadMA`, `rangoRegulacionA`: van
 *    codificados en la referencia comercial. «iC60N 2P C16» es 16 A curva C a dos polos y no
 *    admite discusión; «GV2ME08» es el 2,5–4 A de la serie. Son fiables — `datosElectricos:
 *    'referencia'`.
 *
 *  - `poderCorteKA` y `disipacionW`: NO salen de la referencia, salen de la hoja de datos, y esa
 *    no la tiene el programa. Son los valores CORRIENTES de cada familia, del orden de magnitud
 *    correcto, y entran al proyecto marcados como estimación (`poderCorteEstimado`,
 *    `disipacionEstimada`). El balance térmico y el dossier lo dicen, y el DRC lo repite en su
 *    mensaje. Sirven para que el cálculo no arranque en cero y para tener el hueco relleno con
 *    algo sensato que corregir, NO para certificar nada.
 *
 * Si vas a firmar un tablero, sustituye esos dos por los de la hoja del fabricante en la ficha
 * de cada aparato: en cuanto lo hagas, el dossier deja de marcarlos como estimados.
 */
const FICHA_ELECTRICA: Record<string, Partial<PlantillaAparato>> = {
	/* ---------- Protección ---------- */
	// Los iC60N llevan marcado Icn 6000 A (EN 60898); la curva y el calibre van en la referencia.
	'disyuntor-1p': { poderCorteKA: 6, curvaDisparo: 'C', disipacionW: 1.6, datosElectricos: 'referencia' },
	'disyuntor-2p': { poderCorteKA: 6, curvaDisparo: 'C', disipacionW: 2.2, datosElectricos: 'referencia' },
	'disyuntor-2p-16': { poderCorteKA: 6, curvaDisparo: 'C', disipacionW: 4.4, datosElectricos: 'referencia' },
	'disyuntor-3p': { poderCorteKA: 6, curvaDisparo: 'C', disipacionW: 7, datosElectricos: 'referencia' },
	// Un diferencial puro no corta cortocircuitos por sí solo: los 6 kA son su corriente
	// CONDICIONAL, y solo valen si lleva detrás el automático que lo respalda.
	'diferencial-2p': {
		poderCorteKA: 6, sensibilidadMA: 30, claseDiferencial: 'AC', disipacionW: 2.5,
		datosElectricos: 'referencia',
	},
	'diferencial-4p': {
		poderCorteKA: 6, sensibilidadMA: 30, claseDiferencial: 'AC', disipacionW: 5,
		datosElectricos: 'referencia',
	},
	'guardamotor': { poderCorteKA: 100, rangoRegulacionA: [2.5, 4], disipacionW: 4, datosElectricos: 'referencia' },
	'guardamotor-9': { poderCorteKA: 100, rangoRegulacionA: [6, 10], disipacionW: 6, datosElectricos: 'referencia' },
	'portafusible': { poderCorteKA: 100, curvaDisparo: 'gG', disipacionW: 1.5, datosElectricos: 'tipico' },

	/* ---------- Maniobra ---------- */
	// En un contactor casi toda la disipación es la bobina sujetando el electroimán.
	'contactor-3p': { disipacionW: 6, datosElectricos: 'referencia' },
	'contactor-3p-18': { disipacionW: 8, datosElectricos: 'referencia' },
	'rele-termico': { rangoRegulacionA: [2.5, 4], disipacionW: 5, datosElectricos: 'referencia' },
	'rele-aux': { corrienteNominal: 8, polos: 2, disipacionW: 1.2, datosElectricos: 'referencia' },
	// El SSR es el aparato que más calienta de un tablero pequeño: ~1,3 V de caída por la
	// corriente que pasa. Con 20 A son 25 W dentro del armario, y eso decide si hace falta
	// ventilación. Es justo el dato que nadie mete a mano y luego sorprende.
	'rele-estado-solido': { disipacionW: 25, datosElectricos: 'referencia' },
	'variador': { disipacionW: 35, datosElectricos: 'referencia' },

	/* ---------- Alimentación ---------- */
	// En una fuente conmutada la disipación es lo que se pierde por el rendimiento (~87-89 %).
	'fuente-24': { disipacionW: 9, datosElectricos: 'referencia' },
	'fuente-24-5a': { disipacionW: 16, datosElectricos: 'referencia' },
	'fuente-24-10a': { disipacionW: 30, datosElectricos: 'referencia' },
	'trafo-220-24': { corrienteNominal: 0.33, polos: 1, disipacionW: 11, datosElectricos: 'tipico' },

	/* ---------- Conexión ---------- */
	'borna-1': { disipacionW: 0.1, datosElectricos: 'tipico' },
	'borna-2': { disipacionW: 0.1, datosElectricos: 'tipico' },
	'borna-4': { disipacionW: 0.2, datosElectricos: 'tipico' },
	'borna-pe-1': { disipacionW: 0, datosElectricos: 'tipico' },
	'bornero-8': { disipacionW: 0.5, datosElectricos: 'tipico' },
	'bornero-12': { disipacionW: 0.6, datosElectricos: 'tipico' },
	'bornero-seccionable': { disipacionW: 0.4, datosElectricos: 'tipico' },
	'bornero-portafusible': { curvaDisparo: 'gG', disipacionW: 2, datosElectricos: 'tipico' },
	'bornero-pe': { disipacionW: 0, datosElectricos: 'tipico' },

	/* ---------- Control ---------- */
	// Contactos pasivos: no calientan. Decirlo con un 0 explícito es mejor que dejarlo en blanco
	// y que el balance térmico les invente unos vatios por su tipo.
	'pulsador-emergencia': { disipacionW: 0, datosElectricos: 'referencia' },
	'pulsador-marcha': { disipacionW: 0, datosElectricos: 'referencia' },
	'selector-2pos': { disipacionW: 0, datosElectricos: 'referencia' },
	'final-carrera': { disipacionW: 0, datosElectricos: 'referencia' },
	'sensor-inductivo': { disipacionW: 0.3, datosElectricos: 'referencia' },
	'piloto-24': { disipacionW: 0.4, datosElectricos: 'referencia' },
	'horometro': { disipacionW: 0.5, datosElectricos: 'tipico' },
	'plc': { disipacionW: 5, datosElectricos: 'referencia' },

	/* ---------- Campo ----------
	 * Estos aparatos están FUERA del armario, así que su disipación DENTRO del armario es cero.
	 * No es un hueco sin rellenar ni una estimación prudente: un motor de 1,5 kW calienta mucho,
	 * pero calienta en la cubierta, no en el tablero, y el balance térmico del armario no debe
	 * contarlo. Los calibres son los de una máquina corriente de ese tamaño — 'tipico' —, porque
	 * la placa del motor de cada obra la trae el usuario y la corrige en la ficha del aparato.
	 */
	'acometida-mono': { disipacionW: 0, datosElectricos: 'tipico' },
	'acometida-tri': { disipacionW: 0, datosElectricos: 'tipico' },
	'ampolleta-220': { disipacionW: 0, datosElectricos: 'tipico' },
	'motor-mono': { disipacionW: 0, datosElectricos: 'tipico' },
	'motor-tri': { disipacionW: 0, datosElectricos: 'tipico' },
	'resistencia-campo': { disipacionW: 0, datosElectricos: 'tipico' },
};

/** El catálogo que ve el usuario: cada aparato con su geometría y su ficha eléctrica. */
export const PLANTILLAS: PlantillaAparato[] = PLANTILLAS_BASE.map(
	(p) => ({ ...p, ...(FICHA_ELECTRICA[p.id] ?? {}) }),
);

/** Todo aparato del catálogo tiene que declarar de dónde salen sus datos eléctricos. */
export const SIN_FICHA_ELECTRICA = PLANTILLAS_BASE.filter((p) => !FICHA_ELECTRICA[p.id]).map((p) => p.id);

/**
 * Controladores reales (BMS/HVAC) descritos por ficha de datos. No se modela cada uno a
 * mano: la ficha aporta huella, fondo y borneras con los rótulos del fabricante, y el
 * constructor 3D genérico hace el resto.
 */
export function plantillaDeControlador(f: FichaControlador): PlantillaAparato {
	return {
		id: `ctrl-${f.id}`,
		nombre: f.nombre,
		tipo: 'plc',
		grupo: 'Control',
		descripcion: `${f.descripcion} · ${f.entradasSalidas}`,
		fabricante: f.fabricante,
		referencia: f.referencia,
		tensionNominal: f.tension,
		ancho: f.ancho,
		alto: f.alto,
		profundidad: f.profundidad,
		color: f.color,
		bornes: bornesDeControlador(f),
		terminales: f.bloques.map((b) => ({ ...b, bornes: [...b.bornes] })),
		rasgosFrente: { ...f.frente },
		// Un controlador no es una protección: no tiene calibre, curva ni poder de corte. Lo que
		// sí aporta al tablero es CALOR, y un armario de BMS con tres o cuatro dentro lo nota.
		disipacionW: disipacionDeControlador(f),
		datosElectricos: 'referencia',
		nota: notaMedidas(f),
	};
}

for (const ficha of CONTROLADORES) PLANTILLAS.push(plantillaDeControlador(ficha));

/** Orden en que se muestran los grupos: el recorrido natural de la corriente por el tablero. */
const ORDEN_GRUPOS: PlantillaAparato['grupo'][] = ['Protección', 'Maniobra', 'Alimentación', 'Control', 'Conexión', 'Campo'];
PLANTILLAS.sort((a, b) => ORDEN_GRUPOS.indexOf(a.grupo) - ORDEN_GRUPOS.indexOf(b.grupo));

/** Crea un dispositivo nuevo desde una plantilla, con designación IEC correlativa. */
export function crearDesdePlantilla(plantilla: PlantillaAparato, proyecto: Proyecto): Dispositivo {
	const clase = plantilla.clase ?? CLASE_POR_TIPO[plantilla.tipo];
	let maximo = 0;
	for (const d of proyecto.dispositivos) {
		const claseD = d.clase ?? CLASE_POR_TIPO[d.tipo];
		if (claseD === clase && !d.funcion && !d.ubicacion && d.numero) {
			maximo = Math.max(maximo, d.numero);
		}
	}
	const numero = maximo + 1;
	const designacion = aplicarPlantilla(opcionesDe(proyecto).formatoDesignacion, { clase, n: numero });
	return {
		id: `d${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`,
		tipo: plantilla.tipo,
		clase: plantilla.clase,
		// La marca de campo es la que hace que el simulador reconozca una acometida como origen
		// de tensión, y que el dibujo la saque por un prensaestopas en vez de por la placa.
		campo: plantilla.campo,
		numero,
		designacion,
		congelado: true, // la designación asignada al colocar no se pisa en renumeraciones
		descripcion: plantilla.descripcion,
		fabricante: plantilla.fabricante,
		referencia: plantilla.referencia,
		tensionNominal: plantilla.tensionNominal,
		corrienteNominal: plantilla.corrienteNominal,
		polos: plantilla.polos,
		// Ficha eléctrica. El poder de corte y la disipación entran marcados como estimación:
		// son los valores corrientes de la familia, no los de la hoja de datos de este aparato.
		// En cuanto el usuario escriba el suyo en la ficha, las banderas se van y el dossier
		// deja de avisar. Sin esto el balance térmico presumiría de un rigor que no tiene.
		poderCorteKA: plantilla.poderCorteKA,
		poderCorteEstimado: plantilla.poderCorteKA !== undefined ? true : undefined,
		disipacionW: plantilla.disipacionW,
		// Un aparato de campo disipa CERO dentro del armario, y eso no es una estimación: está
		// fuera. Marcarlo como estimado haría que el dossier avisara de un dato que sí es exacto.
		disipacionEstimada: plantilla.disipacionW !== undefined && !plantilla.campo ? true : undefined,
		curvaDisparo: plantilla.curvaDisparo,
		sensibilidadMA: plantilla.sensibilidadMA,
		claseDiferencial: plantilla.claseDiferencial,
		rangoRegulacionA: plantilla.rangoRegulacionA ? [...plantilla.rangoRegulacionA] : undefined,
		profundidad: plantilla.profundidad,
		colorCuerpo: plantilla.color,
		terminales: plantilla.terminales?.map((b) => ({ ...b, bornes: [...b.bornes] })),
		rasgosFrente: plantilla.rasgosFrente ? { ...plantilla.rasgosFrente } : undefined,
		bornes: plantilla.bornes.map((b) => ({ ...b })),
		puentesInternos: plantilla.puentesInternos?.map(([a, b]) => [a, b] as [string, string]),
		rol: plantilla.rol ? { ...plantilla.rol } : undefined,
	};
}
