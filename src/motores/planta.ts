/**
 * Consultar la planta: buscar una máquina, filtrar por lo que interesa y colorearlas por lo que
 * hace falta ver.
 *
 * Es lo que convierte el visor 3D de una maqueta bonita en una herramienta de trabajo. En la
 * cubierta hay 129 máquinas; quien sube a intervenir una no quiere pasear entre todas, quiere
 * escribir «343» y que se le encienda la suya. Y quien va a cablear un tablero quiere ver de un
 * golpe cuáles cuelgan del mismo controlador, cuáles tienen puntos dibujados y cuáles no.
 *
 * Va aparte del visor a propósito: aquí no hay Three.js ni DOM, solo el modelo. Así se puede
 * probar sin navegador, que es lo que hace que estas reglas se puedan cambiar sin miedo.
 */
import { EquipoPlanta, Infraestructura } from '../modelo/infraestructura.js';
import { ESTADOS_OBRA, EstadoObra } from './levantamiento.js';

/* --------------------------------- Buscar y filtrar --------------------------------- */

export interface FiltroPlanta {
	/** Texto libre: marcado, controlador, sigla de un punto o descripción del punto. */
	texto?: string;
	tipo?: 'uma' | 'vex';
	/** Solo las que el plano rotula con un controlador. */
	conControlador?: boolean;
	/** Solo las que traen dibujado su diagrama de puntos. */
	conPuntos?: boolean;
	/** Solo las que están situadas en planta (las demás no se pueden enseñar en 3D). */
	situados?: boolean;
	/** Solo las que el plano marca como cableadas en el tablero. */
	enTablero?: boolean;
	/** Solo las que tienen un punto con esta sigla (VAF, TAS…). */
	sigla?: string;
}

/**
 * Normaliza un texto para poder buscarlo como lo escribiría una persona con prisa: sin tildes, sin
 * mayúsculas y sin los guiones del marcado. Así «uma3343», «UMA 3 343» y «uma-3-343» encuentran
 * lo mismo, que es como se escribe de verdad cuando se está buscando algo.
 */
