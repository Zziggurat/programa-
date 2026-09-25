/** ESQ-05: giro editorial reversible, sin cambiar identidad, bornes o topología. */
import type { Proyecto, RepresentacionEsquema } from '../modelo/tipos.js';

export type PlanGiroRepresentacion =
	| { readonly ok: false; readonly motivo: string }
	| { readonly ok: true; readonly vistaId: string; readonly giroNuevo: 0 | 180 };

const origen = new WeakMap<Extract<PlanGiroRepresentacion, { ok: true }>,
	{ proyecto: Proyecto; firma: string }>();
const firma = (p: Proyecto): string => JSON.stringify({ vistas: p.esquema?.representaciones,
	dispositivos: p.dispositivos, hojas: p.hojas, esEjemplo: p.esEjemplo });

export function previsualizarGiroRepresentacion(p: Proyecto, vistaId: string): PlanGiroRepresentacion {
	if (p.esEjemplo) return { ok: false, motivo: 'Un ejemplo es de solo lectura.' };
	const lista = p.esquema?.representaciones;
	if (!lista) return { ok: false, motivo: 'Activa primero las vistas editables M2.' };
	const vistas = lista.filter((r) => r.id === vistaId);
	if (vistas.length !== 1 || p.dispositivos.filter((d) => d.id === vistas[0].dispositivoId).length !== 1
		|| p.hojas.filter((h) => h.id === vistas[0].hojaId).length !== 1) {
		return { ok: false, motivo: 'Selecciona una vista única y vigente.' };
	}
	if (vistas[0].giro !== undefined && vistas[0].giro !== 180) {
		return { ok: false, motivo: 'La orientación de esta vista no es reconocida.' };
	}
	const plan = { ok: true as const, vistaId, giroNuevo: vistas[0].giro === 180 ? 0 as const : 180 as const };
	origen.set(plan, { proyecto: p, firma: firma(p) });
	return plan;
}

/** Devuelve false si el documento cambió después del preview; jamás aplica una propuesta ajena. */
export function aplicarGiroRepresentacion(p: Proyecto, plan: PlanGiroRepresentacion): boolean {
	if (!plan.ok || p.esEjemplo) return false;
	const registrado = origen.get(plan);
	if (!registrado || registrado.proyecto !== p || registrado.firma !== firma(p)) return false;
	const lista = p.esquema?.representaciones;
	const indice = lista?.findIndex((r) => r.id === plan.vistaId) ?? -1;
	if (indice < 0 || !lista) return false;
	const vista: RepresentacionEsquema = lista[indice];
	const copia = { ...vista };
	if (plan.giroNuevo === 180) copia.giro = 180;
	else delete copia.giro;
	lista[indice] = copia;
	origen.delete(plan);
	return true;
}
