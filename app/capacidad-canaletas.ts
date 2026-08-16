/**
 * ¿ESTA CANALETA ESTÁ LLENA, O ES MI ROUTER EL QUE NO ENCUENTRA SITIO?
 *
 * Todo lo que se había medido hasta aquí decía cuántos cables ENTRARON. Eso no distingue las dos
 * respuestas que importan: un ducto lleno de verdad y un ducto medio vacío al que el repartidor no
 * supo meter nada más se cuentan igual. Y la diferencia manda: en el primer caso la canaleta del
 * ejemplo está mal dimensionada y hay que cambiarla; en el segundo hay que arreglar el reparto.
 *
 * Este módulo mide la FÍSICA, no la discretización. No sabe nada de carriles ni de la rejilla que
 * usa el router: coge la geometría final que se dibuja, corta la canaleta en rodajas a lo largo y
 * en cada rodaja mira qué hay dentro y qué hueco queda. Si en una rodaja cabe todavía un círculo
 * del diámetro del cable más gordo del tablero, esa canaleta NO está llena, por muchos carriles
 * que el router crea tener ocupados.
 *
 * Y separa dos cosas que se confundían:
 *
 *   CAPACIDAD DE ALMACENAMIENTO   cuánta sección interior queda libre
 *   CAPACIDAD DE ENTRADA          cuánto ancho de ranura queda libre
 *
 * Un ducto puede ir medio vacío y aun así no admitir un cable más porque todos los que quieren
 * entrar lo hacen por la misma boca. Eso no es una canaleta llena: es una entrada congestionada, y
 * se arregla de otra manera.
 */
import { Canaleta } from '../src/modelo/tipos.js';
import { cruzDe, ejeDe, RANURA, RedCanaletas, Tramo } from './canaletas-red.js';

/** Un cable visto en una rodaja: dónde corta el plano y con qué radio. */
export interface CableEnRodaja {
	id: string;
	radio: number;
	/** Coordenada transversal y altura del eje del cable en esa rodaja. */
	cruz: number;
	z: number;
}

/** Una rodaja transversal del ducto, con lo que hay dentro y el hueco que queda. */
export interface Rodaja {
	eje: number;
	cables: CableEnRodaja[];
	/** Fracción de la sección interior ocupada por cobre y aislamiento. */
	ocupacion: number;
	/**
	 * Radio del mayor cable que todavía cabría aquí respetando la holgura. Es LA medida que
	 * distingue «lleno» de «mal repartido»: se busca por barrido fino, sin usar los carriles del
	 * router, así que un hueco entre dos posiciones discretas también cuenta.
	 */
	radioLibre: number;
}

/** Una boca de entrada: cuántos cables la usan y cuánto ancho queda. */
export interface Boca {
	eje: number;
	cables: string[];
	usado: number;
	libre: number;
}

export interface AuditoriaTramo {
	id: string;
	anchoInterior: number;
	altoInterior: number;
	/** mm² de sección interior útil. */
	seccion: number;
	/** Conductores distintos que viajan por dentro en algún tramo. */
	cables: string[];
	/** Cuántos hay de cada radio, para ver si el problema es de cables gordos. */
	porRadio: { radio: number; n: number }[];
	ocupacionMedia: number;
	ocupacionMaxima: number;
	/** Dónde se produce el máximo, en coordenada de eje. */
	dondeElMaximo: number;
	/** Menor hueco libre encontrado a lo largo del tramo, en radio. */
	radioLibreMinimo: number;
	rodajas: Rodaja[];
	bocas: Boca[];
	ranurasTotales: number;
	ranurasUsadas: number;
	ranurasSaturadas: number;
	/**
	 * Cables que NO entraron pero cuyos dos bornes caen a lo largo de este tramo: los que habrían
	 * querido usarlo. Es la demanda insatisfecha, y sin ella no se puede recomendar un tamaño.
	 */
	demandaFuera: string[];
	estado: 'libre' | 'moderada' | 'alta' | 'saturada';
	/** Por qué está así, en una frase, para que el aviso diga algo útil. */
	motivo: string;
}

/**
 * Aire entre dos cables dentro del ducto. Es el mismo criterio que usa el reparto: si aquí se
 * midiera con menos, la auditoría diría que cabe algo que luego se dibuja fundido.
 */
