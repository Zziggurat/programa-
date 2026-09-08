import { comparar, indexarRevisiones, verificarRevision } from './hash.js';
import { claveRevision, referenciaTecnica, type ConfiguracionTecnicaProyecto, type EstadoResolucion,
	type FactorAmpacidad, type FilaAmpacidad, type InstalacionConductorTecnica, type PoliticaLookup,
	type ProcedenciaTecnica, type ReferenciaTecnica, type RevisionTablaAmpacidad, type RevisionTecnica } from './tipos.js';

export interface FactorAmpacidadAplicado {
	id: string; dimension: FactorAmpacidad['dimension']; entrada: number; factor: number;
	politica: PoliticaLookup; puntosUsados: { valor: number; factor: number }[];
}
export interface ResultadoAmpacidadTecnica {
	estado: EstadoResolucion;
	conductorId: string;
	referencia?: ReferenciaTecnica;
	procedencia?: ProcedenciaTecnica;
	condiciones?: InstalacionConductorTecnica;
	seccionMm2?: number;
	izBaseA?: number;
	izA?: number;
	filasBase: FilaAmpacidad[];
	factoresAplicados: FactorAmpacidadAplicado[];
	faltantes: string[];
	motivos: string[];
	transformaciones: string[];
	advertencias: string[];
}
interface Lookup { valor?: number; indices: number[]; motivos: string[]; transformacion?: string }
const iguales = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** Dominio cerrado incluso para STEP: no se emplea el extremo fuera del intervalo tabulado. */
function lookup(puntos: readonly { x: number; y: number }[], x: number, politica: PoliticaLookup): Lookup {
	if (!Number.isFinite(x) || !puntos.length) return { indices: [], motivos: ['Valor de consulta no finito o tabla vacía.'] };
	const exacto = puntos.findIndex(p => iguales(p.x, x));
	if (exacto >= 0) return { valor: puntos[exacto].y, indices: [exacto], motivos: [] };
	if (x < puntos[0].x || x > puntos[puntos.length - 1].x) return { indices: [], motivos: [`${x} fuera del dominio [${puntos[0].x}, ${puntos[puntos.length - 1].x}].`] };
	if (politica === 'EXACT_ONLY') return { indices: [], motivos: [`No existe muestra exacta para ${x}; EXACT_ONLY no interpola.`] };
	const arriba = puntos.findIndex(p => p.x > x); const abajo = arriba - 1;
	if (politica === 'STEP_LOWER' || politica === 'STEP_UPPER') {
		const i = politica === 'STEP_LOWER' ? abajo : arriba;
		return { valor: puntos[i].y, indices: [i], motivos: [], transformacion: `${politica}: ${x} usa la muestra ${puntos[i].x}.` };
	}
	const a = puntos[abajo], b = puntos[arriba]; const t = (x - a.x) / (b.x - a.x);
	return { valor: a.y + t * (b.y - a.y), indices: [abajo, arriba], motivos: [],
		transformacion: `LINEAR: ${a.y} + (${x} - ${a.x}) / (${b.x} - ${a.x}) × (${b.y} - ${a.y}).` };
}

function vacio(instalacion: InstalacionConductorTecnica, seccionMm2?: number): ResultadoAmpacidadTecnica {
	return { estado: 'MISSING', conductorId: instalacion.conductorId, condiciones: structuredClone(instalacion), seccionMm2,
		filasBase: [], factoresAplicados: [], faltantes: [], motivos: [], transformaciones: [], advertencias: [] };
}

