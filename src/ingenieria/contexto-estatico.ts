/** Condición de revisión documental: polos explícitos cerrados, no estado runtime. */
import { resolverComportamiento } from '../modelo/comportamiento.js';
import type { Proyecto } from '../modelo/tipos.js';
import type { ContextoTopologiaFisica } from '../fisica/topologia-proyecto.js';

export function contextoEstaticoIngenieria(proyecto: Proyecto,
	referenciasManualesMm?: ReadonlyMap<string, number>): ContextoTopologiaFisica {
	const conexionesCerradas = new Map<string, readonly (readonly [string, string])[]>();
	for (const d of [...proyecto.dispositivos].sort((a, b) => a.id.localeCompare(b.id))) {
		const perfil = resolverComportamiento(d);
		let pares: readonly { entrada: string; salida: string }[] = [];
		if (perfil?.clase === 'proteccion' || perfil?.clase === 'contactos-electromagneticos') pares = perfil.polos;
		else if (perfil?.clase === 'pasivo') pares = perfil.conexiones;
		if (pares.length) conexionesCerradas.set(d.id, pares.map((p) => [p.entrada, p.salida] as const));
	}
	return { conexionesCerradas, referenciasManualesMm };
}
