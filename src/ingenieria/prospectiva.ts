import { magnitud } from '../fisica/complejos.js';
import { simularFisicaProyecto, type ContextoTopologiaFisica } from '../fisica/topologia-proyecto.js';
import type { ResultadoFallaFisica } from '../fisica/fallas.js';
import type { DiagnosticoFisica } from '../fisica/tipos.js';
import type { ConfiguracionTecnicaProyecto } from '../datos-tecnicos/tipos.js';
import { resolverProyectoTecnico } from '../datos-tecnicos/resolver.js';
import { resolverComportamiento } from '../modelo/comportamiento.js';
import type { Proyecto } from '../modelo/tipos.js';

export type EstadoProspectivaProteccion = 'RESUELTO' | 'SIN_ENSAYO' | 'DATOS_RED' | 'TOPOLOGIA' | 'NO_SOPORTADO' | 'CONFLICTO';
export interface ResultadoProspectivaProteccion {
	proteccionId: string;
	estado: EstadoProspectivaProteccion;
	ensayo?: NonNullable<ConfiguracionTecnicaProyecto['prospectiva']>[number];
	iccA?: number;
	origen: 'CALCULADO' | 'ESTIMADO' | 'NO_MODELADO';
	falla?: ResultadoFallaFisica;
	diagnosticos: DiagnosticoFisica[];
	motivos: string[];
	limitaciones: string[];
}

