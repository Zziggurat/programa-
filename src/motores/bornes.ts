/**
 * Motor de listas de bornes (plan de borneros).
 *
 * Para cada dispositivo de tipo "bornero" genera la tabla clásica de taller:
 * borna | conexión interna | conexión externa | número de conductor | puentes.
 * El lado (interno/externo) se deduce de si el aparato del otro extremo es de campo.
 */
import { Proyecto } from '../modelo/tipos.js';
import { conductoresEn, dispositivo, extremoTexto } from '../modelo/proyecto.js';
import { ResultadoPotenciales } from './potenciales.js';

export interface FilaBornero {
	borna: string;
	internas: string[];   // "K1:A1"
	externas: string[];   // "M1:U"
	numeroConductor?: string;
	puenteCon: string[];  // otras bornas puenteadas
	avisos: string[];
}

export interface PlanBornero {
	borneroId: string;
	designacion: string;
	filas: FilaBornero[];
}

export function generarPlanBorneros(
	proyecto: Proyecto,
	potenciales?: ResultadoPotenciales,
): PlanBornero[] {
	const planes: PlanBornero[] = [];

	for (const bornero of proyecto.dispositivos) {
		if (bornero.tipo !== 'bornero') continue;

		const puenteDe = (borna: string): string[] => {
			for (const grupo of bornero.puentes ?? []) {
				if (grupo.includes(borna)) return grupo.filter((b) => b !== borna);
			}
			return [];
		};

		const filas: FilaBornero[] = bornero.bornes.map((borna) => {
			const ref = { dispositivoId: bornero.id, borneId: borna.id };
			const internas: string[] = [];
			const externas: string[] = [];
			let numeroConductor: string | undefined;
			const avisos: string[] = [];

			for (const c of conductoresEn(proyecto, ref)) {
				const otro = c.de.dispositivoId === bornero.id && c.de.borneId === borna.id ? c.a : c.de;
				const destino = extremoTexto(proyecto, otro);
				if (dispositivo(proyecto, otro.dispositivoId).campo) externas.push(destino);
				else internas.push(destino);
				numeroConductor = numeroConductor ?? c.numero;
			}
			if (potenciales && !numeroConductor) {
				// Borna alimentada solo por puente: hereda el número del potencial.
				const p = potenciales.porBorne.get(`${bornero.id}::${borna.id}`);
				if (p) {
					const c = proyecto.conductores.find((x) => potenciales.porConductor.get(x.id) === p && x.numero);
					numeroConductor = c?.numero;
				}
			}

			if (externas.length > 1) avisos.push(`${externas.length} conductores del lado de campo`);
			if (internas.length === 0 && externas.length === 0 && puenteDe(borna.id).length === 0) {
				avisos.push('borna sin uso');
			}

			return {
				borna: borna.id,
				internas: internas.sort(),
				externas: externas.sort(),
				numeroConductor,
				puenteCon: puenteDe(borna.id),
				avisos,
			};
		});

		planes.push({
			borneroId: bornero.id,
			designacion: bornero.designacion ?? bornero.id,
			filas,
		});
	}

	return planes.sort((a, b) => a.designacion.localeCompare(b.designacion, undefined, { numeric: true }));
}
