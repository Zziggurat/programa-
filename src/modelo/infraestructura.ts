/**
 * Modelo de la INFRAESTRUCTURA de un edificio: la cubierta, sus equipos de clima y sus
 * instalaciones. Es el modelo de la segunda herramienta del programa.
 *
 * Va aparte de `Proyecto` (el tablero) a propósito y de forma total: son dos herramientas
 * distintas que comparten programa, no un modelo mezclado. Un tablero se diseña; una planta se
 * recorre y se consulta. Lo único que las une es el TAG del equipo —«UMA-3-343»— y el hecho de
 * que el plano diga qué señales de ese equipo van cableadas en el tablero.
 *
 * Lo produce `herramientas/extraer-planta.py` a partir del DWG del proyectista.
 */

/** Sistemas que recorren la cubierta. Cada uno con su color y su cota en el visor. */
export type SistemaTraza = 'inyeccion' | 'extraccion' | 'agua-fria' | 'agua' | 'bandeja' | 'bus';

/** Un punto de control del BMS: una señal que entra o sale del controlador. */
export interface PuntoBMS {
	/** Sigla tal como está en el plano: VAF, VAC, EF, STI, TAE… */
	sigla: string;
	/** Qué es, en palabras. */
	que: string;
	/** Naturaleza de la señal: entrada/salida, digital/analógica. */
	clase: string;
}

/** Una máquina de la cubierta: una unidad manejadora de aire o un extractor. */
export interface EquipoPlanta {
	/** Marcado del proyecto: UMA-3-343, VEX-2-405… */
	tag: string;
	/**
	 * True si el marcado se leyó del plano junto a esa máquina. False si la máquina se
	 * identificó por su posición porque el plano no la rotula ahí: el visor lo dice, porque un
	 * tag inventado sobre un equipo real sería peor que no poner ninguno.
	 */
	tagSeguro: boolean;
	tipo: 'uma' | 'vex';
	/** Posición y huella en mm sobre la cubierta. `null` si solo se conoce su diagrama de control. */
	x: number | null;
	y: number | null;
	ancho: number | null;
	fondo: number | null;
	alto: number | null;
	/** Lista de puntos del BMS de esta máquina, tal como los dibuja el plano. */
	puntos: PuntoBMS[];
	/** Controlador que la gobierna, p. ej. «XL50_CH7_17» (un Honeywell Excel 50). */
	controlador: string | null;
	/** True si el plano marca sus señales como «EN TDFC»: van cableadas en el tablero. */
	enTablero: boolean;
}

/** Un tramo de conducto, cañería, bandeja o bus, con su recorrido en planta. */
export interface TrazaPlanta {
	sistema: SistemaTraza;
	/** Cota supuesta sobre la cubierta, en mm. Ver `alturasSupuestas`. */
	z: number;
	/** Sección supuesta del tramo, en mm. */
	ancho: number;
	alto: number;
	/** Recorrido en planta: pares [x, y] en mm. */
	puntos: [number, number][];
}

/**
 * Familias de obra que el plano dibuja alrededor de las máquinas. No son clima: son la cubierta
 * en sí, lo que hace que al pasear se reconozca el sitio en vez de ver tubos sobre una losa lisa.
 */
export type FamiliaObra = 'borde' | 'baranda' | 'muro' | 'lucernario' | 'escalera' | 'acero';

/** Un tramo de obra: su recorrido en planta es del plano; su altura y su grosor, de proyecto. */
export interface ObraPlanta {
	familia: FamiliaObra;
	/** Altura supuesta sobre la cubierta, en mm. */
	alto: number;
	/** Grosor supuesto del elemento, en mm. */
	grosor: number;
	puntos: [number, number][];
}

/** Un pilar de la estructura. La posición y el RADIO salen del plano; la altura, no. */
export interface ColumnaPlanta {
	x: number;
	y: number;
	/** Radio real del pilar en el plano, en mm. */
	r: number;
	/** Altura supuesta del pilar, en mm. Ver `alturasSupuestas`. */
	alto?: number;
}

