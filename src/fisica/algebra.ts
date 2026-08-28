import { CERO, Complejo, dividir, magnitud, multiplicar, restar } from './complejos.js';
import { TOLERANCIAS_FISICA } from './tolerancias.js';

export class ErrorNumericoFisica extends Error {
	constructor(public readonly codigo: 'MATRIZ_SINGULAR' | 'DIMENSION_INVALIDA', mensaje: string) {
		super(mensaje);
		this.name = 'ErrorNumericoFisica';
	}
}

/** Eliminacion gaussiana compleja con pivoteo parcial. No muta sus argumentos. */
export function resolverSistemaComplejo(a: readonly (readonly Complejo[])[], b: readonly Complejo[]): Complejo[] {
	const n = b.length;
	if (a.length !== n || a.some((fila) => fila.length !== n)) {
		throw new ErrorNumericoFisica('DIMENSION_INVALIDA', 'La matriz debe ser cuadrada y coincidir con el vector');
	}
	const m = a.map((fila, i) => [...fila.map((x) => ({ ...x })), { ...b[i] }]);
	for (let col = 0; col < n; col++) {
		let pivote = col;
		for (let fila = col + 1; fila < n; fila++) if (magnitud(m[fila][col]) > magnitud(m[pivote][col])) pivote = fila;
		if (magnitud(m[pivote][col]) <= TOLERANCIAS_FISICA.pivoteSolver) {
			throw new ErrorNumericoFisica('MATRIZ_SINGULAR', `No existe referencia independiente en la columna ${col}`);
		}
		[m[col], m[pivote]] = [m[pivote], m[col]];
		const p = m[col][col];
		for (let j = col; j <= n; j++) m[col][j] = dividir(m[col][j], p);
		for (let fila = 0; fila < n; fila++) {
			if (fila === col) continue;
			const factor = m[fila][col];
			if (magnitud(factor) <= TOLERANCIAS_FISICA.cero) continue;
			for (let j = col; j <= n; j++) m[fila][j] = restar(m[fila][j], multiplicar(factor, m[col][j]));
		}
	}
	return m.map((fila) => fila[n] ?? CERO);
}

