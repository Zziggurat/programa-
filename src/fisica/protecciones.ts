import type { OrigenDatoFisico, PuntoCurvaProteccionFisica } from '../modelo/fisica.js';

export interface PerfilCurvaProteccion {
	id: string;
	descripcion: string;
	puntos: PuntoCurvaProteccionFisica[];
	instantaneoDesdeIn?: number;
	origen: OrigenDatoFisico;
}

export interface EvaluacionCurvaProteccion {
	region: 'NORMAL' | 'TERMICA' | 'INSTANTANEA' | 'NO_MODELADA';
	multiploIn: number;
	tMinS?: number;
	tMaxS?: number;
	origen: OrigenDatoFisico;
	explicacion: string;
}

const puntos = (...p: [number, number, number][]): PuntoCurvaProteccionFisica[] =>
	p.map(([multiploIn, tMinS, tMaxS]) => ({ multiploIn, tMinS, tMaxS }));

/** Curvas de ingenieria genericas y explicitas; no representan certificacion de fabricante. */
export const CURVAS_PROTECCION_GENERICAS: Readonly<Record<string, PerfilCurvaProteccion>> = Object.freeze({
	B: { id: 'MODELO_GEN_B', descripcion: 'Modelo generico B', puntos: puntos([1.13, 3600, 7200], [1.45, 180, 3600], [2.55, 1, 60]), instantaneoDesdeIn: 5, origen: 'ESTIMADO' },
	C: { id: 'MODELO_GEN_C', descripcion: 'Modelo generico C', puntos: puntos([1.13, 3600, 7200], [1.45, 180, 3600], [2.55, 1, 60]), instantaneoDesdeIn: 10, origen: 'ESTIMADO' },
	D: { id: 'MODELO_GEN_D', descripcion: 'Modelo generico D', puntos: puntos([1.13, 3600, 7200], [1.45, 180, 3600], [2.55, 1, 60]), instantaneoDesdeIn: 20, origen: 'ESTIMADO' },
	K: { id: 'MODELO_GEN_K', descripcion: 'Modelo generico K', puntos: puntos([1.2, 1200, 7200], [2, 20, 300], [4, 1, 30]), instantaneoDesdeIn: 12, origen: 'ESTIMADO' },
	Z: { id: 'MODELO_GEN_Z', descripcion: 'Modelo generico Z', puntos: puntos([1.1, 300, 3600], [1.5, 10, 300], [2, 1, 60]), instantaneoDesdeIn: 3, origen: 'ESTIMADO' },
	gG: { id: 'MODELO_GEN_GG', descripcion: 'Modelo I2t generico gG', puntos: puntos([1.25, 3600, 14400], [2, 10, 300], [5, 0.05, 5], [10, 0.01, 0.5]), origen: 'ESTIMADO' },
	aM: { id: 'MODELO_GEN_AM', descripcion: 'Modelo I2t generico aM', puntos: puntos([2, 120, 3600], [5, 1, 60], [10, 0.02, 1]), origen: 'ESTIMADO' },
});

function interpolarLog(a: PuntoCurvaProteccionFisica, b: PuntoCurvaProteccionFisica, x: number, campo: 'tMinS' | 'tMaxS'): number {
	const t = (Math.log(x) - Math.log(a.multiploIn)) / (Math.log(b.multiploIn) - Math.log(a.multiploIn));
	return Math.exp(Math.log(a[campo]) + t * (Math.log(b[campo]) - Math.log(a[campo])));
}

