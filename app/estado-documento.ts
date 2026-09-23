/** Texto de estado del documento. La revisión indicada es la última confirmada, nunca una promesa de guardado. */
export type FaseGuardado = 'guardando' | 'guardado' | 'sucio' | 'fallo';

export interface EstadoDocumentoVisible {
	nombre: string;
	id?: string;
	revision?: number;
	ejemplo: boolean;
	recuperacion: boolean;
	fase: FaseGuardado;
	motivo?: string;
	puedeReintentar: boolean;
}

export interface PresentacionDocumento {
	chip: string;
	detalle: string;
	aviso?: string;
	accion?: 'reintentar' | 'recuperar';
	tono: 'normal' | 'pendiente' | 'error';
}

export function presentarEstadoDocumento(estado: EstadoDocumentoVisible): PresentacionDocumento {
	const nombre = estado.nombre.trim() || 'Tablero sin nombre';
	const revision = Number.isInteger(estado.revision) && (estado.revision ?? 0) > 0
		? `r${estado.revision}` : undefined;
	const identidad = [nombre, estado.id ? `ID ${estado.id}` : undefined, revision ? `revisión local ${revision}` : undefined]
		.filter(Boolean).join(' · ');
	const prefijo = revision ? `${revision} · ` : '';
	if (estado.ejemplo) {
		return { chip: 'Ejemplo · solo lectura', detalle: `${nombre} · ejemplo de solo lectura; no se guarda sobre tus tableros.`, tono: 'normal' };
	}
	if (estado.recuperacion) {
		return {
			chip: `${prefijo}Recuperación`, tono: 'error', accion: estado.puedeReintentar ? 'recuperar' : undefined,
			detalle: `${identidad}. El documento requiere recuperación; no se guardarán cambios nuevos.`,
			aviso: estado.puedeReintentar
				? `«${nombre}» requiere recuperación. Abre Mis tableros y restaura una versión válida antes de continuar.`
				: `«${nombre}» tiene un autoguardado antiguo ilegible. Resuelve el diálogo de recuperación antes de continuar; la copia original no se ha sobrescrito.`,
		};
	}
	if (estado.fase === 'fallo') {
		const motivo = estado.motivo ? ` Causa: ${estado.motivo}.` : '';
		return {
			chip: `${prefijo}Sin guardar`, tono: 'error',
			accion: estado.puedeReintentar ? 'reintentar' : undefined,
			detalle: `${identidad}. Falló el guardado de los últimos cambios.${motivo}`,
			aviso: estado.puedeReintentar
				? `No se guardaron los últimos cambios de «${nombre}».${motivo} Reintenta antes de cerrar esta pestaña.`
				: `No se guardaron los últimos cambios de «${nombre}».${motivo} Descarga una copia con Archivo → Guardar antes de cerrar.`,
		};
	}
	if (estado.fase === 'guardando') {
		return {
			chip: `${prefijo}Guardando…`, tono: 'pendiente',
			detalle: `${identidad}. Hay cambios pendientes de confirmación; no cierres esta pestaña todavía.`,
		};
	}
	if (estado.fase === 'sucio') {
		return {
			chip: `${prefijo}Cambios pendientes`, tono: 'pendiente',
			detalle: `${identidad}. Los cambios aún no tienen una revisión local confirmada.`,
		};
	}
	return {
		chip: `${prefijo}Guardado local`, tono: 'normal',
		detalle: `${identidad}. El documento está guardado en este navegador. Exportar crea una copia portátil aparte.`,
	};
}
