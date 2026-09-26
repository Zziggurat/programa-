import type { Dispositivo, EntradaCable, Proyecto } from './tipos.js';

/** Aparatos sin colocación física sobre la placa o la puerta. */
export function aparatosDeCampo(proyecto: Proyecto): Dispositivo[] {
	const colocados = new Set(proyecto.gabinete?.colocaciones.map((c) => c.dispositivoId) ?? []);
	return proyecto.dispositivos.filter((d) => !colocados.has(d.id));
}

/** Regleta de entradas bajo la placa, en milímetros de modelo. */
export function yEntradasCampo(proyecto: Proyecto): number {
	return (proyecto.gabinete?.alto ?? 0) + 26;
}

/** Entrada declarada que le corresponde al aparato; varias piezas pueden compartirla. */
export function entradaDeCampo(proyecto: Proyecto, dispositivoId: string): EntradaCable | undefined {
	const abajo = (proyecto.gabinete?.entradas ?? []).filter((e) => e.cara === 'inferior');
	if (!abajo.length) return undefined;
	const campo = aparatosDeCampo(proyecto);
	const i = campo.findIndex((d) => d.id === dispositivoId);
	if (i < 0) return undefined;
	return abajo[Math.min(i, abajo.length - 1)];
}

/** Centro del prensaestopas, declarado o repartido provisionalmente. */
export function xEntradaCampo(proyecto: Proyecto, dispositivoId: string): number | undefined {
	const declarada = entradaDeCampo(proyecto, dispositivoId);
	if (declarada) return Math.round(declarada.x);
	const campo = aparatosDeCampo(proyecto);
	const i = campo.findIndex((d) => d.id === dispositivoId);
	if (i < 0) return undefined;
	const ancho = proyecto.gabinete?.ancho ?? 0;
	return Math.round(((i + 1) * ancho) / (campo.length + 1));
}

/** El cable y la firma de dependencias usan exactamente la misma pose de terminal. */
export function anclajeCampo(
	proyecto: Proyecto, d: Dispositivo, borneId: string,
): { x: number; y: number; z: number } | undefined {
	const cx = xEntradaCampo(proyecto, d.id);
	if (cx === undefined) return undefined;
	const j = Math.max(0, d.bornes.findIndex((b) => b.id === borneId));
	const n = Math.max(1, d.bornes.length);
	return { x: Math.round(cx + (j - (n - 1) / 2) * 13), y: yEntradasCampo(proyecto), z: 30 };
}