export function normalizar(t: string): string {
	return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
		.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Todo el texto por el que se puede encontrar una máquina, ya normalizado. */
function textoDe(e: EquipoPlanta): string {
	return normalizar([
		e.tag,
		e.controlador ?? '',
		e.tipo === 'uma' ? 'unidad manejadora de aire uma' : 'ventilador extractor vex',
		...e.puntos.map((p) => `${p.sigla} ${p.que}`),
	].join(' '));
}

/**
 * Busca máquinas. Devuelve las que cumplen TODOS los filtros, ordenadas por lo cerca que están de
 * lo que se ha escrito: primero las que empiezan por el texto buscado —el caso normal, teclear el
 * marcado— y después las que solo lo contienen en algún sitio.
 */
export function buscarEquipos(inf: Infraestructura, f: FiltroPlanta = {}): EquipoPlanta[] {
	const q = normalizar(f.texto ?? '');
	const sigla = (f.sigla ?? '').toUpperCase();
	const salida: { e: EquipoPlanta; peso: number }[] = [];
	for (const e of inf.equipos) {
		if (f.tipo && e.tipo !== f.tipo) continue;
		if (f.conControlador && !e.controlador) continue;
		if (f.conPuntos && e.puntos.length === 0) continue;
		if (f.situados && e.x === null) continue;
		if (f.enTablero && !e.enTablero) continue;
		if (sigla && !e.puntos.some((p) => p.sigla.toUpperCase() === sigla)) continue;
		if (!q) { salida.push({ e, peso: 2 }); continue; }
		const tag = normalizar(e.tag);
		if (tag.startsWith(q)) salida.push({ e, peso: 0 });
		else if (tag.includes(q)) salida.push({ e, peso: 1 });
		else if (textoDe(e).includes(q)) salida.push({ e, peso: 2 });
	}
	return salida
		.sort((a, b) => a.peso - b.peso || a.e.tag.localeCompare(b.e.tag, 'es', { numeric: true }))
		.map((x) => x.e);
}

/* ---------------------------------- Colorear ---------------------------------- */

/**
 * Por qué se colorea la planta.
 *
 *  - `tipo`: manejadoras y extractores, que es lo de siempre.
 *  - `controlador`: por el canal del controlador que la gobierna (CH6, CH8…). Es el color que
 *    importa para cablear: las del mismo canal comparten bus y suelen compartir tablero.
 *  - `puntos`: cuántas señales tiene, de gris (ninguna) a verde fuerte (nueve). Enseña de un golpe
 *    dónde está el trabajo.
 *  - `tablero`: si sus señales van cableadas en el tablero o no.
 *  - `obra`: en qué punto está cada máquina según el parte que se lleva en el propio programa.
 *    Este es el color que se mira al subir: enseña de un golpe lo que queda por hacer.
 */
export type ModoColor = 'tipo' | 'controlador' | 'puntos' | 'tablero' | 'obra';

export const MODOS_COLOR: { modo: ModoColor; nombre: string; ayuda: string }[] = [
	{ modo: 'tipo', nombre: 'Tipo de máquina', ayuda: 'Manejadoras de aire y extractores' },
	{ modo: 'controlador', nombre: 'Controlador', ayuda: 'Por el canal del bus: CH5, CH6, CH8…' },
	{ modo: 'puntos', nombre: 'Nº de señales', ayuda: 'Cuántos puntos de BMS tiene dibujados' },
	{ modo: 'tablero', nombre: 'Cableada en tablero', ayuda: 'Si sus señales entran al tablero' },
	{ modo: 'obra', nombre: 'Estado en obra', ayuda: 'Lo que tú has apuntado: pendiente, montado, probado…' },
];

/**
 * Canal del bus al que cuelga la máquina, sacado del nombre del controlador: «XL50_CH8_17» → CH8.
 * Si el plano no la rotula, no se inventa nada: devuelve undefined y se pinta como «sin dato».
 */
export function canalDe(e: EquipoPlanta): string | undefined {
	const m = /CH\s*(\d+)/i.exec(e.controlador ?? '');
	return m ? `CH${m[1]}` : undefined;
}

/** Paleta de canales. Colores separados en tono para que se distingan a distancia. */
const COLOR_CANAL = [0x4dabf7, 0x51cf66, 0xffa94d, 0xda77f2, 0xffd43b, 0x22b8cf, 0xff8787, 0x94d82d];
const GRIS_SIN_DATO = 0x596270;

/** Canales presentes en la planta, ordenados por número. Para la leyenda y para el color. */
export function canalesDe(inf: Infraestructura): string[] {
	const set = new Set<string>();
	for (const e of inf.equipos) { const c = canalDe(e); if (c) set.add(c); }
	return [...set].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
}

/**
 * Color de una máquina según el modo elegido.
 *
 * `estados` es el parte de obra —lo que ha apuntado quien sube— y solo hace falta para el modo
 * `obra`. Va como argumento y no dentro del equipo a propósito: el equipo es lo que dice el plano,
 * y el parte es lo que dice la persona. No son el mismo dato ni se guardan en el mismo sitio.
 */
export function colorDeEquipo(
	e: EquipoPlanta, modo: ModoColor, canales: string[],
	estados?: ReadonlyMap<string, EstadoObra>,
): number {
	switch (modo) {
		case 'tipo':
			return e.tipo === 'uma' ? 0x8b98a5 : 0x6b7d8f;
		case 'controlador': {
			const c = canalDe(e);
			if (!c) return GRIS_SIN_DATO;
			return COLOR_CANAL[Math.max(0, canales.indexOf(c)) % COLOR_CANAL.length];
		}
		case 'puntos': {
			if (e.puntos.length === 0) return GRIS_SIN_DATO;
			// De nueve señales para arriba ya es una máquina completa: se satura ahí.
			const t = Math.min(1, e.puntos.length / 9);
			return mezclar(0x3b4a5a, 0x2f9e44, t);
		}
		case 'tablero':
			return e.enTablero ? 0x2f9e44 : GRIS_SIN_DATO;
		case 'obra': {
			const estado = estados?.get(e.tag) ?? 'pendiente';
			return ESTADOS_OBRA.find((x) => x.estado === estado)?.color ?? GRIS_SIN_DATO;
		}
	}
}

/** Leyenda del modo de color activo: qué significa cada color en pantalla. */
export function leyendaColor(
	inf: Infraestructura, modo: ModoColor, estados?: ReadonlyMap<string, EstadoObra>,
): { color: number; nombre: string; cuantos: number }[] {
	const canales = canalesDe(inf);
	const cuenta = (f: (e: EquipoPlanta) => boolean): number => inf.equipos.filter(f).length;
	switch (modo) {
		case 'tipo':
			return [
				{ color: 0x8b98a5, nombre: 'Manejadora de aire (UMA)', cuantos: cuenta((e) => e.tipo === 'uma') },
				{ color: 0x6b7d8f, nombre: 'Extractor (VEX)', cuantos: cuenta((e) => e.tipo === 'vex') },
			];
		case 'controlador':
			return [
				...canales.map((c, i) => ({
					color: COLOR_CANAL[i % COLOR_CANAL.length],
					nombre: `Canal ${c}`,
					cuantos: cuenta((e) => canalDe(e) === c),
				})),
				{ color: GRIS_SIN_DATO, nombre: 'Sin controlador en el plano', cuantos: cuenta((e) => !canalDe(e)) },
			];
		case 'puntos':
			return [
				{ color: GRIS_SIN_DATO, nombre: 'Sin señales dibujadas', cuantos: cuenta((e) => e.puntos.length === 0) },
				{ color: mezclar(0x3b4a5a, 0x2f9e44, 0.33), nombre: '1 a 3 señales', cuantos: cuenta((e) => e.puntos.length >= 1 && e.puntos.length <= 3) },
				{ color: mezclar(0x3b4a5a, 0x2f9e44, 0.66), nombre: '4 a 6 señales', cuantos: cuenta((e) => e.puntos.length >= 4 && e.puntos.length <= 6) },
				{ color: mezclar(0x3b4a5a, 0x2f9e44, 1), nombre: '7 señales o más', cuantos: cuenta((e) => e.puntos.length >= 7) },
			];
		case 'tablero':
			return [
				{ color: 0x2f9e44, nombre: 'Cableada en el tablero', cuantos: cuenta((e) => e.enTablero) },
				{ color: GRIS_SIN_DATO, nombre: 'No lo dice el plano', cuantos: cuenta((e) => !e.enTablero) },
			];
		case 'obra':
			return ESTADOS_OBRA.map((x) => ({
				color: x.color,
				nombre: x.nombre,
				cuantos: cuenta((e) => (estados?.get(e.tag) ?? 'pendiente') === x.estado),
			}));
	}
}

/** Interpolación lineal entre dos colores 0xRRGGBB. */
function mezclar(a: number, b: number, t: number): number {
	const c = (v: number, d: number): number => Math.round(v + (d - v) * t);
	return (c((a >> 16) & 255, (b >> 16) & 255) << 16)
		| (c((a >> 8) & 255, (b >> 8) & 255) << 8)
		| c(a & 255, b & 255);
}

/* ------------------------------- Medir tiradas ------------------------------- */

/**
 * Lo que mide una cinta métrica en una cubierta, que no es la línea recta.
 *
 * Un cable no vuela: sale del tablero, sube a la bandeja, corre por ella en ortogonal y baja a la
 * máquina. Por eso se dan las dos medidas —la recta, que es el mínimo teórico, y el RECORRIDO
 * ortogonal, que es lo que de verdad se pide en la ferretería— más un margen de subida y bajada y
 * el porcentaje de reserva que todo el mundo deja para las curvas y el conexionado.
 */
export interface Medida {
	/** Distancia en línea recta entre los extremos, en metros. */
	recta: number;
	/** Recorrido siguiendo la bandeja: los tramos en planta, en ortogonal, en metros. */
	recorrido: number;
	/** Subidas y bajadas verticales acumuladas, en metros. */
	vertical: number;
	/** Recorrido + vertical + reserva, redondeado hacia arriba: lo que se pide de cable. */
	cablePedido: number;
	/** Reserva aplicada, en tanto por uno (0,1 = 10 %). */
	reserva: number;
	/** Nº de tramos medidos. */
	tramos: number;
}

/** Altura a la que corre la bandeja sobre la cubierta, en metros. Sube y baja una vez cada punta. */
const ALTURA_BANDEJA = 3.2;
const RESERVA = 0.1;

/**
 * Mide una tirada por los puntos marcados. Los puntos van en metros de escena, con `y` la altura.
 *
 * Con un solo punto no hay medida. Con dos o más, cada tramo se cuenta en ortogonal —primero en
 * una dirección y luego en la otra, que es como va una bandeja— y se suma la subida a la bandeja
 * en el primer punto y la bajada en el último.
 */
export function medirTirada(puntos: { x: number; y: number; z: number }[]): Medida | undefined {
	if (puntos.length < 2) return undefined;
	let recta = 0;
	let recorrido = 0;
	for (let i = 1; i < puntos.length; i++) {
		const a = puntos[i - 1];
		const b = puntos[i];
		recta += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
		recorrido += Math.abs(b.x - a.x) + Math.abs(b.z - a.z);
	}
	const vertical = Math.max(0, ALTURA_BANDEJA - puntos[0].y) + Math.max(0, ALTURA_BANDEJA - puntos[puntos.length - 1].y);
	return {
		recta,
		recorrido,
		vertical,
		cablePedido: Math.ceil((recorrido + vertical) * (1 + RESERVA)),
		reserva: RESERVA,
		tramos: puntos.length - 1,
	};
}
