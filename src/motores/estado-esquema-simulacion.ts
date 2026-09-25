/**
 * Proyección de solo lectura del resultado eléctrico sobre una hoja ya montada.
 *
 * `ResultadoSimulacion` no lleva projectId, revisión ni hash. El llamador debe entregar
 * únicamente el resultado vigente del proyecto que muestra; esta función NO puede certificar
 * la frescura de un snapshot antiguo con los mismos IDs. Si no hay resultado, nada se infiere
 * de potenciales estáticos, nombres, números de hilo ni colores del dibujo.
 */
import type { Proyecto } from '../modelo/tipos.js';
import { claveBorne } from '../modelo/proyecto.js';
import type { HojaEsq } from './esquema.js';
import type { EstadoMotor, EstadoProteccion, EstadoVariador, ResultadoSimulacion } from './simulacion.js';

export type ModoEstadoEsquema = 'diseno' | 'simulacion-sin-snapshot' | 'simulacion-inestable' | 'simulacion';
export type EstadoHiloEsquema = 'no-aplica' | 'desconocido' | 'vivo' | 'no-registrado-vivo';
export type ActividadAparatoEsquema = 'no-aplica' | 'desconocida' | 'activa' | 'no-registrada-activa';

/** Estado contractual del perfil, si ese perfil lo comunica en el runtime. */
export type FuncionAparatoEsquema =
	| { tipo: 'motor'; estado: EstadoMotor['estado'] }
	| { tipo: 'proteccion'; estado: EstadoProteccion['estado'] }
	| { tipo: 'variador'; estado: EstadoVariador['estado'] };

export interface IndicadorHiloEsquema {
	conductorId: string;
	estado: EstadoHiloEsquema;
}

export interface IndicadorAparatoEsquema {
	dispositivoId: string;
	/** Ausente solo en la vista legacy de un símbolo por aparato. */
	representacionId?: string;
	actividad: ActividadAparatoEsquema;
	/** Borne realmente presente en el modelo y en `resultado.vivos`, no potencia inferida. */
	bornesConTension: readonly string[];
	funcion?: FuncionAparatoEsquema;
}

export interface ProyeccionEstadoEsquema {
	modo: ModoEstadoEsquema;
	hilos: readonly IndicadorHiloEsquema[];
	aparatos: readonly IndicadorAparatoEsquema[];
}

export interface EntradaEstadoEsquema {
	proyecto: Proyecto;
	hoja: Pick<HojaEsq, 'hilos' | 'simbolos'> & Partial<Pick<HojaEsq, 'referencias'>>;
	energizado: boolean;
	/** Debe ser el resultado vigente de ESTE proyecto; el tipo no porta identidad para comprobarlo. */
	resultado?: ResultadoSimulacion;
}

const comparar = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** Una función por ID o ninguna: una respuesta ambigua no gana por el orden del array. */
function indexarUnicos<T>(lista: readonly T[], idDe: (valor: T) => string): Map<string, T | undefined> {
	const indice = new Map<string, T | undefined>();
	for (const valor of lista) {
		const id = idDe(valor);
		if (indice.has(id)) indice.set(id, undefined);
		else indice.set(id, valor);
	}
	return indice;
}

/** No toca Proyecto, HojaEsq, ResultadoSimulacion ni sus Map/Set. */
export function proyectarEstadoEsquema({ proyecto, hoja, energizado, resultado }: EntradaEstadoEsquema): ProyeccionEstadoEsquema {
	const modo: ModoEstadoEsquema = !energizado ? 'diseno'
		: !resultado ? 'simulacion-sin-snapshot'
		: resultado.oscila ? 'simulacion-inestable' : 'simulacion';
	const utilizable = modo === 'simulacion' ? resultado : undefined;
	const conductores = new Set<string>();
	const conductoresDuplicados = new Set<string>();
	for (const c of proyecto.conductores) {
		if (conductores.has(c.id)) conductoresDuplicados.add(c.id);
		conductores.add(c.id);
	}
	const dispositivos = indexarUnicos(proyecto.dispositivos, (d) => d.id);
	const motores = indexarUnicos(utilizable?.motores ?? [], (m) => m.dispositivoId);
	const protecciones = indexarUnicos(utilizable?.protecciones ?? [], (p) => p.dispositivoId);
	const variadores = indexarUnicos(utilizable?.variadores ?? [], (v) => v.dispositivoId);
	// Una referencia interhoja es otra vista del MISMO conductor, no un conductor nuevo.
	const idsVisibles = [...hoja.hilos.map((h) => h.conductorId),
		...(hoja.referencias ?? []).filter((r) => r.tipo === 'enlace' && r.conductorId)
			.map((r) => r.conductorId!)];
	const hilos = [...new Set(idsVisibles)].sort(comparar).map((conductorId): IndicadorHiloEsquema => ({
		conductorId,
		estado: !conductores.has(conductorId) || conductoresDuplicados.has(conductorId)
			|| modo === 'simulacion-sin-snapshot' || modo === 'simulacion-inestable'
			? 'desconocido'
			: modo === 'diseno' ? 'no-aplica'
			: utilizable!.conductoresVivos.has(conductorId) ? 'vivo' : 'no-registrado-vivo',
	}));
	const aparatos = [...hoja.simbolos]
		.sort((a, b) => comparar(a.dispositivoId, b.dispositivoId)
			|| comparar(a.representacionId ?? '', b.representacionId ?? ''))
		.map((simbolo): IndicadorAparatoEsquema => {
			const { dispositivoId, representacionId } = simbolo;
			const dispositivo = dispositivos.get(dispositivoId);
			if (!dispositivo || !utilizable) return {
				dispositivoId, representacionId,
				actividad: !dispositivo || modo !== 'diseno' ? 'desconocida' : 'no-aplica',
				bornesConTension: [],
			};
			// Una vista de bobina no debe apropiarse de la tensión de un polo de otra hoja.
			const pinesDeLaVista = new Set(simbolo.pines.keys());
			const bornesConTension = dispositivo.bornes.filter((borne) => pinesDeLaVista.has(borne.id)
				&& utilizable.vivos.has(claveBorne({ dispositivoId, borneId: borne.id })))
				.map((borne) => borne.id).sort(comparar);
			const motor = motores.get(dispositivoId);
			const proteccion = protecciones.get(dispositivoId);
			const variador = variadores.get(dispositivoId);
			const funcion: FuncionAparatoEsquema | undefined = motor
				? { tipo: 'motor', estado: motor.estado }
				: proteccion ? { tipo: 'proteccion', estado: proteccion.estado }
				: variador ? { tipo: 'variador', estado: variador.estado } : undefined;
			return { dispositivoId, representacionId,
				actividad: utilizable.activos.has(dispositivoId) ? 'activa' : 'no-registrada-activa',
				bornesConTension, ...(funcion ? { funcion } : {}),
			};
		});
	return { modo, hilos, aparatos };
}
