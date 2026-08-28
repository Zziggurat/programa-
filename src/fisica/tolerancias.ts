/** Tolerancias centrales. Solver, tests y presentacion no deben compartir numeros magicos. */
export const TOLERANCIAS_FISICA = Object.freeze({
	cero: 1e-12,
	pivoteSolver: 1e-12,
	convergenciaV: 1e-7,
	residuoKclA: 1e-6,
	balancePotenciaRel: 1e-5,
	comparacionTests: 1e-8,
	visualRel: 1e-3,
});

