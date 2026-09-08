import type { CriteriosCircuitoIngenieria } from '../modelo/ingenieria.js';
import { indexarRevisiones, verificarRevision } from './hash.js';
import { claveRevision, type ClaveCriterioTecnico, type ConfiguracionTecnicaProyecto, type EstadoResolucion,
	type ProcedenciaTecnica, type ReferenciaTecnica, type RevisionTecnica, type ValorCriterioTecnico } from './tipos.js';

export const CLAVES_CRITERIOS_TECNICOS: readonly ClaveCriterioTecnico[] = [
	'maxVoltageDropPercent', 'maxLossW', 'maxLossPercent', 'maxUnbalancePercent', 'capacidadCorte', 'coordinarIbInIz',
];
export type OrigenCriterioResuelto = 'LEGACY' | 'PERFIL_PROYECTO' | 'OVERRIDE_PROYECTO' | 'PERFIL_CIRCUITO' | 'OVERRIDE_CIRCUITO';
export interface PasoCriterioTecnico {
	origen: OrigenCriterioResuelto; estado: EstadoResolucion; decision?: ValorCriterioTecnico; referencia?: ReferenciaTecnica; motivo?: string;
}
export interface CriterioTecnicoResuelto {
	clave: ClaveCriterioTecnico;
	estado: EstadoResolucion;
	decision?: ValorCriterioTecnico;
	origen?: OrigenCriterioResuelto;
	referencia?: ReferenciaTecnica;
	procedencia?: ProcedenciaTecnica;
	ruta: PasoCriterioTecnico[];
	motivos: string[];
}
export interface ResultadoCriteriosTecnicos {
	circuitoId?: string;
	parametros: Record<ClaveCriterioTecnico, CriterioTecnicoResuelto>;
	referencias: ReferenciaTecnica[];
	advertencias: string[];
}

const decisionValida = (clave: ClaveCriterioTecnico, d: ValorCriterioTecnico): boolean => {
	if (d.modo === 'DESACTIVADO' || d.modo === 'NO_APLICA') return typeof d.motivo === 'string' && d.motivo.trim().length > 0;
	if (d.modo !== 'VALOR') return false;
	if (clave === 'capacidadCorte') return ['Icn', 'Icu', 'Ics'].includes(String(d.valor));
	if (clave === 'coordinarIbInIz') return typeof d.valor === 'boolean';
	return typeof d.valor === 'number' && Number.isFinite(d.valor) && d.valor >= 0;
};

/** Proyecto heredado → perfil proyecto → override proyecto → perfil circuito → override circuito. */
export function resolverCriteriosTecnicos(config?: ConfiguracionTecnicaProyecto, circuitoId?: string,
	legacy?: CriteriosCircuitoIngenieria, indiceCompartido?: ReadonlyMap<string, RevisionTecnica>): ResultadoCriteriosTecnicos {
	const parametros = Object.fromEntries(CLAVES_CRITERIOS_TECNICOS.map((clave): [ClaveCriterioTecnico, CriterioTecnicoResuelto] => [clave,
		{ clave, estado: 'MISSING', ruta: [], motivos: [`Criterio ${clave} no configurado.`] }])) as Record<ClaveCriterioTecnico, CriterioTecnicoResuelto>;
	const resultado: ResultadoCriteriosTecnicos = { circuitoId, parametros, referencias: [], advertencias: [] };
	const aplicar = (valores: Partial<Record<ClaveCriterioTecnico, ValorCriterioTecnico>>, origen: OrigenCriterioResuelto,
		referencia?: ReferenciaTecnica, procedencia?: ProcedenciaTecnica) => {
		for (const clave of CLAVES_CRITERIOS_TECNICOS) {
			const d = valores[clave]; if (d === undefined) continue;
			const valida = decisionValida(clave, d); const decision = structuredClone(d);
			const estado: EstadoResolucion = !valida ? 'CONFLICT' : d.modo === 'VALOR' ? 'RESOLVED' : 'NOT_APPLICABLE';
			const motivos = !valida ? [`Decisión inválida para ${clave}.`] : d.modo === 'VALOR' ? [] : [d.motivo];
			parametros[clave] = { clave, estado, decision, origen, referencia: referencia && { ...referencia }, procedencia: procedencia && { ...procedencia },
				ruta: [...parametros[clave].ruta, { origen, estado, decision: structuredClone(decision), referencia: referencia && { ...referencia } }], motivos };
		}
	};
	if (legacy) {
		const valores: Partial<Record<ClaveCriterioTecnico, ValorCriterioTecnico>> = {};
		for (const clave of ['maxVoltageDropPercent', 'maxLossW', 'maxLossPercent', 'maxUnbalancePercent'] as const) {
			if (legacy[clave] !== undefined) valores[clave] = { modo: 'VALOR', valor: legacy[clave] };
		}
		aplicar(valores, 'LEGACY', undefined, { origen: 'USUARIO', referencia: 'Criterios persistentes de Ingeniería V7' });
	}
	let indice: ReadonlyMap<string, RevisionTecnica>; let conflictoIndice: string | undefined;
	try { indice = indiceCompartido ?? indexarRevisiones(config?.revisiones ?? [], false); } catch (e) { indice = new Map(); conflictoIndice = String((e as Error).message); }
	const perfil = (ref: ReferenciaTecnica | undefined, origen: 'PERFIL_PROYECTO' | 'PERFIL_CIRCUITO') => {
		if (!ref) return;
		resultado.referencias.push({ ...ref }); const revision = indice.get(claveRevision(ref));
		let estado: EstadoResolucion = 'MISSING'; let motivo = 'No se encuentra el perfil de criterios fijado.';
		if (conflictoIndice) { estado = 'CONFLICT'; motivo = conflictoIndice; }
		else if (revision) {
			if (revision.tipo !== 'CRITERIOS' || revision.hash !== ref.hash) { estado = 'CONFLICT'; motivo = 'Tipo/hash no coincide con el perfil de criterios fijado.'; }
			else {
				try {
					verificarRevision(revision); aplicar(revision.parametros, origen, ref, revision.procedencia);
					if (revision.estado === 'RETIRADA') resultado.advertencias.push(`${origen}: revisión retirada ${revision.nombre} r${revision.revision}.`);
					return;
				} catch (e) { estado = 'CONFLICT'; motivo = String((e as Error).message); }
			}
		}
		/* Desconocemos qué claves redefinía el perfil ausente: no hacemos fallback silencioso. */
		for (const clave of CLAVES_CRITERIOS_TECNICOS) parametros[clave] = { clave, estado, origen, referencia: { ...ref },
			ruta: [...parametros[clave].ruta, { origen, estado, referencia: { ...ref }, motivo }], motivos: [motivo] };
	};
	perfil(config?.criterios, 'PERFIL_PROYECTO');
	aplicar(config?.overridesCriterios ?? {}, 'OVERRIDE_PROYECTO', undefined, { origen: 'USUARIO', referencia: 'Override explícito de criterios del proyecto' });
	const circuito = circuitoId ? config?.criteriosCircuito?.[circuitoId] : undefined;
	perfil(circuito?.perfil, 'PERFIL_CIRCUITO');
	aplicar(circuito?.overrides ?? {}, 'OVERRIDE_CIRCUITO', undefined, { origen: 'USUARIO', referencia: `Override explícito del circuito ${circuitoId ?? ''}` });
	return resultado;
}

