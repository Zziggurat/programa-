import type { Conductor, Proyecto } from '../src/modelo/tipos.js';
import { longitudPlanRutaAutomaticaMm } from '../src/modelo/plan-ruta-automatica.js';
import {
	asignarPlanesAutomaticos, diagnosticoCables,
	prepararAlternativasPlanesAutomaticos, prepararAsignacionPlanesAutomaticos,
} from './escena3d.js';

export interface OpcionRutaCable {
	plan: NonNullable<Conductor['planRutaAutomatica']>;
	longitudReferenciaMm: number;
	puntos: number;
	zMinMm: number;
	zMaxMm: number;
	contactos: number;
	invasiones: number;
}

/** Un borrador aislado: calcularlo no incorpora el conductor ni toca planes del tablero base. */
export interface PropuestaAltaCable {
	/** Foto exacta del documento que autorizó calcular esta propuesta. */
	firmaBase: string;
	documento: Proyecto;
	conductorId: string;
	/** Candidatos del mismo router con separación espacial; ninguno modifica BASE. */
	opciones: OpcionRutaCable[];
	longitudReferenciaMm: number;
	puntos: number;
	contactos: number;
	invasiones: number;
	/** Planes previos sin asignación que se fijarían al aceptar esta operación. */
	planesExistentesFijados: number;
	idsPlanesExistentesFijados: string[];
}

export function proponerAltaCable(base: Proyecto, nuevo: Conductor): PropuestaAltaCable {
	if (base.conductores.some((c) => c.id === nuevo.id)) {
		throw new Error(`Ya existe un conductor con el ID ${nuevo.id}.`);
	}
	const firmaBase = JSON.stringify(base);
	const documento = structuredClone(base);
	const planesAntes = new Set(base.conductores.filter((c) => c.planRutaAutomatica).map((c) => c.id));
	// La foto de los recorridos actuales se prepara solo en el borrador. En el commit se
	// incorporará junto con el alta como una única modificación deshacible.
	asignarPlanesAutomaticos(documento, prepararAsignacionPlanesAutomaticos(documento));
	documento.conductores.push(structuredClone(nuevo));
	const preparados = prepararAlternativasPlanesAutomaticos(documento, nuevo.id, 3);
	if (!preparados.length) {
		throw new Error(`No hay un recorrido automático válido para ${nuevo.id}; no se creó el cable.`);
	}
	asignarPlanesAutomaticos(documento, [preparados[0]]);
	const opciones = preparados.map(({ plan }, indice): OpcionRutaCable => {
		const variante = indice === 0 ? documento : structuredClone(documento);
		const conductor = variante.conductores.find((c) => c.id === nuevo.id)!;
		conductor.planRutaAutomatica = plan;
		const diagnostico = diagnosticoCables(variante);
		let zMinMm = Infinity, zMaxMm = -Infinity;
		for (let i = 2; i < plan.puntosXYZ.length; i += 3) {
			zMinMm = Math.min(zMinMm, plan.puntosXYZ[i]);
			zMaxMm = Math.max(zMaxMm, plan.puntosXYZ[i]);
		}
		return { plan, longitudReferenciaMm: longitudPlanRutaAutomaticaMm(plan),
			puntos: plan.puntosXYZ.length / 3, zMinMm, zMaxMm,
			contactos: diagnostico.conflictos.filter((v) => v.a === nuevo.id || v.b === nuevo.id).length,
			invasiones: diagnostico.invasiones.filter((v) => v.a === nuevo.id).length };
	});
	const idsPlanesExistentesFijados = documento.conductores.filter((c) => c.id !== nuevo.id
		&& !!c.planRutaAutomatica && !planesAntes.has(c.id)).map((c) => c.id).sort();
	return {
		firmaBase, documento, conductorId: nuevo.id, opciones,
		longitudReferenciaMm: opciones[0].longitudReferenciaMm,
		puntos: opciones[0].puntos,
		contactos: opciones[0].contactos,
		invasiones: opciones[0].invasiones,
		planesExistentesFijados: idsPlanesExistentesFijados.length,
		idsPlanesExistentesFijados,
	};
}

/** Aplica solo sobre la BASE exacta; devuelve una copia para no compartir el borrador con el editor. */
export function aplicarPropuestaAltaCable(base: Proyecto, propuesta: PropuestaAltaCable, indice = 0): Proyecto {
	if (JSON.stringify(base) !== propuesta.firmaBase) {
		throw new Error('El tablero cambió mientras se revisaba el recorrido; la propuesta quedó obsoleta.');
	}
	if (!Number.isInteger(indice) || indice < 0 || indice >= propuesta.opciones.length) {
		throw new Error('La alternativa elegida no pertenece a esta propuesta.');
	}
	const documento = structuredClone(propuesta.documento);
	const conductor = documento.conductores.find((c) => c.id === propuesta.conductorId);
	if (!conductor) throw new Error('El cable propuesto ya no está disponible.');
	conductor.planRutaAutomatica = structuredClone(propuesta.opciones[indice].plan);
	return documento;
}
