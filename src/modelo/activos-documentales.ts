import type { Proyecto } from './tipos.js';

/** Imágenes que el dossier PDF intentará incorporar al paquete documental. */
export function activosIncrustablesEnDossier(proyecto: Pick<Proyecto, 'dossier'>): {
	logo: boolean;
	imagenes: number;
	total: number;
} {
	const logo = !!proyecto.dossier?.empresa?.logo;
	const imagenes = (proyecto.dossier?.bloques ?? [])
		.filter(b => b.tipo === 'imagen' && !!b.imagen).length;
	return { logo, imagenes, total: Number(logo) + imagenes };
}
