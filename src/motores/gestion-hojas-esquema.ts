/**
 * ESQ-07: cambios acotados del registro de folios M2. Una hoja es una vista
 * identificada por ID; cambiar su número o clasificación nunca toca el grafo.
 * El plan es para confirmar/mostrar. Solo la preparación privada puede aplicar.
 */
import type { ClaseHojaEsquema, Hoja, Proyecto, RepresentacionEsquema } from '../modelo/tipos.js';

const ordenar = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const CLASES: readonly ClaseHojaEsquema[] = ['potencia', 'mando', 'plc-io', 'bornes', 'mixta'];
const maxTitulo = 120;
const maxId = 120;
const maxColumnas = 20;
const minColumnas = 4;

export type SolicitudGestionHojaEsquema =
	| { readonly tipo: 'crear'; readonly id: string; readonly titulo: string;
		readonly clase?: ClaseHojaEsquema; readonly columnas?: number }
	| { readonly tipo: 'editar'; readonly id: string; readonly titulo?: string;
		/** `null` quita la clasificación; ausente conserva el valor anterior. */
		readonly clase?: ClaseHojaEsquema | null; readonly columnas?: number }
	| { readonly tipo: 'mover'; readonly id: string; readonly direccion: 'subir' | 'bajar' }
	| { readonly tipo: 'eliminar'; readonly id: string };

export interface ResumenHojaEsquema {
	readonly id: string;
	readonly numero: number;
	readonly titulo: string;
	readonly clase?: ClaseHojaEsquema;
	/** Ausente = hereda columnas globales; no equivale a declarar el mismo número. */
	readonly columnasDeclaradas?: number;
	readonly columnas: number;
}

export interface PlanGestionHojaEsquema {
	readonly tipo: SolicitudGestionHojaEsquema['tipo'];
	readonly hojaId: string;
	readonly hojasAntes: readonly ResumenHojaEsquema[];
	readonly hojasDespues: readonly ResumenHojaEsquema[];
	/** Vistas cuyo folio cambia de número o de geometría editorial; no se duplican. */
	readonly vistasAfectadas: readonly { id: string; dispositivoId: string; hojaId: string }[];
	readonly cambios: number;
}

interface OrigenPlan { proyecto: Proyecto; firma: string; hojas: readonly Hoja[]; cambios: number }
const origenes = new WeakMap<PlanGestionHojaEsquema, OrigenPlan>();

const idValido = (v: unknown): v is string => typeof v === 'string'
	&& v.length > 0 && v.length <= maxId && v === v.trim() && !/[\x00-\x1F\x7F]/.test(v);
const tituloValido = (v: unknown, limitar: boolean): v is string => typeof v === 'string'
	&& v.trim().length > 0 && (!limitar || v.trim().length <= maxTitulo)
	&& !/[\x00-\x1F\x7F]/.test(v);
const claseValida = (v: unknown): v is ClaseHojaEsquema => CLASES.includes(v as ClaseHojaEsquema);
const columnasValidas = (v: unknown): v is number => typeof v === 'number'
	&& Number.isInteger(v) && v >= minColumnas && v <= maxColumnas;
const foliosOrdenados = (hojas: readonly Hoja[]): Hoja[] => [...hojas]
	.sort((a, b) => a.numero - b.numero || ordenar(a.id, b.id));

function firmaRelevante(proyecto: Proyecto): string {
	return JSON.stringify({
		hojas: proyecto.hojas,
		representaciones: proyecto.esquema?.representaciones,
		columnasPorHoja: proyecto.esquema?.columnasPorHoja,
		legado: proyecto.dispositivos.map((d) => [d.id, d.hojaId]),
		ejemplo: proyecto.esEjemplo,
	});
}

