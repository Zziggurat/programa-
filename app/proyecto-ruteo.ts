/** Vista mínima del proyecto que necesita el repartidor de rutas en un Worker.
 *
 * La copia estructurada de un Proyecto completo arrastraba fotografías (data URLs),
 * fichas técnicas y el dossier por cada gesto. Ninguno participa en la geometría. La
 * presencia de imagen sí modifica el anclaje del borne y se conserva como marcador;
 * jamás se le envían los bytes al Worker. No se modifica el documento persistente.
 */
import type { Proyecto } from '../src/modelo/tipos.js';

export function proyectoParaRuteo(proyecto: Proyecto): Proyecto {
	return {
		formato: proyecto.formato,
		version: proyecto.version,
		nombre: proyecto.nombre,
		hojas: [],
		dispositivos: proyecto.dispositivos.map((d) => ({
			id: d.id,
			tipo: d.tipo,
			bornes: d.bornes.map((b) => ({ id: b.id, u: b.u, v: b.v })),
			...(d.terminales ? { terminales: d.terminales } : {}),
			...(d.imagen ? { imagen: 'data:image/png;base64,AA==' } : {}),
			...(d.componentePersonalizado ? { componentePersonalizado: d.componentePersonalizado } : {}),
			...(d.profundidad === undefined ? {} : { profundidad: d.profundidad }),
		})),
		conductores: proyecto.conductores.map((c) => ({
			id: c.id,
			de: c.de,
			a: c.a,
			...(c.seccion === undefined ? {} : { seccion: c.seccion }),
			...(c.trazado ? { trazado: c.trazado } : {}),
			...(c.estadoRutaFisica ? { estadoRutaFisica: c.estadoRutaFisica } : {}),
			...(c.clase ? { clase: c.clase } : {}),
		})),
		gabinete: proyecto.gabinete,
	};
}
