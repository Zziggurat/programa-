/**
 * Geometría asignada por el repartidor, no intención manual ni metraje eléctrico adoptado.
 *
 * Las coordenadas se guardan como series planas para no repetir tres claves JSON por
 * muestra. Esto conserva exactamente los Number del ruteo, sin cuantización encubierta.
 * La validez frente a aparatos, canaletas y bornes se comprueba aparte; leer esta forma
 * no concede por sí mismo permiso para dibujarla en otro estado del tablero.
 */
export interface PlanRutaAutomaticaV1 {
	version: 1;
	modo: 'AUTO_ASIGNADO';
	marco: 'PLACA';
	de: [number, number, number];
	a: [number, number, number];
	/** Radio usado al distribuir la ruta; cambiar sección exige revisión. */
	radio: number;
	/** Huellas físicas próximas y dimensiones del gabinete al aceptar el plan. */
	entorno: string;
	/** Identidad y propiedades geométricas del conductor al aceptar el plan. */
	fuente: string;
	nodosXY: number[];
	puntosXYZ: number[];
}

export interface PuntoPlan3D { x: number; y: number; z: number }

/** Referencia espacial del plan aceptado; no incluye reservas, terminales ni corte. */
export function longitudPlanRutaAutomaticaMm(plan: PlanRutaAutomaticaV1): number {
	let total = 0;
	for (let i = 3; i < plan.puntosXYZ.length; i += 3) {
		total += Math.hypot(plan.puntosXYZ[i] - plan.puntosXYZ[i - 3],
			plan.puntosXYZ[i + 1] - plan.puntosXYZ[i - 2],
			plan.puntosXYZ[i + 2] - plan.puntosXYZ[i - 1]);
	}
	return total;
}
export interface RutaParaPlan {
	de: PuntoPlan3D;
	a: PuntoPlan3D;
	nodos: readonly { x: number; y: number }[];
	puntos: readonly PuntoPlan3D[];
	radio: number;
	geometria?: string;
}

/** Un archivo malicioso no debe crear millones de vértices al abrir un solo cable. */
export const MAX_PUNTOS_PLAN_AUTO = 8192;
export const MAX_NODOS_PLAN_AUTO = 4096;
const MAX_COORDENADA_MM = 5000;

function serieNumerica(v: unknown, dimension: number, minimo: number, maximo: number): number[] {
	if (!Array.isArray(v) || v.length % dimension !== 0
		|| v.length < dimension * minimo || v.length > dimension * maximo
		|| !v.every((n) => typeof n === 'number' && Number.isFinite(n)
			&& Math.abs(n) <= MAX_COORDENADA_MM)) throw new Error('PLAN_AUTO_COORDENADAS_INVALIDAS');
	return [...v] as number[];
}

/** Rechaza un plan desconocido o truncado; nunca se lo sustituye por autorouting. */
export function leerPlanRutaAutomaticaV1(bruto: unknown): PlanRutaAutomaticaV1 {
	if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) throw new Error('PLAN_AUTO_INVALIDO');
	const r = bruto as Record<string, unknown>;
	if (r.version !== 1 || r.modo !== 'AUTO_ASIGNADO' || r.marco !== 'PLACA'
		|| Object.keys(r).some((k) => !['version', 'modo', 'marco', 'de', 'a', 'radio', 'entorno', 'fuente', 'nodosXY', 'puntosXYZ'].includes(k))) {
		throw new Error('PLAN_AUTO_NO_SOPORTADO');
	}
	if (typeof r.radio !== 'number' || !Number.isFinite(r.radio) || r.radio <= 0 || r.radio > 100
		|| typeof r.entorno !== 'string' || r.entorno.length === 0 || r.entorno.length > 100_000
		|| typeof r.fuente !== 'string' || r.fuente.length === 0 || r.fuente.length > 2000) {
		throw new Error('PLAN_AUTO_CONTEXTO_INVALIDO');
	}
	const de = serieNumerica(r.de, 3, 1, 1) as [number, number, number];
	const a = serieNumerica(r.a, 3, 1, 1) as [number, number, number];
	const nodosXY = serieNumerica(r.nodosXY, 2, 2, MAX_NODOS_PLAN_AUTO);
	const puntosXYZ = serieNumerica(r.puntosXYZ, 3, 2, MAX_PUNTOS_PLAN_AUTO);
	if (de.some((v, i) => v !== puntosXYZ[i])
		|| a.some((v, i) => v !== puntosXYZ[puntosXYZ.length - 3 + i])) {
		throw new Error('PLAN_AUTO_EXTREMOS_INCONSISTENTES');
	}
	return { version: 1, modo: 'AUTO_ASIGNADO', marco: 'PLACA', de, a,
		radio: r.radio, entorno: r.entorno, fuente: r.fuente, nodosXY, puntosXYZ };
}

/** Solo los datos del conductor que pueden alterar su asignación física. */
export function firmaFuentePlanRuta(c: { id: string; de: { dispositivoId: string; borneId: string };
	a: { dispositivoId: string; borneId: string }; seccion?: number; clase?: string },
): string {
	// El abanico de un borne no es propietario del plan ya aceptado. Un conductor nuevo
	// debe elegir sitio alrededor de los existentes, no forzarlos todos a revisión.
	return JSON.stringify([c.id, c.de, c.a, c.seccion, c.clase]);
}

export function planDesdeRutaAutomatica(
	ruta: RutaParaPlan, entorno: string, fuente: string,
): PlanRutaAutomaticaV1 {
	if (ruta.geometria) throw new Error('PLAN_AUTO_NO_ACEPTA_RUTA_MANUAL');
	return leerPlanRutaAutomaticaV1({ version: 1, modo: 'AUTO_ASIGNADO', marco: 'PLACA',
		de: [ruta.de.x, ruta.de.y, ruta.de.z], a: [ruta.a.x, ruta.a.y, ruta.a.z],
		radio: ruta.radio, entorno, fuente,
		nodosXY: ruta.nodos.flatMap((p) => [p.x, p.y]),
		puntosXYZ: ruta.puntos.flatMap((p) => [p.x, p.y, p.z]),
	});
}

export function geometriaDelPlanRuta(plan: PlanRutaAutomaticaV1): {
	de: PuntoPlan3D; a: PuntoPlan3D; nodos: { x: number; y: number }[]; puntos: PuntoPlan3D[];
} {
	const nodos: { x: number; y: number }[] = [];
	const puntos: PuntoPlan3D[] = [];
	for (let i = 0; i < plan.nodosXY.length; i += 2) {
		nodos.push({ x: plan.nodosXY[i], y: plan.nodosXY[i + 1] });
	}
	for (let i = 0; i < plan.puntosXYZ.length; i += 3) {
		puntos.push({ x: plan.puntosXYZ[i], y: plan.puntosXYZ[i + 1], z: plan.puntosXYZ[i + 2] });
	}
	return { de: { x: plan.de[0], y: plan.de[1], z: plan.de[2] },
		a: { x: plan.a[0], y: plan.a[1], z: plan.a[2] }, nodos, puntos };
}
