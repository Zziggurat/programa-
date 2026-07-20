/**
 * Catálogo de aparatos: plantillas listas para colocar en la placa.
 * Cada plantilla define el aparato eléctrico completo (bornes con su naturaleza,
 * tensión, referencia comercial) y su huella física en mm.
 */
import { Borne, Dispositivo, LetraClase, Proyecto, Rol, TipoDispositivo, CLASE_POR_TIPO } from '../src/modelo/tipos.js';
import { aplicarPlantilla } from '../src/motores/numeracion.js';
import { opcionesDe } from '../src/modelo/proyecto.js';

export interface PlantillaAparato {
	id: string;
	nombre: string;
	tipo: TipoDispositivo;
	clase?: LetraClase;
	descripcion: string;
	fabricante: string;
	referencia: string;
	tensionNominal?: number;
	/** Huella sobre la placa, en mm. */
	ancho: number;
	alto: number;
	bornes: Borne[];
	puentesInternos?: [string, string][];
	rol?: Rol;
	/** Color del chip en el catálogo (coincide con el cuerpo 3D). */
	color: string;
	grupo: 'Protección' | 'Maniobra' | 'Control' | 'Alimentación' | 'Conexión';
}

const L = (id: string): Borne => ({ id, tipo: 'L' });
const N = (id: string): Borne => ({ id, tipo: 'N' });
const C = (id: string): Borne => ({ id, tipo: 'control' });
const S = (id: string): Borne => ({ id, tipo: 'senal' });

export const PLANTILLAS: PlantillaAparato[] = [
	{
		id: 'disyuntor-1p', nombre: 'Disyuntor 1P C10', tipo: 'disyuntor', grupo: 'Protección',
		descripcion: 'Interruptor automático 1P C10', fabricante: 'Schneider Electric',
		referencia: 'iC60N 1P C10', tensionNominal: 220, ancho: 18, alto: 85, color: '#e8e8e4',
		bornes: [L('1'), L('2')],
	},
	{
		id: 'disyuntor-2p', nombre: 'Disyuntor 2P C6', tipo: 'disyuntor', grupo: 'Protección',
		descripcion: 'Interruptor automático 2P C6', fabricante: 'Schneider Electric',
		referencia: 'iC60N 2P C6', tensionNominal: 220, ancho: 36, alto: 85, color: '#e8e8e4',
		bornes: [L('1'), L('2'), N('3'), N('4')],
	},
	{
		id: 'disyuntor-3p', nombre: 'Disyuntor 3P C20', tipo: 'disyuntor', grupo: 'Protección',
		descripcion: 'Interruptor automático 3P C20', fabricante: 'Schneider Electric',
		referencia: 'iC60N 3P C20', tensionNominal: 380, ancho: 54, alto: 85, color: '#e8e8e4',
		bornes: [L('1'), L('2'), L('3'), L('4'), L('5'), L('6')],
	},
	{
		id: 'diferencial-2p', nombre: 'Diferencial 2P 40A', tipo: 'diferencial', grupo: 'Protección',
		descripcion: 'Interruptor diferencial 2P 40 A 30 mA', fabricante: 'Schneider Electric',
		referencia: 'iID 2P 40A 30mA', tensionNominal: 220, ancho: 36, alto: 85, color: '#e8e8e4',
		bornes: [L('1'), L('2'), N('N1'), N('N2')],
	},
	{
		id: 'guardamotor', nombre: 'Guardamotor 3P', tipo: 'guardamotor', grupo: 'Protección',
		descripcion: 'Guardamotor magnetotérmico 2.5–4 A', fabricante: 'Schneider Electric',
		referencia: 'GV2ME08', tensionNominal: 380, ancho: 45, alto: 89, color: '#3d4348',
		bornes: [L('1'), L('2'), L('3'), L('4'), L('5'), L('6')],
	},
	{
		id: 'portafusible', nombre: 'Portafusible 10×38', tipo: 'fusible', grupo: 'Protección',
		descripcion: 'Portafusible seccionable 10×38 mm', fabricante: 'Phoenix Contact',
		referencia: 'UT 4-HESI', ancho: 18, alto: 70, color: '#5d666e',
		bornes: [C('1'), C('2')],
	},
	{
		id: 'contactor-3p', nombre: 'Contactor 3P 9A', tipo: 'contactor', grupo: 'Maniobra',
		descripcion: 'Contactor tripolar 9 A, bobina 24 V + NA auxiliar', fabricante: 'Schneider Electric',
		referencia: 'LC1D09B7', tensionNominal: 24, ancho: 45, alto: 86, color: '#2f3437',
		rol: { tipo: 'maestro' },
		bornes: [L('1/L1'), L('3/L2'), L('5/L3'), L('2/T1'), L('4/T2'), L('6/T3'), C('A1'), C('A2'), C('13'), C('14')],
	},
	{
		id: 'rele-termico', nombre: 'Relé térmico', tipo: 'rele', grupo: 'Maniobra',
		descripcion: 'Relé térmico de sobrecarga 2.5–4 A', fabricante: 'Schneider Electric',
		referencia: 'LRD08', ancho: 45, alto: 70, color: '#4a545c',
		bornes: [L('1'), L('2'), L('3'), L('4'), L('5'), L('6'), C('95'), C('96'), C('97'), C('98')],
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
		bornes: [L('L1'), N('N'), { id: 'PE', tipo: 'PE' }, L('U'), L('V'), L('W'), S('AI1'), S('DI1'), C('+24'), C('0V')],
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
		bornes: [L('L'), N('N'), { id: 'PE', tipo: 'PE' }, C('+V'), C('-V')],
	},
	{
		id: 'trafo-220-24', nombre: 'Transformador 220/24', tipo: 'transformador', grupo: 'Alimentación',
		descripcion: 'Transformador de mando 220/24 V 72 VA', fabricante: 'Genérico',
		referencia: 'TRF-220-24-72VA', ancho: 90, alto: 80, color: '#86673f',
		bornes: [L('P1'), N('P2'), C('S1'), C('S2')],
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
];

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
		numero,
		designacion,
		congelado: true, // la designación asignada al colocar no se pisa en renumeraciones
		descripcion: plantilla.descripcion,
		fabricante: plantilla.fabricante,
		referencia: plantilla.referencia,
		tensionNominal: plantilla.tensionNominal,
		bornes: plantilla.bornes.map((b) => ({ ...b })),
		puentesInternos: plantilla.puentesInternos?.map(([a, b]) => [a, b] as [string, string]),
		rol: plantilla.rol ? { ...plantilla.rol } : undefined,
	};
}
