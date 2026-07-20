/**
 * Utilidades de consulta y construcción sobre el modelo de proyecto.
 */
import {
	Borne, Conductor, Dispositivo, Hoja, OPCIONES_POR_DEFECTO,
	OpcionesProyecto, Proyecto, RefBorne,
} from './tipos.js';

export function crearProyecto(nombre: string, opciones?: OpcionesProyecto): Proyecto {
	return {
		formato: 'tablero-studio',
		version: 1,
		nombre,
		hojas: [],
		dispositivos: [],
		conductores: [],
		opciones,
	};
}

export function opcionesDe(proyecto: Proyecto): Required<OpcionesProyecto> {
	return { ...OPCIONES_POR_DEFECTO, ...(proyecto.opciones ?? {}) };
}

export function dispositivo(proyecto: Proyecto, id: string): Dispositivo {
	const d = proyecto.dispositivos.find((d) => d.id === id);
	if (!d) throw new Error(`Dispositivo desconocido: ${id}`);
	return d;
}

export function hoja(proyecto: Proyecto, id: string): Hoja | undefined {
	return proyecto.hojas.find((h) => h.id === id);
}

export function borneDe(d: Dispositivo, borneId: string): Borne | undefined {
	return d.bornes.find((b) => b.id === borneId);
}

/** Clave única de un punto de conexión, usada por el motor de potenciales. */
export function claveBorne(ref: RefBorne): string {
	return `${ref.dispositivoId}::${ref.borneId}`;
}

/** Conductores que llegan a un borne concreto. */
export function conductoresEn(proyecto: Proyecto, ref: RefBorne): Conductor[] {
	return proyecto.conductores.filter(
		(c) =>
			(c.de.dispositivoId === ref.dispositivoId && c.de.borneId === ref.borneId) ||
			(c.a.dispositivoId === ref.dispositivoId && c.a.borneId === ref.borneId),
	);
}

/**
 * Posición legible al estilo QElectroTech: "hoja.FilaColumna", p. ej. "2.B3".
 * Las filas se nombran con letras (A, B, C…) y las columnas con números desde 1.
 */
export function posicionTexto(proyecto: Proyecto, d: Dispositivo): string {
	if (!d.hojaId || !d.posicion) return '?';
	const h = hoja(proyecto, d.hojaId);
	const numero = h ? h.numero : '?';
	const fila = String.fromCharCode(65 + Math.max(0, Math.floor(d.posicion.y)));
	const columna = Math.max(1, Math.floor(d.posicion.x) + 1);
	return `${numero}.${fila}${columna}`;
}

/** Descripción corta de un extremo de conductor: "K1:A1" (usa designación si existe). */
export function extremoTexto(proyecto: Proyecto, ref: RefBorne): string {
	const d = dispositivo(proyecto, ref.dispositivoId);
	return `${d.designacion ?? d.id}:${ref.borneId}`;
}
