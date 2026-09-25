/**
 * DOC-05: una proyección de longitudes para documentos, sin alterar la política eléctrica.
 *
 * `fisica.longitudManualM` es una declaración de longitud ELÉCTRICA. El ruteo legacy entrega
 * una propuesta 2D de material que ya contiene reserva, puntas y redondeo. Ninguna de las dos
 * magnitudes demuestra por sí sola la longitud que se cortará realmente en el taller.
 */
import type { Proyecto } from '../modelo/tipos.js';
import { opcionesDe } from '../modelo/proyecto.js';
import type { ResultadoRuteo } from './ruteo.js';

export type OrigenOpcionLongitud = 'CONFIGURADO' | 'POR_DEFECTO';
export type EstadoRutaLongitud = 'PENDIENTE' | 'SIN_RUTA' | 'SIN_DESGLOSE' | 'RUTA_2D_ESTIMADA';

export interface LongitudDocumentalConductor {
	conductorId: string;
	estadoRuta: EstadoRutaLongitud;
	/** Longitud eléctrica persistente; no es una medida de corte. */
	longitudDeclaradaElectricaM?: number;
	/** Recorrido ortogonal 2D según el grafo de canaletas, antes de márgenes (mm). */
	longitudRutaMm?: number;
	reservaPorcentaje: number;
	origenReserva: OrigenOpcionLongitud;
	reservaMm?: number;
	extraPorConexionMm: number;
	origenPuntas: OrigenOpcionLongitud;
	puntasMm?: number;
	redondeoMm?: number;
	/** Propuesta del router; ESTIMADA antes de verificar geometría y tolerancias en M6. */
	propuestaCorteMm?: number;
	/** Solo un futuro dato declarado o verificado puede ocupar este campo. */
	longitudCorteVerificadaMm?: number;
}

/** El caller aporta el ruteo de ESTE snapshot; nunca se reconstruye una ruta en el exportador. */
export function proyectarLongitudesDocumentales(
	proyecto: Proyecto, ruteo: ResultadoRuteo,
): LongitudDocumentalConductor[] {
	const opciones = opcionesDe(proyecto);
	const rutas = new Map(ruteo.rutas.map((ruta) => [ruta.conductorId, ruta]));
	const origenReserva: OrigenOpcionLongitud = proyecto.opciones?.reservaCable === undefined
		? 'POR_DEFECTO' : 'CONFIGURADO';
	const origenPuntas: OrigenOpcionLongitud = proyecto.opciones?.extraPorConexionMm === undefined
		? 'POR_DEFECTO' : 'CONFIGURADO';
	return [...proyecto.conductores].sort((a, b) => a.id.localeCompare(b.id)).map((c) => {
		const pendiente = c.estadoRutaFisica === 'pendiente';
		const ruta = pendiente ? undefined : rutas.get(c.id);
		const manual = c.fisica?.longitudManualM;
		const desglosada = ruta && [ruta.longitudRutaMm, ruta.reservaMm, ruta.puntasMm, ruta.redondeoMm]
			.every((valor) => typeof valor === 'number' && Number.isFinite(valor));
		return {
			conductorId: c.id,
			estadoRuta: pendiente ? 'PENDIENTE' : !ruta ? 'SIN_RUTA'
				: desglosada ? 'RUTA_2D_ESTIMADA' : 'SIN_DESGLOSE',
			...(typeof manual !== 'number' || !Number.isFinite(manual) || manual <= 0
				? {} : { longitudDeclaradaElectricaM: manual }),
			reservaPorcentaje: opciones.reservaCable,
			origenReserva,
			extraPorConexionMm: opciones.extraPorConexionMm,
			origenPuntas,
			...(desglosada ? {
				longitudRutaMm: ruta!.longitudRutaMm,
				reservaMm: ruta!.reservaMm,
				puntasMm: ruta!.puntasMm,
				redondeoMm: ruta!.redondeoMm,
				propuestaCorteMm: ruta!.longitudMm,
			} : {}),
		};
	});
}