export const AIRE_INTERIOR = 1.2;
/** Cada cuántos milímetros se corta una rodaja. */
const PASO_RODAJA = 12;

/** El trozo de recorrido de un cable que corta el plano `eje` dentro del tramo. */
function cortaEn(
	t: Tramo, puntos: { x: number; y: number; z: number }[], eje: number,
): { cruz: number; z: number } | undefined {
	for (let i = 1; i < puntos.length; i++) {
		const a = puntos[i - 1];
		const b = puntos[i];
		const ea = ejeDe(t, a.x, a.y);
		const eb = ejeDe(t, b.x, b.y);
		if ((ea - eje) * (eb - eje) > 0) continue;   // los dos al mismo lado
		if (Math.abs(eb - ea) < 1e-9) continue;
		const u = (eje - ea) / (eb - ea);
		if (u < 0 || u > 1) continue;
		const cruz = cruzDe(t, a.x, a.y) + (cruzDe(t, b.x, b.y) - cruzDe(t, a.x, a.y)) * u;
		const z = a.z + (b.z - a.z) * u;
		// Solo cuenta si está DENTRO: un cable que pasa por delante del ducto no lo ocupa.
		if (Math.abs(cruz - t.centro) > t.semiancho) continue;
		if (z < t.zMin || z > t.zMax) continue;
		return { cruz, z };
	}
	return undefined;
}

/**
 * ¿Cabe todavía algo aquí? Barrido de un milímetro sobre la sección, buscando el mayor círculo
 * que no toque ni las paredes ni ningún cable. No es packing óptimo ni falta que hace: contesta la
 * única pregunta que se le pide, que es si queda hueco geométrico o no.
 */
function huecoLibre(t: Tramo, cables: CableEnRodaja[], radioMax: number): number {
	let mejor = 0;
	const c0 = t.centro - t.semiancho;
	const c1 = t.centro + t.semiancho;
	for (let cruz = c0; cruz <= c1; cruz += 1) {
		for (let z = t.zMin; z <= t.zMax; z += 1) {
			// Lo que da la pared: la distancia al borde más cercano.
			let cabe = Math.min(cruz - c0, c1 - cruz, z - t.zMin, t.zMax - z);
			if (cabe <= mejor) continue;
			for (const q of cables) {
				const d = Math.hypot(cruz - q.cruz, z - q.z) - q.radio - AIRE_INTERIOR;
				if (d < cabe) cabe = d;
				if (cabe <= mejor) break;
			}
			if (cabe > mejor) mejor = Math.min(cabe, radioMax);
		}
	}
	return Math.max(0, mejor);
}