function validarBase(proyecto: Proyecto): void {
	if (proyecto.esEjemplo) throw new Error('Un ejemplo es de solo lectura; crea una copia antes de gestionar hojas.');
	const vistas = proyecto.esquema?.representaciones;
	if (!Array.isArray(vistas)) throw new Error('Activa primero las vistas M2; las hojas legacy son generadas y no tienen IDs estables.');
	const ids = new Set<string>();
	const numeros = new Set<number>();
	for (const h of proyecto.hojas) {
		if (!idValido(h.id) || !Number.isInteger(h.numero) || h.numero < 1
			|| !tituloValido(h.titulo, false)
			|| (h.clase !== undefined && !claseValida(h.clase))
			|| (h.columnas !== undefined && !columnasValidas(h.columnas))) {
			throw new Error('Hay una hoja con ID, número, título, clase o columnas inválidos; revisa el documento antes de editar folios.');
		}
		if (ids.has(h.id) || numeros.has(h.numero)) {
			throw new Error('Hay IDs o números de hoja duplicados; no se elige una hoja por orden del array.');
		}
		ids.add(h.id);
		numeros.add(h.numero);
	}
	const idsVistas = new Set<string>();
	for (const r of vistas) {
		if (!idValido(r.id) || idsVistas.has(r.id) || !ids.has(r.hojaId)) {
			throw new Error('Hay vistas duplicadas o referidas a una hoja inexistente; revisa los anclajes antes de editar folios.');
		}
		idsVistas.add(r.id);
	}
}

function tituloNuevo(titulo: unknown): string {
	if (!tituloValido(titulo, true)) throw new Error(`El título de la hoja debe tener entre 1 y ${maxTitulo} caracteres sin controles.`);
	return titulo.trim();
}

function claseNueva(clase: unknown): ClaseHojaEsquema | undefined {
	if (clase === undefined || clase === null) return undefined;
	if (!claseValida(clase)) throw new Error('La clase de hoja no está declarada en el modelo.');
	return clase;
}

function columnasNuevas(columnas: unknown): number {
	if (!columnasValidas(columnas)) throw new Error(`Las columnas de hoja deben ser enteras entre ${minColumnas} y ${maxColumnas}.`);
	return columnas;
}

function resumen(h: Hoja, columnasPorHoja: number | undefined): ResumenHojaEsquema {
	return { id: h.id, numero: h.numero, titulo: h.titulo,
		...(h.clase === undefined ? {} : { clase: h.clase }),
		...(h.columnas === undefined ? {} : { columnasDeclaradas: h.columnas }),
		columnas: h.columnas ?? columnasPorHoja ?? 10 };
}

