/** ESQ-05: alinear vistas gráficas M2 sin modificar aparatos ni conexiones. */
import { esReferenciaVisualInerte } from '../modelo/apariencia.js';
import type { Proyecto, RepresentacionEsquema } from '../modelo/tipos.js';
import { FILAS_ESQ, montarEsquema, type HojaEsq, type SimboloEsq } from './esquema.js';
import type { ResultadoPotenciales } from './potenciales.js';
import type { PosicionMovimientoRepresentacion } from './mover-representacion-esquema.js';

export type EjeAlineacionRepresentaciones = 'fila' | 'columna';

export interface CambioAlineacionRepresentacion {
	readonly vistaId: string;
	readonly antes: PosicionMovimientoRepresentacion;
	readonly despues: PosicionMovimientoRepresentacion;
}

export type PlanAlineacionRepresentaciones =
	| { readonly ok: false; readonly motivo: string }
	| { readonly ok: true; readonly hojaId: string; readonly eje: EjeAlineacionRepresentaciones;
		readonly anclaId: string; readonly cambios: readonly CambioAlineacionRepresentacion[];
		readonly noOp: boolean };

type PlanExitoso = Extract<PlanAlineacionRepresentaciones, { ok: true }>;
interface OrigenPlan {
	proyecto: Proyecto;
	firma: string;
	destinos: ReadonlyMap<string, PosicionMovimientoRepresentacion>;
	noOp: boolean;
}
const origenes = new WeakMap<PlanExitoso, OrigenPlan>();
const error = (motivo: string): PlanAlineacionRepresentaciones => ({ ok: false, motivo });

/** Un plan envejece si cambian la disposición, las identidades o el circuito. */
function firmaRelevante(proyecto: Proyecto): string {
	return JSON.stringify({
		hojas: proyecto.hojas,
		esquema: proyecto.esquema,
		dispositivos: proyecto.dispositivos,
		conductores: proyecto.conductores,
		esEjemplo: proyecto.esEjemplo,
	});
}

function clave(posicion: PosicionMovimientoRepresentacion): string {
	return `${posicion.hojaId}:${posicion.columna}:${posicion.fila}`;
}

function cajasSeCruzan(a: SimboloEsq | undefined, b: SimboloEsq | undefined): boolean {
	if (!a || !b) return false;
	const epsilon = 1e-6;
	return Math.max(a.x, b.x) < Math.min(a.x + a.ancho, b.x + b.ancho) - epsilon
		&& Math.max(a.y, b.y) < Math.min(a.y + a.alto, b.y + b.alto) - epsilon;
}

/**
 * La casilla es una reserva lógica, no el contorno real: un bloque alto puede invadir otra fila.
 * Se compara el montaje antes/después una vez por operación, nunca durante pointermove. Solo se
 * rechaza una intersección nueva entre cajas de símbolos; etiquetas e hilos tienen otro contrato.
 */
function superposicionNueva(
	proyecto: Proyecto, hojaId: string,
	destinos: ReadonlyMap<string, PosicionMovimientoRepresentacion>,
): string | undefined {
	const potencialesVacios: ResultadoPotenciales = {
		potenciales: [], porBorne: new Map(), porConductor: new Map(),
	};
	const lista = proyecto.esquema!.representaciones!;
	const copia: Proyecto = {
		...proyecto,
		esquema: { ...proyecto.esquema!, representaciones: lista.map((r) => {
			const destino = destinos.get(r.id);
			return destino ? { ...r, hojaId: destino.hojaId,
				posicion: { columna: destino.columna, fila: destino.fila } } : r;
		}) },
	};
	let antes: HojaEsq | undefined;
	let despues: HojaEsq | undefined;
	try {
		antes = montarEsquema(proyecto, potencialesVacios).find((h) => h.id === hojaId);
		despues = montarEsquema(copia, potencialesVacios).find((h) => h.id === hojaId);
	} catch {
		return 'No se pudo comprobar la geometría de la hoja; revisa el esquema antes de alinear.';
	}
	if (!antes || !despues) return 'La hoja de alineación ya no se puede proyectar.';
	const antesPorId = new Map(antes.simbolos.map((s) => [s.representacionId, s]));
	const despuesPorId = new Map(despues.simbolos.map((s) => [s.representacionId, s]));
	for (const id of destinos.keys()) {
		if (!antesPorId.has(id) || !despuesPorId.has(id)) {
			return `La vista ${id} no tiene una geometría inequívoca para alinearla.`;
		}
	}
	const vistos = new Set<string>();
	for (const id of destinos.keys()) {
		const vista = despuesPorId.get(id)!;
		for (const otra of despues.simbolos) {
			const otroId = otra.representacionId;
			if (!otroId || otroId === id) continue;
			const par = [id, otroId].sort().join('\u0000');
			if (vistos.has(par)) continue;
			vistos.add(par);
			if (cajasSeCruzan(vista, otra)
				&& !cajasSeCruzan(antesPorId.get(id), antesPorId.get(otroId))) {
				return `La alineación superpondría las cajas de las vistas ${id} y ${otroId}.`;
			}
		}
	}
	return undefined;
}

