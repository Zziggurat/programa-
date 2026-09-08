import { magnitud } from './complejos.js';
import type { ResultadoFisicaElectrica } from './topologia-proyecto.js';

/** Historial del evento todavía inyectado, dentro del resultado runtime, no del Proyecto.
 * La red/medición actual sigue desenergizada: no se repone corriente ni potencia prospectiva.
 * Cambiar/quitar el ensayo o volver a energizarlo invalida la evidencia despejada anterior.
 */
export function conservarEvidenciaDisparo(anterior: ResultadoFisicaElectrica | undefined,
	actual: ResultadoFisicaElectrica, huboDisparo = false): void {
	if (!anterior) return;
	const previas = new Map(anterior.fallas.map(f=>[f.id,f])), conservadas = new Set<string>();
	actual.fallas = actual.fallas.map(f=>{
		const p=previas.get(f.id);
		if (!p || !(p.despejada || huboDisparo) || p.tipo!==f.tipo || p.nodoA!==f.nodoA || p.nodoB!==f.nodoB
			|| !p.iccA || !p.vPrefallaV || magnitud(p.vPrefallaV)<=1e-6
			|| f.vPrefallaV && magnitud(f.vPrefallaV)>1e-6) return f;
		if (f.zFallaOhm && p.zFallaOhm && (f.zFallaOhm.re!==p.zFallaOhm.re || f.zFallaOhm.im!==p.zFallaOhm.im)) return f;
		conservadas.add(f.id); return {...structuredClone(p),despejada:true};
	});
	if (conservadas.size) actual.selectividad = [
		...actual.selectividad.filter(s=>!conservadas.has(s.fallaId)),
		...structuredClone(anterior.selectividad.filter(s=>conservadas.has(s.fallaId))),
	];
}