/** Tabla y condiciones explícitas; la temperatura ambiente jamás reemplaza R(T) del conductor. */
export function evaluarAmpacidad(entrada: {
	tabla: RevisionTablaAmpacidad; instalacion: InstalacionConductorTecnica; seccionMm2?: number;
}): ResultadoAmpacidadTecnica {
	const { tabla, instalacion: i, seccionMm2 } = entrada; const resultado = vacio(i, seccionMm2);
	resultado.referencia = referenciaTecnica(tabla); resultado.procedencia = structuredClone(tabla.procedencia);
	try { verificarRevision(tabla); } catch (e) { return { ...resultado, estado: 'CONFLICT', motivos: [String((e as Error).message)] }; }
	if (claveRevision(i.tabla) !== claveRevision(resultado.referencia) || i.tabla.hash !== tabla.hash) {
		return { ...resultado, estado: 'CONFLICT', motivos: ['La tabla no coincide con la revisión/hash fijados en la instalación.'] };
	}
	if (tabla.estado === 'RETIRADA') resultado.advertencias.push('Revisión retirada: se conserva el dato fijado, pero debe revisarse su utilización.');
	const obligatorias = ['material', 'aislamiento', 'temperaturaAislamientoC', 'metodo', 'temperaturaAmbienteC', 'cargados', 'agrupamiento'] as const;
	resultado.faltantes = obligatorias.filter(k => i[k] === undefined).map(k => `instalacion.${k}`);
	if (seccionMm2 === undefined) resultado.faltantes.push('seccionMm2');
	if (resultado.faltantes.length) return { ...resultado, motivos: ['Faltan condiciones necesarias; una corrección ausente no vale 1.'] };
	if (!(Number.isFinite(seccionMm2) && seccionMm2! > 0) || !Number.isFinite(i.temperaturaAmbienteC) || i.temperaturaAmbienteC! < -273.15
		|| !Number.isFinite(i.temperaturaAislamientoC) || i.temperaturaAislamientoC! < -273.15
		|| !Number.isInteger(i.cargados) || i.cargados! < 1 || !Number.isInteger(i.agrupamiento) || i.agrupamiento! < 1) {
		return { ...resultado, estado: 'OUT_OF_DOMAIN', motivos: ['Sección o condiciones de instalación fuera del dominio físico declarado.'] };
	}
	const ids = [...i.factores].sort(comparar); const porId = new Map(tabla.factores.map(f => [f.id, f]));
	if (new Set(ids).size !== ids.length) return { ...resultado, estado: 'CONFLICT', motivos: ['Factor repetido: doble corrección.'] };
	const factores = ids.map(id => porId.get(id));
	if (factores.some(f => !f)) return { ...resultado, faltantes: ids.filter(id => !porId.has(id)).map(id => `factor:${id}`), motivos: ['Factor ausente en la revisión fijada.'] };
	const fs = factores as FactorAmpacidad[];
	if (new Set(fs.map(f => f.dimension)).size !== fs.length) return { ...resultado, estado: 'CONFLICT', motivos: ['Dos factores corrigen la misma dimensión.'] };
	if (ids.length && !tabla.combinaciones.some(c => [...c].sort(comparar).join('\0') === ids.join('\0'))) {
		return { ...resultado, estado: 'NOT_APPLICABLE', motivos: ['La combinación de factores no está autorizada por el dataset.'] };
	}
	if (fs.some(f => f.material !== i.material || f.aislamiento !== i.aislamiento || f.metodo !== i.metodo)) {
		return { ...resultado, estado: 'NOT_APPLICABLE', motivos: ['Un factor pertenece a otro material, aislamiento o método.'] };
	}
	const filas = tabla.filas.filter(f => f.material === i.material && f.aislamiento === i.aislamiento
		&& f.temperaturaAislamientoC === i.temperaturaAislamientoC && f.metodo === i.metodo && f.cargados === i.cargados);
	if (!filas.length) return { ...resultado, estado: 'NOT_APPLICABLE', motivos: ['No existe fila para material/aislamiento/método/temperatura de aislamiento/conductores cargados declarados.'] };
	const grupos = new Map<string, FilaAmpacidad[]>();
	for (const f of filas) { const k = `${f.temperaturaBaseC}\0${f.agrupamientoBase}`; const grupo = grupos.get(k) ?? []; grupo.push(f); grupos.set(k, grupo); }
	const candidatos = [...grupos.entries()].sort(([a], [b]) => comparar(a, b)).map(([, grupo]) => {
		const r: ResultadoAmpacidadTecnica = { ...resultado, filasBase: [], factoresAplicados: [], motivos: [], faltantes: [], transformaciones: [] };
		const ordenadas = [...grupo].sort((a, b) => a.seccionMm2 - b.seccionMm2);
		if (new Set(ordenadas.map(f => f.seccionMm2)).size !== ordenadas.length) return { ...r, estado: 'CONFLICT' as const, motivos: ['Filas ambiguas para la misma sección y condiciones base.'] };
		const fila = ordenadas[0];
		for (const dimension of ['AMBIENTE', 'AGRUPAMIENTO'] as const) {
			const base = dimension === 'AMBIENTE' ? fila.temperaturaBaseC : fila.agrupamientoBase;
			const actual = dimension === 'AMBIENTE' ? i.temperaturaAmbienteC! : i.agrupamiento!;
			const f = fs.find(x => x.dimension === dimension);
			if (!f) {
				if (!iguales(base, actual)) { r.faltantes.push(`factor:${dimension}`); r.motivos.push(`${dimension}: base ${base}, instalación ${actual}; falta corrección explícita.`); }
				continue;
			}
			const ancla = f.puntos.find(p => iguales(p.valor, base));
			if (!ancla) { r.faltantes.push(`factor:${f.id}:base:${base}`); r.motivos.push(`El factor ${f.id} no declara el anclaje de la fila base ${base}.`); continue; }
			if (!iguales(ancla.factor, 1)) return { ...r, estado: 'CONFLICT' as const, motivos: [`${f.id}: factor distinto de 1 en la condición ya incorporada a la fila; doble corrección.`] };
			const valor = lookup(f.puntos.map(p => ({ x: p.valor, y: p.factor })), actual, f.politica);
			if (valor.valor === undefined) return { ...r, estado: 'OUT_OF_DOMAIN' as const, motivos: valor.motivos.map(m => `${f.id}: ${m}`) };
			r.factoresAplicados.push({ id: f.id, dimension, entrada: actual, factor: valor.valor, politica: f.politica,
				puntosUsados: valor.indices.map(n => structuredClone(f.puntos[n])) });
			if (valor.transformacion) r.transformaciones.push(`${f.id}: ${valor.transformacion}`);
		}
		if (r.faltantes.length) return r;
		const base = lookup(ordenadas.map(f => ({ x: f.seccionMm2, y: f.izA })), seccionMm2!, tabla.politicaSeccion);
		if (base.valor === undefined) return { ...r, estado: 'OUT_OF_DOMAIN' as const, motivos: base.motivos.map(m => `Sección: ${m}`) };
		r.filasBase = base.indices.map(n => structuredClone(ordenadas[n])); r.izBaseA = base.valor;
		r.izA = r.factoresAplicados.reduce((iz, f) => iz * f.factor, base.valor); r.estado = 'RESOLVED';
		if (base.transformacion) r.transformaciones.unshift(`Iz base: ${base.transformacion}`);
		r.transformaciones.push(`Iz = ${base.valor}${r.factoresAplicados.map(f => ` × ${f.factor}`).join('')} = ${r.izA} A.`);
		return r;
	});
	const resueltos = candidatos.filter(c => c.estado === 'RESOLVED');
	if (resueltos.length > 1) return { ...resultado, estado: 'CONFLICT', motivos: ['Más de una fila base aplicable: la revisión debe desambiguar sus condiciones.'] };
	if (resueltos.length === 1) return resueltos[0];
	const prioridad: EstadoResolucion[] = ['CONFLICT', 'MISSING', 'OUT_OF_DOMAIN', 'NOT_APPLICABLE'];
	const estado = prioridad.find(e => candidatos.some(c => c.estado === e)) ?? 'MISSING';
	return { ...resultado, estado, faltantes: [...new Set(candidatos.flatMap(c => c.faltantes))].sort(comparar),
		motivos: [...new Set(candidatos.flatMap(c => c.motivos))].sort(comparar) };
}