/** Ensayos independientes de dos nodos: nunca alteran el snapshot operativo ni el diseño. */
export function analizarProspectivaProtecciones(proyecto: Proyecto,
	contexto: ContextoTopologiaFisica = {}): ReadonlyMap<string, ResultadoProspectivaProteccion> {
	const salida = new Map<string, ResultadoProspectivaProteccion>();
	if (!proyecto.datosTecnicos) return salida;
	const fuentesDatos = new Set(proyecto.dispositivos.filter(d => d.fisica?.fuente || resolverComportamiento(d)?.clase === 'fuente').map(d => d.id));
	for (const v of proyecto.datosTecnicos.vinculos) if (proyecto.datosTecnicos.revisiones.some(r => r.tipo === 'PRODUCTO' && r.id === v.producto.id && r.catalogo.id === v.producto.catalogoId && r.familia === 'FUENTE')) fuentesDatos.add(v.entidadId);
	const tecnica = resolverProyectoTecnico({ ...proyecto,
		dispositivos: [...proyecto.dispositivos].sort((a, b) => a.id.localeCompare(b.id)),
		conductores: [...proyecto.conductores].sort((a, b) => a.id.localeCompare(b.id)),
	});
	proyecto = tecnica.proyecto;
	const dispositivos = new Map(proyecto.dispositivos.map(d => [d.id, d]));
	const ensayos = proyecto.datosTecnicos!.prospectiva ?? [];
	const ids = new Set([...proyecto.dispositivos.filter(d => resolverComportamiento(d)?.clase === 'proteccion').map(d => d.id),
		...ensayos.map(e => e.proteccionId)]);
	for (const proteccionId of [...ids].sort()) {
		const lista = ensayos.filter(e => e.proteccionId === proteccionId);
		const r: ResultadoProspectivaProteccion = { proteccionId, estado: 'SIN_ENSAYO', origen: 'NO_MODELADO',
			diagnosticos: [], motivos: [], limitaciones: [
				'Ensayo prospectivo de dos nodos; no representa Icc certificada, selectividad ni capacidad de servicio.',
				'Usa la impedancia de falla franca explícita del modelo (0,001 Ω), sin impedancias de red inventadas.',
			] };
		salida.set(proteccionId, r);
		if (!lista.length) { r.motivos.push('No hay punto de falla prospectiva configurado para esta protección.'); continue; }
		if (lista.length !== 1) { r.estado = 'CONFLICTO'; r.motivos.push('Más de un ensayo define la misma protección; no se elige por orden.'); continue; }
		const ensayo = lista[0]; r.ensayo = structuredClone(ensayo);
		const proteccion = dispositivos.get(proteccionId);
		if (!proteccion || resolverComportamiento(proteccion)?.clase !== 'proteccion') {
			r.estado = 'CONFLICTO'; r.motivos.push('El ensayo no apunta a un perfil funcional de protección.'); continue;
		}
		const de = dispositivos.get(ensayo.de.dispositivoId)?.bornes.find(b => b.id === ensayo.de.borneId);
		const a = dispositivos.get(ensayo.a.dispositivoId)?.bornes.find(b => b.id === ensayo.a.borneId);
		const nodoA = `${ensayo.de.dispositivoId}::${ensayo.de.borneId}`;
		const nodoB = `${ensayo.a.dispositivoId}::${ensayo.a.borneId}`;
		if (!de || !a || nodoA === nodoB) { r.estado = 'TOPOLOGIA'; r.motivos.push('Se requieren dos terminales persistentes distintos y existentes.'); continue; }
		if (ensayo.tipo === 'TRIFASICA') {
			r.estado = 'NO_SOPORTADO'; r.motivos.push('El solver prospectivo disponible resuelve dos nodos, no una falla trifásica simultánea.'); continue;
		}
		if (ensayo.tipo === 'L_PE' && a.tipo !== 'PE' || ensayo.tipo === 'L_N' && a.tipo !== 'N'
			|| ensayo.tipo === 'L_L' && (de.tipo !== 'L' || a.tipo !== 'L')) {
			r.estado = 'TOPOLOGIA'; r.motivos.push('Los terminales no declaran la semántica eléctrica exigida por el tipo de ensayo; no se infiere por nombre.'); continue;
		}
		if (proyecto.dispositivos.some(d => d.fisica?.transformador?.primarioTerminales)) {
			r.estado = 'NO_SOPORTADO'; r.motivos.push('El cálculo prospectivo de Thevenin no incorpora aún transformadores acoplados; no se publica una Icc parcial.'); continue;
		}
		const problemasRed = tecnica.problemas.filter(p => p.entidad === 'CONDUCTOR'
			|| p.entidad === 'DEVICE' && fuentesDatos.has(p.entidadId));
		const datosRed = tecnica.resoluciones.filter(d => d.estado !== 'RESOLVED'
			&& (d.campo.startsWith('fuente.') || d.campo.startsWith('conductor.')));
		if (problemasRed.length || datosRed.length) {
			r.estado = 'DATOS_RED'; r.motivos.push('Existen datos técnicos de red sin resolver; no se rescata el valor legacy.',
				...problemasRed.map(p => p.motivo), ...datosRed.flatMap(d => d.motivos)); continue;
		}
		const id = `prospectiva:${proteccionId}`;
		// Copia de contexto: los fallos operativos no se acumulan en este ensayo estático.
		const f = simularFisicaProyecto(proyecto, { ...contexto, fallas: [{ id, tipo: ensayo.tipo, nodoA, nodoB }] });
		const falla = f.fallas.find(x => x.id === id); r.falla = falla && structuredClone(falla);
		r.diagnosticos = structuredClone(f.diagnosticos);
		if (f.diagnosticos.some(d => /sin seccion o longitud fisica/i.test(d.mensaje))) {
			r.estado = 'DATOS_RED'; r.motivos.push('Hay conductores sin sección o longitud: sus resistencias de sustitución no validan una Icc.'); continue;
		}
		if (!falla?.iccA) {
			r.estado = f.diagnosticos.some(d => /impedancia interna|impedancia total/i.test(d.mensaje)) ? 'DATOS_RED' : 'TOPOLOGIA';
			r.motivos.push(...(falla?.diagnosticos.map(d => d.mensaje) ?? []));
			if (!r.motivos.length) r.motivos.push('La topología física no permite resolver la Icc del punto configurado.');
			continue;
		}
		if (!f.protecciones.get(proteccionId)?.fallas.includes(id) || !falla.vPrefallaV || magnitud(falla.vPrefallaV) <= 1e-6) {
			r.estado = 'TOPOLOGIA'; r.motivos.push('No existe camino energizado del punto a la fuente a través de esta protección en el contexto analizado.'); continue;
		}
		// El BFS legado elige un camino. Para afirmar que esta protección corta la falla,
		// además exigimos que no quede otro suministro al retirar sus polos del grafo.
		const vecinos = new Map<string, string[]>();
		for (const rama of f.medicion.ramas.values()) {
			if (rama.id === `falla:${id}` || rama.id.startsWith(`interno:${proteccionId}:`)) continue;
			vecinos.set(rama.de, [...(vecinos.get(rama.de) ?? []), rama.a]);
			vecinos.set(rama.a, [...(vecinos.get(rama.a) ?? []), rama.de]);
		}
		const fuentes = new Set(f.medicion.fuentes.map(x => x.de)), vistos = new Set([nodoA]), pendientes = [nodoA];
		let bypass = false;
		for (let i = 0; i < pendientes.length && !bypass; i++) {
			const nodo = pendientes[i]; if (fuentes.has(nodo)) { bypass = true; break; }
			for (const vecino of vecinos.get(nodo) ?? []) if (!vistos.has(vecino)) { vistos.add(vecino); pendientes.push(vecino); }
		}
		if (bypass) { r.estado = 'TOPOLOGIA'; r.motivos.push('El punto conserva un camino a una fuente que no atraviesa esta protección; no se le asigna toda la Icc.'); continue; }
		const iccA = magnitud(falla.iccA);
		if (!Number.isFinite(iccA) || iccA <= 0) { r.estado = 'DATOS_RED'; r.motivos.push('La corriente prospectiva no es finita y positiva.'); continue; }
		r.estado = 'RESUELTO'; r.iccA = iccA;
		const estimado = [...f.conductores.values()].some(c => c.origenLongitud !== 'CONFIGURADO' || c.origenReactancia === 'NO_MODELADO')
			|| [...f.contactos.values()].some(c => c.origen === 'ESTIMADO');
		r.origen = falla.origen === 'CALCULADO' && !estimado ? 'CALCULADO' : 'ESTIMADO';
		if (estimado) r.limitaciones.push('Hay longitudes/contactos estimados o reactancia no modelada; el resultado conserva categoría estimada.');
	}
	return salida;
}