/** Propuesta pura, estable por IDs aunque cambie el orden de las listas. */
export function previsualizarAlineacionRepresentaciones(
	proyecto: Proyecto, ids: readonly string[], anclaId: string, eje: EjeAlineacionRepresentaciones,
): PlanAlineacionRepresentaciones {
	if (proyecto.esEjemplo) return error('Un ejemplo es de solo lectura; crea una copia antes de alinear vistas.');
	if (eje !== 'fila' && eje !== 'columna') return error('Elige alinear por fila o por columna.');
	const lista = proyecto.esquema?.representaciones;
	if (!Array.isArray(lista)) return error('Activa primero las vistas M2 para alinear representaciones.');
	if (lista.length > 5000) return error('El esquema supera el máximo de 5000 vistas M2.');
	if (lista.some((r) => !r || typeof r.id !== 'string' || !r.id)) {
		return error('La lista de vistas M2 contiene una representación sin ID válido.');
	}
	if (!Array.isArray(ids) || ids.length < 2 || ids.length > 64
		|| ids.some((id) => typeof id !== 'string' || !id)
		|| new Set(ids).size !== ids.length) {
		return error('Selecciona entre 2 y 64 IDs de vista diferentes.');
	}
	if (!ids.includes(anclaId)) return error('La vista de referencia debe pertenecer a la selección.');
	if (new Set(lista.map((r) => r?.id)).size !== lista.length) {
		return error('Hay IDs de vista repetidos; no se puede alinear inequívocamente.');
	}
	if (new Set(proyecto.hojas.map((h) => h.id)).size !== proyecto.hojas.length) {
		return error('Hay IDs de hoja repetidos; no se puede alinear inequívocamente.');
	}
	const porId = new Map(lista.map((r) => [r.id, r]));
	const seleccionadas = [...ids].sort((a, b) => a < b ? -1 : a > b ? 1 : 0).map((id) => porId.get(id));
	if (seleccionadas.some((r) => !r)) return error('Una vista seleccionada ya no existe.');
	const vistas = seleccionadas as RepresentacionEsquema[];
	const hojaId = vistas[0].hojaId;
	if (vistas.some((r) => r.hojaId !== hojaId)) {
		return error('Alinea únicamente vistas de una misma hoja.');
	}
	const hoja = proyecto.hojas.find((h) => h.id === hojaId);
	if (!hoja) return error('La hoja de la selección ya no existe.');
	if (hoja.formatoPapel !== undefined && hoja.formatoPapel !== 'A3' && hoja.formatoPapel !== 'A2') {
		return error('El formato físico de la hoja no se puede proyectar.');
	}
	const columnas = Math.max(4, Math.min(20, hoja.columnas ?? proyecto.esquema?.columnasPorHoja ?? 10));
	const dentro = (r: RepresentacionEsquema): boolean => Number.isInteger(r.posicion.columna)
		&& r.posicion.columna >= 1 && r.posicion.columna <= columnas
		&& Number.isInteger(r.posicion.fila) && r.posicion.fila >= 1 && r.posicion.fila <= FILAS_ESQ;
	if (vistas.some((r) => !dentro(r))) return error('Una vista seleccionada está fuera de la rejilla de su hoja.');
	for (const r of vistas) {
		const aparatos = proyecto.dispositivos.filter((d) => d.id === r.dispositivoId);
		if (aparatos.length !== 1 || esReferenciaVisualInerte(aparatos[0])) {
			return error(`El aparato de la vista ${r.id} no existe de forma inequívoca.`);
		}
	}
	const ancla = porId.get(anclaId)!;
	const cambios: CambioAlineacionRepresentacion[] = vistas.map((r) => {
		const antes = Object.freeze({ hojaId, columna: r.posicion.columna, fila: r.posicion.fila });
		const despues = Object.freeze({ hojaId,
			columna: eje === 'columna' ? ancla.posicion.columna : r.posicion.columna,
			fila: eje === 'fila' ? ancla.posicion.fila : r.posicion.fila });
		return Object.freeze({ vistaId: r.id, antes, despues });
	});
	const destinos = new Map(cambios.map((c) => [c.vistaId, c.despues]));
	if (new Set(cambios.map((c) => clave(c.despues))).size !== cambios.length) {
		return error('Dos vistas seleccionadas quedarían en la misma casilla.');
	}
	const elegidas = new Set(ids);
	const ajenas = new Set(lista.filter((r) => !elegidas.has(r.id))
		.map((r) => clave({ hojaId: r.hojaId, columna: r.posicion.columna, fila: r.posicion.fila })));
	if (cambios.some((c) => ajenas.has(clave(c.despues)))) {
		return error('Una casilla de destino ya tiene otra vista.');
	}
	const noOp = cambios.every((c) => clave(c.antes) === clave(c.despues));
	if (!noOp) {
		const movidas = new Map(cambios.filter((c) => clave(c.antes) !== clave(c.despues))
			.map((c) => [c.vistaId, c.despues]));
		const motivo = superposicionNueva(proyecto, hojaId, movidas);
		if (motivo) return error(motivo);
	}
	const plan: PlanExitoso = Object.freeze({ ok: true, hojaId, eje, anclaId,
		cambios: Object.freeze(cambios), noOp });
	origenes.set(plan, { proyecto, firma: firmaRelevante(proyecto), destinos, noOp });
	return plan;
}

/** Aplica todos los destinos juntos; un plan ajeno u obsoleto no puede mutar parcialmente. */
export function aplicarAlineacionRepresentaciones(proyecto: Proyecto, plan: PlanExitoso): void {
	const origen = origenes.get(plan);
	if (!origen || origen.proyecto !== proyecto || origen.firma !== firmaRelevante(proyecto)) {
		throw new Error('El proyecto cambió durante la alineación; vuelve a previsualizar.');
	}
	if (origen.noOp) return;
	const lista = proyecto.esquema?.representaciones;
	if (!lista) throw new Error('Las vistas M2 ya no están disponibles.');
	const nuevas = lista.map((r) => {
		const destino = origen.destinos.get(r.id);
		return destino ? { ...r, hojaId: destino.hojaId,
			posicion: { columna: destino.columna, fila: destino.fila } } : r;
	});
	proyecto.esquema!.representaciones = nuevas;
}
