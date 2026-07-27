/**
 * Motor de ESQUEMA: convierte el modelo del tablero en un plano eléctrico dibujable.
 *
 * Es el entregable que recibe el cliente y el que usa el electricista en terreno. El 3D dice
 * dónde va cada aparato; el esquema dice qué hace el tablero.
 *
 * Este motor es PURO: produce geometría en milímetros de papel (símbolos, hilos, textos) sin
 * saber nada de SVG, Canvas ni PDF. Quien dibuje decide cómo pintarlo, y las pruebas pueden
 * comprobar la topología sin renderizar nada.
 *
 * Convenios de dibujo (IEC 60617, como en cualquier esquema de tablero):
 *  - Los circuitos se leen de arriba abajo: la alimentación arriba, el consumo abajo.
 *  - La hoja se divide en COLUMNAS numeradas; cada circuito ocupa una columna.
 *  - Cada hilo lleva su número de potencial, el mismo en todos los puntos que están unidos.
 *  - Los contactos de un aparato llevan la referencia cruzada de dónde está su bobina.
 */
import { Dispositivo, Proyecto } from '../modelo/tipos.js';
import { ResultadoPotenciales } from './potenciales.js';

/* --------------------------------- Geometría --------------------------------- */

export interface PuntoEsq { x: number; y: number }

/** Un trazo del dibujo. Todo el esquema se reduce a estas primitivas. */
export type Trazo =
	| { tipo: 'linea'; a: PuntoEsq; b: PuntoEsq; grosor?: number; trazos?: boolean }
	| { tipo: 'circulo'; c: PuntoEsq; r: number; relleno?: boolean }
	| { tipo: 'texto'; p: PuntoEsq; texto: string; tam?: number; anclaje?: 'izq' | 'centro' | 'der'; negrita?: boolean };

/** Símbolo de un aparato ya colocado en la hoja, con sus puntos de conexión. */
export interface SimboloEsq {
	dispositivoId: string;
	designacion: string;
	/** Esquina superior izquierda del símbolo, en mm de papel. */
	x: number;
	y: number;
	ancho: number;
	alto: number;
	trazos: Trazo[];
	/** Punto de conexión de cada borne, en coordenadas absolutas de la hoja. */
	pines: Map<string, PuntoEsq>;
}

/** Un hilo dibujado entre dos pines, con el número de potencial que le corresponde. */
export interface HiloEsq {
	conductorId: string;
	numero?: string;
	nodos: PuntoEsq[];
}

/** Una hoja del esquema, lista para pintar. */
export interface HojaEsq {
	id: string;
	numero: number;
	titulo: string;
	anchoMm: number;
	altoMm: number;
	columnas: number;
	simbolos: SimboloEsq[];
	hilos: HiloEsq[];
	/**
	 * TODO el texto suelto de la hoja: números de hilo, enlaces a otra hoja y referencias
	 * cruzadas de bobina. Va junto a propósito: solo colocándolo de una vez se puede garantizar
	 * que nada tape a nada. Quien dibuje se limita a pintarlo donde diga aquí.
	 */
	referencias: EtiquetaEsq[];
}

/** Un texto suelto ya colocado en la hoja. */
export interface EtiquetaEsq {
	texto: string;
	p: PuntoEsq;
	/** 'hilo' = número de potencial · 'enlace' = va a otra hoja · 'bobina' = referencia cruzada. */
	tipo: 'hilo' | 'enlace' | 'bobina';
	/** Aparato al que pertenece (si aplica), para poder resaltarlo con él. */
	dispositivoId?: string;
}

/* ------------------------------- Medidas del papel ------------------------------- */

/** A3 apaisado, que es el formato normal de un esquema de tablero. */
export const HOJA_A3 = { ancho: 420, alto: 297 };
/** Margen del cajetín y la rejilla. */
export const MARGEN = { izq: 20, der: 10, arriba: 14, abajo: 34 };
/** Alto de la banda de alimentación (arriba) y de la de retorno (abajo) dentro del dibujo. */
const BARRA_ARRIBA = 28;
const BARRA_ABAJO = 34;