/** Resolución contra el subconjunto del proyecto; jamás usa latest ni catálogo global. */
export function resolverAmpacidadTecnica(config: ConfiguracionTecnicaProyecto | undefined,
	conductorId: string, seccionMm2?: number, indiceCompartido?: ReadonlyMap<string, RevisionTecnica>): ResultadoAmpacidadTecnica {
	const instalaciones = config?.instalaciones.filter(i => i.conductorId === conductorId) ?? [];
	if (!instalaciones.length) return { estado: 'MISSING', conductorId, seccionMm2,
		filasBase: [], factoresAplicados: [], faltantes: ['instalacion'], motivos: ['No hay instalación técnica fijada para este conductor.'], transformaciones: [], advertencias: [] };
	const r = vacio(instalaciones[0], seccionMm2);
	if (instalaciones.length !== 1) return { ...r, estado: 'CONFLICT', motivos: ['Hay más de una instalación para este conductor.'] };
	try {
		const indice = indiceCompartido ?? indexarRevisiones(config!.revisiones, false); const tabla = indice.get(claveRevision(instalaciones[0].tabla));
		if (!tabla) return { ...r, faltantes: ['tabla:revision-fijada'], motivos: ['No se encuentra la revisión exacta de ampacidad.'] };
		if (tabla.tipo !== 'AMPACIDAD') return { ...r, estado: 'CONFLICT', motivos: ['La referencia de instalación no es una tabla de ampacidad.'] };
		return evaluarAmpacidad({ tabla, instalacion: instalaciones[0], seccionMm2 });
	} catch (e) { return { ...r, estado: 'CONFLICT', motivos: [String((e as Error).message)] }; }
}
