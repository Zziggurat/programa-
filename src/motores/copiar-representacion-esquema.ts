/** ESQ-05: copiar un aparato y todas sus vistas funcionales, sin duplicar anclajes. */
import { esReferenciaVisualInerte } from '../modelo/apariencia.js';
import { identidadParaCopia } from '../modelo/identidad-copia.js';
import type { Dispositivo, Proyecto, RepresentacionEsquema } from '../modelo/tipos.js';
import { FILAS_ESQ, montarEsquema, type SimboloEsq } from './esquema.js';
import type { ResultadoPotenciales } from './potenciales.js';
import type { PosicionMovimientoRepresentacion } from './mover-representacion-esquema.js';

export type PlanCopiaRepresentacion =
	| { readonly ok: false; readonly motivo: string }
	| { readonly ok: true; readonly origenVistaId: string; readonly origenDispositivoId: string;
		readonly nuevaVista: RepresentacionEsquema; readonly nuevasVistas: RepresentacionEsquema[];
		readonly nuevoDispositivoId: string };

export interface IdentidadesCopiaRepresentacion {
	dispositivoId: string;
	vistaId: string;
	/** IDs preparados para las demás vistas del mismo aparato, por ID gráfico de origen. */
	otrasVistas?: { origenVistaId: string; nuevaVistaId: string }[];
}

const error = (motivo: string): PlanCopiaRepresentacion => ({ ok: false, motivo });
const potencialesVacios: ResultadoPotenciales = {
	potenciales: [], porBorne: new Map(), porConductor: new Map(),
};
const cajasSeCruzan = (a: SimboloEsq, b: SimboloEsq): boolean => {
	const epsilon = 1e-6;
	return Math.max(a.x, b.x) < Math.min(a.x + a.ancho, b.x + b.ancho) - epsilon
		&& Math.max(a.y, b.y) < Math.min(a.y + a.alto, b.y + b.alto) - epsilon;
};

/**
 * Una representación conectable solo puede aparecer una vez por borne. Copiarla contra el
 * MISMO aparato dejaría dos anclajes e impediría saber dónde acaba cada hilo. La propuesta
 * crea una identidad eléctrica distinta, sin conductores, y reserva una casilla gráfica.
 * No genera IDs, no escribe en Proyecto ni presupone dónde cabe el duplicado físico 3D.
 */
