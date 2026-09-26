/**
 * Ruta física M6: intención persistente, separada de la conexión eléctrica y de la malla.
 * Los extremos pertenecen al conductor y se resuelven desde sus bornes; duplicarlos aquí
 * permitiría que una ruta apuntase a otro aparato sin cambiar el circuito.
 *
 * V1 admite solamente polilíneas rectas en el marco fijo de la placa. Una ruta legacy XY
 * carece de profundidad inequívoca y NO se convierte automáticamente a este formato.
 */
export interface PuntoRutaFisica {
	id: string;
	x: number;
	y: number;
	z: number;
}

export interface RutaFisicaV1 {
	version: 1;
	modo: 'MANUAL';
	marco: 'PLACA';
	geometria: 'POLILINEA';
	/** Puntos interiores ordenados. Sus IDs sobreviven a inserciones y cambios de orden de arrays. */
	nodos: PuntoRutaFisica[];
}

export interface PuntoFisico3D { x: number; y: number; z: number }

/** El marco PLACA V1 no puede representar un extremo móvil de puerta ni uno de campo. */
export function admiteRutaEnPlaca(
	conductor: { de: { dispositivoId: string }; a: { dispositivoId: string } },
	colocaciones: readonly { dispositivoId: string; montaje?: 'placa' | 'puerta' }[],
	dispositivos: readonly { id: string; campo?: boolean }[] = [],
): boolean {
	return [conductor.de.dispositivoId, conductor.a.dispositivoId].every((id) =>
		!dispositivos.some((d) => d.id === id && d.campo)
		&& colocaciones.some((col) => col.dispositivoId === id && col.montaje !== 'puerta'));
}

/** Valida sin sanear: un saneo silencioso desplazaría la ruta que el usuario guardó. */
export function leerRutaFisicaV1(bruto: unknown): RutaFisicaV1 {
	if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) throw new Error('RUTA_M6_INVALIDA');
	const r = bruto as Record<string, unknown>;
	if (r.version !== 1 || r.modo !== 'MANUAL' || r.marco !== 'PLACA'
		|| r.geometria !== 'POLILINEA' || !Array.isArray(r.nodos) || r.nodos.length > 128
		|| Object.keys(r).some((k) => !['version', 'modo', 'marco', 'geometria', 'nodos'].includes(k))) {
		throw new Error('RUTA_M6_NO_SOPORTADA');
	}
	const vistos = new Set<string>();
	const nodos = r.nodos.map((brutoNodo) => {
		if (typeof brutoNodo !== 'object' || brutoNodo === null || Array.isArray(brutoNodo)) throw new Error('NODO_RUTA_M6_INVALIDO');
		const n = brutoNodo as Record<string, unknown>;
		if (typeof n.id !== 'string' || !n.id.trim() || n.id.length > 120 || vistos.has(n.id)
			|| /[\x00-\x1f\x7f]/.test(n.id)
			|| Object.keys(n).some((k) => !['id', 'x', 'y', 'z'].includes(k))
			|| ![n.x, n.y, n.z].every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 5000)) {
			throw new Error('NODO_RUTA_M6_INVALIDO');
		}
		vistos.add(n.id);
		return { id: n.id, x: n.x as number, y: n.y as number, z: n.z as number };
	});
	return { version: 1, modo: 'MANUAL', marco: 'PLACA', geometria: 'POLILINEA', nodos };
}

/** Solo el legacy XYZ explícito puede convertirse sin inventar la profundidad. */
export function rutaDesdeTrazadoLegacy(
	conductorId: string, trazado: readonly { x: number; y: number; z?: number }[] | undefined,
): RutaFisicaV1 | undefined {
	if (!trazado?.length || trazado.some((p) => p.z === undefined)) return undefined;
	try {
		return leerRutaFisicaV1({ version: 1, modo: 'MANUAL', marco: 'PLACA', geometria: 'POLILINEA',
			nodos: trazado.map((p, i) => ({ id: `${conductorId}:n${i + 1}`, x: p.x, y: p.y, z: p.z })) });
	} catch {
		return undefined;
	}
}

/** Largo de la referencia espacial, sin reserva, puntas, curvatura ni estimación de corte. */
export function longitudPolilineaMm(puntos: readonly PuntoFisico3D[]): number {
	if (puntos.some((p) => ![p.x, p.y, p.z].every(Number.isFinite))) throw new Error('RUTA_M6_NO_FINITA');
	let longitud = 0;
	for (let i = 1; i < puntos.length; i++) {
		const a = puntos[i - 1], b = puntos[i];
		longitud += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
	}
	return longitud;
}
