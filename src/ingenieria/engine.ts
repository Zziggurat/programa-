/** Punto de entrada único del EngineeringEngine V7. */
import { simularFisicaProyecto, type ContextoTopologiaFisica } from '../fisica/topologia-proyecto.js';
import type { Proyecto } from '../modelo/tipos.js';
import { descubrirCircuitos } from './circuitos.js';
import { REGLA_COMPATIBILIDAD_EQUIPOS } from './compatibilidad.js';
import { REGLA_CONDUCTORES } from './conductores.js';
import { REGLA_POTENCIA_Y_BALANCE, resumirPotenciaIngenieria } from './potencia.js';
import { REGLA_PROTECCIONES } from './protecciones.js';
import { REGLA_TOPOLOGIA_CIRCUITOS, validarIngenieria, type EngineeringRule } from './validacion.js';

export const REGLAS_INGENIERIA_V7: readonly EngineeringRule[] = [
	REGLA_TOPOLOGIA_CIRCUITOS, REGLA_CONDUCTORES, REGLA_PROTECCIONES,
	REGLA_POTENCIA_Y_BALANCE, REGLA_COMPATIBILIDAD_EQUIPOS,
];

/** Ejecuta un snapshot estático: deliberadamente no acepta reloj ni memoria de simulación. */
export function ejecutarIngenieria(entrada: {
	proyecto: Proyecto;
	contextoFisico?: ContextoTopologiaFisica;
	reglas?: readonly EngineeringRule[];
}) {
	const circuitos = descubrirCircuitos(entrada.proyecto).circuitos;
	const fisica = simularFisicaProyecto(entrada.proyecto, entrada.contextoFisico);
	const validacion = validarIngenieria({ proyecto: entrada.proyecto, circuitos, fisica,
		reglas: entrada.reglas ?? REGLAS_INGENIERIA_V7 });
	const potencia = resumirPotenciaIngenieria({ proyecto: entrada.proyecto, circuitos, fisica });
	return { circuitos, fisica, validacion, potencia };
}
