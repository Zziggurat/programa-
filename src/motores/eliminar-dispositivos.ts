/**
 * ESQ-04: borrar una representación no equivale a borrar su aparato eléctrico.
 * Este plan enumera el alcance de la segunda operación antes de pedir confirmación.
 * No crea una red paralela ni interpreta nombres visibles como identidades.
 */
import type { Proyecto } from '../modelo/tipos.js';

const ordenar = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

export interface PlanEliminacionDispositivos {
	readonly ids: readonly string[];
	readonly aparatos: readonly { id: string; designacion: string; tipo: string }[];
	readonly conductores: readonly { id: string; de: string; a: string; rutaPendiente: boolean }[];
	readonly representaciones: readonly { id: string; dispositivoId: string; hojaId: string }[];
	/** Incluye las hojas de las contrapartes de las conexiones que desaparecerán. */
	readonly hojasAfectadas: readonly { id: string; numero: number; titulo: string }[];
	readonly colocaciones: readonly { dispositivoId: string; montaje: 'placa' | 'puerta' }[];
	readonly vinculosTecnicos: readonly { entidad: 'DEVICE' | 'CONDUCTOR'; entidadId: string }[];
	readonly instalacionesTecnicas: readonly { conductorId: string }[];
	readonly prospectivasTecnicas: readonly { indice: number; proteccionId: string }[];
	/** Un contacto que permanece no puede seguir apuntando al maestro borrado. */
	readonly rolesDependientes: readonly { dispositivoId: string; maestroId: string }[];
	readonly metadatosCircuitoAfectados: readonly { circuitoId: string; conductoresReasignables: readonly string[] }[];
	/** Historial V9 conservado deliberadamente: no es una instrucción activa ni una revisión técnica. */
	readonly decisionesHistoricasAfectadas: readonly string[];
}

type OrigenPlan = { proyecto: Proyecto; firma: string; ids: readonly string[] };
const origenes = new WeakMap<PlanEliminacionDispositivos, OrigenPlan>();

/** Puro: incluso una cancelación después de mostrar el plan deja el Proyecto idéntico. */
export function planificarEliminacionDispositivos(
	proyecto: Proyecto, idsSolicitados: readonly string[],
): PlanEliminacionDispositivos {
	const ids = [...new Set(idsSolicitados)].sort(ordenar);
	if (!ids.length) throw new Error('Selecciona al menos un aparato para eliminar.');
	const porId = new Map(proyecto.dispositivos.map((d) => [d.id, d]));
	if (porId.size !== proyecto.dispositivos.length
		|| new Set(proyecto.conductores.map((c) => c.id)).size !== proyecto.conductores.length) {
		throw new Error('Hay IDs de aparatos o conductores repetidos; revisa el proyecto antes de eliminar.');
	}
	for (const id of ids) if (!porId.has(id)) throw new Error(`El aparato ${id} ya no existe.`);
	const fuera = new Set(ids);
	const cables = proyecto.conductores.filter((c) => fuera.has(c.de.dispositivoId) || fuera.has(c.a.dispositivoId));
	const cablesFuera = new Set(cables.map((c) => c.id));
	const relacionados = new Set(ids);
	for (const c of cables) { relacionados.add(c.de.dispositivoId); relacionados.add(c.a.dispositivoId); }
	const vistas = proyecto.esquema?.representaciones ?? [];
	const hojasIds = new Set(vistas.filter((r) => relacionados.has(r.dispositivoId)).map((r) => r.hojaId));
	for (const d of proyecto.dispositivos) if (relacionados.has(d.id) && d.hojaId) hojasIds.add(d.hojaId);
	const tecnica = proyecto.datosTecnicos;
	const plan: PlanEliminacionDispositivos = {
		ids,
		aparatos: ids.map((id) => {
			const d = porId.get(id)!;
			return { id, designacion: d.designacion ?? id, tipo: d.tipo };
		}),
		conductores: cables.map((c) => ({ id: c.id,
			de: `${c.de.dispositivoId}::${c.de.borneId}`,
			a: `${c.a.dispositivoId}::${c.a.borneId}`,
			rutaPendiente: c.estadoRutaFisica === 'pendiente' }))
			.sort((a, b) => ordenar(a.id, b.id)),
		representaciones: vistas.filter((r) => fuera.has(r.dispositivoId))
			.map((r) => ({ id: r.id, dispositivoId: r.dispositivoId, hojaId: r.hojaId }))
			.sort((a, b) => ordenar(a.id, b.id)),
		hojasAfectadas: proyecto.hojas.filter((h) => hojasIds.has(h.id))
			.map((h) => ({ id: h.id, numero: h.numero, titulo: h.titulo }))
			.sort((a, b) => a.numero - b.numero || ordenar(a.id, b.id)),
		colocaciones: (proyecto.gabinete?.colocaciones ?? []).filter((c) => fuera.has(c.dispositivoId))
			.map((c) => ({ dispositivoId: c.dispositivoId, montaje: c.montaje ?? 'placa' }))
			.sort((a, b) => ordenar(a.dispositivoId, b.dispositivoId)),
		vinculosTecnicos: (tecnica?.vinculos ?? []).filter((v) => v.entidad === 'DEVICE'
			? fuera.has(v.entidadId) : cablesFuera.has(v.entidadId))
			.map((v) => ({ entidad: v.entidad, entidadId: v.entidadId }))
			.sort((a, b) => ordenar(`${a.entidad}:${a.entidadId}`, `${b.entidad}:${b.entidadId}`)),
		instalacionesTecnicas: (tecnica?.instalaciones ?? []).filter((i) => cablesFuera.has(i.conductorId))
			.map((i) => ({ conductorId: i.conductorId }))
			.sort((a, b) => ordenar(a.conductorId, b.conductorId)),
		prospectivasTecnicas: (tecnica?.prospectiva ?? []).flatMap((p, indice) =>
			fuera.has(p.proteccionId) || fuera.has(p.de.dispositivoId) || fuera.has(p.a.dispositivoId)
				? [{ indice, proteccionId: p.proteccionId }] : []),
		rolesDependientes: proyecto.dispositivos.flatMap((d) => {
			const rol = d.rol;
			return !fuera.has(d.id) && rol?.tipo === 'esclavo' && fuera.has(rol.maestroId)
				? [{ dispositivoId: d.id, maestroId: rol.maestroId }] : [];
		}).sort((a, b) => ordenar(a.dispositivoId, b.dispositivoId)),
		metadatosCircuitoAfectados: Object.entries(proyecto.ingenieria?.circuitos ?? {})
			.flatMap(([circuitoId, meta]) => {
				const afectados = (meta.conductoresReasignablesFase ?? []).filter((id) => cablesFuera.has(id));
				return afectados.length ? [{ circuitoId, conductoresReasignables: afectados.sort(ordenar) }] : [];
			}).sort((a, b) => ordenar(a.circuitoId, b.circuitoId)),
		decisionesHistoricasAfectadas: (proyecto.ingenieria?.disenoAsistido?.decisiones ?? [])
			.filter((d) => d.cambios.some((c) => c.tipo === 'PROTECCION'
				? fuera.has(c.dispositivoId) : cablesFuera.has(c.conductorId)))
			.map((d) => d.id).sort(ordenar),
	};
	origenes.set(plan, { proyecto, firma: JSON.stringify(proyecto), ids });
	return plan;
}

