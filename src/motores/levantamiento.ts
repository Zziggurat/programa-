/**
 * EL LEVANTAMIENTO: lo que se apunta al subir a la cubierta.
 *
 * El visor 3D ya sabía enseñar la planta, buscar una máquina y medir una tirada, pero todo eso se
 * perdía al cerrar. Y el trabajo de verdad en una cubierta es justo lo contrario: subes con el
 * plano, anotas qué te has encontrado en cada máquina, mides las tiradas que vas a pedir, y bajas
 * con esa lista. Si mañana hay que volver, la lista tiene que seguir ahí.
 *
 * Dos cosas se guardan:
 *
 *  - LA NOTA DE CADA MÁQUINA, con su estado en obra. «La UMA-3-343 no tiene prensaestopas», «el
 *    extractor 12 está montado pero sin probar». Es el parte de obra, máquina a máquina.
 *  - LAS TIRADAS MEDIDAS, con su nombre, su sección y sus metros. De ahí sale sola la lista de
 *    cable a pedir, que es el papel que se lleva uno a la ferretería.
 *
 * Aquí no hay Three.js ni DOM: solo el modelo y sus cuentas, para poder probarlo sin navegador.
 */
import { EquipoPlanta, Infraestructura } from '../modelo/infraestructura.js';

/* --------------------------------- El parte de obra --------------------------------- */

/** En qué punto está una máquina. Es el vocabulario que se usa en obra, no uno inventado. */
export type EstadoObra = 'pendiente' | 'en-curso' | 'montado' | 'probado' | 'problema';

export const ESTADOS_OBRA: { estado: EstadoObra; nombre: string; color: number }[] = [
	{ estado: 'pendiente', nombre: 'Pendiente', color: 0x596270 },
	{ estado: 'en-curso', nombre: 'En curso', color: 0x4dabf7 },
	{ estado: 'montado', nombre: 'Montado', color: 0xffa94d },
	{ estado: 'probado', nombre: 'Probado', color: 0x2f9e44 },
	{ estado: 'problema', nombre: 'Con problema', color: 0xe03131 },
];

const ESTADOS = new Set<string>(ESTADOS_OBRA.map((e) => e.estado));

export interface NotaEquipo {
	tag: string;
	estado: EstadoObra;
	/** Lo que se apuntó a mano. Puede estar vacío: marcar el estado ya es información. */
	nota: string;
	/** Cuándo se tocó por última vez, en ISO. Sirve para saber si el parte está al día. */
	fecha: string;
}

/* ---------------------------------- Las tiradas ---------------------------------- */

/**
 * Una tirada medida y guardada, con lo que hace falta para pedir el cable.
 *
 * `metros` es lo que devuelve la cinta como «cable a pedir» —recorrido ortogonal más subidas y
 * bajadas más reserva—, y `conductores` cuántos hilos van por ese recorrido: pedir 40 m de una
 * manguera de 4×2,5 no es lo mismo que pedir 40 m de cable suelto, y la ferretería cobra por metro
 * de manguera, no por metro de hilo.
 */
export interface Tirada {
	id: string;
	nombre: string;
	/** Marcados de los extremos, si la cinta se pinchó sobre máquinas. */
	desde?: string;
	hasta?: string;
	/** Metros a pedir (con la reserva ya dentro). */
	metros: number;
	/** Recorrido medido en la bandeja, sin reserva. */
	recorrido: number;
	seccion: number;
	conductores: number;
	fecha: string;
}

export interface Levantamiento {
	/** Parte de obra por marcado de máquina. */
	notas: Record<string, NotaEquipo>;
	tiradas: Tirada[];
}

export function levantamientoVacio(): Levantamiento {
	return { notas: {}, tiradas: [] };
}

/**
 * Lee un levantamiento guardado. NUNCA lanza: lo que venga mal se descarta y lo que venga bien se
 * conserva. Un parte de obra a medias vale mucho más que un error al abrir el programa.
 */
export function leerLevantamiento(dato: unknown): Levantamiento {
	const l = levantamientoVacio();
	if (!dato || typeof dato !== 'object') return l;
	const d = dato as { notas?: unknown; tiradas?: unknown };
	if (d.notas && typeof d.notas === 'object') {
		for (const [tag, valor] of Object.entries(d.notas as Record<string, unknown>)) {
			if (!valor || typeof valor !== 'object') continue;
			const v = valor as Partial<NotaEquipo>;
			const estado = ESTADOS.has(String(v.estado)) ? v.estado as EstadoObra : 'pendiente';
			l.notas[tag] = {
				tag,
				estado,
				nota: typeof v.nota === 'string' ? v.nota : '',
				fecha: typeof v.fecha === 'string' ? v.fecha : new Date().toISOString(),
			};
		}
	}
	if (Array.isArray(d.tiradas)) {
		for (const valor of d.tiradas) {
			if (!valor || typeof valor !== 'object') continue;
			const v = valor as Partial<Tirada>;
			const metros = Number(v.metros);
			if (!Number.isFinite(metros) || metros <= 0) continue;
			l.tiradas.push({
				id: typeof v.id === 'string' ? v.id : `t${l.tiradas.length + 1}`,
				nombre: typeof v.nombre === 'string' && v.nombre ? v.nombre : 'Tirada sin nombre',
				desde: typeof v.desde === 'string' ? v.desde : undefined,
				hasta: typeof v.hasta === 'string' ? v.hasta : undefined,
				metros,
				recorrido: Number.isFinite(Number(v.recorrido)) ? Number(v.recorrido) : metros,
				seccion: Number.isFinite(Number(v.seccion)) && Number(v.seccion) > 0 ? Number(v.seccion) : 2.5,
				conductores: Number.isFinite(Number(v.conductores)) && Number(v.conductores) > 0
					? Math.round(Number(v.conductores)) : 3,
				fecha: typeof v.fecha === 'string' ? v.fecha : new Date().toISOString(),
			});
		}
	}
	return l;
}

