import { resolverComportamiento } from './comportamiento.js';
import type { Dispositivo } from './tipos.js';

/** Apariencia rasterizada, ya resuelta a data URL o pendiente de resolverse desde `assetId`. */
export function tieneAparienciaDeImagen(d: Pick<Dispositivo, 'imagen' | 'assetId'>): boolean {
	return !!(d.imagen || d.assetId);
}

/**
 * Una foto antigua sin contrato eléctrico es una referencia y debe permanecer inerte. Una imagen
 * con perfil confirmado es un aparato: participa en esquema, DRC, térmica y simulación igual que
 * su equivalente nativo. Centralizar esta decisión evita volver a usar `imagen` como tipo lógico.
 */
export function esReferenciaVisualInerte(d: Dispositivo): boolean {
	if (!tieneAparienciaDeImagen(d)) return false;
	const comportamiento = resolverComportamiento(d);
	return !comportamiento || comportamiento.clase === 'sin-comportamiento';
}
