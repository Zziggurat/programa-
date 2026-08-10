/**
 * QUÉ TENSIÓN TIENE CADA BORNE — no cada aparato.
 *
 * Hasta ahora, «la tensión» era un dato del aparato y se le colgaba igual a todos sus bornes. Con
 * eso, el tablero que el propio programa arma desde la Planta salía con TRES avisos R6 de
 * «conflicto de tensión» recién generado, y ninguno era verdad:
 *
 *   P7   a1::GND + g1::PE + red::PE          → «conecta 24 V y 220 V»
 *   P35  g1::L (primario) + q1::2            → «conecta 24 V y 220 V»
 *   P36  g1::N (primario) + q1::4            → «conecta 24 V y 220 V»
 *
 * Los dos motivos son de libro:
 *
 * 1. **Una fuente tiene dos tensiones.** Los bornes L/N del primario de una fuente 220/24 están a
 *    220, y los `+24`/`0V` del secundario a 24. Colgar una sola cifra del aparato obliga a mentir
 *    en uno de los dos lados.
 *
 * 2. **El conductor de protección no tiene tensión de empleo.** Un PE une la carcasa de un
 *    disyuntor de 220 con la masa de un controlador de 24 PORQUE PARA ESO ESTÁ. Leer eso como un
 *    conflicto es leer al revés la única red del tablero que se une a propósito.
 *
 * Un DRC que avisa de lo que él mismo acaba de armar enseña a ignorar los avisos, y el día que
 * salte uno de verdad —una bobina de 24 alimentada a 220— ya nadie lo mira. Por eso se arregla el
 * modelo y no la regla.
 */
import { Borne, Dispositivo } from '../modelo/tipos.js';

/**
 * Qué tensión reparte el secundario de un transformador o de una fuente.
 *
 * Manda el dato declarado; si no lo hay, se lee de la descripción, que es donde de verdad está
 * escrito en casi todos los catálogos («Transformador 220/24 V 3 A»); y si tampoco, se supone 24,
 * que es lo más común en control.
 */
export function tensionSecundariaDe(d: Dispositivo): number {
	if (d.tensionSecundariaV && d.tensionSecundariaV > 0) return d.tensionSecundariaV;
	const m = /(\d{2,4})\s*\/\s*(\d{1,4})\s*V/i.exec(d.descripcion ?? '');
	if (m) {
		const secundario = Number(m[2]);
		if (secundario > 0 && secundario < Number(m[1])) return secundario;
	}
	return 24;
}

/** ¿Este borne está en el secundario de una fuente o un transformador? */
function esSecundario(b: Borne): boolean {
	if (b.lado) return b.lado === 'secundario+' || b.lado === 'secundario-';
	// Proyectos guardados antes de que existiera `lado`: se deduce del id, como la simulación.
	return b.id === '+V' || b.id === '-V' || b.id === 'S1' || b.id === 'S2';
}

/**
 * La tensión de empleo de un borne, o `undefined` si no tiene ninguna.
 *
 * `undefined` no es «no se sabe»: es «aquí no hay tensión de empleo que comparar». Es lo que pasa
 * con un PE, y es justo lo que hace falta para que R6 no lo cuente.
 */
export function tensionDeBorne(d: Dispositivo, b: Borne): number | undefined {
	if (b.tipo === 'PE') return undefined;
	if (d.tipo === 'fuente' || d.tipo === 'transformador') {
		return esSecundario(b) ? tensionSecundariaDe(d) : d.tensionNominal;
	}
	return d.tensionNominal;
}
