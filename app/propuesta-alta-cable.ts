import type { Conductor, Proyecto } from '../src/modelo/tipos.js';
import {
	asignarPlanesAutomaticos, diagnosticoCables, largoDibujadoMm,
	prepararAsignacionPlanesAutomaticos,
} from './escena3d.js';

/** Un borrador aislado: calcularlo no incorpora el conductor ni toca planes del tablero base. */
export interface PropuestaAltaCable {
	documento: Proyecto;
	conductorId: string;
	longitudReferenciaMm: number;
	puntos: number;
	contactos: number;
	invasiones: number;
}

export function proponerAltaCable(base: Proyecto, nuevo: Conductor): PropuestaAltaCable {
	if (base.conductores.some((c) => c.id === nuevo.id)) {
		throw new Error(`Ya existe un conductor con el ID ${nuevo.id}.`);
	}
	const documento = structuredClone(base);
	// La foto de los recorridos actuales se prepara solo en el borrador. En el commit se
	// incorporará junto con el alta como una única modificación deshacible.
	asignarPlanesAutomaticos(documento, prepararAsignacionPlanesAutomaticos(documento));
	documento.conductores.push(structuredClone(nuevo));
	const preparado = prepararAsignacionPlanesAutomaticos(documento, new Set([nuevo.id]));
	if (preparado.length !== 1) {
		throw new Error(`No hay un recorrido automático válido para ${nuevo.id}; no se creó el cable.`);
	}
	asignarPlanesAutomaticos(documento, preparado);
	const cable = documento.conductores.find((c) => c.id === nuevo.id)!;
	const diagnostico = diagnosticoCables(documento);
	return {
		documento, conductorId: nuevo.id,
		longitudReferenciaMm: largoDibujadoMm(documento, cable),
		puntos: preparado[0].plan.puntosXYZ.length / 3,
		contactos: diagnostico.conflictos.filter((v) => v.a === nuevo.id || v.b === nuevo.id).length,
		invasiones: diagnostico.invasiones.filter((v) => v.a === nuevo.id).length,
	};
}
