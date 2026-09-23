import type { ResumenProyecto } from '../src/persistencia/tipos.js';

const normalizarBusqueda = (texto: string): string => texto.normalize('NFD')
	.replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();

/** Consulta local sobre los metadatos del sobre; no abre ni altera los proyectos. */
export function filtrarTableros<T extends Pick<ResumenProyecto, 'id' | 'nombre' | 'revision'>>(
	documentos: readonly T[], consulta: string,
): T[] {
	const palabras = normalizarBusqueda(consulta).split(/\s+/).filter(Boolean);
	if (!palabras.length) return [...documentos];
	return documentos.filter((d) => {
		const campos = [d.nombre, d.id, `revision ${d.revision}`, `r${d.revision}`]
			.map(normalizarBusqueda);
		return palabras.every((palabra) => campos.some((campo) => campo.includes(palabra)));
	});
}
