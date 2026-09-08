import type { CondicionesTecnicas, EstadoResolucion } from './tipos.js';

export interface ResultadoCondicionesTecnicas { estado: EstadoResolucion; motivos: string[] }
const tolerancia = (a: number, b: number) => 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const intervalo = (v: unknown): [number, number] | undefined => {
	if (typeof v === 'number' && Number.isFinite(v)) return [v, v];
	if (Array.isArray(v) && v.length === 2 && v.every(x => typeof x === 'number' && Number.isFinite(x)) && v[0] <= v[1]) return [v[0], v[1]];
	return undefined;
};

/** La condición solicitada completa debe estar contenida en la condición publicada. */
export function evaluarCondicionesTecnicas(entrada: {
	declaradas: CondicionesTecnicas; actuales: CondicionesTecnicas;
}): ResultadoCondicionesTecnicas {
	const motivos: string[] = []; let falta = false; let incompatible = false; let invalida = false;
	for (const k of Object.keys(entrada.declaradas).sort() as (keyof CondicionesTecnicas)[]) {
		const declarada = entrada.declaradas[k]; if (declarada === undefined) continue;
		const actual = entrada.actuales[k];
		if (actual === undefined) { falta = true; motivos.push(`Falta condición ${k}.`); continue; }
		if (typeof declarada === 'string') {
			if (actual !== declarada) { incompatible = true; motivos.push(`${k}: ${String(actual)} no coincide con ${declarada}.`); }
		} else {
			const dominio = intervalo(declarada); const pedido = intervalo(actual);
			if (!dominio || !pedido) { invalida = true; motivos.push(`${k}: valor o intervalo no finito/invertido.`); continue; }
			if (pedido[0] < dominio[0] - tolerancia(pedido[0], dominio[0]) || pedido[1] > dominio[1] + tolerancia(pedido[1], dominio[1])) {
				incompatible = true; motivos.push(`${k}: [${pedido}] no está contenido en [${dominio}].`);
			}
		}
	}
	return { estado: invalida ? 'OUT_OF_DOMAIN' : incompatible ? 'NOT_APPLICABLE' : falta ? 'MISSING' : 'RESOLVED', motivos };
}