export function planCopiarAparatoConVista(
	proyecto: Proyecto, origenVistaId: string, destino: PosicionMovimientoRepresentacion,
	ids: IdentidadesCopiaRepresentacion,
): PlanCopiaRepresentacion {
	if (proyecto.esEjemplo) return error('Un ejemplo es de solo lectura; crea una copia antes de pegar aparatos.');
	const lista = proyecto.esquema?.representaciones;
	if (!Array.isArray(lista)) return error('Activa primero las vistas M2 para copiar desde el esquema.');
	if (lista.length >= 5000) return error('El esquema ya alcanzó el máximo de vistas M2.');
	if (new Set(lista.map((r) => r.id)).size !== lista.length) {
		return error('Hay IDs de vista repetidos; no se puede copiar una representación inequívocamente.');
	}
	if (new Set(proyecto.dispositivos.map((d) => d.id)).size !== proyecto.dispositivos.length) {
		return error('Hay IDs de aparato repetidos; no se puede crear una copia inequívoca.');
	}
	if (new Set(proyecto.hojas.map((h) => h.id)).size !== proyecto.hojas.length) {
		return error('Hay IDs de hoja repetidos; no se puede elegir un destino inequívoco.');
	}
	if (!ids || typeof ids.dispositivoId !== 'string' || !ids.dispositivoId.trim()
		|| ids.dispositivoId.length > 120 || typeof ids.vistaId !== 'string' || !ids.vistaId.trim()
		|| ids.vistaId.length > 120 || proyecto.dispositivos.some((d) => d.id === ids.dispositivoId)
		|| lista.some((r) => r.id === ids.vistaId)) {
		return error('Los IDs nuevos de aparato y vista deben ser únicos y válidos.');
	}
	if (!destino || typeof destino.hojaId !== 'string'
		|| !Number.isInteger(destino.columna) || !Number.isInteger(destino.fila)) {
		return error('El destino necesita folio, columna y fila válidos.');
	}
	const vistas = lista.filter((r) => r.id === origenVistaId);
	if (vistas.length !== 1) return error('La vista elegida no existe de forma única.');
	const vista = vistas[0];
	const grupo = lista.filter((r) => r.dispositivoId === vista.dispositivoId)
		.sort((a, b) => a.id.localeCompare(b.id));
	if (lista.length + grupo.length > 5000) return error('La copia superaría el máximo de vistas M2.');
	if (grupo.length === 1 && vista.parte.tipo !== 'completa') {
		return error('Una vista funcional aislada no representa el aparato completo para copiarlo.');
	}
	if (grupo.length > 1 && grupo.some((r) => r.parte.tipo === 'completa')) {
		return error('Una vista completa no se puede mezclar con vistas funcionales del mismo aparato.');
	}
	if (grupo.length > 1 && destino.hojaId !== vista.hojaId) {
		return error('La copia desdoblada conserva los folios; pega en el mismo folio de la vista elegida.');
	}
	const otras = grupo.filter((r) => r.id !== vista.id);
	const propuestas = ids.otrasVistas ?? [];
	if (!Array.isArray(propuestas) || propuestas.length !== otras.length
		|| propuestas.some((v) => !v || typeof v.origenVistaId !== 'string'
			|| typeof v.nuevaVistaId !== 'string')
		|| new Set(propuestas.map((v) => v.origenVistaId)).size !== propuestas.length
		|| otras.some((r) => propuestas.filter((v) => v.origenVistaId === r.id).length !== 1)) {
		return error('Faltan IDs únicos para copiar todas las vistas funcionales.');
	}
	const nuevosIds = [ids.vistaId, ...propuestas.map((v) => v.nuevaVistaId)];
	if (nuevosIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 120
		|| lista.some((r) => r.id === id)) || new Set(nuevosIds).size !== nuevosIds.length) {
		return error('Cada vista copiada necesita un ID gráfico nuevo y único.');
	}
	const aparatos = proyecto.dispositivos.filter((d) => d.id === vista.dispositivoId);
	if (aparatos.length !== 1 || esReferenciaVisualInerte(aparatos[0])) {
		return error('El aparato de origen no existe de forma inequívoca o es una referencia visual.');
	}
	const colocaciones = proyecto.gabinete?.colocaciones.filter((c) => c.dispositivoId === vista.dispositivoId);
	if (colocaciones?.length !== 1) {
		return error('El aparato de origen necesita una colocación física única para copiarlo.');
	}
	if (colocaciones[0].montaje === 'puerta') {
		return error('La copia desde esquema no calcula un hueco físico seguro sobre la puerta.');
	}
	const hoja = proyecto.hojas.find((h) => h.id === destino?.hojaId);
	if (!hoja || (hoja.formatoPapel !== undefined && hoja.formatoPapel !== 'A3' && hoja.formatoPapel !== 'A2')) {
		return error('El folio de destino no existe o su formato no se puede proyectar.');
	}
	const columnas = Math.max(4, Math.min(20, hoja.columnas ?? proyecto.esquema?.columnasPorHoja ?? 10));
	if (!Number.isInteger(destino.columna) || destino.columna < 1 || destino.columna > columnas
		|| !Number.isInteger(destino.fila) || destino.fila < 1 || destino.fila > FILAS_ESQ) {
		return error(`La casilla debe caber en ${hoja.titulo} (${columnas}×${FILAS_ESQ}).`);
	}
	const dc = destino.columna - vista.posicion.columna;
	const df = destino.fila - vista.posicion.fila;
	const nuevasVistas: RepresentacionEsquema[] = [vista, ...otras].map((r) => ({
		id: r.id === vista.id ? ids.vistaId : propuestas.find((v) => v.origenVistaId === r.id)!.nuevaVistaId,
		dispositivoId: ids.dispositivoId,
		hojaId: r.id === vista.id ? destino.hojaId : r.hojaId,
		posicion: { columna: r.posicion.columna + dc, fila: r.posicion.fila + df },
		...(r.giro === 180 ? { giro: 180 as const } : {}),
		parte: structuredClone(r.parte),
	}));
	for (const r of nuevasVistas) {
		const folio = proyecto.hojas.find((h) => h.id === r.hojaId);
		if (!folio || (folio.formatoPapel !== undefined && folio.formatoPapel !== 'A3'
			&& folio.formatoPapel !== 'A2')) return error('Un folio de la copia no existe o no se puede proyectar.');
		const columnasFolio = Math.max(4, Math.min(20, folio.columnas ?? proyecto.esquema?.columnasPorHoja ?? 10));
		if (r.posicion.columna < 1 || r.posicion.columna > columnasFolio
			|| r.posicion.fila < 1 || r.posicion.fila > FILAS_ESQ) {
			return error(`Las vistas no caben en ${folio.titulo} (${columnasFolio}×${FILAS_ESQ}).`);
		}
		if (lista.some((v) => v.hojaId === r.hojaId && v.posicion.columna === r.posicion.columna
			&& v.posicion.fila === r.posicion.fila)
			|| nuevasVistas.some((v) => v !== r && v.hojaId === r.hojaId
				&& v.posicion.columna === r.posicion.columna && v.posicion.fila === r.posicion.fila)) {
			return error('Una casilla de la copia ya tiene otra vista.');
		}
	}
	const nuevaVista = nuevasVistas[0];
	// Montar el candidato usa el mismo generador de cajas/pines que SVG y PDF. Esto ocurre solo
	// al confirmar el pegado, jamás por pointermove o por hover.
	const copiaDispositivo: Dispositivo = { ...aparatos[0], id: ids.dispositivoId,
		...identidadParaCopia(aparatos[0], proyecto.dispositivos) };
	const candidato: Proyecto = { ...proyecto, dispositivos: [...proyecto.dispositivos, copiaDispositivo],
		esquema: { ...proyecto.esquema, representaciones: [...lista, ...nuevasVistas] } };
	let proyectado;
	try { proyectado = montarEsquema(candidato, potencialesVacios); }
	catch { return error('No se pudo comprobar la geometría del destino; revisa el esquema.'); }
	const idsNuevos = new Set(nuevosIds);
	const nuevas = proyectado.flatMap((h) => h.simbolos.filter((s) => idsNuevos.has(s.representacionId ?? '')));
	const bornesNuevos = nuevas.flatMap((s) => [...s.pines.keys()]);
	if (nuevas.length !== nuevasVistas.length || nuevas.some((s) => !s.pines.size)
		|| new Set(bornesNuevos).size !== bornesNuevos.length
		|| (grupo.length === 1 && bornesNuevos.length !== aparatos[0].bornes.length)) {
		return error('La copia no tendría anclajes gráficos inequívocos.');
	}
	if (proyectado.some((h) => h.simbolos.some((s) => idsNuevos.has(s.representacionId ?? '')
		&& h.simbolos.some((otro) => otro !== s && cajasSeCruzan(s, otro))))) {
		return error('La copia se superpondría con otra caja de símbolo; elige otra casilla.');
	}
	return { ok: true, origenVistaId: vista.id, origenDispositivoId: vista.dispositivoId,
		nuevaVista, nuevasVistas, nuevoDispositivoId: ids.dispositivoId };
}
