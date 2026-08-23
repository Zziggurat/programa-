/**
 * DE QUÉ CLASE ES CADA CABLE.
 *
 * En el modelo un conductor es solo «de este borne a este otro», y para el motor eléctrico con
 * eso basta. Para MONTAR el tablero no basta: el mismo dibujo de dos puntos unidos puede ser un
 * hilo rígido peinado en canaleta, un flexible con lazo de servicio hasta un piloto de la puerta,
 * una acometida que trae el instalador desde fuera o el conductor de protección, que no comparte
 * mazo con nadie. Son cuatro maneras distintas de tender el mismo trazo.
 *
 * Aquí se deduce esa clase de la semántica eléctrica y de dónde están los extremos, que son datos
 * persistentes del proyecto. Una clase escrita por la persona manda sobre la deducción física,
 * salvo que alguno de los bornes sea PE: la función de protección es una propiedad eléctrica más
 * fuerte que una preferencia de tendido.
 */
import { ClaseConductor, Conductor, Proyecto } from '../modelo/tipos.js';

/** Un aparato montado sobre la hoja de la puerta, no sobre la placa del fondo. */
export function montadoEnPuerta(proyecto: Proyecto, dispositivoId: string): boolean {
	return !!proyecto.gabinete?.colocaciones.some(
		(c) => c.dispositivoId === dispositivoId && c.montaje === 'puerta',
	);
}

/**
 * Un aparato que NO está colocado en ninguna superficie del gabinete. Existe eléctricamente
 * —motor, alimentación, pulsador remoto— pero no vive dentro del armario: lo que lo une al
 * tablero es cable de campo, y ese cable lo tira el instalador hasta una bornera.
 */
export function fueraDelGabinete(proyecto: Proyecto, dispositivoId: string): boolean {
	const g = proyecto.gabinete;
	if (!g) return false;
	return !g.colocaciones.some((c) => c.dispositivoId === dispositivoId);
}

/** El borne al que apunta un extremo. El id es un rótulo; `tipo` es la declaración eléctrica. */
function borneDe(proyecto: Proyecto, extremo: Conductor['de']) {
	return proyecto.dispositivos.find((d) => d.id === extremo.dispositivoId)
		?.bornes.find((b) => b.id === extremo.borneId);
}

/**
 * Si el conductor es de protección por SEMÁNTICA persistente.
 *
 * No se mira el nombre ni el color. `GND` puede ser el común funcional de 0 V de un control y un
 * hilo verde-amarillo mal declarado sigue siendo un dato incoherente, no una orden para cambiar
 * en silencio su función eléctrica. Los proyectos antiguos sin `Borne.tipo` deben declarar la
 * clase del conductor si quieren apartarse de la deducción física.
 */
function esProteccion(proyecto: Proyecto, c: Conductor): boolean {
	return borneDe(proyecto, c.de)?.tipo === 'PE' || borneDe(proyecto, c.a)?.tipo === 'PE';
}

/**
 * La clase del conductor. El orden de las preguntas importa: protección primero, porque un PE que
 * va a un aparato de puerta sigue siendo PE y no debe acabar dentro del mazo de mando; después el
 * campo, porque un cable que sale del armario ya no se tiende aquí dentro sea cual sea el otro
 * extremo; y solo entonces la puerta.
 */
export function claseDeConductor(proyecto: Proyecto, c: Conductor): ClaseConductor {
	if (c.clase === 'proteccion') return 'proteccion';
	if (esProteccion(proyecto, c)) return 'proteccion';
	if (c.clase) return c.clase;
	if (fueraDelGabinete(proyecto, c.de.dispositivoId) || fueraDelGabinete(proyecto, c.a.dispositivoId)) {
		return 'campo';
	}
	if (montadoEnPuerta(proyecto, c.de.dispositivoId) || montadoEnPuerta(proyecto, c.a.dispositivoId)) {
		return 'puerta';
	}
	return 'interno';
}

/** Cómo se llama cada clase para la persona que mira el inspector. */
export const NOMBRE_CLASE: Record<ClaseConductor, string> = {
	interno: 'Interno del tablero',
	puerta: 'A la puerta (flexible)',
	campo: 'De campo (lo trae el instalador)',
	proteccion: 'Protección (PE)',
};

/** Reparto por clases, para el listado de material y para saber de un vistazo qué hay. */
export function recuentoPorClase(proyecto: Proyecto): Record<ClaseConductor, number> {
	const r: Record<ClaseConductor, number> = { interno: 0, puerta: 0, campo: 0, proteccion: 0 };
	for (const c of proyecto.conductores) r[claseDeConductor(proyecto, c)]++;
	return r;
}
