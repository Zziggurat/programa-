/**
 * DE QUÉ CLASE ES CADA CABLE.
 *
 * En el modelo un conductor es solo «de este borne a este otro», y para el motor eléctrico con
 * eso basta. Para MONTAR el tablero no basta: el mismo dibujo de dos puntos unidos puede ser un
 * hilo rígido peinado en canaleta, un flexible con lazo de servicio hasta un piloto de la puerta,
 * una acometida que trae el instalador desde fuera o el conductor de protección, que no comparte
 * mazo con nadie. Son cuatro maneras distintas de tender el mismo trazo.
 *
 * Aquí se deduce esa clase de dónde están los extremos, que es información que el proyecto ya
 * tiene, y solo se deduce cuando el conductor no la lleva escrita: si el usuario la fijó a mano,
 * manda la suya.
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

/** Si el conductor es de protección: por su color normalizado o por su marca de potencial. */
function esProteccion(proyecto: Proyecto, c: Conductor): boolean {
	const color = (c.color ?? '').toLowerCase();
	if (color.includes('verde') && color.includes('amarillo')) return true;
	if (color === '#00a651' || color === 'pe') return true;
	const bornes = [c.de.borneId, c.a.borneId].map((b) => b.toUpperCase());
	return bornes.includes('PE') || bornes.includes('GND');
}

/**
 * La clase del conductor. El orden de las preguntas importa: protección primero, porque un PE que
 * va a un aparato de puerta sigue siendo PE y no debe acabar dentro del mazo de mando; después el
 * campo, porque un cable que sale del armario ya no se tiende aquí dentro sea cual sea el otro
 * extremo; y solo entonces la puerta.
 */
export function claseDeConductor(proyecto: Proyecto, c: Conductor): ClaseConductor {
	if (c.clase) return c.clase;
	if (esProteccion(proyecto, c)) return 'proteccion';
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
