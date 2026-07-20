/**
 * Motor de referencias cruzadas.
 *
 * Equivalente al CrossRefItem de QElectroTech: para cada maestro (p. ej. bobina de
 * contactor) lista sus esclavos (contactos) con su posición "hoja.FilaColumna", y a la
 * inversa. También produce el índice general de dispositivos.
 */
import { Dispositivo, Proyecto } from '../modelo/tipos.js';
import { posicionTexto } from '../modelo/proyecto.js';

export interface RefContacto {
	dispositivoId: string;
	designacion: string;
	contacto: 'NA' | 'NC' | 'potencia';
	posicion: string; // "2.B3"
}

export interface ReferenciaCruzada {
	maestroId: string;
	designacion: string;
	posicion: string;
	contactos: RefContacto[];
}

export interface EntradaIndice {
	dispositivoId: string;
	designacion: string;
	descripcion: string;
	posicion: string;
}

export interface ResultadoReferencias {
	/** Una entrada por maestro, con sus contactos enlazados. */
	cruzadas: ReferenciaCruzada[];
	/** Para cada esclavo, la posición de su maestro (para rotularlo junto al contacto). */
	maestroDeEsclavo: Map<string, { designacion: string; posicion: string }>;
	/** Índice de todos los dispositivos con su posición en el esquema. */
	indice: EntradaIndice[];
}

export function generarReferencias(proyecto: Proyecto): ResultadoReferencias {
	const etiqueta = (d: Dispositivo) => d.designacion ?? d.id;

	const cruzadas: ReferenciaCruzada[] = [];
	const maestroDeEsclavo = new Map<string, { designacion: string; posicion: string }>();

	for (const maestro of proyecto.dispositivos) {
		if (maestro.rol?.tipo !== 'maestro') continue;
		const contactos: RefContacto[] = proyecto.dispositivos
			.filter((d) => d.rol?.tipo === 'esclavo' && d.rol.maestroId === maestro.id)
			.map((d) => ({
				dispositivoId: d.id,
				designacion: etiqueta(d),
				contacto: d.rol!.tipo === 'esclavo' ? d.rol!.contacto : 'NA',
				posicion: posicionTexto(proyecto, d),
			}))
			.sort((a, b) => a.posicion.localeCompare(b.posicion));
		cruzadas.push({
			maestroId: maestro.id,
			designacion: etiqueta(maestro),
			posicion: posicionTexto(proyecto, maestro),
			contactos,
		});
		for (const c of contactos) {
			maestroDeEsclavo.set(c.dispositivoId, {
				designacion: etiqueta(maestro),
				posicion: posicionTexto(proyecto, maestro),
			});
		}
	}

	const indice: EntradaIndice[] = proyecto.dispositivos
		.map((d) => ({
			dispositivoId: d.id,
			designacion: etiqueta(d),
			descripcion: d.descripcion ?? '',
			posicion: posicionTexto(proyecto, d),
		}))
		.sort((a, b) => a.designacion.localeCompare(b.designacion, undefined, { numeric: true }));

	return { cruzadas, maestroDeEsclavo, indice };
}
