/**
 * Motor de ETIQUETAS: las tiras de rótulos que se meten en la impresora y se pegan sobre las
 * bornas y los aparatos. Sin ellas un tablero no se entrega, y hacerlas a mano en una hoja de
 * cálculo es de las tareas más ingratas del oficio.
 *
 * El motor decide QUÉ dice cada etiqueta a partir del modelo; quién imprime decide el tamaño.
 */
import { Proyecto } from '../modelo/tipos.js';
import { esReferenciaVisualInerte } from '../modelo/apariencia.js';
import { ResultadoPotenciales } from './potenciales.js';

export interface Etiqueta {
	/** Texto principal (lo que se lee de lejos): la borna o el aparato. */
	principal: string;
	/** Línea secundaria: a dónde va ese hilo, o qué hace el aparato. */
	secundaria?: string;
}

export interface TiraEtiquetas {
	/** Aparato al que pertenece la tira (un bornero, o el conjunto de aparatos del tablero). */
	titulo: string;
	etiquetas: Etiqueta[];
}

/** Texto corto de un extremo de conductor: "-K1:A1". */
function extremo(proyecto: Proyecto, dispositivoId: string, borneId: string): string {
	const d = proyecto.dispositivos.find((x) => x.id === dispositivoId);
	return `${d?.designacion ?? dispositivoId}:${borneId}`;
}

/**
 * Tiras de rótulos de los BORNEROS: una etiqueta por borna, con su número de potencial y a
 * qué aparato va. Es lo que se pega en la regleta y lo que mira el electricista al conectar.
 */
export function tirasDeBorneros(proyecto: Proyecto, potenciales?: ResultadoPotenciales): TiraEtiquetas[] {
	const tiras: TiraEtiquetas[] = [];
	for (const d of proyecto.dispositivos) {
		if (d.tipo !== 'bornero' || esReferenciaVisualInerte(d)) continue;
		const etiquetas: Etiqueta[] = d.bornes.map((b) => {
			// A dónde va esta borna: el otro extremo de sus conductores, sin contar el bornero mismo.
			const destinos = proyecto.conductores
				.filter((c) => (c.de.dispositivoId === d.id && c.de.borneId === b.id)
					|| (c.a.dispositivoId === d.id && c.a.borneId === b.id))
				.map((c) => (c.de.dispositivoId === d.id && c.de.borneId === b.id
					? extremo(proyecto, c.a.dispositivoId, c.a.borneId)
					: extremo(proyecto, c.de.dispositivoId, c.de.borneId)));
			const numero = proyecto.conductores.find((c) =>
				(c.de.dispositivoId === d.id && c.de.borneId === b.id)
				|| (c.a.dispositivoId === d.id && c.a.borneId === b.id))?.numero
				?? potenciales?.porBorne.get(`${d.id}::${b.id}`)?.id;
			return {
				principal: b.id,
				secundaria: [numero ? `hilo ${numero}` : '', ...new Set(destinos)].filter(Boolean).join(' · ') || undefined,
			};
		});
		tiras.push({ titulo: d.designacion ?? d.id, etiquetas });
	}
	return tiras;
}

/**
 * Tira de rótulos de los APARATOS: la designación y qué es cada uno, para pegar sobre el
 * carril o sobre la propia tapa. Van en orden de designación, como se leen en el tablero.
 */
export function tiraDeAparatos(proyecto: Proyecto): TiraEtiquetas {
	const etiquetas = proyecto.dispositivos
		.filter((d) => !esReferenciaVisualInerte(d) && !d.campo)
		.map((d) => ({ principal: d.designacion ?? d.id, secundaria: d.descripcion }))
		.sort((a, b) => a.principal.localeCompare(b.principal, 'es', { numeric: true }));
	return { titulo: 'Aparatos del tablero', etiquetas };
}

/** Todas las tiras que hay que imprimir de un proyecto. */
export function todasLasTiras(proyecto: Proyecto, potenciales?: ResultadoPotenciales): TiraEtiquetas[] {
	const tiras = tirasDeBorneros(proyecto, potenciales);
	const aparatos = tiraDeAparatos(proyecto);
	if (aparatos.etiquetas.length) tiras.push(aparatos);
	return tiras;
}
