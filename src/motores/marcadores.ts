/** Marcadores físicos de una revisión. El identificador del hilo se imprime en ambos extremos. */
import type { Proyecto } from '../modelo/tipos.js';
import { esReferenciaVisualInerte } from '../modelo/apariencia.js';

export type TipoMarcador = 'aparato' | 'borne' | 'extremo-conductor';
export type CampoMarcador = 'identificador' | 'designacion' | 'borne'
	| 'destinoDispositivo' | 'destinoBorne'
	| 'numeroConductor' | 'descripcion';
export interface MapeoCamposMarcador {
	principal: CampoMarcador;
	secundaria?: CampoMarcador;
}
export interface OpcionesMarcadores {
	/** Mapea columnas semánticas a las líneas que espera la impresora. No concatena campos. */
	mapeo?: Partial<Record<TipoMarcador, MapeoCamposMarcador>>;
	/** Copias de cada marcador de la categoría, sin confundir copias con extremos distintos. */
	copias?: Partial<Record<TipoMarcador, number>>;
}
export interface Marcador {
	tipo: TipoMarcador;
	entidadId: string;
	lado?: 'de' | 'a';
	dispositivoId: string;
	borneId?: string;
	campos: Record<CampoMarcador, string>;
	campoPrincipal: CampoMarcador;
	campoSecundario?: CampoMarcador;
	principal: string;
	secundaria?: string;
	cantidad: number;
}

const MAPEO: Record<TipoMarcador, MapeoCamposMarcador> = {
	'aparato': { principal: 'identificador', secundaria: 'descripcion' },
	borne: { principal: 'borne', secundaria: 'designacion' },
	'extremo-conductor': { principal: 'identificador', secundaria: 'designacion' },
};

const orden = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** Una fila por aparato, una por borna y exactamente dos por conductor conectado. */
export function prepararMarcadores(proyecto: Proyecto, opciones: OpcionesMarcadores = {}): Marcador[] {
	const dispositivos = [...proyecto.dispositivos]
		.filter((d) => !esReferenciaVisualInerte(d)).sort((a, b) => orden(a.id, b.id));
	const dispositivosPorId = new Map(dispositivos.map((d) => [d.id, d]));
	const resultado: Marcador[] = [];
	const incluir = (base: Omit<Marcador, 'campoPrincipal' | 'campoSecundario' | 'principal' | 'secundaria' | 'cantidad'>): void => {
		const mapeo = opciones.mapeo?.[base.tipo] ?? MAPEO[base.tipo];
		const cantidad = opciones.copias?.[base.tipo] ?? 1;
		if (!Number.isSafeInteger(cantidad) || cantidad < 1 || cantidad > 1000)
			throw new Error(`La cantidad de copias para ${base.tipo} debe ser un entero entre 1 y 1000.`);
		const principal = base.campos[mapeo.principal];
		const secundaria = mapeo.secundaria ? base.campos[mapeo.secundaria] : '';
		if (typeof principal !== 'string' || !principal)
			throw new Error(`El campo principal ${mapeo.principal} está vacío para ${base.tipo} ${base.entidadId}.`);
		resultado.push({ ...base, campoPrincipal: mapeo.principal,
			...(mapeo.secundaria ? { campoSecundario: mapeo.secundaria } : {}),
			principal, ...(secundaria ? { secundaria } : {}), cantidad });
	};
	for (const d of dispositivos) {
		// Los aparatos de campo son físicos y también requieren identidad para montaje en sitio.
		const designacion = d.designacion ?? d.id;
		incluir({ tipo: 'aparato', entidadId: d.id, dispositivoId: d.id,
			campos: { identificador: designacion, designacion, borne: '',
				destinoDispositivo: '', destinoBorne: '',
				numeroConductor: '', descripcion: d.descripcion ?? '' } });
		if (d.tipo === 'bornero') for (const b of [...d.bornes].sort((a, c) => orden(a.id, c.id))) {
			incluir({ tipo: 'borne', entidadId: `${d.id}::${b.id}`, dispositivoId: d.id, borneId: b.id,
				campos: { identificador: b.id, designacion, borne: b.id,
					destinoDispositivo: '', destinoBorne: '',
					numeroConductor: '', descripcion: '' } });
		}
	}
	for (const c of [...proyecto.conductores].sort((a, b) => orden(a.id, b.id))) {
		for (const lado of ['de', 'a'] as const) {
			const ref = c[lado];
			const otro = c[lado === 'de' ? 'a' : 'de'];
			const d = dispositivosPorId.get(ref.dispositivoId);
			// La falta de aparato/borna queda en el informe DRC; el marcador conserva el ID real.
			const identificador = c.numero || c.id;
			const designacion = d?.designacion ?? ref.dispositivoId;
			const destinoDispositivo = dispositivosPorId.get(otro.dispositivoId)?.designacion ?? otro.dispositivoId;
			incluir({ tipo: 'extremo-conductor', entidadId: c.id, lado,
				dispositivoId: ref.dispositivoId, borneId: ref.borneId,
				campos: { identificador, designacion, borne: ref.borneId,
					destinoDispositivo, destinoBorne: otro.borneId,
					numeroConductor: identificador, descripcion: '' } });
		}
	}
	return resultado;
}
