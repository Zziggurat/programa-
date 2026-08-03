/**
 * LA REVISIÓN COMPLETA DEL TABLERO: todos los motores, en el único orden que vale, una sola vez.
 *
 * POR QUÉ EXISTE ESTO
 *
 * Cada motor consume lo que produce el anterior: sin potenciales no hay numeración de hilos, sin
 * ruteo no hay caída de tensión, sin esquema montado no hay posición «hoja.columna» que citar en
 * el índice. Ese orden estaba escrito a mano en TRES sitios —la pantalla, el dossier HTML y el
 * PDF— y las tres cadenas se habían separado sin que nadie se enterase:
 *
 *  - La pantalla le daba al DRC el largo del cable DIBUJADO; el PDF, el largo RUTEADO por canaleta
 *    con su 15 % de reserva y sus puntas. Dos números distintos para el mismo hilo, o sea dos
 *    caídas de tensión distintas para el mismo tablero según dónde lo mirases.
 *  - El PDF no llamaba a la sincronización, así que el papel salía sin los avisos de solape ni de
 *    aparato sin colocar que la pantalla sí enseñaba.
 *
 * Ninguna de las dos cosas daba error: simplemente el documento mentía un poco. Ese es el fallo
 * que este archivo existe para que no vuelva a pasar — y el que volvería a aparecer el día que se
 * añada un motor nuevo y se olvide uno de los tres sitios.
 *
 * QUÉ NO ES
 *
 * No es la simulación. `simulacion.ts` energiza el tablero y ve correr la corriente; esto revisa
 * el proyecto y saca los papeles. Son dos cosas distintas y por eso no se llama `simularTablero`.
 *
 * LO QUE CUESTA CARO SE CALCULA SOLO SI SE PIDE
 *
 * La pantalla llama a esto en CADA cambio del tablero, y ahí solo hace falta el núcleo
 * (potenciales, ruteo, verificación, esquema, sincronización). La lista de materiales, la ficha,
 * el balance térmico y los planes de bornero solo los quiere quien exporta, así que son campos
 * perezosos: no se calculan hasta que alguien los lee, y entonces se calculan una sola vez.
 */
import { Proyecto } from '../modelo/tipos.js';
import { calcularPotenciales, ResultadoPotenciales } from './potenciales.js';
import { numerarConductores, numerarDispositivos } from './numeracion.js';
import { Hallazgo, Severidad, verificarProyecto } from './drc.js';
import { rutearConductores, ResultadoRuteo } from './ruteo.js';
import { HojaEsq, montarEsquema, posicionesEnEsquema } from './esquema.js';
import { generarReferencias, ResultadoReferencias } from './referencias.js';
import { generarPlanBorneros, PlanBornero } from './bornes.js';
import { ResultadoSincronizacion, sincronizarEsquemaGabinete } from './sincronizacion.js';
import { FichaTablero, generarFichaTablero } from './ficha-tablero.js';
import { BalanceTermico, calcularBalanceTermico, Montaje } from './termico.js';
import { FilaBOM, FilaConductor, generarBOM, generarListaConductores } from './documentacion.js';

export interface OpcionesRevision {
	/**
	 * Rehacer las designaciones de los aparatos (-K1, -Q2…). Por defecto FALSE, y a propósito:
	 * mientras se dibuja, cada aparato recibe su número al colocarlo, y renumerar en cada
	 * repintado le cambiaría el nombre a un aparato por haber borrado otro. Solo lo pide quien
	 * exporta, para que el documento salga con la numeración al día.
	 */
	renumerarAparatos?: boolean;
	/**
	 * Rehacer los números de hilo por potencial. Por defecto TRUE: el número de un hilo depende de
	 * a qué está conectado, así que cambia con cada cable que se toca.
	 */
	renumerarHilos?: boolean;
	/**
	 * Largo real de cada conductor (mm) por su id, tal como está DIBUJADO en la placa. Lo aporta
	 * quien dibuja, porque la geometría del trazado vive en la vista y no en el modelo.
	 *
	 * Es el dato bueno para la caída de tensión: es el hilo que se va a cortar. Si no se pasa, se
	 * cae al largo que calcula el ruteo por canaletas, que es una estimación —y que además solo
	 * existe para los conductores que el ruteo consiguió resolver—.
	 */
	longitudesMm?: Map<string, number>;
	/** Montaje del armario para el balance térmico, si se quiere forzar. */
	montaje?: Montaje;
	/** Columnas por hoja del esquema montado, si se quiere forzar. */
	columnasPorHoja?: number;
}

export interface ResumenRevision {
	dispositivos: number;
	conductores: number;
	potenciales: number;
	errores: number;
	avisos: number;
	/** Suma de las longitudes ruteadas dentro del gabinete, en mm. */
	longitudCableMm: number;
	sincronizado: boolean;
}