/** Ancho de una columna de circuito, en mm. */
export function anchoColumna(hoja = HOJA_A3, columnas = 10): number {
	return (hoja.ancho - MARGEN.izq - MARGEN.der) / columnas;
}

/* --------------------------------- Símbolos --------------------------------- */

/**
 * Dibuja el símbolo IEC de un aparato, centrado en (0,0) y mirando hacia abajo (entrada
 * arriba, salida abajo), que es como se leen los esquemas de mando y potencia.
 * Devuelve los trazos en coordenadas locales y los pines por nombre de borne.
 */
export function simboloDe(d: Dispositivo): { ancho: number; alto: number; trazos: Trazo[]; pines: Map<string, PuntoEsq> } {
	const pines = new Map<string, PuntoEsq>();
	const trazos: Trazo[] = [];
	const entradas = d.bornes.filter((_, i) => i % 2 === 0);
	const salidas = d.bornes.filter((_, i) => i % 2 === 1);
	const vias = Math.max(1, Math.min(entradas.length, Math.max(salidas.length, 1)));
	const ancho = Math.max(10, vias * 8);
	const alto = 20;

	/** Coloca los pines de una fila repartidos a lo ancho del símbolo. */
	const repartir = (lista: typeof entradas, y: number) => {
		lista.forEach((b, i) => {
			const x = lista.length === 1 ? 0 : -ancho / 2 + (i * ancho) / (lista.length - 1);
			pines.set(b.id, { x, y });
			trazos.push({ tipo: 'linea', a: { x, y }, b: { x, y: y > 0 ? y - 4 : y + 4 } });
		});
	};
	repartir(entradas, -alto / 2);
	repartir(salidas, alto / 2);

	switch (d.tipo) {
		case 'disyuntor':
		case 'guardamotor':
		case 'seccionador':
			// Contacto abierto con la cruz del magnetotérmico.
			for (const b of entradas) {
				const p = pines.get(b.id)!;
				trazos.push({ tipo: 'linea', a: { x: p.x, y: -alto / 2 + 4 }, b: { x: p.x + 3, y: alto / 2 - 4 } });
			}
			trazos.push({ tipo: 'linea', a: { x: -ancho / 2 - 2, y: 0 }, b: { x: ancho / 2 + 2, y: 0 }, trazos: true });
			break;
		case 'diferencial':
			trazos.push({ tipo: 'circulo', c: { x: 0, y: 0 }, r: 5 });
			trazos.push({ tipo: 'texto', p: { x: 0, y: 1.5 }, texto: 'I∆', tam: 4, anclaje: 'centro' });
			break;
		case 'fusible':
			trazos.push({ tipo: 'linea', a: { x: -3, y: -6 }, b: { x: 3, y: -6 } });
			trazos.push({ tipo: 'linea', a: { x: 3, y: -6 }, b: { x: 3, y: 6 } });
			trazos.push({ tipo: 'linea', a: { x: 3, y: 6 }, b: { x: -3, y: 6 } });
			trazos.push({ tipo: 'linea', a: { x: -3, y: 6 }, b: { x: -3, y: -6 } });
			break;
		case 'contactor':
		case 'rele':
			// Bobina: rectángulo con la designación; contactos: trazo inclinado.
			if (d.bornes.some((b) => /^A[12]$/.test(b.id))) {
				trazos.push({ tipo: 'linea', a: { x: -5, y: -5 }, b: { x: 5, y: -5 } });
				trazos.push({ tipo: 'linea', a: { x: 5, y: -5 }, b: { x: 5, y: 5 } });
				trazos.push({ tipo: 'linea', a: { x: 5, y: 5 }, b: { x: -5, y: 5 } });
				trazos.push({ tipo: 'linea', a: { x: -5, y: 5 }, b: { x: -5, y: -5 } });
			} else {
				trazos.push({ tipo: 'linea', a: { x: -4, y: 4 }, b: { x: 4, y: -4 } });
			}
			break;
		case 'motor':
			trazos.push({ tipo: 'circulo', c: { x: 0, y: 0 }, r: 8 });
			trazos.push({ tipo: 'texto', p: { x: 0, y: 2 }, texto: 'M', tam: 6, anclaje: 'centro', negrita: true });
			break;
		case 'piloto':
			trazos.push({ tipo: 'circulo', c: { x: 0, y: 0 }, r: 5 });
			trazos.push({ tipo: 'linea', a: { x: -3.5, y: -3.5 }, b: { x: 3.5, y: 3.5 } });
			trazos.push({ tipo: 'linea', a: { x: 3.5, y: -3.5 }, b: { x: -3.5, y: 3.5 } });
			break;
		case 'pulsador':
		case 'selector':
			trazos.push({ tipo: 'linea', a: { x: -4, y: 4 }, b: { x: 4, y: -4 } });
			trazos.push({ tipo: 'linea', a: { x: 0, y: -6 }, b: { x: 0, y: -2 } });
			trazos.push({ tipo: 'linea', a: { x: -3, y: -6 }, b: { x: 3, y: -6 } });
			break;
		case 'transformador':
			trazos.push({ tipo: 'circulo', c: { x: -3, y: 0 }, r: 5 });
			trazos.push({ tipo: 'circulo', c: { x: 3, y: 0 }, r: 5 });
			break;
		case 'fuente':
			trazos.push({ tipo: 'linea', a: { x: -8, y: -6 }, b: { x: 8, y: -6 } });
			trazos.push({ tipo: 'linea', a: { x: 8, y: -6 }, b: { x: 8, y: 6 } });
			trazos.push({ tipo: 'linea', a: { x: 8, y: 6 }, b: { x: -8, y: 6 } });
			trazos.push({ tipo: 'linea', a: { x: -8, y: 6 }, b: { x: -8, y: -6 } });
			trazos.push({ tipo: 'texto', p: { x: 0, y: 2 }, texto: '=', tam: 6, anclaje: 'centro' });
			break;
		case 'sensor':
			trazos.push({ tipo: 'linea', a: { x: -5, y: -5 }, b: { x: 5, y: 0 } });
			trazos.push({ tipo: 'linea', a: { x: 5, y: 0 }, b: { x: -5, y: 5 } });
			trazos.push({ tipo: 'linea', a: { x: -5, y: 5 }, b: { x: -5, y: -5 } });
			break;
		case 'bornero':
			for (const [, p] of pines) trazos.push({ tipo: 'circulo', c: { x: p.x, y: 0 }, r: 1.6 });
			break;
		default:
			trazos.push({ tipo: 'linea', a: { x: -ancho / 2, y: -6 }, b: { x: ancho / 2, y: -6 } });
			trazos.push({ tipo: 'linea', a: { x: ancho / 2, y: -6 }, b: { x: ancho / 2, y: 6 } });
			trazos.push({ tipo: 'linea', a: { x: ancho / 2, y: 6 }, b: { x: -ancho / 2, y: 6 } });
			trazos.push({ tipo: 'linea', a: { x: -ancho / 2, y: 6 }, b: { x: -ancho / 2, y: -6 } });
	}
	return { ancho, alto, trazos, pines };
}

