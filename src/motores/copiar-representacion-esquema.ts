/** ESQ-05: preparar una copia eléctrica nueva desde una vista completa, sin duplicar anclajes. */
import { esReferenciaVisualInerte } from '../modelo/apariencia.js';
import type { Dispositivo, Proyecto, RepresentacionEsquema } from '../modelo/tipos.js';
import { FILAS_ESQ, montarEsquema, type SimboloEsq } from './esquema.js';
import type { ResultadoPotenciales } from './potenciales.js';
import type { PosicionMovimientoRepresentacion } from './mover-representacion-esquema.js';

export type PlanCopiaRepresentacion =
	| { readonly ok: false; readonly motivo: string }
	| { readonly ok: true; readonly origenVistaId: string; readonly origenDispositivoId: string;
		readonly nuevaVista: RepresentacionEsquema; readonly nuevoDispositivoId: string };

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
	ids: { dispositivoId: string; vistaId: string },
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
	const vistas = lista.filter((r) => r.id === origenVistaId);
	if (vistas.length !== 1 || vistas[0].parte.tipo !== 'completa') {
		return error('Solo una vista completa y única puede copiarse como aparato nuevo.');
	}
	const vista = vistas[0];
	if (lista.filter((r) => r.dispositivoId === vista.dispositivoId).length !== 1) {
		return error('Este aparato tiene varias vistas funcionales; cópialo desde el tablero y represéntalo por partes.');
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
	if (lista.some((r) => r.hojaId === destino.hojaId && r.posicion.columna === destino.columna
		&& r.posicion.fila === destino.fila)) {
		return error('La casilla de destino ya tiene otra vista.');
	}
	const nuevaVista: RepresentacionEsquema = {
		id: ids.vistaId, dispositivoId: ids.dispositivoId, hojaId: destino.hojaId,
		posicion: { columna: destino.columna, fila: destino.fila }, parte: { tipo: 'completa' },
	};
	// Montar el candidato usa el mismo generador de cajas/pines que SVG y PDF. Esto ocurre solo
	// al confirmar el pegado, jamás por pointermove o por hover.
	const copiaDispositivo: Dispositivo = { ...aparatos[0], id: ids.dispositivoId };
	const candidato: Proyecto = { ...proyecto, dispositivos: [...proyecto.dispositivos, copiaDispositivo],
		esquema: { ...proyecto.esquema, representaciones: [...lista, nuevaVista] } };
	let proyectado;
	try { proyectado = montarEsquema(candidato, potencialesVacios); }
	catch { return error('No se pudo comprobar la geometría del destino; revisa el esquema.'); }
	const hojaMontada = proyectado.find((h) => h.id === destino.hojaId);
	const nuevas = hojaMontada?.simbolos.filter((s) => s.representacionId === ids.vistaId) ?? [];
	if (nuevas.length !== 1 || nuevas[0].pines.size !== aparatos[0].bornes.length) {
		return error('La copia no tendría anclajes gráficos inequívocos.');
	}
	if (hojaMontada?.simbolos.some((s) => s !== nuevas[0] && cajasSeCruzan(s, nuevas[0]))) {
		return error('La copia se superpondría con otra caja de símbolo; elige otra casilla.');
	}
	return { ok: true, origenVistaId: vista.id, origenDispositivoId: vista.dispositivoId,
		nuevaVista, nuevoDispositivoId: ids.dispositivoId };
}
