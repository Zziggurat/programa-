import { TOLERANCIAS_FISICA } from './tolerancias.js';

export interface Complejo { re: number; im: number }
export const CERO: Complejo = Object.freeze({ re: 0, im: 0 });
export const UNO: Complejo = Object.freeze({ re: 1, im: 0 });

export function complejo(re: number, im = 0): Complejo {
	if (!Number.isFinite(re) || !Number.isFinite(im)) throw new Error('COMPLEJO_NO_FINITO');
	return { re, im };
}
export const sumar = (a: Complejo, b: Complejo): Complejo => ({ re: a.re + b.re, im: a.im + b.im });
export const restar = (a: Complejo, b: Complejo): Complejo => ({ re: a.re - b.re, im: a.im - b.im });
export const negar = (a: Complejo): Complejo => ({ re: -a.re, im: -a.im });
export const multiplicar = (a: Complejo, b: Complejo): Complejo => ({
	re: a.re * b.re - a.im * b.im,
	im: a.re * b.im + a.im * b.re,
});
export const conjugado = (a: Complejo): Complejo => ({ re: a.re, im: -a.im });
export const magnitud2 = (a: Complejo): number => a.re * a.re + a.im * a.im;
export const magnitud = (a: Complejo): number => Math.hypot(a.re, a.im);
export const faseRad = (a: Complejo): number => Math.atan2(a.im, a.re);
export const faseDeg = (a: Complejo): number => faseRad(a) * 180 / Math.PI;
export function dividir(a: Complejo, b: Complejo): Complejo {
	const d = magnitud2(b);
	if (d <= TOLERANCIAS_FISICA.cero ** 2) throw new Error('DIVISION_COMPLEJA_POR_CERO');
	return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}
export const escalar = (a: Complejo, factor: number): Complejo => ({ re: a.re * factor, im: a.im * factor });
export function polar(mag: number, anguloRad: number): Complejo {
	return complejo(mag * Math.cos(anguloRad), mag * Math.sin(anguloRad));
}
export function casiIgual(a: Complejo, b: Complejo, tolerancia = TOLERANCIAS_FISICA.comparacionTests): boolean {
	return magnitud(restar(a, b)) <= tolerancia * Math.max(1, magnitud(a), magnitud(b));
}