export interface ResultadoCoordinacionIbInIz {
	estado: 'PASS' | 'FAIL' | 'INDETERMINATE' | 'NOT_APPLICABLE';
	ibA?: number; inA?: number; izA?: number;
	criterio: CriterioTecnicoResuelto;
	faltantes: string[];
	motivos: string[];
}

/** Esta desigualdad verifica un criterio concreto; nunca acredita dimensionamiento completo. */
export function evaluarCoordinacionIbInIz(entrada: { criterio: CriterioTecnicoResuelto; ibA?: number; inA?: number; izA?: number }): ResultadoCoordinacionIbInIz {
	const r: ResultadoCoordinacionIbInIz = { ...entrada, criterio: structuredClone(entrada.criterio), estado: 'INDETERMINATE', faltantes: [], motivos: [] };
	const { criterio, ibA, inA, izA } = entrada;
	if (criterio.clave !== 'coordinarIbInIz') return { ...r, motivos: ['El criterio no corresponde a coordinación Ib/In/Iz.'] };
	if (criterio.estado === 'NOT_APPLICABLE') return { ...r, estado: 'NOT_APPLICABLE', motivos: [...criterio.motivos] };
	if (criterio.estado !== 'RESOLVED' || criterio.decision?.modo !== 'VALOR' || typeof criterio.decision.valor !== 'boolean') {
		return { ...r, faltantes: ['criterio:coordinarIbInIz'], motivos: [...criterio.motivos] };
	}
	if (!criterio.decision.valor) return { ...r, estado: 'NOT_APPLICABLE', motivos: ['La coordinación Ib/In/Iz está deshabilitada explícitamente por el criterio.'] };
	for (const [k, v] of Object.entries({ ibA, inA, izA })) if (v === undefined || !Number.isFinite(v) || v < 0) r.faltantes.push(k);
	if (r.faltantes.length) return { ...r, motivos: ['Faltan corrientes válidas para evaluar Ib ≤ In ≤ Iz.'] };
	const excede = (a: number, b: number) => a - b > 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
	const falla = excede(ibA!, inA!) || excede(inA!, izA!);
	// Formato del mensaje, nunca de la comparación ni de las magnitudes almacenadas.
	const mostrar = (v: number | undefined) => v === undefined ? '—' : String(Number(v.toPrecision(10)));
	return { ...r, estado: falla ? 'FAIL' : 'PASS', motivos: [`${mostrar(ibA)} A ≤ ${mostrar(inA)} A ≤ ${mostrar(izA)} A: ${falla ? 'no cumple' : 'cumple'} el criterio configurado; no es un dimensionamiento completo.`] };
}