/** Pureza de cancelación: no añade hojas, vistas ni un segundo circuito al proyecto. */
export function previsualizarGestionHojaEsquema(
	proyecto: Proyecto, solicitud: SolicitudGestionHojaEsquema,
): PlanGestionHojaEsquema {
	validarBase(proyecto);
	const vistas = proyecto.esquema!.representaciones!;
	const antes = foliosOrdenados(proyecto.hojas);
	const hojas = antes.map((h) => ({ ...h }));
	const indice = hojas.findIndex((h) => h.id === solicitud.id);
	switch (solicitud.tipo) {
		case 'crear': {
			if (!idValido(solicitud.id)) throw new Error(`El ID de hoja debe tener entre 1 y ${maxId} caracteres sin controles ni espacios exteriores.`);
			if (indice >= 0) throw new Error(`La hoja ${solicitud.id} ya existe.`);
			const numero = Math.max(0, ...hojas.map((h) => h.numero)) + 1;
			const columnas = solicitud.columnas === undefined ? undefined : columnasNuevas(solicitud.columnas);
			const clase = claseNueva(solicitud.clase);
			hojas.push({ id: solicitud.id, numero, titulo: tituloNuevo(solicitud.titulo),
				...(clase === undefined ? {} : { clase }), ...(columnas === undefined ? {} : { columnas }) });
			for (const [i, h] of hojas.entries()) h.numero = i + 1;
			break;
		}
		case 'editar': {
			if (indice < 0) throw new Error(`La hoja ${solicitud.id} ya no existe.`);
			const h = hojas[indice];
			if (solicitud.titulo !== undefined) h.titulo = tituloNuevo(solicitud.titulo);
			if (solicitud.clase !== undefined) {
				const clase = claseNueva(solicitud.clase);
				if (clase === undefined) delete h.clase;
				else h.clase = clase;
			}
			if (solicitud.columnas !== undefined) {
				const columnas = columnasNuevas(solicitud.columnas);
				const actuales = h.columnas ?? proyecto.esquema?.columnasPorHoja ?? 10;
				if (columnas < actuales) {
					const fuera = vistas.filter((r) => r.hojaId === h.id && r.posicion.columna > columnas);
					if (fuera.length) throw new Error(`Reducir a ${columnas} columnas dejaría fuera las vistas ${fuera.map((r) => r.id).sort(ordenar).join(', ')}.`);
				}
				h.columnas = columnas;
			}
			break;
		}
		case 'mover': {
			if (indice < 0) throw new Error(`La hoja ${solicitud.id} ya no existe.`);
			if (solicitud.direccion !== 'subir' && solicitud.direccion !== 'bajar') {
				throw new Error('La dirección de movimiento de la hoja no es válida.');
			}
			const destino = indice + (solicitud.direccion === 'subir' ? -1 : 1);
			if (destino < 0 || destino >= hojas.length) throw new Error('La hoja ya está en el extremo del orden.');
			[hojas[indice], hojas[destino]] = [hojas[destino], hojas[indice]];
			for (const [i, h] of hojas.entries()) h.numero = i + 1;
			break;
		}
		case 'eliminar': {
			if (indice < 0) throw new Error(`La hoja ${solicitud.id} ya no existe.`);
			if (hojas.length === 1) throw new Error('El proyecto necesita al menos una hoja de esquema.');
			if (vistas.some((r) => r.hojaId === solicitud.id)
				|| proyecto.dispositivos.some((d) => d.hojaId === solicitud.id)) {
				throw new Error('La hoja contiene vistas o referencias legacy; reubícalas antes de eliminarla.');
			}
			hojas.splice(indice, 1);
			for (const [i, h] of hojas.entries()) h.numero = i + 1;
			break;
		}
	}
	// El valor efectivo del preview puede coincidir aunque se haya fijado por primera vez
	// `columnas`: esa decisión persistente no debe perderse como supuesto no-op.
	const porIdAntes = new Map(antes.map((h) => [h.id, h]));
	const porIdDespues = new Map(hojas.map((h) => [h.id, h]));
	const afectados = new Set([...porIdAntes.keys(), ...porIdDespues.keys()]
		.filter((id) => JSON.stringify(porIdAntes.get(id)) !== JSON.stringify(porIdDespues.get(id))));
	const plan: PlanGestionHojaEsquema = {
		tipo: solicitud.tipo, hojaId: solicitud.id,
		hojasAntes: antes.map((h) => resumen(h, proyecto.esquema?.columnasPorHoja)),
		hojasDespues: hojas.map((h) => resumen(h, proyecto.esquema?.columnasPorHoja)),
		vistasAfectadas: vistas.filter((r) => afectados.has(r.hojaId))
			.map((r: RepresentacionEsquema) => ({ id: r.id, dispositivoId: r.dispositivoId, hojaId: r.hojaId }))
			.sort((a, b) => ordenar(a.hojaId, b.hojaId) || ordenar(a.id, b.id)),
		cambios: afectados.size,
	};
	origenes.set(plan, { proyecto, firma: firmaRelevante(proyecto),
		hojas: hojas.map((h) => ({ ...h })), cambios: plan.cambios });
	return plan;
}

/** Un plan envejecido o fabricado a mano no puede mutar el documento. */
export function aplicarGestionHojaEsquema(proyecto: Proyecto, plan: PlanGestionHojaEsquema): void {
	const origen = origenes.get(plan);
	if (!origen || origen.proyecto !== proyecto || origen.firma !== firmaRelevante(proyecto)) {
		throw new Error('Las hojas, vistas o referencias cambiaron durante la confirmación; vuelve a previsualizar.');
	}
	if (proyecto.esEjemplo) throw new Error('Un ejemplo es de solo lectura.');
	if (origen.cambios === 0) return;
	proyecto.hojas = origen.hojas.map((h) => ({ ...h }));
}
