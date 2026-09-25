/** ESQ-05: preparar y aplicar un único traslado de una vista M2 por su ID estable. */
import { esReferenciaVisualInerte } from '../modelo/apariencia.js';
import type { Proyecto, RepresentacionEsquema } from '../modelo/tipos.js';
import { FILAS_ESQ } from './esquema.js';

export interface PosicionMovimientoRepresentacion {
	readonly hojaId: string;
	readonly columna: number;
	readonly fila: number;
}

export type PlanMovimientoRepresentacion =
	| { readonly ok: false; readonly motivo: string }
	| { readonly ok: true; readonly vistaId: string; readonly dispositivoId: string;
		readonly origen: PosicionMovimientoRepresentacion;
		readonly destino: PosicionMovimientoRepresentacion; readonly noOp: boolean };

type PlanExitoso = Extract<PlanMovimientoRepresentacion, { ok: true }>;
interface OrigenPlan {
	proyecto: Proyecto;
	firma: string;
	vistaId: string;
	destino: PosicionMovimientoRepresentacion;
	noOp: boolean;
}
const origenes = new WeakMap<PlanExitoso, OrigenPlan>();
const error = (motivo: string): PlanMovimientoRepresentacion => ({ ok: false, motivo });

/** El plan envejece si cambia el dibujo, sus referencias o el circuito durante la confirmación. */
function firmaRelevante(proyecto: Proyecto): string {
	return JSON.stringify({
		hojas: proyecto.hojas,
		esquema: proyecto.esquema,
		dispositivos: proyecto.dispositivos,
		conductores: proyecto.conductores,
		esEjemplo: proyecto.esEjemplo,
	});
}

/** No cambia el proyecto. También sirve para comprobar una casilla durante el arrastre. */
export function previsualizarMovimientoRepresentacion(
	proyecto: Proyecto, vistaId: string, destino: PosicionMovimientoRepresentacion,
): PlanMovimientoRepresentacion {
	if (proyecto.esEjemplo) return error('Un ejemplo es de solo lectura; crea una copia antes de mover vistas.');
	const lista = proyecto.esquema?.representaciones;
	if (!Array.isArray(lista)) return error('Activa primero las vistas M2 para mover una representación.');
	if (lista.length > 5000) return error('El esquema supera el máximo de 5000 vistas M2.');
	if (new Set(lista.map((r) => r.id)).size !== lista.length) {
		return error('Hay IDs de vista repetidos; no se puede mover una representación inequívocamente.');
	}
	if (new Set(proyecto.hojas.map((h) => h.id)).size !== proyecto.hojas.length) {
		return error('Hay IDs de hoja repetidos; no se puede elegir un folio inequívocamente.');
	}
	const vistas = lista.filter((r) => r?.id === vistaId);
	if (vistas.length !== 1) return error('La vista indicada ya no existe o su ID está repetido.');
	const vista = vistas[0];
	const aparatos = proyecto.dispositivos.filter((d) => d.id === vista.dispositivoId);
	if (aparatos.length !== 1 || esReferenciaVisualInerte(aparatos[0])) {
		return error('El aparato de esta vista ya no existe de forma inequívoca.');
	}
	if (proyecto.hojas.filter((h) => h.id === vista.hojaId).length !== 1) {
		return error('La hoja de origen ya no existe de forma inequívoca.');
	}
	const hojas = proyecto.hojas.filter((h) => h.id === destino?.hojaId);
	if (hojas.length !== 1) return error('Elige una hoja de destino existente y única.');
	const hoja = hojas[0];
	const columnas = Math.max(4, Math.min(20, hoja.columnas ?? proyecto.esquema?.columnasPorHoja ?? 10));
	if (!Number.isInteger(destino.columna) || destino.columna < 1 || destino.columna > columnas
		|| !Number.isInteger(destino.fila) || destino.fila < 1 || destino.fila > FILAS_ESQ) {
		return error(`La casilla debe caber en ${hoja.titulo} (${columnas}×${FILAS_ESQ}).`);
	}
	if (lista.some((r) => r !== vista && r.hojaId === destino.hojaId
		&& r.posicion.columna === destino.columna && r.posicion.fila === destino.fila)) {
		return error(`La casilla ${destino.columna}.${destino.fila} de ${hoja.titulo} ya tiene otra vista.`);
	}
	const origen: PosicionMovimientoRepresentacion = Object.freeze({
		hojaId: vista.hojaId, columna: vista.posicion.columna, fila: vista.posicion.fila,
	});
	const ubicacion: PosicionMovimientoRepresentacion = Object.freeze({
		hojaId: destino.hojaId, columna: destino.columna, fila: destino.fila,
	});
	const noOp = origen.hojaId === ubicacion.hojaId
		&& origen.columna === ubicacion.columna && origen.fila === ubicacion.fila;
	const plan: PlanExitoso = Object.freeze({
		ok: true, vistaId: vista.id, dispositivoId: vista.dispositivoId,
		origen, destino: ubicacion, noOp,
	});
	origenes.set(plan, { proyecto, firma: firmaRelevante(proyecto), vistaId: vista.id,
		destino: ubicacion, noOp });
	return plan;
}

/** Rechaza planes ajenos u obsoletos; un traslado real cambia una sola lista de vistas. */
export function aplicarMovimientoRepresentacion(proyecto: Proyecto, plan: PlanExitoso): void {
	const origen = origenes.get(plan);
	if (!origen || origen.proyecto !== proyecto || origen.firma !== firmaRelevante(proyecto)) {
		throw new Error('El proyecto cambió durante el movimiento; vuelve a previsualizar la casilla.');
	}
	if (origen.noOp) return;
	const lista = proyecto.esquema?.representaciones;
	if (!lista) throw new Error('Las vistas M2 ya no están disponibles.');
	const indice = lista.findIndex((r) => r.id === origen.vistaId);
	if (indice < 0) throw new Error('La vista ya no existe.');
	const vista: RepresentacionEsquema = lista[indice];
	const nuevas = [...lista];
	nuevas[indice] = { ...vista, hojaId: origen.destino.hojaId,
		posicion: { columna: origen.destino.columna, fila: origen.destino.fila } };
	proyecto.esquema!.representaciones = nuevas;
}
