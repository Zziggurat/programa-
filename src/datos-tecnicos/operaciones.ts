import type { Proyecto } from '../modelo/tipos.js';
import { congelarSubconjunto, hashSnapshotTecnico, indexarRevisiones } from './hash.js';
import { DatosTecnicosInvalidos, validarConfiguracionTecnica } from './schema.js';
import { leerDatoLegacy, resolverProyectoTecnico } from './resolver.js';
import { referenciaTecnica, type ConfiguracionTecnicaProyecto, type ReferenciaTecnica, type RevisionTecnica, type VinculoTecnico } from './tipos.js';

export const configuracionTecnicaVacia = (): ConfiguracionTecnicaProyecto => ({ version: 1, revisiones: [], vinculos: [], instalaciones: [] });
export function referenciasDelProyecto(c: ConfiguracionTecnicaProyecto): ReferenciaTecnica[] {
	return [...c.vinculos.map(v => v.producto), ...c.instalaciones.map(i => i.tabla), ...(c.criterios ? [c.criterios] : []), ...Object.values(c.criteriosCircuito ?? {}).flatMap(x => x.perfil ? [x.perfil] : [])];
}
/** Frontera de adopción. El cargador tolera referencias rotas para rescate, esta operación no. */
export function validarAdopcionTecnica(p: Proyecto): void {
	const c = p.datosTecnicos; if (!c) return;
	validarConfiguracionTecnica(c); congelarSubconjunto(referenciasDelProyecto(c), c.revisiones);
	const ids = new Set(p.dispositivos.map(d => d.id)), cables = new Set(p.conductores.map(w => w.id));
	for (const v of c.vinculos) if (!(v.entidad === 'DEVICE' ? ids : cables).has(v.entidadId)) throw new DatosTecnicosInvalidos(`MISSING: entidad ${v.entidadId}`);
	for (const i of c.instalaciones) if (!cables.has(i.conductorId)) throw new DatosTecnicosInvalidos(`MISSING: conductor ${i.conductorId}`);
}
/** Cada operación devuelve un candidato; ninguna modifica BASE ni escribe almacenamiento. */
export function cambiarConfiguracionTecnica(base: Proyecto, cambiar: (c: ConfiguracionTecnicaProyecto) => void, disponibles: RevisionTecnica[] = []): Proyecto {
	if (base.esEjemplo) throw new DatosTecnicosInvalidos('Ejemplo de solo lectura. Hacer una copia para trabajar.');
	const p = structuredClone(base), c = p.datosTecnicos ?? configuracionTecnicaVacia();
	// Verificar el cierre que permanece referenciado permite rescatar una ficha rota
	// mediante Desvincular, sin imponer que todo el catálogo ajeno sea válido.
	const indice = indexarRevisiones([...c.revisiones, ...disponibles], false); cambiar(c);
	c.revisiones = congelarSubconjunto(referenciasDelProyecto(c), [...indice.values()]); p.datosTecnicos = c;
	validarAdopcionTecnica(p); return p;
}
export function vincularProductoTecnico(base: Proyecto, vinculo: VinculoTecnico, disponibles: RevisionTecnica[]): Proyecto {
	const p = cambiarConfiguracionTecnica(base, c => {
		const anterior = c.vinculos.find(v => v.entidad === vinculo.entidad && v.entidadId === vinculo.entidadId);
		c.vinculos = c.vinculos.filter(v => !(v.entidad === vinculo.entidad && v.entidadId === vinculo.entidadId));
		c.vinculos.push(structuredClone({ ...vinculo, decisiones: { ...anterior?.decisiones, ...vinculo.decisiones } }));
	}, disponibles);
	const resuelto = resolverProyectoTecnico(p); const problemas = resuelto.problemas.filter(x => x.entidadId === vinculo.entidadId);
	if (problemas.length) throw new DatosTecnicosInvalidos(problemas.map(x => x.motivo).join('; '));
	// Dato no aplicable puede conservarse como evidencia explícita; conflicto exige elección.
	const conflictos = resuelto.resoluciones.filter(d => d.entidadId === vinculo.entidadId && d.estado === 'CONFLICT');
	if (conflictos.length) throw new DatosTecnicosInvalidos(`CONFLICT: elegir Conservar o Catálogo para ${conflictos.map(d => d.clave).join(', ')}`);
	return p;
}
export function desvincularProductoTecnico(base: Proyecto, entidad: VinculoTecnico['entidad'], id: string): Proyecto {
	return cambiarConfiguracionTecnica(base, c => { c.vinculos = c.vinculos.filter(v => !(v.entidad === entidad && v.entidadId === id)); });
}
export interface PreviewTecnico {
	hashBase: string; hashCandidato: string; candidato: Proyecto;
	cambios: { entidad: string; campo: string; antes?: unknown; despues?: unknown; overridePreservado: boolean }[];
}
export function prepararPreviewTecnico(base: Proyecto, candidato: Proyecto): PreviewTecnico {
	validarAdopcionTecnica(candidato);
	const a = resolverProyectoTecnico(base), b = resolverProyectoTecnico(candidato);
	const claves = new Set([...a.resoluciones, ...b.resoluciones].map(x => `${x.entidad}:${x.entidadId}:${x.clave}`));
	const indice = (r: typeof a) => new Map(r.resoluciones.map(x => [`${x.entidad}:${x.entidadId}:${x.clave}`, x]));
	const ia = indice(a), ib = indice(b); const cambios: PreviewTecnico['cambios'] = [];
	for (const k of [...claves].sort()) {
		const antes = ia.get(k), despues = ib.get(k), dato = despues ?? antes!;
		const legacy = (p: Proyecto) => { const e = dato.entidad === 'DEVICE' ? p.dispositivos.find(d=>d.id===dato.entidadId) : p.conductores.find(c=>c.id===dato.entidadId); const d = e && leerDatoLegacy(e,dato.campo,dato.canal); return { estado:d?'RESOLVED':'MISSING',origen:'LEGACY',dato:d }; };
		cambios.push({ entidad: dato.entidadId, campo: dato.clave, antes: antes ?? legacy(base), despues: despues ?? legacy(candidato), overridePreservado: despues?.origen === 'OVERRIDE' || despues?.origen === 'CONSERVAR' });
	}
	return { hashBase: hashSnapshotTecnico(base), hashCandidato: hashSnapshotTecnico(candidato), candidato: structuredClone(candidato), cambios };
}
export function comprobarPreviewTecnico(base: Proyecto, preview: PreviewTecnico): void {
	if (hashSnapshotTecnico(base) !== preview.hashBase) throw new DatosTecnicosInvalidos('STALE_RESULT: BASE cambió. Calcular nuevamente la comparación.');
	if (hashSnapshotTecnico(preview.candidato) !== preview.hashCandidato) throw new DatosTecnicosInvalidos('STALE_RESULT: el candidato cambió después del preview.');
	validarAdopcionTecnica(preview.candidato);
}
export function listadoRevisionesProyecto(p: Proyecto): ReferenciaTecnica[] { return p.datosTecnicos?.revisiones.map(referenciaTecnica) ?? []; }
