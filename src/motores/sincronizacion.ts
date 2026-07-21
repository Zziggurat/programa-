/**
 * Motor de sincronización esquema ↔ gabinete.
 *
 * Compara la lista de dispositivos del esquema con las colocaciones físicas de la placa
 * de montaje y detecta inconsistencias en ambos sentidos. En QElectroTech el plano de
 * montaje es un dibujo aparte sin ningún vínculo; aquí es el mismo modelo.
 */
import { Proyecto } from '../modelo/tipos.js';

export interface ResultadoSincronizacion {
	/** Dispositivos del esquema (dentro del gabinete) sin colocar en la placa. */
	faltanEnGabinete: string[];
	/** Colocaciones que apuntan a dispositivos inexistentes en el esquema. */
	sobranEnGabinete: string[];
	/** Dispositivos de campo colocados dentro del gabinete (probable error). */
	campoDentroDelGabinete: string[];
	/** Pares de colocaciones que se solapan físicamente. */
	solapes: [string, string][];
	/** Colocaciones fuera de los límites de la placa. */
	fueraDePlaca: string[];
	sincronizado: boolean;
}

export function sincronizarEsquemaGabinete(proyecto: Proyecto): ResultadoSincronizacion {
	const gabinete = proyecto.gabinete;
	// Las imágenes de referencia son visuales: no cuentan como aparatos del montaje físico.
	const idsImagen = new Set(proyecto.dispositivos.filter((d) => d.imagen).map((d) => d.id));
	const colocaciones = (gabinete?.colocaciones ?? []).filter((c) => !idsImagen.has(c.dispositivoId));
	const idsEsquema = new Set(proyecto.dispositivos.map((d) => d.id));
	const idsColocados = new Set(colocaciones.map((c) => c.dispositivoId));

	const faltanEnGabinete = proyecto.dispositivos
		.filter((d) => !d.campo && !d.imagen && d.tipo !== 'cable' && !idsColocados.has(d.id))
		.map((d) => d.designacion ?? d.id);

	const sobranEnGabinete = colocaciones
		.filter((c) => !idsEsquema.has(c.dispositivoId))
		.map((c) => c.dispositivoId);

	const campoDentroDelGabinete = colocaciones
		.filter((c) => idsEsquema.has(c.dispositivoId))
		.filter((c) => proyecto.dispositivos.find((d) => d.id === c.dispositivoId)!.campo)
		.map((c) => c.dispositivoId);

	const solapes: [string, string][] = [];
	for (let i = 0; i < colocaciones.length; i++) {
		for (let j = i + 1; j < colocaciones.length; j++) {
			const a = colocaciones[i];
			const b = colocaciones[j];
			const separados =
				a.x + a.ancho <= b.x || b.x + b.ancho <= a.x ||
				a.y + a.alto <= b.y || b.y + b.alto <= a.y;
			if (!separados) solapes.push([a.dispositivoId, b.dispositivoId]);
		}
	}

	const fueraDePlaca = gabinete
		? colocaciones
			.filter((c) => c.x < 0 || c.y < 0 || c.x + c.ancho > gabinete.ancho || c.y + c.alto > gabinete.alto)
			.map((c) => c.dispositivoId)
		: [];

	return {
		faltanEnGabinete,
		sobranEnGabinete,
		campoDentroDelGabinete,
		solapes,
		fueraDePlaca,
		sincronizado:
			faltanEnGabinete.length === 0 &&
			sobranEnGabinete.length === 0 &&
			campoDentroDelGabinete.length === 0 &&
			solapes.length === 0 &&
			fueraDePlaca.length === 0,
	};
}