export interface RevisionTablero {
	proyecto: Proyecto;
	potenciales: ResultadoPotenciales;
	ruteo: ResultadoRuteo;
	/** Verificación eléctrica MÁS los hallazgos físicos de la sincronización, ya ordenados. */
	hallazgos: Hallazgo[];
	hojasEsquema: HojaEsq[];
	/** Posición «hoja.columna» de cada aparato en el esquema montado. */
	posicionesEsquema: Map<string, string>;
	sincronizacion: ResultadoSincronizacion;
	resumen: ResumenRevision;

	/* Perezosos: no se calculan hasta que se leen. */
	referencias: ResultadoReferencias;
	planesBorneros: PlanBornero[];
	ficha: FichaTablero;
	termico: BalanceTermico | undefined;
	bom: FilaBOM[];
	listaConductores: FilaConductor[];
}

/** Memoriza el resultado: el campo perezoso se calcula como mucho una vez. */
function perezoso<T>(calcular: () => T): () => T {
	let hecho = false;
	let valor: T;
	return () => {
		if (!hecho) {
			valor = calcular();
			hecho = true;
		}
		return valor;
	};
}

const ORDEN: Severidad[] = ['error', 'aviso'];

/**
 * Corre la revisión completa. Muta el proyecto recibido: le asigna los números de hilo, y las
 * designaciones de los aparatos si se piden.
 */
export function revisarTablero(
	proyecto: Proyecto,
	opciones: OpcionesRevision = {},
): RevisionTablero {
	if (opciones.renumerarAparatos ?? false) numerarDispositivos(proyecto);
	const potenciales = calcularPotenciales(proyecto);
	if (opciones.renumerarHilos ?? true) numerarConductores(proyecto, potenciales);

	const ruteo = rutearConductores(proyecto);

	// El largo bueno es el del cable dibujado. Solo cuando no lo hay —porque quien llama no dibuja,
	// como una prueba o un script— se usa el del ruteo, que ya trae reserva y puntas.
	const longitudesMm = opciones.longitudesMm
		?? new Map(ruteo.rutas.map((r) => [r.conductorId, r.longitudMm]));

	const hallazgos = verificarProyecto(proyecto, potenciales, {
		longitudesMm,
		canaletas: ruteo.ocupaciones,
		// Y por qué canaleta va cada uno: con eso la coordinación cuenta los circuitos que se
		// calientan entre ellos y corrige la intensidad admisible, que dentro de un armario nunca
		// es la de la tabla.
		canaletasPorConductor: new Map(ruteo.rutas.map((r) => [r.conductorId, r.canaletasUsadas])),
	});

	const hojasEsquema = montarEsquema(proyecto, potenciales,
		opciones.columnasPorHoja !== undefined ? { columnasPorHoja: opciones.columnasPorHoja } : {});
	const posicionesEsquema = posicionesEnEsquema(hojasEsquema);

	// Los fallos del montaje físico son hallazgos como los demás: si un aparato no está colocado o
	// dos se pisan, eso tiene que salir tanto en pantalla como en el papel.
	const sincronizacion = sincronizarEsquemaGabinete(proyecto);
	for (const [a, b] of sincronizacion.solapes) {
		hallazgos.push({ regla: 'S1-solape', severidad: 'error', mensaje: `${a} y ${b} se solapan en la placa` });
	}
	for (const id of sincronizacion.faltanEnGabinete) {
		hallazgos.push({ regla: 'S2-falta-colocar', severidad: 'aviso', mensaje: `${id} no está colocado en el gabinete` });
	}
	hallazgos.sort((a, b) => ORDEN.indexOf(a.severidad) - ORDEN.indexOf(b.severidad)
		|| a.regla.localeCompare(b.regla));

	const referencias = perezoso(() => generarReferencias(proyecto, posicionesEsquema));
	const planesBorneros = perezoso(() => generarPlanBorneros(proyecto, potenciales));
	const ficha = perezoso(() => generarFichaTablero(proyecto, ruteo));
	const termico = perezoso(() => calcularBalanceTermico(proyecto, opciones.montaje));
	const bom = perezoso(() => generarBOM(proyecto));
	const listaConductores = perezoso(() => generarListaConductores(proyecto, ruteo));

	return {
		proyecto,
		potenciales,
		ruteo,
		hallazgos,
		hojasEsquema,
		posicionesEsquema,
		sincronizacion,
		resumen: {
			dispositivos: proyecto.dispositivos.length,
			conductores: proyecto.conductores.length,
			potenciales: potenciales.potenciales.length,
			errores: hallazgos.filter((h) => h.severidad === 'error').length,
			avisos: hallazgos.filter((h) => h.severidad === 'aviso').length,
			longitudCableMm: ruteo.rutas.reduce((suma, r) => suma + r.longitudMm, 0),
			sincronizado: sincronizacion.sincronizado,
		},
		get referencias() { return referencias(); },
		get planesBorneros() { return planesBorneros(); },
		get ficha() { return ficha(); },
		get termico() { return termico(); },
		get bom() { return bom(); },
		get listaConductores() { return listaConductores(); },
	};
}
