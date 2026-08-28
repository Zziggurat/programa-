/**
 * Contrato común para instrumentación analógica.
 *
 * Separa el valor eléctrico que circularía por los bornes de la magnitud física que representa.
 * No resuelve una red por impedancias: la continuidad y la alimentación las decide el motor de
 * simulación, y estas funciones realizan únicamente conversiones deterministas y trazables.
 */

export type TipoSenalAnalogica = 'tension' | 'corriente';
export type UnidadElectricaAnalogica = 'V' | 'mA';

export type CalidadSenalAnalogica =
	| 'normal'
	| 'sin-alimentacion'
	| 'circuito-abierto'
	| 'fuera-de-rango'
	| 'fallo-sensor'
	| 'senal-invalida'
	| 'under-range'
	| 'over-range'
	| 'compliance-insuficiente'
	| 'carga-excesiva'
	| 'caida-excesiva'
	| 'no-converge';

/** Causas cuantitativas V5; se agregan a la semantica V3, no crean otra calidad paralela. */
export type CalidadFisicaAnalogica = Extract<CalidadSenalAnalogica,
	'compliance-insuficiente' | 'carga-excesiva' | 'caida-excesiva' | 'no-converge'>;

export type OrigenSenalAnalogica = 'calculado' | 'estimado' | 'inyectado' | 'no-modelado';

export interface RangoSenalAnalogica {
	tipo: TipoSenalAnalogica;
	unidad: UnidadElectricaAnalogica;
	minimo: number;
	maximo: number;
	/** Límites diagnósticos opcionales del perfil. No se presupone NAMUR. */
	diagnostico?: { minimoValido?: number; maximoValido?: number };
}

export interface VariableFisicaAnalogica {
	magnitud: string;
	unidad: string;
	minimo: number;
	maximo: number;
}

export interface SenalAnalogica {
	tipo: TipoSenalAnalogica;
	unidadElectrica: UnidadElectricaAnalogica;
	valorElectrico?: number;
	/** Fracción sin limitar. Permite diagnosticar under/over-range sin perder el valor bruto. */
	valorNormalizado?: number;
	calidad: CalidadSenalAnalogica;
	origen: OrigenSenalAnalogica;
	valorFisico?: number;
	magnitud?: string;
	unidad?: string;
}

export interface ResultadoEscalado {
	valor?: number;
	normalizado?: number;
	calidad: CalidadSenalAnalogica;
	clamped: boolean;
}

const finito = (n: number): boolean => Number.isFinite(n);

export function rangoAnalogicoValido(rango: RangoSenalAnalogica): boolean {
	return finito(rango.minimo) && finito(rango.maximo) && rango.minimo !== rango.maximo
		&& (rango.tipo === 'tension' ? rango.unidad === 'V' : rango.unidad === 'mA')
		&& (rango.diagnostico?.minimoValido === undefined || finito(rango.diagnostico.minimoValido))
		&& (rango.diagnostico?.maximoValido === undefined || finito(rango.diagnostico.maximoValido));
}

export function normalizarAnalogico(
	valor: number,
	rango: RangoSenalAnalogica,
	opciones: { clamp?: boolean } = {},
): ResultadoEscalado {
	if (!finito(valor) || !rangoAnalogicoValido(rango)) {
		return { calidad: 'senal-invalida', clamped: false };
	}
	const normalizado = (valor - rango.minimo) / (rango.maximo - rango.minimo);
	const minimoValido = rango.diagnostico?.minimoValido;
	const maximoValido = rango.diagnostico?.maximoValido;
	const calidad: CalidadSenalAnalogica = minimoValido !== undefined && valor < minimoValido
		? 'under-range'
		: maximoValido !== undefined && valor > maximoValido
			? 'over-range'
			: normalizado < 0 || normalizado > 1 ? 'fuera-de-rango' : 'normal';
	const clamped = opciones.clamp === true && (normalizado < 0 || normalizado > 1);
	return {
		valor: clamped ? Math.max(0, Math.min(1, normalizado)) : normalizado,
		normalizado,
		calidad,
		clamped,
	};
}

export function valorElectricoDesdeNormalizado(
	normalizado: number,
	rango: RangoSenalAnalogica,
	opciones: { clamp?: boolean } = { clamp: true },
): ResultadoEscalado {
	if (!finito(normalizado) || !rangoAnalogicoValido(rango)) {
		return { calidad: 'senal-invalida', clamped: false };
	}
	const n = opciones.clamp === false ? normalizado : Math.max(0, Math.min(1, normalizado));
	const valor = rango.minimo + (rango.maximo - rango.minimo) * n;
	return {
		valor,
		normalizado,
		calidad: normalizado < 0 || normalizado > 1 ? 'fuera-de-rango' : 'normal',
		clamped: n !== normalizado,
	};
}

export function escalarSenalAIngenieria(
	senal: SenalAnalogica,
	rangoElectrico: RangoSenalAnalogica,
	variable: VariableFisicaAnalogica,
	opciones: { clamp?: boolean } = { clamp: true },
): ResultadoEscalado {
	if (senal.calidad !== 'normal' || senal.valorElectrico === undefined
		|| senal.tipo !== rangoElectrico.tipo || senal.unidadElectrica !== rangoElectrico.unidad
		|| !finito(variable.minimo) || !finito(variable.maximo) || variable.minimo === variable.maximo) {
		return { calidad: senal.calidad === 'normal' ? 'senal-invalida' : senal.calidad, clamped: false };
	}
	const n = normalizarAnalogico(senal.valorElectrico, rangoElectrico, opciones);
	if (n.valor === undefined) return n;
	return {
		valor: variable.minimo + (variable.maximo - variable.minimo) * n.valor,
		normalizado: n.normalizado,
		calidad: n.calidad,
		clamped: n.clamped,
	};
}

export function senalDesdeVariableFisica(
	valorFisico: number,
	variable: VariableFisicaAnalogica,
	rangoElectrico: RangoSenalAnalogica,
	origen: OrigenSenalAnalogica = 'calculado',
): SenalAnalogica {
	if (!finito(valorFisico) || !finito(variable.minimo) || !finito(variable.maximo)
		|| variable.minimo === variable.maximo || !rangoAnalogicoValido(rangoElectrico)) {
		return senalInvalida(rangoElectrico, 'senal-invalida', origen);
	}
	const normalizado = (valorFisico - variable.minimo) / (variable.maximo - variable.minimo);
	const electrico = valorElectricoDesdeNormalizado(normalizado, rangoElectrico, { clamp: false });
	return {
		tipo: rangoElectrico.tipo,
		unidadElectrica: rangoElectrico.unidad,
		valorElectrico: electrico.valor,
		valorNormalizado: normalizado,
		calidad: electrico.calidad,
		origen,
		valorFisico,
		magnitud: variable.magnitud,
		unidad: variable.unidad,
	};
}

export function senalInvalida(
	rango: Pick<RangoSenalAnalogica, 'tipo' | 'unidad'>,
	calidad: Exclude<CalidadSenalAnalogica, 'normal'>,
	origen: OrigenSenalAnalogica = 'calculado',
): SenalAnalogica {
	return { tipo: rango.tipo, unidadElectrica: rango.unidad, calidad, origen };
}

export const RANGO_0_10_V: RangoSenalAnalogica = {
	tipo: 'tension', unidad: 'V', minimo: 0, maximo: 10,
};

export const RANGO_4_20_MA: RangoSenalAnalogica = {
	tipo: 'corriente', unidad: 'mA', minimo: 4, maximo: 20,
};
