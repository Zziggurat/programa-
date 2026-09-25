/**
 * ESQ-08, frontera de designaciones: propuesta explícita, no autolayout ni renumeración al guardar.
 * Hoja/vista y conductor conservan sus IDs; una bobina multivista usa su ancla primaria.
 */
import type { Dispositivo, Proyecto, RepresentacionEsquema } from '../modelo/tipos.js';
import { esReferenciaVisualInerte } from '../modelo/apariencia.js';
import { opcionesDe } from '../modelo/proyecto.js';
import { aplicarPlantilla, claseDe } from './numeracion.js';

const ordenar = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const claveVisible = (v: string): string => v.normalize('NFKC').trim().toUpperCase();
const limiteNumero = 100_000;

export interface UbicacionRenumeracion {
	readonly origen: 'BOBINA' | 'VISTA' | 'LEGACY' | 'SIN_VISTA';
	readonly hojaId?: string;
	readonly numeroHoja?: number;
	readonly columna?: number;
	readonly fila?: number;
}

export interface FilaRenumeracionEsquema {
	readonly dispositivoId: string;
	readonly ubicacion: UbicacionRenumeracion;
	readonly congelado: boolean;
	readonly numeroAnterior?: number;
	readonly designacionAnterior?: string;
	readonly numeroPropuesto?: number;
	readonly designacionPropuesta?: string;
	readonly cambia: boolean;
}

export interface ConflictoRenumeracionEsquema {
	readonly codigo: 'CONGELADO_SIN_DESIGNACION' | 'DESIGNACION_CONGELADA_DUPLICADA'
		| 'PLANTILLA_NO_UNIVOCA' | 'DESIGNACION_PROPUESTA_DUPLICADA' | 'NUMERACION_AGOTADA';
	readonly dispositivos: readonly string[];
	readonly detalle: string;
}

export interface PlanRenumeracionEsquema {
	readonly filas: readonly FilaRenumeracionEsquema[];
	readonly conflictos: readonly ConflictoRenumeracionEsquema[];
	readonly cambios: number;
}

type OrigenPlan = { proyecto: Proyecto; firma: string; tieneConflictos: boolean;
	asignaciones: ReadonlyMap<string, { numero: number; designacion: string }> };
const origenes = new WeakMap<PlanRenumeracionEsquema, OrigenPlan>();

function anclaDe(d: Dispositivo, numeroDeHoja: ReadonlyMap<string, number>,
	vistasDeAparato: readonly RepresentacionEsquema[]): UbicacionRenumeracion {
	const vistas = [...vistasDeAparato];
	const prioridad = (r: RepresentacionEsquema) => r.parte.tipo === 'bobina' ? 0 : 1;
	vistas.sort((a, b) => prioridad(a) - prioridad(b)
		|| (numeroDeHoja.get(a.hojaId)! - numeroDeHoja.get(b.hojaId)!)
		|| ordenar(a.hojaId, b.hojaId)
		|| a.posicion.columna - b.posicion.columna
		|| a.posicion.fila - b.posicion.fila || ordenar(a.id, b.id));
	const vista = vistas[0];
	if (vista) return { origen: vista.parte.tipo === 'bobina' ? 'BOBINA' : 'VISTA',
		hojaId: vista.hojaId, numeroHoja: numeroDeHoja.get(vista.hojaId),
		columna: vista.posicion.columna, fila: vista.posicion.fila };
	if (d.hojaId && numeroDeHoja.has(d.hojaId)) return {
		origen: 'LEGACY', hojaId: d.hojaId, numeroHoja: numeroDeHoja.get(d.hojaId),
		columna: d.esquema?.columna, fila: d.esquema?.fila,
	};
	return { origen: 'SIN_VISTA' };
}

function compararUbicaciones(a: UbicacionRenumeracion, b: UbicacionRenumeracion): number {
	return (a.numeroHoja ?? Infinity) - (b.numeroHoja ?? Infinity)
		|| (a.columna ?? Infinity) - (b.columna ?? Infinity)
		|| (a.fila ?? Infinity) - (b.fila ?? Infinity)
		|| ordenar(a.hojaId ?? '', b.hojaId ?? '');
}

/**
 * No modifica el documento. Una referencia congelada se reserva por su TEXTO real; `numero`
 * puede estar obsoleto después de que la persona haya escrito otra designación en la ficha.
 */
