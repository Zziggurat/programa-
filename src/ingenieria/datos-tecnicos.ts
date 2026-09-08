import type { EngineeringRule, ResultadoReglaIngenieria } from './validacion.js';
import { resolverCriteriosTecnicos } from '../datos-tecnicos/criterios.js';

/** Los problemas de datos forman parte del mismo Issue Center y del mismo resumen de cobertura. */
export const REGLA_DATOS_TECNICOS: EngineeringRule = {
	code: 'TS-DATA-RESOLUTION', category: 'DOCUMENTATION', scope: 'ENTITY',
	evaluate(ctx) {
		if (!ctx.proyecto.datosTecnicos) return [];
		const rs: ResultadoReglaIngenieria[] = [];
		const problema = (id: string, tipo: 'PROJECT' | 'DEVICE' | 'CONDUCTOR', campo: string, estado: string, motivo: string, referencia?: string): ResultadoReglaIngenieria => ({
			code: `TS-DATA-${estado}-${campo.replace(/[^\w-]/g, '-')}`, category: 'DOCUMENTATION', severity: estado === 'CONFLICT' ? 'ERROR' : 'WARNING',
			status: estado === 'UNVERIFIED_SOURCE' ? 'WARNING' : 'INDETERMINATE', title: `${estado}: ${campo}`, description: motivo,
			evidence: referencia ? [{ codigo: 'TECHNICAL_REVISION', descripcion: 'Revisión/hash fijado; no certifica fuente', valor: referencia, origen: 'CONFIGURADO' }] : [],
			relatedEntities: [{ tipo, id }], provenance: 'NO_DISPONIBLE', missingData: [campo], remediationHints: ['Abrir Datos técnicos para esta entidad, revisar condiciones, vínculo u override y volver a validar.'],
		});
		for (const p of ctx.tecnica?.problemas ?? []) rs.push(problema(p.entidadId, p.entidad, 'vinculo', p.estado, p.motivo));
		for (const d of ctx.tecnica?.resoluciones ?? []) {
			if (d.estado !== 'RESOLVED') rs.push(problema(d.entidadId, d.entidad, d.clave, d.estado, d.motivos.join('; '), d.referencia.hash));
			for (const a of d.advertencias) rs.push(problema(d.entidadId, d.entidad, d.clave, 'UNVERIFIED_SOURCE', a, d.referencia.hash));
		}
		for (const c of ctx.circuitos) {
			const criterios = resolverCriteriosTecnicos(ctx.proyecto.datosTecnicos, c.id, c.criterios);
			for (const [k, p] of Object.entries(criterios.parametros)) {
				if (p.estado === 'RESOLVED') continue;
				const r = problema(c.id, 'PROJECT', k, p.estado, p.motivos.join('; '), p.referencia?.hash); r.circuitId = c.id; r.relatedEntities = [{ tipo: 'CIRCUIT', id: c.id }];
				if (p.estado === 'NOT_APPLICABLE') { r.status = 'NOT_APPLICABLE'; r.severity = 'INFO'; r.missingData = []; }
				rs.push(r);
			}
		}
		return rs;
	},
};