/* --------------------------------- Montaje de hojas --------------------------------- */

/** ¿Es un aparato de potencia (va en la hoja de fuerza) o de mando? */
export function esPotencia(d: Dispositivo): boolean {
	if (['motor', 'variador', 'guardamotor', 'seccionador'].includes(d.tipo)) return true;
	// Un aparato con bornes de fuerza (L/N) y sin bornes de control es de potencia.
	const fuerza = d.bornes.filter((b) => b.tipo === 'L' || b.tipo === 'N').length;
	const control = d.bornes.filter((b) => b.tipo === 'control' || b.tipo === 'senal').length;
	return fuerza > 0 && fuerza >= control;
}

/**
 * Reparte los aparatos en columnas siguiendo el orden eléctrico: se empieza por las fuentes
 * de alimentación y se avanza conductor a conductor, de modo que los aparatos conectados
 * entre sí caen en columnas contiguas y los hilos salen cortos, como en un esquema hecho a
 * mano. Devuelve el índice de columna de cada aparato.
 */
export function repartirEnColumnas(proyecto: Proyecto, aparatos: Dispositivo[]): Map<string, number> {
	const idsValidos = new Set(aparatos.map((d) => d.id));
	const vecinos = new Map<string, Set<string>>();
	for (const d of aparatos) vecinos.set(d.id, new Set());
	for (const c of proyecto.conductores) {
		const a = c.de.dispositivoId;
		const b = c.a.dispositivoId;
		if (!idsValidos.has(a) || !idsValidos.has(b) || a === b) continue;
		vecinos.get(a)!.add(b);
		vecinos.get(b)!.add(a);
	}
	// Se arranca por las fuentes de energía; si no hay, por el aparato más conectado.
	const prioridad = (d: Dispositivo) =>
		(['fuente', 'transformador'].includes(d.tipo) ? 0 : d.tipo === 'bornero' ? 1 : 2);
	const orden = [...aparatos].sort(
		(p, q) => prioridad(p) - prioridad(q) || (vecinos.get(q.id)!.size - vecinos.get(p.id)!.size),
	);

	const columna = new Map<string, number>();
	let siguiente = 0;
	for (const raiz of orden) {
		if (columna.has(raiz.id)) continue;
		// Recorrido en anchura: los aparatos conectados quedan juntos.
		const cola = [raiz.id];
		columna.set(raiz.id, siguiente++);
		while (cola.length) {
			const actual = cola.shift()!;
			for (const v of [...(vecinos.get(actual) ?? [])].sort()) {
				if (columna.has(v)) continue;
				columna.set(v, siguiente++);
				cola.push(v);
			}
		}
	}
	return columna;
}

