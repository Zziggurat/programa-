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
	/* El orden visual/persistido no forma parte del modelo eléctrico. Una vista canónica evita
	 * que el orden de inserción altere el pivoteo del solver y deje diferencias flotantes de
	 * último bit en informes reproducibles. Los objetos y el Proyecto original no se mutan. */
	const proyecto = { ...entrada.proyecto,
		dispositivos: [...entrada.proyecto.dispositivos].sort((a, b) => a.id.localeCompare(b.id)),
		conductores: [...entrada.proyecto.conductores].sort((a, b) => a.id.localeCompare(b.id)),
	};
	const circuitos = descubrirCircuitos(proyecto).circuitos;
	const fisica = simularFisicaProyecto(proyecto, entrada.contextoFisico);
	const validacion = validarIngenieria({ proyecto, circuitos, fisica,
		reglas: entrada.reglas ?? REGLAS_INGENIERIA_V7 });
	const potencia = resumirPotenciaIngenieria({ proyecto, circuitos, fisica });
	return { circuitos, fisica, validacion, potencia };
}