/** Audita un tramo con la geometría final de los cables que hay en el tablero. */
export function auditarTramo(
	t: Tramo,
	trazos: { id: string; radio: number; puntos: { x: number; y: number; z: number }[] }[],
	radioMax: number,
	demandaFuera: string[] = [],
): AuditoriaTramo {
	const anchoInterior = t.semiancho * 2;
	const altoInterior = t.zMax - t.zMin;
	const seccion = anchoInterior * altoInterior;

	const rodajas: Rodaja[] = [];
	const dentro = new Set<string>();
	const radios = new Map<string, number>();
	for (let eje = t.desde + PASO_RODAJA / 2; eje < t.hasta; eje += PASO_RODAJA) {
		const cables: CableEnRodaja[] = [];
		for (const tr of trazos) {
			const q = cortaEn(t, tr.puntos, eje);
			if (!q) continue;
			cables.push({ id: tr.id, radio: tr.radio, cruz: q.cruz, z: q.z });
			dentro.add(tr.id);
			radios.set(tr.id, tr.radio);
		}
		let area = 0;
		for (const q of cables) area += Math.PI * q.radio * q.radio;
		rodajas.push({
			eje, cables,
			ocupacion: area / seccion,
			radioLibre: huecoLibre(t, cables, radioMax),
		});
	}

	let ocupacionMedia = 0;
	let ocupacionMaxima = 0;
	let dondeElMaximo = t.desde;
	let radioLibreMinimo = Infinity;
	for (const r of rodajas) {
		ocupacionMedia += r.ocupacion / Math.max(1, rodajas.length);
		if (r.ocupacion > ocupacionMaxima) { ocupacionMaxima = r.ocupacion; dondeElMaximo = r.eje; }
		if (r.cables.length && r.radioLibre < radioLibreMinimo) radioLibreMinimo = r.radioLibre;
	}
	if (radioLibreMinimo === Infinity) radioLibreMinimo = radioMax;

	/*
	 * LAS BOCAS. Un cable entra por una ranura cruzando la pared, así que se le busca el punto en
	 * que su recorrido atraviesa el plano de la cara interior y se mira a qué ranura cae.
	 */
	const bocas = new Map<number, Boca>();
	for (const ranura of t.ranuras) bocas.set(ranura, { eje: ranura, cables: [], usado: 0, libre: RANURA });
	for (const tr of trazos) {
		for (let i = 1; i < tr.puntos.length; i++) {
			const a = tr.puntos[i - 1];
			const b = tr.puntos[i];
			for (const lado of [-1, 1]) {
				const pared = t.centro + lado * t.semiancho;
				const ca = cruzDe(t, a.x, a.y) - pared;
				const cb = cruzDe(t, b.x, b.y) - pared;
				if (ca * cb > 0 || Math.abs(cb - ca) < 1e-9) continue;
				const u = -ca / (cb - ca);
				const eje = ejeDe(t, a.x, a.y) + (ejeDe(t, b.x, b.y) - ejeDe(t, a.x, a.y)) * u;
				const z = a.z + (b.z - a.z) * u;
				if (eje < t.desde || eje > t.hasta || z < t.zMin || z > t.zMax) continue;
				let cerca: Boca | undefined;
				let dist = Infinity;
				for (const boca of bocas.values()) {
					const d = Math.abs(boca.eje - eje);
					if (d < dist) { dist = d; cerca = boca; }
				}
				if (!cerca || dist > RANURA) continue;
				if (cerca.cables.includes(tr.id)) continue;
				cerca.cables.push(tr.id);
				cerca.usado += tr.radio * 2;
				cerca.libre = RANURA - cerca.usado;
			}
		}
	}
	const listaBocas = [...bocas.values()].sort((p, q) => p.eje - q.eje);
	const usadas = listaBocas.filter((b) => b.cables.length > 0);
	// Saturada: ya no admite ni el cable más fino que hay en el tablero.
	const masFino = Math.min(...trazos.map((q) => q.radio), radioMax);
	const saturadas = usadas.filter((b) => b.libre < masFino * 2);

	/*
	 * EL VEREDICTO. Se decide por lo que de verdad limita, no por un porcentaje suelto:
	 *
	 *   — si todavía cabe un cable gordo en la sección más apretada, hay sitio;
	 *   — si no cabe pero las bocas están libres, la que está llena es la canaleta;
	 *   — si cabe dentro pero no queda ninguna boca, la entrada es el cuello de botella.
	 */
	const cabeDentro = radioLibreMinimo >= radioMax;
	const cabeAlgoDentro = radioLibreMinimo >= masFino;
	const bocasLibres = listaBocas.length - saturadas.length;
	let estado: AuditoriaTramo['estado'];
	let motivo: string;
	if (!cabeAlgoDentro) {
		estado = 'saturada';
		motivo = `no cabe ningún cable más en el eje ${Math.round(dondeElMaximo)}`;
	} else if (!cabeDentro) {
		estado = 'alta';
		motivo = `solo caben cables de hasta ${(radioLibreMinimo * 2).toFixed(1)} mm de diámetro`;
	} else if (bocasLibres === 0) {
		estado = 'saturada';
		motivo = 'queda sección interior, pero no queda ninguna ranura libre por donde entrar';
	} else if (bocasLibres < listaBocas.length * 0.25) {
		estado = 'alta';
		motivo = `quedan ${bocasLibres} ranuras libres de ${listaBocas.length}`;
	} else if (ocupacionMaxima > 0.25 || usadas.length > listaBocas.length * 0.4) {
		estado = 'moderada';
		motivo = `${(ocupacionMaxima * 100).toFixed(0)} % de sección en el punto más cargado`;
	} else {
		estado = 'libre';
		motivo = 'con sitio de sobra';
	}

	const porRadio = new Map<number, number>();
	for (const id of dentro) {
		const r = Math.round((radios.get(id) ?? 0) * 100) / 100;
		porRadio.set(r, (porRadio.get(r) ?? 0) + 1);
	}

	return {
		id: t.id, anchoInterior, altoInterior, seccion,
		cables: [...dentro],
		porRadio: [...porRadio].map(([radio, n]) => ({ radio, n })).sort((p, q) => q.radio - p.radio),
		ocupacionMedia, ocupacionMaxima, dondeElMaximo, radioLibreMinimo, rodajas,
		bocas: listaBocas,
		ranurasTotales: listaBocas.length,
		ranurasUsadas: usadas.length,
		ranurasSaturadas: saturadas.length,
		demandaFuera, estado, motivo,
	};
}