/**
 * Profundidad eléctrica de cada aparato: 0 para las fuentes de energía y +1 por cada aparato
 * que se atraviesa hasta llegar a él. Es lo que hace que un esquema se lea: la alimentación
 * arriba, las protecciones debajo, la maniobra después y el consumo al fondo.
 */
export function nivelesDe(proyecto: Proyecto, aparatos: Dispositivo[]): Map<string, number> {
	const idsValidos = new Set(aparatos.map((d) => d.id));
	const vecinos = new Map<string, Set<string>>();
	for (const d of aparatos) vecinos.set(d.id, new Set());
	for (const c of proyecto.conductores) {
		const a = c.de.dispositivoId;
		const b = c.a.dispositivoId;
		if (!idsValidos.has(a) || !idsValidos.has(b) || a === b) continue;
		vecinos.get(a)!.add(b);
		vecinos.get(b)!.add(a);
	}
	// Origen: de dónde entra la energía. Si no hay fuente declarada, el bornero o lo más conectado.
	const esOrigen = (d: Dispositivo) => ['fuente', 'transformador'].includes(d.tipo);
	let raices = aparatos.filter(esOrigen);
	if (raices.length === 0) raices = aparatos.filter((d) => d.tipo === 'bornero');
	if (raices.length === 0) {
		const top = [...aparatos].sort((p, q) => vecinos.get(q.id)!.size - vecinos.get(p.id)!.size)[0];
		raices = top ? [top] : [];
	}
	const nivel = new Map<string, number>();
	const cola: string[] = [];
	for (const r of raices) { nivel.set(r.id, 0); cola.push(r.id); }
	while (cola.length) {
		const actual = cola.shift()!;
		for (const v of vecinos.get(actual) ?? []) {
			if (nivel.has(v)) continue;
			nivel.set(v, nivel.get(actual)! + 1);
			cola.push(v);
		}
	}
	// Los que no cuelgan de ninguna fuente (islas) van al nivel intermedio, no descolgados.
	for (const d of aparatos) if (!nivel.has(d.id)) nivel.set(d.id, 1);
	return nivel;
}

/**
 * Monta el esquema completo: coloca cada aparato en su columna y hoja, tiende los hilos entre
 * pines y añade las referencias cruzadas. Es la función que consume la vista.
 */
