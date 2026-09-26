/**
 * Estado efímero de inspección del montaje. No pertenece a Proyecto: ocultar un cuerpo
 * no desconecta sus bornes, no cambia su posición y no debe entrar en autosave/BOM/DRC.
 */
export interface VistaMontaje {
	readonly ocultos: ReadonlySet<string>;
	readonly aislados?: ReadonlySet<string>;
}

export function vistaMontajeInicial(): VistaMontaje { return { ocultos: new Set() }; }

export function aparatoVisibleEnVista(vista: VistaMontaje, id: string): boolean {
	return !vista.ocultos.has(id) && (!vista.aislados || vista.aislados.has(id));
}

export function alternarOcultacion(vista: VistaMontaje, id: string): VistaMontaje {
	const ocultos = new Set(vista.ocultos);
	if (ocultos.has(id)) ocultos.delete(id);
	else ocultos.add(id);
	return { ocultos, aislados: vista.aislados };
}

/** Elegir una pieza en la lista/DRC la hace localizable aunque estuviera oculta. */
export function revelarAparato(vista: VistaMontaje, id: string): VistaMontaje {
	if (aparatoVisibleEnVista(vista, id)) return vista;
	const ocultos = new Set(vista.ocultos);
	ocultos.delete(id);
	return { ocultos, aislados: vista.aislados?.has(id) ? vista.aislados : undefined };
}

/** Aísla un conjunto explícito; pulsar de nuevo el mismo conjunto termina el aislamiento. */
export function alternarAislamiento(vista: VistaMontaje, ids: readonly string[]): VistaMontaje {
	const nuevos = new Set(ids);
	if (!nuevos.size) return vista;
	if (vista.aislados?.size === nuevos.size && [...nuevos].every(id => vista.aislados!.has(id)))
		return { ocultos: new Set(vista.ocultos) };
	const ocultos = new Set(vista.ocultos);
	for (const id of nuevos) ocultos.delete(id); // aislar una pieza oculta la recupera explícitamente
	return { ocultos, aislados: nuevos };
}

/** Sanea IDs tras Undo/Redo o eliminación, sin trasladar filtros a otro documento. */
export function depurarVistaMontaje(vista: VistaMontaje, ids: ReadonlySet<string>): VistaMontaje {
	const ocultos = new Set([...vista.ocultos].filter(id => ids.has(id)));
	const aislados = vista.aislados && new Set([...vista.aislados].filter(id => ids.has(id)));
	return { ocultos, aislados: aislados?.size ? aislados : undefined };
}