/**
 * Aplica un plan confirmado solamente al documento exacto y sin cambios posteriores.
 * Los datos dependientes se preparan antes de publicar cualquiera de las colecciones.
 */
export function aplicarEliminacionDispositivos(proyecto: Proyecto, plan: PlanEliminacionDispositivos): void {
	const origen = origenes.get(plan);
	if (!origen || origen.proyecto !== proyecto || origen.firma !== JSON.stringify(proyecto)) {
		throw new Error('El proyecto cambió durante la confirmación. Revisa de nuevo el alcance de la eliminación.');
	}
	if (proyecto.esEjemplo) throw new Error('Un ejemplo es de solo lectura. Crea una copia antes de eliminar.');
	const fuera = new Set(origen.ids);
	// El preview es dato para mostrar, no una autoridad mutable para decidir qué borrar.
	const cablesFuera = new Set(proyecto.conductores.filter((c) => fuera.has(c.de.dispositivoId)
		|| fuera.has(c.a.dispositivoId)).map((c) => c.id));
	const dispositivos = proyecto.dispositivos.filter((d) => !fuera.has(d.id)).map((d) => {
		if (d.rol?.tipo !== 'esclavo' || !fuera.has(d.rol.maestroId)) return d;
		const copia = { ...d };
		delete copia.rol;
		return copia;
	});
	const conductores = proyecto.conductores.filter((c) => !cablesFuera.has(c.id));
	const gabinete = proyecto.gabinete ? { ...proyecto.gabinete,
		colocaciones: proyecto.gabinete.colocaciones.filter((c) => !fuera.has(c.dispositivoId)) } : undefined;
	const esquema = proyecto.esquema?.representaciones === undefined ? proyecto.esquema
		: { ...proyecto.esquema,
			representaciones: proyecto.esquema.representaciones.filter((r) => !fuera.has(r.dispositivoId)) };
	const datosTecnicos = proyecto.datosTecnicos ? { ...proyecto.datosTecnicos,
		vinculos: proyecto.datosTecnicos.vinculos.filter((v) => v.entidad === 'DEVICE'
			? !fuera.has(v.entidadId) : !cablesFuera.has(v.entidadId)),
		instalaciones: proyecto.datosTecnicos.instalaciones.filter((i) => !cablesFuera.has(i.conductorId)),
		prospectiva: proyecto.datosTecnicos.prospectiva?.filter((p) => !fuera.has(p.proteccionId)
			&& !fuera.has(p.de.dispositivoId) && !fuera.has(p.a.dispositivoId)) } : undefined;
	let ingenieria = proyecto.ingenieria;
	if (ingenieria?.circuitos && Object.values(ingenieria.circuitos).some((meta) =>
		meta.conductoresReasignablesFase?.some((id) => cablesFuera.has(id)))) {
		const circuitos = Object.fromEntries(Object.entries(ingenieria.circuitos).map(([id, meta]) => {
			if (!meta.conductoresReasignablesFase?.some((c) => cablesFuera.has(c))) return [id, meta];
			const restantes = meta.conductoresReasignablesFase.filter((c) => !cablesFuera.has(c));
			const copia = { ...meta };
			if (restantes.length) copia.conductoresReasignablesFase = restantes;
			else delete copia.conductoresReasignablesFase;
			return [id, copia];
		}));
		ingenieria = { ...ingenieria, circuitos };
	}
	proyecto.dispositivos = dispositivos;
	proyecto.conductores = conductores;
	if (gabinete) proyecto.gabinete = gabinete;
	if (esquema) proyecto.esquema = esquema;
	if (datosTecnicos) proyecto.datosTecnicos = datosTecnicos;
	if (ingenieria) proyecto.ingenieria = ingenieria;
}