export function montarEsquema(
	proyecto: Proyecto,
	potenciales: ResultadoPotenciales,
	opciones: { columnasPorHoja?: number; hoja?: { ancho: number; alto: number } } = {},
): HojaEsq[] {
	const papel = opciones.hoja ?? HOJA_A3;
	const columnas = opciones.columnasPorHoja ?? 10;
	const paso = anchoColumna(papel, columnas);
	const aparatos = proyecto.dispositivos.filter((d) => !d.imagen);
	if (aparatos.length === 0) return [];

	// Fuerza y mando van en hojas distintas, como en cualquier esquema profesional.
	const grupos: { titulo: string; lista: Dispositivo[] }[] = [];
	const potencia = aparatos.filter(esPotencia);
	const mando = aparatos.filter((d) => !esPotencia(d));
	if (potencia.length) grupos.push({ titulo: 'Circuito de potencia', lista: potencia });
	if (mando.length) grupos.push({ titulo: 'Circuito de mando', lista: mando });

	const hojas: HojaEsq[] = [];
	const pinGlobal = new Map<string, PuntoEsq>();   // "disp::borne" → punto absoluto
	const hojaDeAparato = new Map<string, { hoja: number; col: number }>();

	let numeroHoja = 0;
	for (const grupo of grupos) {
		const porColumna = repartirEnColumnas(proyecto, grupo.lista);
		const porNivel = nivelesDe(proyecto, grupo.lista);
		const nivelMax = Math.max(1, ...[...porNivel.values()]);
		// Franja útil para escalonar los aparatos entre la barra de arriba y la de abajo.
		const yArriba = MARGEN.arriba + BARRA_ARRIBA + 18;
		const yAbajo = papel.alto - MARGEN.abajo - BARRA_ABAJO - 18;
		const total = Math.max(1, ...[...porColumna.values()].map((c) => c + 1));
		const nHojas = Math.ceil(total / columnas);
		for (let h = 0; h < nHojas; h++) {
			numeroHoja++;
			const simbolos: SimboloEsq[] = [];
			const enEstaHoja = grupo.lista.filter((d) => {
				const c = porColumna.get(d.id) ?? 0;
				return Math.floor(c / columnas) === h;
			});
			for (const d of enEstaHoja) {
				const col = (porColumna.get(d.id) ?? 0) % columnas;
				const s = simboloDe(d);
				// Centro del símbolo: en su columna, a media altura de la zona de circuito.
				const cx = MARGEN.izq + paso * (col + 0.5);
				// Cuanto más «lejos» está el aparato de la alimentación, más abajo se dibuja.
				const cy = nivelMax === 0
					? (yArriba + yAbajo) / 2
					: yArriba + ((porNivel.get(d.id) ?? 1) / nivelMax) * (yAbajo - yArriba);
				const pines = new Map<string, PuntoEsq>();
				for (const [id, p] of s.pines) {
					const abs = { x: cx + p.x, y: cy + p.y };
					pines.set(id, abs);
					pinGlobal.set(`${d.id}::${id}`, abs);
				}
				simbolos.push({
					dispositivoId: d.id,
					designacion: d.designacion ?? d.id,
					x: cx - s.ancho / 2, y: cy - s.alto / 2, ancho: s.ancho, alto: s.alto,
					trazos: s.trazos.map((t) => desplazar(t, cx, cy)),
					pines,
				});
				hojaDeAparato.set(d.id, { hoja: numeroHoja, col: col + 1 });
			}
			hojas.push({
				id: `esq${numeroHoja}`,
				numero: numeroHoja,
				titulo: nHojas > 1 ? `${grupo.titulo} (${h + 1}/${nHojas})` : grupo.titulo,
				anchoMm: papel.ancho, altoMm: papel.alto, columnas,
				simbolos, hilos: [], referencias: [],
			});
		}
	}

	// Hilos: se tienden en la hoja donde están sus dos extremos. Si cruzan de hoja, se marcan
	// con una referencia en el borde (como los enlaces de página de un esquema de verdad).
	for (const c of proyecto.conductores) {
		const a = pinGlobal.get(`${c.de.dispositivoId}::${c.de.borneId}`);
		const b = pinGlobal.get(`${c.a.dispositivoId}::${c.a.borneId}`);
		const ha = hojaDeAparato.get(c.de.dispositivoId);
		const hb = hojaDeAparato.get(c.a.dispositivoId);
		if (!a || !b || !ha || !hb) continue;
		// El número del hilo lo pone el motor de numeración a partir del potencial; si aún no se
		// ha numerado, se etiqueta con el propio potencial para que el plano nunca salga mudo.
		const numero = c.numero ?? potenciales.porConductor.get(c.id)?.id;
		if (ha.hoja === hb.hoja) {
			const hoja = hojas.find((x) => x.numero === ha.hoja)!;
			const nodos = rutaHilo(a, b, hoja);
			hoja.hilos.push({ conductorId: c.id, numero, nodos });
			// El número va sobre el tramo más largo, que es donde de verdad se lee.
			if (numero) hoja.referencias.push({ texto: numero, p: puntoMedioDelTramoMasLargo(nodos), tipo: 'hilo' });
		} else {
			// Enlace entre hojas: cada punta se remata con la referencia a la otra hoja. La
			// referencia pertenece al aparato de SU hoja (no al del otro extremo) y lleva el
			// número del hilo, que es lo que el electricista busca para seguirlo de plano a plano.
			const extremos = [
				{ pin: a, propia: ha, otra: hb, id: c.de.dispositivoId },
				{ pin: b, propia: hb, otra: ha, id: c.a.dispositivoId },
			];
			for (const e of extremos) {
				const hoja = hojas.find((x) => x.numero === e.propia.hoja);
				if (!hoja) continue;
				hoja.referencias.push({
					dispositivoId: e.id,
					tipo: 'enlace',
					texto: `${numero ? `${numero} ` : ''}→ /${e.otra.hoja}.${e.otra.col}`,
					p: { x: e.pin.x, y: e.pin.y + (e.pin.y > papel.alto / 2 ? 6 : -6) },
				});
			}
		}
	}

	// Referencias cruzadas maestro/esclavo: dónde está la bobina de cada contacto.
	for (const d of aparatos) {
		if (d.rol?.tipo !== 'esclavo') continue;
		const maestro = hojaDeAparato.get(d.rol.maestroId);
		const propia = hojaDeAparato.get(d.id);
		if (!maestro || !propia) continue;
		const hoja = hojas.find((x) => x.numero === propia.hoja);
		const simbolo = hoja?.simbolos.find((s) => s.dispositivoId === d.id);
		if (!hoja || !simbolo) continue;
		hoja.referencias.push({
			dispositivoId: d.id,
			tipo: 'bobina',
			texto: `bobina /${maestro.hoja}.${maestro.col}`,
			p: { x: simbolo.x + simbolo.ancho / 2, y: simbolo.y + simbolo.alto + 12 },
		});
	}

	// Con todas las referencias ya creadas, se reparten para que ninguna tape a otra.
	for (const hoja of hojas) {
		separarEtiquetas(hoja.referencias, {
			altoMm: hoja.altoMm,
			// El símbolo y su designación (que va a la izquierda) son sitio ocupado.
			obstaculos: hoja.simbolos.map((s) => ({ x: s.x - 24, y: s.y, ancho: s.ancho + 24, alto: s.alto })),
		});
	}

	return hojas;
}

