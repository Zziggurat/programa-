/**
 * Motor de sincronización esquema ↔ gabinete.
 *
 * Compara la lista de dispositivos del esquema con las colocaciones físicas de la placa
 * de montaje y detecta inconsistencias en ambos sentidos. En QElectroTech el plano de
 * montaje es un dibujo aparte sin ningún vínculo; aquí es el mismo modelo.
 */
import { Colocacion, Proyecto } from '../modelo/tipos.js';
import { esReferenciaVisualInerte } from '../modelo/apariencia.js';
import { cajaDeGabinete } from '../modelo/proyecto.js';

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
	// Solo las referencias visuales inertes quedan fuera. Una imagen con perfil eléctrico confirmado
	// es un aparato físico y debe sincronizarse igual que su equivalente nativo.
	const idsReferencia = new Set(proyecto.dispositivos
		.filter(esReferenciaVisualInerte).map((d) => d.id));
	const colocaciones = (gabinete?.colocaciones ?? []).filter((c) => !idsReferencia.has(c.dispositivoId));
	const idsEsquema = new Set(proyecto.dispositivos.map((d) => d.id));
	const idsColocados = new Set(colocaciones.map((c) => c.dispositivoId));

	const faltanEnGabinete = proyecto.dispositivos
		.filter((d) => !d.campo && !esReferenciaVisualInerte(d)
			&& d.tipo !== 'cable' && !idsColocados.has(d.id))
		.map((d) => d.designacion ?? d.id);

	const sobranEnGabinete = colocaciones
		.filter((c) => !idsEsquema.has(c.dispositivoId))
		.map((c) => c.dispositivoId);

	const campoDentroDelGabinete = colocaciones
		.filter((c) => idsEsquema.has(c.dispositivoId))
		.filter((c) => proyecto.dispositivos.find((d) => d.id === c.dispositivoId)!.campo)
		.map((c) => c.dispositivoId);

	/*
	 * DOS APARATOS SOLO SE ESTORBAN SI ESTÁN EN LA MISMA SUPERFICIE.
	 *
	 * Las coordenadas de un aparato de placa y las de uno de puerta se parecen —las dos se miden
	 * en milímetros desde una esquina de arriba a la izquierda— pero son de sitios distintos, y
	 * están separadas por el fondo del armario. Comparándolas sin mirar dónde va montado cada uno,
	 * un piloto de puerta a 250 mm «se solapaba» con el contactor que hay a 250 mm en la placa, y
	 * el DRC daba tres errores de un tablero que está perfectamente montado.
	 */
	const superficie = (c: Colocacion) => c.montaje ?? 'placa';
	const solapes: [string, string][] = [];
	for (let i = 0; i < colocaciones.length; i++) {
		for (let j = i + 1; j < colocaciones.length; j++) {
			const a = colocaciones[i];
			const b = colocaciones[j];
			if (superficie(a) !== superficie(b)) continue;
			const separados =
				a.x + a.ancho <= b.x || b.x + b.ancho <= a.x ||
				a.y + a.alto <= b.y || b.y + b.alto <= a.y;
			if (!separados) solapes.push([a.dispositivoId, b.dispositivoId]);
		}
	}

	// Y cada uno se sale por el borde de LA SUYA: la puerta es del tamaño del armario, que es
	// mayor que la placa, así que medir un piloto de puerta contra la placa lo dejaría fuera sin
	// estarlo (o dentro estando fuera, que es peor).
	const caja = gabinete ? cajaDeGabinete(gabinete) : undefined;
	const fueraDePlaca = gabinete
		? colocaciones
			.filter((c) => {
				const ancho = superficie(c) === 'puerta' ? caja!.ancho : gabinete.ancho;
				const alto = superficie(c) === 'puerta' ? caja!.alto : gabinete.alto;
				return c.x < 0 || c.y < 0 || c.x + c.ancho > ancho || c.y + c.alto > alto;
			})
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