export function evaluarCurva(perfil: PerfilCurvaProteccion | undefined, corrienteA: number, inA: number): EvaluacionCurvaProteccion {
	if (!perfil || !Number.isFinite(corrienteA) || !(inA > 0)) return { region: 'NO_MODELADA', multiploIn: 0,
		origen: 'NO_MODELADO', explicacion: 'Faltan curva o corriente nominal' };
	const multiploIn = Math.max(0, corrienteA / inA);
	if (perfil.instantaneoDesdeIn !== undefined && multiploIn >= perfil.instantaneoDesdeIn) return {
		region: 'INSTANTANEA', multiploIn, tMinS: 0.005, tMaxS: 0.05, origen: perfil.origen,
		explicacion: `${multiploIn.toFixed(2)} In alcanza la region instantanea del ${perfil.id}`,
	};
	const ordenados = [...perfil.puntos].sort((a, b) => a.multiploIn - b.multiploIn);
	if (!ordenados.length || multiploIn < ordenados[0].multiploIn) return { region: 'NORMAL', multiploIn,
		origen: perfil.origen, explicacion: `${multiploIn.toFixed(2)} In por debajo de la banda modelada` };
	let izq = ordenados[0]; let der = ordenados[ordenados.length - 1];
	for (let i = 1; i < ordenados.length; i++) if (multiploIn <= ordenados[i].multiploIn) { izq = ordenados[i - 1]; der = ordenados[i]; break; }
	const tMinS = izq === der ? izq.tMinS : interpolarLog(izq, der, multiploIn, 'tMinS');
	const tMaxS = izq === der ? izq.tMaxS : interpolarLog(izq, der, multiploIn, 'tMaxS');
	return { region: 'TERMICA', multiploIn, tMinS, tMaxS, origen: perfil.origen,
		explicacion: `Ventana ${tMinS.toPrecision(3)}..${tMaxS.toPrecision(3)} s segun ${perfil.id}` };
}

export interface MemoriaProteccionFisica { cargaTermica: number; i2tA2s: number; disparada: boolean }

/** Avanza una vez por delta temporal; las iteraciones del solver nunca llaman a esta funcion. */
export function avanzarProteccionFisica(
	memoria: MemoriaProteccionFisica,
	evaluacion: EvaluacionCurvaProteccion,
	corrienteA: number,
	deltaS: number,
	i2tLimiteA2s?: number,
): MemoriaProteccionFisica {
	const dt = Number.isFinite(deltaS) ? Math.max(0, deltaS) : 0;
	if (memoria.disparada) return { ...memoria };
	const i2tA2s = memoria.i2tA2s + corrienteA * corrienteA * dt;
	if (evaluacion.region === 'INSTANTANEA' || (i2tLimiteA2s !== undefined && i2tA2s >= i2tLimiteA2s)) {
		return { cargaTermica: 1, i2tA2s, disparada: true };
	}
	const tiempo = evaluacion.tMaxS === undefined ? undefined
		: (evaluacion.tMinS! + evaluacion.tMaxS) / 2;
	const cargaTermica = tiempo ? Math.min(1, memoria.cargaTermica + dt / Math.max(0.001, tiempo))
		: Math.max(0, memoria.cargaTermica - dt / 60);
	return { cargaTermica, i2tA2s, disparada: cargaTermica >= 1 };
}

export type ClasificacionSelectividad = 'SELECTIVA' | 'PARCIAL' | 'NO_SELECTIVA' | 'INDETERMINADA';
export interface ResultadoSelectividad {
	clasificacion: ClasificacionSelectividad;
	explicacion: string;
	aguasAbajo: EvaluacionCurvaProteccion;
	aguasArriba: EvaluacionCurvaProteccion;
}

export function analizarSelectividad(
	aguasAbajo: EvaluacionCurvaProteccion,
	aguasArriba: EvaluacionCurvaProteccion,
): ResultadoSelectividad {
	if (aguasAbajo.tMinS === undefined || aguasAbajo.tMaxS === undefined
		|| aguasArriba.tMinS === undefined || aguasArriba.tMaxS === undefined) return {
		clasificacion: 'INDETERMINADA', aguasAbajo, aguasArriba,
		explicacion: 'Alguna proteccion no dispone de ventana tiempo-corriente',
	};
	if (aguasAbajo.tMaxS < aguasArriba.tMinS) return { clasificacion: 'SELECTIVA', aguasAbajo, aguasArriba,
		explicacion: `La ventana aguas abajo termina en ${aguasAbajo.tMaxS}s antes de ${aguasArriba.tMinS}s aguas arriba, segun el modelo` };
	if (aguasArriba.tMaxS <= aguasAbajo.tMinS) return { clasificacion: 'NO_SELECTIVA', aguasAbajo, aguasArriba,
		explicacion: 'La proteccion aguas arriba puede despejar antes que la situada aguas abajo' };
	return { clasificacion: 'PARCIAL', aguasAbajo, aguasArriba,
		explicacion: 'Las bandas tiempo-corriente se solapan; no se garantiza que despeje solo la proteccion aguas abajo' };
}