/** Punto medio del tramo más largo de una polilínea: donde cabe una etiqueta y se lee. */
export function puntoMedioDelTramoMasLargo(nodos: PuntoEsq[]): PuntoEsq {
	let mejor = { x: nodos[0]?.x ?? 0, y: nodos[0]?.y ?? 0 };
	let largo = -1;
	for (let i = 0; i < nodos.length - 1; i++) {
		const d = Math.hypot(nodos[i + 1].x - nodos[i].x, nodos[i + 1].y - nodos[i].y);
		if (d > largo) {
			largo = d;
			mejor = { x: (nodos[i].x + nodos[i + 1].x) / 2, y: (nodos[i].y + nodos[i + 1].y) / 2 };
		}
	}
	return mejor;
}

/**
 * Ancho aproximado (mm) que ocupa un texto de etiqueta al dibujarse. Lo usan por igual el
 * reparto y los dibujantes: si cada uno midiera a su manera, el recuadro blanco del número
 * no coincidiría con el hueco reservado y volverían a pisarse cosas.
 */
export function anchoEtiquetaMm(texto: string): number {
	return Math.max(7, texto.length * 1.7);
}

/**
 * Separa las etiquetas que se pisarían entre sí.
 *
 * Cuando de un mismo aparato salen varios hilos hacia otra hoja, todas sus referencias caen
 * casi en el mismo punto y se dibujan una encima de otra: ilegibles. Aquí se apilan hacia
 * fuera del dibujo, como se rotula a mano cuando no cabe todo en una línea.
 *
 * Se hace en una pasada aparte (y no al crearlas) porque solo se puede repartir cuando ya
 * están todas: hasta la última no se sabe cuántas comparten sitio.
 */
