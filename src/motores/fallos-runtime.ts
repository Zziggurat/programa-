/**
 * Fallos que una persona puede introducir durante una sesión de Energizar.
 *
 * No forman parte del Proyecto: son condiciones del ensayo actual. La clasificación de origen
 * evita presentar una aproximación o una maniobra del usuario como si fuera una medida física.
 */
import type { Dispositivo } from '../modelo/tipos.js';
import { resolverComportamiento } from '../modelo/comportamiento.js';

export type TipoFalloRuntime =
	| 'perdida-fase'
	| 'subtension'
	| 'sobretension'
	| 'sobrecarga'
	| 'cortocircuito'
	| 'fuga-tierra'
	| 'motor-bloqueado'
	| 'fallo-externo'
	| 'proteccion-disparada'
	| 'termico-disparado'
	| 'fusible-fundido'
	| 'vfd-fault';

export type OrigenMagnitudSimulacion = 'calculado' | 'estimado' | 'inyectado' | 'no-modelado';

export interface FalloRuntimeActivo {
	tipo: TipoFalloRuntime;
	origen: OrigenMagnitudSimulacion;
	descripcion: string;
}

export const ETIQUETA_FALLO_RUNTIME: Readonly<Record<TipoFalloRuntime, string>> = {
	'perdida-fase': 'Pérdida de fase',
	subtension: 'Subtensión',
	sobretension: 'Sobretensión',
	sobrecarga: 'Sobrecarga',
	cortocircuito: 'Cortocircuito funcional',
	'fuga-tierra': 'Fuga a tierra simulada',
	'motor-bloqueado': 'Motor bloqueado',
	'fallo-externo': 'Fallo externo',
	'proteccion-disparada': 'Protección disparada',
	'termico-disparado': 'Relé térmico disparado',
	'fusible-fundido': 'Fusible fundido',
	'vfd-fault': 'VFD en FAULT',
};

/**
 * Opciones compatibles por contrato funcional. No se consulta marca, referencia, imagen ni id.
 */
export function fallosCompatibles(d: Dispositivo): TipoFalloRuntime[] {
	const perfil = resolverComportamiento(d);
	if (!perfil || perfil.clase === 'sin-comportamiento') return [];
	if (perfil.clase === 'variador') {
		return perfil.alimentacion.fasesMinimas === 3
			? ['fallo-externo', 'perdida-fase', 'subtension', 'sobrecarga']
			: ['fallo-externo', 'subtension', 'sobrecarga'];
	}
	if (perfil.clase === 'carga' && perfil.efecto === 'giro') {
		return perfil.alimentacion.fasesMinimas === 3
			? ['sobrecarga', 'motor-bloqueado', 'perdida-fase', 'subtension', 'sobretension']
			: ['sobrecarga', 'motor-bloqueado', 'subtension', 'sobretension'];
	}
	if (perfil.clase === 'proteccion') {
		switch (perfil.funcion) {
			case 'diferencial': return ['fuga-tierra'];
			case 'fusible': return ['sobrecarga', 'cortocircuito'];
			case 'termico': return ['sobrecarga', 'perdida-fase'];
			case 'termomagnetico': return ['sobrecarga', 'cortocircuito', 'perdida-fase'];
			default: return [];
		}
	}
	return [];
}

export function tieneFallo(
	estado: { fallos?: readonly TipoFalloRuntime[] } | undefined,
	tipo: TipoFalloRuntime,
): boolean {
	return estado?.fallos?.includes(tipo) === true;
}

/** Transición inmutable usada por la UI y por las regresiones. */
export function cambiarFalloRuntime<T extends { fallos?: TipoFalloRuntime[] }>(
	estado: T,
	tipo: TipoFalloRuntime,
	activo: boolean,
): T {
	const fallos = new Set(estado.fallos ?? []);
	if (activo) fallos.add(tipo); else fallos.delete(tipo);
	const siguiente = { ...estado, fallos: [...fallos].sort() } as T;
	if (!fallos.size) delete siguiente.fallos;
	return siguiente;
}