export function previsualizarRenumeracionEsquema(proyecto: Proyecto): PlanRenumeracionEsquema {
	const aparatos = proyecto.dispositivos.filter((d) => !esReferenciaVisualInerte(d));
	if (new Set(aparatos.map((d) => d.id)).size !== aparatos.length) {
		throw new Error('Hay IDs de aparatos duplicados: no puede renumerarse una identidad ambigua.');
	}
	const numeroDeHoja = new Map(proyecto.hojas.map((h) => [h.id, h.numero]));
	const vistasPorAparato = new Map<string, RepresentacionEsquema[]>();
	for (const vista of proyecto.esquema?.representaciones ?? []) {
		if (!numeroDeHoja.has(vista.hojaId)) continue;
		const lista = vistasPorAparato.get(vista.dispositivoId) ?? [];
		lista.push(vista);
		vistasPorAparato.set(vista.dispositivoId, lista);
	}
	const posicion = new Map(aparatos.map((d) =>
		[d.id, anclaDe(d, numeroDeHoja, vistasPorAparato.get(d.id) ?? [])]));
	aparatos.sort((a, b) => compararUbicaciones(posicion.get(a.id)!, posicion.get(b.id)!)
		|| ordenar(a.id, b.id));
	const conflictos: ConflictoRenumeracionEsquema[] = [];
	const reservadas = new Map<string, string>();
	for (const d of aparatos.filter((x) => x.congelado)) {
		const etiqueta = claveVisible(d.designacion ?? '');
		if (!etiqueta) {
			conflictos.push({ codigo: 'CONGELADO_SIN_DESIGNACION', dispositivos: [d.id],
				detalle: `El aparato ${d.id} está congelado sin una designación visible.` });
			continue;
		}
		const anterior = reservadas.get(etiqueta);
		if (anterior) conflictos.push({ codigo: 'DESIGNACION_CONGELADA_DUPLICADA',
			dispositivos: [anterior, d.id].sort(ordenar),
			detalle: `La designación congelada ${d.designacion} aparece en dos aparatos.` });
		else reservadas.set(etiqueta, d.id);
	}
	const plantilla = opcionesDe(proyecto).formatoDesignacion;
	const siguientePorGrupo = new Map<string, number>();
	const propuestas = new Map<string, string>();
	const asignaciones = new Map<string, { numero: number; designacion: string }>();
	const filas: FilaRenumeracionEsquema[] = [];
	for (const d of aparatos) {
		const base = { dispositivoId: d.id, ubicacion: posicion.get(d.id)!,
			congelado: d.congelado === true,
			numeroAnterior: d.numero, designacionAnterior: d.designacion };
		if (d.congelado) {
			filas.push({ ...base, numeroPropuesto: d.numero,
				designacionPropuesta: d.designacion, cambia: false });
			continue;
		}
		const grupo = JSON.stringify([d.funcion ?? '', d.ubicacion ?? '', claseDe(d)]);
		const etiqueta = (n: number) => aplicarPlantilla(plantilla, {
			funcion: d.funcion, ubicacion: d.ubicacion, clase: claseDe(d), n });
		if (etiqueta(1) === etiqueta(2) || !claveVisible(etiqueta(1))) {
			conflictos.push({ codigo: 'PLANTILLA_NO_UNIVOCA', dispositivos: [d.id],
				detalle: `La plantilla no genera una designación numerada inequívoca para ${d.id}.` });
			filas.push({ ...base, cambia: false });
			continue;
		}
		let n = siguientePorGrupo.get(grupo) ?? 1;
		let texto = etiqueta(n);
		while (n <= limiteNumero && reservadas.has(claveVisible(texto))) {
			n++; texto = etiqueta(n);
		}
		if (n > limiteNumero) {
			conflictos.push({ codigo: 'NUMERACION_AGOTADA', dispositivos: [d.id],
				detalle: `No quedó número libre hasta ${limiteNumero} para ${d.id}.` });
			filas.push({ ...base, cambia: false });
			continue;
		}
		siguientePorGrupo.set(grupo, n + 1);
		const clave = claveVisible(texto);
		const otro = propuestas.get(clave);
		if (otro) conflictos.push({ codigo: 'DESIGNACION_PROPUESTA_DUPLICADA',
			dispositivos: [otro, d.id].sort(ordenar),
			detalle: `La plantilla produciría ${texto} para dos aparatos.` });
		else propuestas.set(clave, d.id);
		asignaciones.set(d.id, { numero: n, designacion: texto });
		filas.push({ ...base, numeroPropuesto: n, designacionPropuesta: texto,
			cambia: d.numero !== n || d.designacion !== texto });
	}
	const plan: PlanRenumeracionEsquema = { filas, conflictos,
		cambios: filas.filter((f) => f.cambia).length };
	origenes.set(plan, { proyecto, firma: JSON.stringify(proyecto),
		tieneConflictos: conflictos.length > 0, asignaciones });
	return plan;
}

/** Aplica solo las asignaciones selladas de un plan aún vigente, en una única actualización. */
export function aplicarRenumeracionEsquema(proyecto: Proyecto, plan: PlanRenumeracionEsquema): void {
	const origen = origenes.get(plan);
	if (!origen || origen.proyecto !== proyecto || origen.firma !== JSON.stringify(proyecto)) {
		throw new Error('El proyecto cambió durante la confirmación. Previsualiza la renumeración otra vez.');
	}
	if (proyecto.esEjemplo) throw new Error('Un ejemplo es de solo lectura. Crea una copia antes de renumerar.');
	if (origen.tieneConflictos) throw new Error('La renumeración tiene conflictos; no se aplicó ningún cambio.');
	const dispositivos = proyecto.dispositivos.map((d) => {
		const propuesta = origen.asignaciones.get(d.id);
		return propuesta && (d.numero !== propuesta.numero || d.designacion !== propuesta.designacion)
			? { ...d, numero: propuesta.numero, designacion: propuesta.designacion } : d;
	});
	proyecto.dispositivos = dispositivos;
}