/**
 * QUÉ SECCIÓN HARÍA FALTA para el cableado que se le pide a este tramo.
 *
 * No es un catálogo comercial: es la cuenta que hace un instalador. Se suma la sección de todos
 * los conductores —los que ya van dentro y los que se quedaron fuera queriendo entrar— y se divide
 * por un llenado de trabajo. El 45 % no es un número mágico: es el orden de magnitud con el que se
 * dimensionan canales portacables para poder tender y retocar sin sacar todo el mazo, y deja sitio
 * para las curvas de entrada, que ocupan más que el tramo recto.
 */
export const LLENADO_DE_TRABAJO = 0.45;

export function seccionNecesaria(radios: number[]): number {
	let cobre = 0;
	for (const r of radios) cobre += Math.PI * r * r;
	return cobre / LLENADO_DE_TRABAJO;
}

/**
 * La medida de canaleta más pequeña que da esa sección, de una escalera de tamaños corrientes.
 * Se pide además que la ranura deje pasar el conductor más gordo, porque una canaleta muy alta con
 * la boca estrecha no resuelve nada.
 */
const MEDIDAS = [25, 40, 60, 80, 100, 120];

export function medidaRecomendada(
	seccionUtil: number, radioMax: number, espesor: number,
): { ancho: number; alto: number } | undefined {
	let mejor: { ancho: number; alto: number; area: number } | undefined;
	for (const ancho of MEDIDAS) {
		for (const alto of MEDIDAS) {
			const util = (ancho - 2 * espesor) * (alto - espesor);
			if (util < seccionUtil) continue;
			// Que quepa el cable más gordo a lo ancho con su aire, o no sirve de nada.
			if (ancho - 2 * espesor < radioMax * 2 + AIRE_INTERIOR * 2) continue;
			const area = ancho * alto;
			if (!mejor || area < mejor.area || (area === mejor.area && ancho < mejor.ancho)) {
				mejor = { ancho, alto, area };
			}
		}
	}
	return mejor && { ancho: mejor.ancho, alto: mejor.alto };
}

/** Audita todas las canaletas de un tablero. */
export function auditarCanaletas(
	canaletas: Canaleta[],
	trazos: { id: string; radio: number; puntos: { x: number; y: number; z: number }[] }[],
	demanda = new Map<string, string[]>(),
): AuditoriaTramo[] {
	const red = new RedCanaletas(canaletas);
	const radioMax = trazos.length ? Math.max(...trazos.map((t) => t.radio)) : 3;
	return red.tramos.map((t) => auditarTramo(t, trazos, radioMax, demanda.get(t.id) ?? []));
}

/**
 * A QUÉ TRAMO HABRÍA QUERIDO ENTRAR un cable que acabó por delante del tablero.
 *
 * Es la misma regla que usa el generador de caminos —el ducto tiene que dar de sí a lo largo para
 * cubrir los dos bornes, y de los que cumplen gana el que menos rodeo pide—, escrita aquí para que
 * la auditoría pueda hablar de DEMANDA y no solo de lo que entró. Sin esto no se puede recomendar
 * un tamaño: no se dimensiona una canaleta por los cables que ya lleva, sino por los que tiene que
 * llevar.
 */
export function tramoQueQuerria(
	red: RedCanaletas, a: { x: number; y: number }, b: { x: number; y: number },
): string | undefined {
	let mejor: string | undefined;
	let rodeo = Infinity;
	for (const t of red.tramos) {
		const ea = ejeDe(t, a.x, a.y);
		const eb = ejeDe(t, b.x, b.y);
		if (t.desde > Math.min(ea, eb) + 40 || t.hasta < Math.max(ea, eb) - 40) continue;
		const r = Math.abs(cruzDe(t, a.x, a.y) - t.centro) + Math.abs(cruzDe(t, b.x, b.y) - t.centro);
		if (r < rodeo || (r === rodeo && mejor && t.id < mejor)) { rodeo = r; mejor = t.id; }
	}
	return mejor;
}