export function separarEtiquetas(
	etiquetas: { texto: string; p: PuntoEsq }[],
	opciones: { paso?: number; altoMm?: number; obstaculos?: { x: number; y: number; ancho: number; alto: number }[] } = {},
): void {
	// Medidas tomadas del texto tal como se dibuja (2,8 mm de cuerpo): la caja real es más
	// alta que el cuerpo por el trazo ascendente y descendente, y más ancha de lo que parece.
	// Quedarse corto aquí deja etiquetas rozándose, que es como si no se hubieran separado.
	const paso = opciones.paso ?? 4.4;
	const alto = opciones.altoMm ?? HOJA_A3.alto;
	const ancho = anchoEtiquetaMm;
	// Los símbolos entran como sitio YA OCUPADO: una referencia encima de un símbolo es tan
	// ilegible como una encima de otra referencia.
	const puestas: { x0: number; x1: number; y: number }[] = [];
	const bloques = (opciones.obstaculos ?? []).map((o) => ({
		x0: o.x - 2, x1: o.x + o.ancho + 2, y0: o.y - 2, y1: o.y + o.alto + 2,
	}));
	// De arriba abajo y de izquierda a derecha: el reparto sale estable y reproducible.
	const orden = [...etiquetas].sort((a, b) => a.p.y - b.p.y || a.p.x - b.p.x);
	for (const e of orden) {
		const w = ancho(e.texto);
		// Las de la mitad de arriba se apilan hacia arriba; las de abajo, hacia abajo.
		const sentido = e.p.y < alto / 2 ? -1 : 1;
		for (let intento = 0; intento < 24; intento++) {
			const x0 = e.p.x - w / 2;
			const x1 = e.p.x + w / 2;
			const chocaEtiqueta = puestas.some((q) => q.x1 > x0 && q.x0 < x1 && Math.abs(q.y - e.p.y) < paso - 0.4);
			const chocaSimbolo = bloques.some((b) => b.x1 > x0 && b.x0 < x1 && b.y1 > e.p.y - 3 && b.y0 < e.p.y + 1.5);
			if (!chocaEtiqueta && !chocaSimbolo) break;
			e.p.y += sentido * paso;
		}
		puestas.push({ x0: e.p.x - w / 2, x1: e.p.x + w / 2, y: e.p.y });
	}
}

/** Traslada un trazo local a coordenadas absolutas de la hoja. */
function desplazar(t: Trazo, dx: number, dy: number): Trazo {
	if (t.tipo === 'linea') return { ...t, a: { x: t.a.x + dx, y: t.a.y + dy }, b: { x: t.b.x + dx, y: t.b.y + dy } };
	if (t.tipo === 'circulo') return { ...t, c: { x: t.c.x + dx, y: t.c.y + dy } };
	return { ...t, p: { x: t.p.x + dx, y: t.p.y + dy } };
}

/**
 * Recorrido ortogonal de un hilo entre dos pines. Sube o baja hasta una banda libre (arriba
 * la de alimentación, abajo la de retorno) y cruza por ella, que es como se dibuja a mano
 * para que los hilos no atraviesen los símbolos.
 */
export function rutaHilo(a: PuntoEsq, b: PuntoEsq, hoja: { altoMm: number }): PuntoEsq[] {
	if (Math.abs(a.x - b.x) < 0.5) return [a, b]; // misma vertical: hilo recto
	// Se cruza por arriba si ambos extremos miran hacia arriba; si no, por abajo.
	const medio = hoja.altoMm / 2;
	const arriba = a.y < medio && b.y < medio;
	const y = arriba ? MARGEN.arriba + BARRA_ARRIBA / 2 : hoja.altoMm - MARGEN.abajo - BARRA_ABAJO / 2;
	return [a, { x: a.x, y }, { x: b.x, y }, b];
}
