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
}

export interface MetadatosCircuitoIngenieria {
	version: 1;
	nombre?: string;
	tipo?: TipoCircuitoIngenieria;
	criterios?: CriteriosCircuitoIngenieria;
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
	const copiar = (campo: keyof CriteriosCircuitoIngenieria) => {
		const valor = numeroNoNegativo(v[campo]); if (valor !== undefined) r[campo] = valor;
	};
	copiar('maxVoltageDropPercent'); copiar('maxLossW'); copiar('maxLossPercent'); copiar('maxUnbalancePercent');
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
			circuitos[id] = { version: 1, nombre, tipo, criterios: leerCriterios(bruto.criterios) };
		}
	}
	const criterios = leerCriterios(v.criterios);
	return criterios || Object.keys(circuitos).length
		? { version: 1, criterios, circuitos: Object.keys(circuitos).length ? circuitos : undefined }
		: { version: 1 };
}