/* ------------------------------- Lo que hay que pedir ------------------------------- */

export interface FilaPedido {
	/** Cómo se pide en el mostrador: «4 × 2,5 mm²». */
	cable: string;
	seccion: number;
	conductores: number;
	/** Metros de manguera, sumando todas las tiradas de ese cable. */
	metros: number;
	/** Cuántas tiradas van con este cable. */
	tiradas: number;
}

/**
 * La lista de cable a pedir: una fila por tipo de manguera, con los metros sumados.
 *
 * Se agrupa por sección Y número de conductores porque es como se compra: nadie pide «120 metros de
 * 2,5», pide «120 metros de 4×2,5». Y se redondea al alza a metros enteros, que es como se corta.
 */
export function listaDePedido(tiradas: readonly Tirada[]): FilaPedido[] {
	const por = new Map<string, FilaPedido>();
	for (const t of tiradas) {
		const clave = `${t.conductores}x${t.seccion}`;
		const fila = por.get(clave) ?? {
			cable: `${t.conductores} × ${String(t.seccion).replace('.', ',')} mm²`,
			seccion: t.seccion,
			conductores: t.conductores,
			metros: 0,
			tiradas: 0,
		};
		fila.metros += t.metros;
		fila.tiradas++;
		por.set(clave, fila);
	}
	return [...por.values()]
		.map((f) => ({ ...f, metros: Math.ceil(f.metros) }))
		.sort((a, b) => a.seccion - b.seccion || a.conductores - b.conductores);
}

/* -------------------------------- Cómo va la obra -------------------------------- */

export interface AvanceObra {
	estado: EstadoObra;
	nombre: string;
	color: number;
	cuantos: number;
}

/**
 * Cuántas máquinas hay en cada estado. Lo que no tiene nota apuntada cuenta como «pendiente»: en
 * una obra, lo que nadie ha tocado está pendiente, no en un limbo aparte.
 */
export function avanceObra(l: Levantamiento, inf: Infraestructura): AvanceObra[] {
	const cuenta = new Map<EstadoObra, number>(ESTADOS_OBRA.map((e) => [e.estado, 0]));
	for (const e of inf.equipos) {
		const estado = l.notas[e.tag]?.estado ?? 'pendiente';
		cuenta.set(estado, (cuenta.get(estado) ?? 0) + 1);
	}
	return ESTADOS_OBRA.map((e) => ({ ...e, cuantos: cuenta.get(e.estado) ?? 0 }));
}

/** Estado de cada máquina, listo para colorear el 3D. */
export function estadosPorTag(l: Levantamiento): Map<string, EstadoObra> {
	const m = new Map<string, EstadoObra>();
	for (const n of Object.values(l.notas)) m.set(n.tag, n.estado);
	return m;
}

/* ---------------------------------- Llevárselo ---------------------------------- */

const csv = (filas: string[][]): string => filas
	.map((f) => f.map((c) => (/[";\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';'))
	.join('\n');

/**
 * El parte de obra en CSV: una fila por máquina anotada, con su estado, su nota y sus datos del
 * plano. Es lo que se manda por correo al terminar la jornada.
 */
export function parteDeObraCSV(l: Levantamiento, inf: Infraestructura): string {
	const porTag = new Map<string, EquipoPlanta>(inf.equipos.map((e) => [e.tag, e]));
	const nombre = new Map(ESTADOS_OBRA.map((e) => [e.estado, e.nombre]));
	const filas: string[][] = [['Máquina', 'Tipo', 'Controlador', 'Señales', 'Estado', 'Nota', 'Fecha']];
	for (const n of Object.values(l.notas).sort((a, b) => a.tag.localeCompare(b.tag, 'es', { numeric: true }))) {
		const e = porTag.get(n.tag);
		filas.push([
			n.tag,
			e ? (e.tipo === 'uma' ? 'UMA' : 'Extractor') : '—',
			e?.controlador ?? '',
			String(e?.puntos.length ?? 0),
			nombre.get(n.estado) ?? n.estado,
			n.nota,
			n.fecha.slice(0, 10),
		]);
	}
	return csv(filas);
}

/** Las tiradas medidas en CSV, con la lista de pedido al final. */
export function tiradasCSV(l: Levantamiento): string {
	const filas: string[][] = [['Tirada', 'Desde', 'Hasta', 'Cable', 'Recorrido (m)', 'A pedir (m)', 'Fecha']];
	for (const t of l.tiradas) {
		filas.push([
			t.nombre, t.desde ?? '', t.hasta ?? '',
			`${t.conductores} x ${String(t.seccion).replace('.', ',')} mm2`,
			t.recorrido.toFixed(1), String(t.metros), t.fecha.slice(0, 10),
		]);
	}
	filas.push([]);
	filas.push(['CABLE A PEDIR']);
	filas.push(['Cable', 'Tiradas', 'Metros']);
	for (const f of listaDePedido(l.tiradas)) {
		filas.push([f.cable, String(f.tiradas), String(f.metros)]);
	}
	return csv(filas);
}
