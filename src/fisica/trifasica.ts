import type { OrigenDatoFisico } from '../modelo/fisica.js';
import { complejo, escalar, magnitud, multiplicar, negar, polar, sumar, type Complejo } from './complejos.js';

export interface ComponentesSimetricas {
	cero: Complejo;
	positiva: Complejo;
	negativa: Complejo;
}

export interface AnalisisTrifasicoFisico {
	sistemaId: string;
	tensionesFaseV: [Complejo, Complejo, Complejo];
	corrientesFaseA: [Complejo, Complejo, Complejo];
	corrienteNeutroA: Complejo;
	desequilibrioTensionPct: number;
	desequilibrioCorrientePct: number;
	componentesTension: ComponentesSimetricas;
	componentesCorriente: ComponentesSimetricas;
	umbralDesequilibrioPct?: number;
	superaUmbral: boolean;
	/** Métrica de ingeniería; no representa automáticamente una magnitud normativa. */
	metrica: 'MAX_DESVIACION_MEDIA';
	origen: OrigenDatoFisico;
}

const A = polar(1, 2 * Math.PI / 3);
const A2 = multiplicar(A, A);

/** Transformada de Fortescue para el orden físico L1, L2, L3. */
export function componentesSimetricas([l1, l2, l3]: readonly [Complejo, Complejo, Complejo]): ComponentesSimetricas {
	return {
		cero: escalar(sumar(sumar(l1, l2), l3), 1 / 3),
		positiva: escalar(sumar(sumar(l1, multiplicar(A, l2)), multiplicar(A2, l3)), 1 / 3),
		negativa: escalar(sumar(sumar(l1, multiplicar(A2, l2)), multiplicar(A, l3)), 1 / 3),
	};
}

/** Máxima desviación de las tres magnitudes respecto de su media. No es una métrica normativa. */
export function desequilibrioMaximoPct(valores: readonly [Complejo, Complejo, Complejo]): number {
	const mags = valores.map(magnitud);
	const media = (mags[0] + mags[1] + mags[2]) / 3;
	if (media <= 1e-12) return 0;
	return Math.max(...mags.map((v) => Math.abs(v - media))) / media * 100;
}

export function analizarTrifasico(
	sistemaId: string,
	tensionesFaseV: [Complejo, Complejo, Complejo],
	corrientesFaseA: [Complejo, Complejo, Complejo],
	umbralDesequilibrioPct?: number,
): AnalisisTrifasicoFisico {
	const desequilibrioTensionPct = desequilibrioMaximoPct(tensionesFaseV);
	const desequilibrioCorrientePct = desequilibrioMaximoPct(corrientesFaseA);
	return {
		sistemaId, tensionesFaseV, corrientesFaseA,
		corrienteNeutroA: negar(sumar(sumar(corrientesFaseA[0], corrientesFaseA[1]), corrientesFaseA[2])),
		desequilibrioTensionPct, desequilibrioCorrientePct,
		componentesTension: componentesSimetricas(tensionesFaseV),
		componentesCorriente: componentesSimetricas(corrientesFaseA),
		umbralDesequilibrioPct,
		superaUmbral: umbralDesequilibrioPct !== undefined
			&& Math.max(desequilibrioTensionPct, desequilibrioCorrientePct) > umbralDesequilibrioPct,
		metrica: 'MAX_DESVIACION_MEDIA', origen: 'CALCULADO',
	};
}

export const TRES_CEROS: [Complejo, Complejo, Complejo] = [complejo(0), complejo(0), complejo(0)];
