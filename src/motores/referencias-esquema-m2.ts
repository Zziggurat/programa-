/** ESQ-08: referencias derivadas de identidades eléctricas y anclajes del esquema montado. */
import type { Proyecto } from '../modelo/tipos.js';
import type { ClaseIOPLC } from '../modelo/programa-plc.js';
import { generarListaSenalesIO, type CalidadDatoIO, type OrigenSenalIO } from '../ingenieria/senales-io.js';
import { descubrirCircuitos, type EstadoTopologiaCircuito } from '../ingenieria/circuitos.js';
import type { HojaEsq } from './esquema.js';

export interface UbicacionTerminalEsquema {
	hojaId: string;
	numeroHoja: number;
	columna: number;
	representacionId?: string;
}

export interface ReferenciaCanalTerminalEsquema {
	controladorId: string;
	canalBorneId: string;
	clase: ClaseIOPLC;
	origen: OrigenSenalIO;
	calidad: CalidadDatoIO;
	conductorId: string;
	canal: UbicacionTerminalEsquema;
	terminal: { dispositivoId: string; borneId: string; ubicacion: UbicacionTerminalEsquema };
}

export interface ReferenciaCircuitoHojasEsquema {
	circuitoId: string;
	nombre: string;
	estadoTopologia: EstadoTopologiaCircuito;
	/** Los conductores son trayectos de alimentación identificados; no todos los retornos. */
	alcance: 'TRAYECTOS_ALIMENTACION_IDENTIFICADOS';
	conductores: string[];
	conductoresSinAncla: string[];
	hojas: { id: string; numero: number }[];
}

export type CodigoDiagnosticoReferenciaEsquema = 'IO_NO_VERIFICABLE' | 'ROL_IO_AMBIGUO'
	| 'CANAL_SIN_ANCLA' | 'CANAL_ANCLA_AMBIGUA' | 'TERMINAL_INEXISTENTE'
	| 'TERMINAL_SIN_ANCLA' | 'TERMINAL_ANCLA_AMBIGUA' | 'CIRCUITO_SIN_FUENTE'
	| 'CIRCUITO_AMBIGUO' | 'CIRCUITO_SIN_ANCLA';

export interface DiagnosticoReferenciaEsquema {
	codigo: CodigoDiagnosticoReferenciaEsquema;
	entidadId: string;
	conductorId?: string;
	detalle: string;
}

export interface ResultadoReferenciasEsquemaM2 {
	canales: ReferenciaCanalTerminalEsquema[];
	circuitos: ReferenciaCircuitoHojasEsquema[];
	diagnosticos: DiagnosticoReferenciaEsquema[];
}

const comparar = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const claveBorne = (dispositivoId: string, borneId: string): string => JSON.stringify([dispositivoId, borneId]);

/**
 * No asigna una página por designación, rótulo o cercanía gráfica. Un borne en dos vistas
 * sigue siendo ambiguo aunque ambas vistas pertenezcan al mismo aparato eléctrico.
 */
