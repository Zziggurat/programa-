/** Identidad del documento emitido, distinta de la revisión editorial del cajetín. */
export type ProcedenciaDocumento = {
	estado: 'confirmado';
	projectId: string;
	revisionRepositorio: number;
	buildId: string;
	generadoEn: string;
} | {
	estado: 'efimero';
	motivo: 'ejemplo' | 'sin-repositorio';
	buildId: string;
	generadoEn: string;
};

/** El archivo que se descarga debe ser el mismo Blob que ya se enseñó en el visor. */
export interface VistaPreviaDocumento {
	firma: string;
	blob: Blob;
	nombre: string;
	procedencia: ProcedenciaDocumento;
}

/** La misma geometría no basta: el documento activo o su revisión también pueden cambiar. */
export function vistaPreviaVigente(vista: VistaPreviaDocumento | undefined,
	firmaActual: string, procedenciaActual: ProcedenciaDocumento): VistaPreviaDocumento | undefined {
	if (!vista || vista.firma !== firmaActual
		|| vista.procedencia.estado !== procedenciaActual.estado
		|| vista.procedencia.buildId !== procedenciaActual.buildId) return undefined;
	if (vista.procedencia.estado === 'confirmado' && procedenciaActual.estado === 'confirmado') {
		return vista.procedencia.projectId === procedenciaActual.projectId
			&& vista.procedencia.revisionRepositorio === procedenciaActual.revisionRepositorio
			? vista : undefined;
	}
	return vista.procedencia.estado === 'efimero' && procedenciaActual.estado === 'efimero'
		&& vista.procedencia.motivo === procedenciaActual.motivo ? vista : undefined;
}

/** Etiquetas comunes; no convierte una revisión editorial en revisión guardada. */
export function resumenProcedenciaDocumento(procedencia?: ProcedenciaDocumento): {
	estado: string;
	projectId: string;
	revisionRepositorio: string;
	buildId: string;
	generadoEn: string;
} {
	if (!procedencia) return {
		estado: 'Sin procedencia confirmada', projectId: 'No disponible',
		revisionRepositorio: 'No disponible', buildId: 'No disponible', generadoEn: 'No disponible',
	};
	if (procedencia.estado === 'efimero') return {
		estado: procedencia.motivo === 'ejemplo' ? 'Ejemplo efímero' : 'Documento efímero sin repositorio',
		projectId: 'No asignado', revisionRepositorio: 'No asignada',
		buildId: procedencia.buildId, generadoEn: procedencia.generadoEn,
	};
	return {
		estado: 'Revisión confirmada', projectId: procedencia.projectId,
		revisionRepositorio: String(procedencia.revisionRepositorio),
		buildId: procedencia.buildId, generadoEn: procedencia.generadoEn,
	};
}
