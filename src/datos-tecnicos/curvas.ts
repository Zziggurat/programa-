import { evaluarCondicionesTecnicas } from './condiciones.js';
import { indexarRevisiones, verificarRevision } from './hash.js';
import { claveRevision, referenciaTecnica, type CondicionesTecnicas, type EstadoResolucion,
	type ProcedenciaTecnica, type ReferenciaTecnica, type RevisionCurvaTecnica, type RevisionTecnica } from './tipos.js';

export interface ResultadoCurvaTecnica {
	estado: EstadoResolucion;
	referencia?: ReferenciaTecnica;
	procedencia?: ProcedenciaTecnica;
	corrienteA: number;
	inA?: number;
	coordenada?: number;
	base?: RevisionCurvaTecnica['base'];
	dominio?: [number, number];
	minimoS?: number;
	maximoS?: number;
	puntosUsados: RevisionCurvaTecnica['puntos'];
	condiciones: CondicionesTecnicas;
	motivos: string[];
	transformaciones: string[];
	advertencias: string[];
}
export interface EntradaEvaluacionCurvaTecnica { corrienteA: number; inA?: number; condiciones: CondicionesTecnicas }
const iguales = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** Evaluación de banda tabulada: no transforma un punto fuera del dominio en protección aprobada. */
export function evaluarCurvaTecnica(entrada: EntradaEvaluacionCurvaTecnica & { curva: RevisionCurvaTecnica }): ResultadoCurvaTecnica {
	const { curva, corrienteA, inA, condiciones } = entrada;
	const r: ResultadoCurvaTecnica = { estado: 'MISSING', referencia: referenciaTecnica(curva), procedencia: structuredClone(curva.procedencia),
		corrienteA, inA, base: curva.base, puntosUsados: [], condiciones: structuredClone(condiciones), motivos: [], transformaciones: [], advertencias: [] };
	try { verificarRevision(curva); } catch (e) { return { ...r, estado: 'CONFLICT', motivos: [String((e as Error).message)] }; }
	if (curva.estado === 'RETIRADA') r.advertencias.push('Revisión retirada; el vínculo fijado se conserva y requiere revisión.');
	const aplicabilidad = evaluarCondicionesTecnicas({ declaradas: curva.condiciones, actuales: condiciones });
	if (aplicabilidad.estado !== 'RESOLVED') return { ...r, ...aplicabilidad };
	if (!Number.isFinite(corrienteA) || corrienteA < 0) return { ...r, estado: 'OUT_OF_DOMAIN', motivos: ['Corriente de consulta inválida.'] };
	if (curva.base === 'MULTIPLOS_IN' && inA === undefined) {
		return { ...r, motivos: ['Falta In para convertir amperios a múltiplos de In.'] };
	}
	if (curva.base === 'MULTIPLOS_IN' && (!Number.isFinite(inA) || inA! <= 0)) {
		return { ...r, estado: 'OUT_OF_DOMAIN', motivos: ['In debe ser positiva y finita para convertir amperios a múltiplos de In.'] };
	}
	const x = curva.base === 'AMPERIOS' ? corrienteA : corrienteA / inA!; r.coordenada = x;
	if (curva.base === 'MULTIPLOS_IN') r.transformaciones.push(`I / In = ${corrienteA} A / ${inA} A = ${x}.`);
	const primero = curva.puntos[0], ultimo = curva.puntos[curva.puntos.length - 1];
	r.dominio = [primero.corriente, ultimo.corriente];
	const exacto = curva.puntos.find(p => iguales(p.corriente, x));
	if (exacto) return { ...r, estado: 'RESOLVED', minimoS: exacto.minimoS, maximoS: exacto.maximoS, puntosUsados: [structuredClone(exacto)] };
	if (x < primero.corriente || x > ultimo.corriente) return { ...r, estado: 'OUT_OF_DOMAIN', motivos: [`Consulta ${x} fuera del dominio cerrado [${r.dominio}]; no se extrapola.`] };
	if (curva.interpolacion === 'EXACT_ONLY') return { ...r, estado: 'OUT_OF_DOMAIN', motivos: ['No existe punto exacto y el dataset no autoriza interpolación.'] };
	const arriba = curva.puntos.findIndex(p => p.corriente > x); const a = curva.puntos[arriba - 1], b = curva.puntos[arriba];
	const log = curva.interpolacion === 'LOG_LOG';
	const t = log ? (Math.log(x) - Math.log(a.corriente)) / (Math.log(b.corriente) - Math.log(a.corriente))
		: (x - a.corriente) / (b.corriente - a.corriente);
	const interpolar = (v0: number, v1: number) => log ? Math.exp(Math.log(v0) + t * (Math.log(v1) - Math.log(v0))) : v0 + t * (v1 - v0);
	r.transformaciones.push(`${curva.interpolacion} autorizada entre ${a.corriente} y ${b.corriente}, fracción ${t}.`);
	return { ...r, estado: 'RESOLVED', minimoS: interpolar(a.minimoS, b.minimoS), maximoS: interpolar(a.maximoS, b.maximoS),
		puntosUsados: structuredClone([a, b]) };
}

export function resolverCurvaTecnica(ref: ReferenciaTecnica, revisiones: readonly RevisionTecnica[],
	entrada: EntradaEvaluacionCurvaTecnica, indiceCompartido?: ReadonlyMap<string, RevisionTecnica>): ResultadoCurvaTecnica {
	const vacio: ResultadoCurvaTecnica = { ...entrada, condiciones: structuredClone(entrada.condiciones), referencia: { ...ref },
		estado: 'MISSING', puntosUsados: [], motivos: [], transformaciones: [], advertencias: [] };
	try {
		const curva = (indiceCompartido ?? indexarRevisiones(revisiones, false)).get(claveRevision(ref));
		if (!curva) return { ...vacio, motivos: ['No se encuentra la revisión exacta de curva.'] };
		if (curva.tipo !== 'CURVA' || curva.hash !== ref.hash) return { ...vacio, estado: 'CONFLICT', motivos: ['Tipo o hash no coincide con la curva fijada.'] };
		return evaluarCurvaTecnica({ ...entrada, curva });
	} catch (e) { return { ...vacio, estado: 'CONFLICT', motivos: [String((e as Error).message)] }; }
}
