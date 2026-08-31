/**
 * Configuración persistente de Ingeniería V7.
 *
 * La topología y los resultados no viven aquí: se derivan del Proyecto y de PhysicsEngine.
 * Solo se guardan decisiones humanas (nombre, tipo y criterios) asociadas a ids de circuito
 * deterministas.
 */

export type TipoCircuitoIngenieria =
	| 'MOTOR' | 'VFD' | 'CONTROL_AC' | 'CONTROL_DC' | 'PLC'
	| 'INSTRUMENTACION' | 'ALIMENTACION' | 'AUXILIAR' | 'GENERICO';

export interface CriteriosCircuitoIngenieria {
	/** Criterios del proyecto/usuario; no son límites normativos incorporados. */
	maxVoltageDropPercent?: number;
	maxLossW?: number;
	maxLossPercent?: number;
	maxUnbalancePercent?: number;
	/** Tabla técnica elegida por el usuario; V7 no incorpora una tabla normativa implícita. */
	ampacityProfile?: {
		nombre: string;
		fuente: string;
		puntos: { seccionMm2: number; corrienteMaxA: number }[];
	};
}

export interface MetadatosCircuitoIngenieria {
	version: 1;
	nombre?: string;
	tipo?: TipoCircuitoIngenieria;
	criterios?: CriteriosCircuitoIngenieria;
	/** Decisión humana explícita: solo estos ramales pueden proponerse para otra fase. */
	conductoresReasignablesFase?: string[];
}

export interface ConfiguracionIngenieriaProyecto {
	version: 1;
	criterios?: CriteriosCircuitoIngenieria;
	circuitos?: Record<string, MetadatosCircuitoIngenieria>;
}

const TIPOS = new Set<TipoCircuitoIngenieria>([
	'MOTOR', 'VFD', 'CONTROL_AC', 'CONTROL_DC', 'PLC',
	'INSTRUMENTACION', 'ALIMENTACION', 'AUXILIAR', 'GENERICO',
]);
const objeto = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const numeroNoNegativo = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;

function leerCriterios(v: unknown): CriteriosCircuitoIngenieria | undefined {
	if (!objeto(v)) return undefined;
	const r: CriteriosCircuitoIngenieria = {};
	type CriterioNumerico = Exclude<keyof CriteriosCircuitoIngenieria, 'ampacityProfile'>;
	const copiar = (campo: CriterioNumerico) => {
		const valor = numeroNoNegativo(v[campo]); if (valor !== undefined) r[campo] = valor;
	};
	copiar('maxVoltageDropPercent'); copiar('maxLossW'); copiar('maxLossPercent'); copiar('maxUnbalancePercent');
	if (objeto(v.ampacityProfile)) {
		const nombre = typeof v.ampacityProfile.nombre === 'string' ? v.ampacityProfile.nombre.trim().slice(0, 120) : '';
		const fuente = typeof v.ampacityProfile.fuente === 'string' ? v.ampacityProfile.fuente.trim().slice(0, 300) : '';
		const puntos = Array.isArray(v.ampacityProfile.puntos) ? v.ampacityProfile.puntos.flatMap((p) => {
			if (!objeto(p)) return []; const seccionMm2 = numeroNoNegativo(p.seccionMm2);
			const corrienteMaxA = numeroNoNegativo(p.corrienteMaxA);
			return seccionMm2 && corrienteMaxA ? [{ seccionMm2, corrienteMaxA }] : [];
		}).sort((a, b) => a.seccionMm2 - b.seccionMm2).slice(0, 200) : [];
		if (nombre && fuente && puntos.length) r.ampacityProfile = { nombre, fuente, puntos };
	}
	return Object.keys(r).length ? r : undefined;
}

/** Lectura tolerante: un proyecto V6 no trae este bloque y sigue abriendo sin migración. */
export function leerConfiguracionIngenieria(v: unknown): ConfiguracionIngenieriaProyecto | undefined {
	if (!objeto(v) || v.version !== 1) return undefined;
	const circuitos: Record<string, MetadatosCircuitoIngenieria> = {};
	if (objeto(v.circuitos)) {
		for (const id of Object.keys(v.circuitos).sort().slice(0, 5000)) {
			const bruto = v.circuitos[id];
			if (!id.trim() || !objeto(bruto) || bruto.version !== 1) continue;
			const nombre = typeof bruto.nombre === 'string' && bruto.nombre.trim()
				? bruto.nombre.trim().slice(0, 200) : undefined;
			const tipo = TIPOS.has(bruto.tipo as TipoCircuitoIngenieria)
				? bruto.tipo as TipoCircuitoIngenieria : undefined;
			const conductoresReasignablesFase = Array.isArray(bruto.conductoresReasignablesFase)
				? [...new Set(bruto.conductoresReasignablesFase.filter((x): x is string => typeof x === 'string' && !!x.trim())
					.map((x) => x.trim().slice(0, 200)))].sort((a, b) => a.localeCompare(b)).slice(0, 500)
				: undefined;
			circuitos[id] = { version: 1, nombre, tipo, criterios: leerCriterios(bruto.criterios),
				conductoresReasignablesFase: conductoresReasignablesFase?.length ? conductoresReasignablesFase : undefined };
		}
	}
	const criterios = leerCriterios(v.criterios);
	return criterios || Object.keys(circuitos).length
		? { version: 1, criterios, circuitos: Object.keys(circuitos).length ? circuitos : undefined }
		: { version: 1 };
}