export interface Infraestructura {
	formato: 'tablero-studio-infraestructura';
	version: 1;
	nombre: string;
	unidades: 'mm';
	origen: { archivo: string; entidades: number; capas: number };
	/**
	 * True cuando las cotas Z y las secciones NO salen del plano sino de reglas de proyecto.
	 * En el plano de la cubierta es el caso: no trae ni una cota Z en las capas de clima. El
	 * visor tiene que decirlo, porque quien mire esto va a tomar decisiones con lo que ve.
	 */
	alturasSupuestas: boolean;
	zona: { x0: number; y0: number; x1: number; y1: number };
	/** Qué significa cada sigla de punto, para poder explicarlo sin salir del visor. */
	leyendaPuntos: Record<string, { que: string; clase: string }>;
	equipos: EquipoPlanta[];
	trazas: TrazaPlanta[];
	/** Pilares de la estructura leídos del plano. Puede faltar en archivos antiguos. */
	columnas?: ColumnaPlanta[];
	/** Barandas, bordes, muros, lucernarios y escaleras. Puede faltar en archivos antiguos. */
	obra?: ObraPlanta[];
}

/** Cómo se dibuja y cómo se llama cada familia de obra. */
export const OBRA: Record<FamiliaObra, { nombre: string; color: number; translucido?: boolean }> = {
	borde: { nombre: 'Bordes y petos de cubierta', color: 0x6c7681 },
	baranda: { nombre: 'Barandas', color: 0xa8b3bd },
	muro: { nombre: 'Muros y casetas', color: 0x7d8790 },
	lucernario: { nombre: 'Lucernarios y termopanel', color: 0x74c0fc, translucido: true },
	escalera: { nombre: 'Escaleras y accesos', color: 0xffa94d },
	acero: { nombre: 'Estructura de acero', color: 0x8d99a6 },
};

/** Metros de cada familia de obra, para la leyenda del visor. */
export function resumenObra(inf: Infraestructura): { familia: FamiliaObra; metros: number }[] {
	const por = new Map<FamiliaObra, number>();
	for (const o of inf.obra ?? []) {
		const largo = o.puntos.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - o.puntos[i][0], p[1] - o.puntos[i][1]), 0);
		por.set(o.familia, (por.get(o.familia) ?? 0) + largo);
	}
	return [...por].map(([familia, mm]) => ({ familia, metros: Math.round(mm / 1000) }))
		.sort((a, b) => b.metros - a.metros);
}

/** Color y nombre de cada sistema, compartidos por el visor 3D y sus leyendas. */
export const SISTEMAS: Record<SistemaTraza, { nombre: string; color: number }> = {
	inyeccion: { nombre: 'Inyección de aire', color: 0x2f9e44 },
	extraccion: { nombre: 'Extracción', color: 0xe8590c },
	'agua-fria': { nombre: 'Agua fría', color: 0x339af0 },
	agua: { nombre: 'Cañerías de agua', color: 0xf06595 },
	bandeja: { nombre: 'Bandeja y canalización', color: 0xfcc419 },
	bus: { nombre: 'Bus LON (control)', color: 0xb197fc },
};

/** Cuenta los puntos del BMS por clase de señal (para la ficha de un equipo). */
export function resumenPuntos(e: EquipoPlanta): { clase: string; cuantos: number }[] {
	const por = new Map<string, number>();
	for (const p of e.puntos) por.set(p.clase, (por.get(p.clase) ?? 0) + 1);
	return [...por].map(([clase, cuantos]) => ({ clase, cuantos }))
		.sort((a, b) => b.cuantos - a.cuantos);
}

/** Totales de la planta, para la cabecera del visor. */
export function resumenPlanta(inf: Infraestructura): {
	umas: number; vex: number; situados: number; conPuntos: number; puntosTotales: number;
	conControlador: number; enTablero: number; metrosPorSistema: { sistema: SistemaTraza; metros: number }[];
} {
	const largo = (t: TrazaPlanta) => t.puntos.slice(1).reduce((s, p, i) => {
		const a = t.puntos[i];
		return s + Math.hypot(p[0] - a[0], p[1] - a[1]);
	}, 0);
	const por = new Map<SistemaTraza, number>();
	for (const t of inf.trazas) por.set(t.sistema, (por.get(t.sistema) ?? 0) + largo(t));
	return {
		umas: inf.equipos.filter((e) => e.tipo === 'uma').length,
		vex: inf.equipos.filter((e) => e.tipo === 'vex').length,
		situados: inf.equipos.filter((e) => e.x !== null).length,
		conPuntos: inf.equipos.filter((e) => e.puntos.length > 0).length,
		puntosTotales: inf.equipos.reduce((s, e) => s + e.puntos.length, 0),
		conControlador: inf.equipos.filter((e) => e.controlador).length,
		enTablero: inf.equipos.filter((e) => e.enTablero).length,
		metrosPorSistema: [...por].map(([sistema, mm]) => ({ sistema, metros: Math.round(mm / 1000) }))
			.sort((a, b) => b.metros - a.metros),
	};
}