export function proyectarReferenciasEsquemaM2(proyecto: Proyecto,
	hojas: readonly HojaEsq[]): ResultadoReferenciasEsquemaM2 {
	const anclajes = new Map<string, UbicacionTerminalEsquema[]>();
	for (const hoja of hojas) for (const simbolo of hoja.simbolos) for (const borneId of simbolo.pines.keys()) {
		const clave = claveBorne(simbolo.dispositivoId, borneId);
		const lista = anclajes.get(clave) ?? [];
		lista.push({ hojaId: hoja.id, numeroHoja: hoja.numero, columna: simbolo.columna,
			...(simbolo.representacionId ? { representacionId: simbolo.representacionId } : {}) });
		anclajes.set(clave, lista);
	}
	const ubicaciones = (dispositivoId: string, borneId: string) =>
		anclajes.get(claveBorne(dispositivoId, borneId)) ?? [];
	const diagnosticos: DiagnosticoReferenciaEsquema[] = [];
	const anotar = (codigo: CodigoDiagnosticoReferenciaEsquema, entidadId: string,
		detalle: string, conductorId?: string) => diagnosticos.push({ codigo, entidadId, detalle,
		...(conductorId ? { conductorId } : {}) });

	const io = generarListaSenalesIO(proyecto);
	for (const d of io.diagnosticos) anotar(d.codigo === 'ROL_AMBIGUO' ? 'ROL_IO_AMBIGUO' : 'IO_NO_VERIFICABLE',
		claveBorne(d.dispositivoId, d.borneId ?? ''), d.mensaje);
	const canales: ReferenciaCanalTerminalEsquema[] = [];
	for (const fila of io.filas) {
		if (fila.clase === 'AMBIGUA' || !fila.conexiones.length) continue;
		const origen = ubicaciones(fila.dispositivoId, fila.borneId);
		if (origen.length !== 1) {
			anotar(origen.length ? 'CANAL_ANCLA_AMBIGUA' : 'CANAL_SIN_ANCLA',
				claveBorne(fila.dispositivoId, fila.borneId),
				`El canal ${fila.dispositivoId}:${fila.borneId} tiene ${origen.length} anclajes en el esquema.`);
			continue;
		}
		for (const conexion of fila.conexiones) {
			const entidad = claveBorne(conexion.otroDispositivoId, conexion.otroBorneId);
			if (!conexion.extremoValido) {
				anotar('TERMINAL_INEXISTENTE', entidad,
					`El extremo ${conexion.otroDispositivoId}:${conexion.otroBorneId} no existe en el Proyecto.`, conexion.conductorId);
				continue;
			}
			const destino = ubicaciones(conexion.otroDispositivoId, conexion.otroBorneId);
			if (destino.length !== 1) {
				anotar(destino.length ? 'TERMINAL_ANCLA_AMBIGUA' : 'TERMINAL_SIN_ANCLA', entidad,
					`El terminal ${conexion.otroDispositivoId}:${conexion.otroBorneId} tiene ${destino.length} anclajes en el esquema.`,
					conexion.conductorId);
				continue;
			}
			canales.push({ controladorId: fila.dispositivoId, canalBorneId: fila.borneId,
				clase: fila.clase, origen: fila.origen, calidad: fila.calidad,
				conductorId: conexion.conductorId, canal: origen[0], terminal: {
					dispositivoId: conexion.otroDispositivoId, borneId: conexion.otroBorneId,
					ubicacion: destino[0],
				} });
		}
	}
	canales.sort((a, b) => comparar(a.controladorId, b.controladorId)
		|| comparar(a.canalBorneId, b.canalBorneId) || comparar(a.conductorId, b.conductorId)
		|| comparar(a.terminal.dispositivoId, b.terminal.dispositivoId)
		|| comparar(a.terminal.borneId, b.terminal.borneId));

	const conductores = new Map(proyecto.conductores.map((c) => [c.id, c]));
	const circuitos: ReferenciaCircuitoHojasEsquema[] = [];
	for (const circuito of descubrirCircuitos(proyecto).circuitos) {
		if (circuito.estadoTopologia === 'SIN_FUENTE') anotar('CIRCUITO_SIN_FUENTE', circuito.id,
			'El circuito no tiene fuente identificada; las páginas no prueban alimentación.');
		if (circuito.estadoTopologia === 'AMBIGUA') anotar('CIRCUITO_AMBIGUO', circuito.id,
			`La topología tiene alternativas: ${circuito.ambiguedades.join('; ')}.`);
		const paginas = new Map<string, { id: string; numero: number }>();
		const sinAncla: string[] = [];
		for (const conductorId of circuito.conductores) {
			const c = conductores.get(conductorId);
			const a = c ? ubicaciones(c.de.dispositivoId, c.de.borneId) : [];
			const b = c ? ubicaciones(c.a.dispositivoId, c.a.borneId) : [];
			if (a.length !== 1 || b.length !== 1) {
				sinAncla.push(conductorId);
				anotar('CIRCUITO_SIN_ANCLA', circuito.id,
					`El conductor ${conductorId} no tiene dos anclajes únicos (${a.length}/${b.length}).`, conductorId);
				continue;
			}
			for (const u of [a[0], b[0]]) paginas.set(u.hojaId, { id: u.hojaId, numero: u.numeroHoja });
		}
		circuitos.push({ circuitoId: circuito.id, nombre: circuito.nombre,
			estadoTopologia: circuito.estadoTopologia, alcance: 'TRAYECTOS_ALIMENTACION_IDENTIFICADOS',
			conductores: [...circuito.conductores], conductoresSinAncla: sinAncla,
			hojas: [...paginas.values()].sort((a, b) => a.numero - b.numero || comparar(a.id, b.id)) });
	}
	circuitos.sort((a, b) => comparar(a.circuitoId, b.circuitoId));
	diagnosticos.sort((a, b) => comparar(a.entidadId, b.entidadId) || comparar(a.codigo, b.codigo)
		|| comparar(a.conductorId ?? '', b.conductorId ?? ''));
	return { canales, circuitos, diagnosticos };
}
