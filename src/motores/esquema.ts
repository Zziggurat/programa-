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
import { Dispositivo, Proyecto, RefBorne } from '../modelo/tipos.js';
import type { ParteRepresentacionEsquema, RepresentacionEsquema } from '../modelo/tipos.js';
import { rotuloVisibleBorne } from '../modelo/bornes.js';
import { esReferenciaVisualInerte } from '../modelo/apariencia.js';
import { resolverComportamiento } from '../modelo/comportamiento.js';
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
	/** Identidad gráfica; ausente solo en el esquema legacy de un símbolo por aparato. */
	representacionId?: string;
	parte?: ParteRepresentacionEsquema['tipo'];
	designacion: string;
	/** Columna de la rejilla (desde 1): es la coordenada con la que se cita en el plano. */
	columna: number;
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
	/** Extremos eléctricos reales del mismo conductor, solo para el dibujo de uniones.
	 * No añade un nodo ni duplica el grafo: la conectividad sigue en `Proyecto.conductores`. */
	bornes?: { de: RefBorne; a: RefBorne };
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
	/** Incidencias derivadas del montaje explícito; no cambian aparatos, cables ni colocaciones. */
	problemas?: ProblemaEsq[];
}

export interface ProblemaEsq {
	codigo: 'posicion-fuera-de-hoja' | 'representacion-invalida' | 'conexion-sin-ancla'
		| 'aparato-sin-representacion';
	mensaje: string;
	dispositivoId?: string;
	representacionId?: string;
	conductorId?: string;
}

/** Advertencia compacta para un plano entregable: el dibujo nunca afirma estar completo si
 * el montaje conoce aparatos, vistas o conductores pendientes. Los detalles quedan en el inspector. */
export function resumenPendientesEsquema(hoja: Pick<HojaEsq, 'problemas'>): string | undefined {
	const problemas = hoja.problemas ?? [];
	if (!problemas.length) return undefined;
	const ids = [...new Set(problemas.map((p) => p.dispositivoId ?? p.conductorId ?? p.representacionId)
		.filter((id): id is string => !!id))].sort((a, b) => a.localeCompare(b));
	// El aviso cabe en la banda A3 incluso con IDs hostiles/largos; el inspector conserva el ID íntegro.
	const visibles = ids.slice(0, 4).map((id) => id.length > 24 ? `${id.slice(0, 21)}...` : id).join(', ');
	return `PENDIENTES DE ESQUEMA ${problemas.length}: ${visibles || 'ver inspector'}`
		+ (ids.length > 4 ? ` (+${ids.length - 4} entidades)` : '');
}

/** Un texto suelto ya colocado en la hoja. */
export interface EtiquetaEsq {
	texto: string;
	p: PuntoEsq;
	/** 'hilo' = potencial · 'enlace' = otra hoja · 'bobina' = referencia · 'aviso' = ubicación pendiente. */
	tipo: 'hilo' | 'enlace' | 'bobina' | 'aviso';
	/** Aparato al que pertenece (si aplica), para poder resaltarlo con él. */
	dispositivoId?: string;
	/** Identidad de la vista o del conductor de la que sale esta referencia, sin crear otro cable. */
	representacionId?: string;
	conductorId?: string;
}

/* ------------------------------- Medidas del papel ------------------------------- */

/** A3 apaisado, que es el formato normal de un esquema de tablero. */
export const HOJA_A3 = { ancho: 420, alto: 297 };
/** Margen del cajetín y la rejilla. */
export const MARGEN = { izq: 20, der: 10, arriba: 14, abajo: 34 };
/** Alto de la banda de alimentación (arriba) y de la de retorno (abajo) dentro del dibujo. */
const BARRA_ARRIBA = 28;
const BARRA_ABAJO = 34;

/**
 * Filas de la rejilla en que se puede soltar un símbolo al arrastrarlo.
 *
 * Ocho es lo que cabe leyéndose en un A3 sin que los símbolos se toquen, y es una rejilla: un
 * esquema que se entrega tiene los aparatos alineados, no puestos a ojo. Arrastrar libre queda
 * bonito en pantalla y descuidado en papel.
 */
export const FILAS_ESQ = 8;

/** Franja vertical donde se dibuja el circuito, entre las dos barras de alimentación. */
export function bandaDeCircuito(papel = HOJA_A3): { arriba: number; abajo: number } {
	return {
		arriba: MARGEN.arriba + BARRA_ARRIBA + 18,
		abajo: papel.alto - MARGEN.abajo - BARRA_ABAJO - 18,
	};
}

/** Fila (1..FILAS_ESQ) en la que cae una altura en mm. Es la inversa de `alturaDeFila`. */
export function filaDeAltura(y: number, papel = HOJA_A3): number {
	const { arriba, abajo } = bandaDeCircuito(papel);
	const t = (y - arriba) / Math.max(1, abajo - arriba);
	return Math.max(1, Math.min(FILAS_ESQ, Math.round(t * (FILAS_ESQ - 1)) + 1));
}

/** Altura en mm del centro de una fila. */
export function alturaDeFila(fila: number, papel = HOJA_A3): number {
	const { arriba, abajo } = bandaDeCircuito(papel);
	const f = Math.max(1, Math.min(FILAS_ESQ, fila));
	return arriba + ((f - 1) / (FILAS_ESQ - 1)) * (abajo - arriba);
}

/** Ancho de una columna de circuito, en mm. */
export function anchoColumna(hoja = HOJA_A3, columnas = 10): number {
	return (hoja.ancho - MARGEN.izq - MARGEN.der) / columnas;
}

/* --------------------------------- Símbolos --------------------------------- */

/** Ancho máximo de un símbolo: por encima de esto invadiría la columna vecina. */
export const ANCHO_MAX_SIMBOLO = 30;
/** Alto máximo de un bloque funcional, para que quepa entre las barras de la hoja. */
export const ALTO_MAX_BLOQUE = 170;
/** Banda (mm) que ocupa la marca del borne por fuera del símbolo, arriba y abajo. */
export const MARCA_BORNE = 3.5;

/**
 * ¿Se dibuja como BLOQUE funcional (rectángulo con los terminales rotulados a los lados)?
 *
 * Es el convenio para controladores, autómatas y variadores: no tienen un símbolo de contacto,
 * tienen decenas de terminales con nombre. Dibujarlos como un aparato de dos filas daría un
 * símbolo de 130 mm en una columna de 39: ilegible e inútil.
 */
export function esBloqueFuncional(d: Dispositivo): boolean {
	// Un bornero SIEMPRE se dibuja como bornero, por muchas bornas que tenga: su símbolo
	// (la fila de círculos) es lo que le dice al electricista que ahí se corta el cable.
	if (d.tipo === 'bornero') return false;
	return !!d.terminales?.length || d.tipo === 'plc' || d.tipo === 'variador' || d.bornes.length > 12;
}

/**
 * Bloque funcional: rectángulo con la mitad de los terminales a la izquierda y la otra mitad
 * a la derecha, cada uno con su rótulo real. Si el aparato declara sus borneras físicas, se
 * respeta ese agrupamiento (lo que va arriba/izquierda en el equipo, va a la izquierda aquí),
 * de modo que el esquema y el aparato de verdad se leen igual.
 */
function bloqueFuncional(d: Dispositivo): { ancho: number; alto: number; trazos: Trazo[]; pines: Map<string, PuntoEsq> } {
	const pines = new Map<string, PuntoEsq>();
	const trazos: Trazo[] = [];

	let izquierda: string[];
	let derecha: string[];
	if (d.terminales?.length) {
		const disponibles = new Set(d.bornes.map((b) => b.id));
		const ya = new Set<string>();
		const delLado = (arribaOIzquierda: boolean): string[] => d.terminales!
			.filter((b) => (b.lado === 'arriba' || b.lado === 'izquierda') === arribaOIzquierda)
			.flatMap((b) => b.bornes).filter((id) => {
				if (!disponibles.has(id) || ya.has(id)) return false;
				ya.add(id); return true;
			});
		izquierda = delLado(true);
		derecha = delLado(false);
		// Un borne no declarado en bloques conserva su identidad y queda visible en el esquema.
		for (const b of d.bornes) if (!ya.has(b.id)) derecha.push(b.id);
	} else {
		const mitad = Math.ceil(d.bornes.length / 2);
		izquierda = d.bornes.slice(0, mitad).map((b) => b.id);
		derecha = d.bornes.slice(mitad).map((b) => b.id);
	}

	const porLado = Math.max(1, izquierda.length, derecha.length);
	const paso = Math.min(4.5, (ALTO_MAX_BLOQUE - 8) / porLado);
	// El bloque se ensancha lo que pidan sus rótulos (2,2 mm de cuerpo ≈ 1,3 mm por letra),
	// para que los de un costado no se metan en los del otro. Nunca más que una columna.
	const rotulos = new Map(d.bornes.map((b) => [b.id, rotuloVisibleBorne(b)]));
	const masLargo = (ids: string[]) => Math.max(0, ...ids.map((id) => (rotulos.get(id) ?? id).length)) * 1.3;
	const ancho = Math.min(ANCHO_MAX_SIMBOLO, Math.max(18, masLargo(izquierda) + masLargo(derecha) + 5));
	const alto = Math.max(20, porLado * paso + 8);

	// Contorno del bloque.
	const x0 = -ancho / 2;
	const x1 = ancho / 2;
	const y0 = -alto / 2;
	const y1 = alto / 2;
	trazos.push({ tipo: 'linea', a: { x: x0, y: y0 }, b: { x: x1, y: y0 } });
	trazos.push({ tipo: 'linea', a: { x: x1, y: y0 }, b: { x: x1, y: y1 } });
	trazos.push({ tipo: 'linea', a: { x: x1, y: y1 }, b: { x: x0, y: y1 } });
	trazos.push({ tipo: 'linea', a: { x: x0, y: y1 }, b: { x: x0, y: y0 } });

	/** Terminales de un costado: pin sobre el borde, guía hacia fuera y rótulo por dentro. */
	const costado = (ids: string[], lado: -1 | 1): void => {
		const x = lado < 0 ? x0 : x1;
		const alturaUtil = ids.length * paso;
		ids.forEach((id, i) => {
			const y = -alturaUtil / 2 + (i + 0.5) * paso;
			pines.set(id, { x, y });
			trazos.push({ tipo: 'linea', a: { x, y }, b: { x: x + lado * 4, y } });
			trazos.push({
				tipo: 'texto', p: { x: x - lado * 1.6, y: y + 0.9 },
				texto: rotulos.get(id) ?? id, tam: 2.2, anclaje: lado < 0 ? 'izq' : 'der',
			});
		});
	};
	costado(izquierda, -1);
	costado(derecha, 1);

	// Referencia comercial dentro del bloque: identifica el equipo sin salir del plano.
	if (d.referencia) {
		trazos.push({ tipo: 'texto', p: { x: 0, y: y0 - 2 }, texto: d.referencia, tam: 2.6, anclaje: 'centro' });
	}
	return { ancho, alto, trazos, pines };
}

/**
 * Dibuja el símbolo IEC de un aparato, centrado en (0,0) y mirando hacia abajo (entrada
 * arriba, salida abajo), que es como se leen los esquemas de mando y potencia.
 * Devuelve los trazos en coordenadas locales y los pines por nombre de borne.
 */
export function simboloDe(d: Dispositivo): { ancho: number; alto: number; trazos: Trazo[]; pines: Map<string, PuntoEsq> } {
	if (esBloqueFuncional(d)) return bloqueFuncional(d);

	const pines = new Map<string, PuntoEsq>();
	const trazos: Trazo[] = [];
	const entradas = d.bornes.filter((_, i) => i % 2 === 0);
	const salidas = d.bornes.filter((_, i) => i % 2 === 1);
	const vias = Math.max(1, Math.min(entradas.length, Math.max(salidas.length, 1)));
	// El ancho se limita al de una columna: un símbolo más ancho invade la columna vecina y
	// el esquema deja de leerse. Con muchos polos se aprieta el paso entre pines, no el papel.
	const ancho = Math.max(10, Math.min(vias * 8, ANCHO_MAX_SIMBOLO));
	const alto = 20;

	/** Coloca los pines de una fila repartidos a lo ancho del símbolo, con su marca de borne. */
	const repartir = (lista: typeof entradas, y: number) => {
		const arriba = y < 0;
		lista.forEach((b, i) => {
			const x = lista.length === 1 ? 0 : -ancho / 2 + (i * ancho) / (lista.length - 1);
			pines.set(b.id, { x, y });
			trazos.push({ tipo: 'linea', a: { x, y }, b: { x, y: arriba ? y + 4 : y - 4 } });
			// Marca del borne junto al pin: es lo que el electricista busca para apretar el hilo
			// en el terminal correcto (1/2, A1/A2, 13/14…).
			trazos.push({
				tipo: 'texto', p: { x: x + 1, y: arriba ? y - 1.2 : y + 3 },
				texto: rotuloVisibleBorne(b), tam: 2.2, anclaje: 'izq',
			});
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
	if (proyecto.esquema?.representaciones !== undefined) {
		return montarRepresentaciones(proyecto, potenciales, opciones);
	}
	const papel = opciones.hoja ?? HOJA_A3;
	// Las columnas por hoja son del PROYECTO: quien dibuja decide si quiere el esquema apretado
	// en pocas hojas o desahogado en varias. `opciones` solo manda cuando se pide expresamente.
	const columnas = Math.max(4, Math.min(20,
		opciones.columnasPorHoja ?? proyecto.esquema?.columnasPorHoja ?? 10));
	const paso = anchoColumna(papel, columnas);
	const aparatos = proyecto.dispositivos.filter((d) => !esReferenciaVisualInerte(d));
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
		// El motor propone; la colocación manual dispone. Un aparato que se ha arrastrado se queda
		// donde lo dejaron, y el resto se sigue ordenando solo alrededor.
		const porColumna = repartirEnColumnas(proyecto, grupo.lista);
		for (const d of grupo.lista) {
			if (d.esquema) porColumna.set(d.id, Math.max(0, d.esquema.columna - 1));
		}
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
				const cyIdeal = d.esquema
					? alturaDeFila(d.esquema.fila, papel)
					: nivelMax === 0
						? (yArriba + yAbajo) / 2
						: yArriba + ((porNivel.get(d.id) ?? 1) / nivelMax) * (yAbajo - yArriba);
				// Un símbolo alto (un bloque de controlador) no puede salirse del marco ni pisar
				// las barras de alimentación y retorno: se ciñe a la franja de circuito.
				const mitad = s.alto / 2;
				const techo = MARGEN.arriba + BARRA_ARRIBA + mitad;
				const suelo = papel.alto - MARGEN.abajo - BARRA_ABAJO - mitad;
				const cy = suelo >= techo ? Math.min(Math.max(cyIdeal, techo), suelo) : (techo + suelo) / 2;
				const pines = new Map<string, PuntoEsq>();
				for (const [id, p] of s.pines) {
					const abs = { x: cx + p.x, y: cy + p.y };
					pines.set(id, abs);
					pinGlobal.set(`${d.id}::${id}`, abs);
				}
				simbolos.push({
					dispositivoId: d.id,
					designacion: d.designacion ?? d.id,
					columna: col + 1,
					x: cx - s.ancho / 2, y: cy - s.alto / 2, ancho: s.ancho, alto: s.alto,
					trazos: s.trazos.map((t) => desplazar(t, cx, cy)),
					pines,
				});
				hojaDeAparato.set(d.id, { hoja: numeroHoja, col: col + 1 });
			}
			hojas.push({
				id: `esq${numeroHoja}`,
				numero: numeroHoja,
				titulo: proyecto.esquema?.titulos?.[String(numeroHoja)]
					?? (nHojas > 1 ? `${grupo.titulo} (${h + 1}/${nHojas})` : grupo.titulo),
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
			hoja.hilos.push({ conductorId: c.id, numero, nodos, bornes: { de: c.de, a: c.a } });
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
			// Sitio ocupado: el símbolo, su designación (que va a la izquierda) y la banda de
			// marcas de borne que asoma por arriba y por abajo de él. Sin contar esa banda, el
			// número del hilo caería justo encima del rótulo del terminal.
			obstaculos: hoja.simbolos.map((s) => ({
				x: s.x - 24, y: s.y - MARCA_BORNE, ancho: s.ancho + 24, alto: s.alto + 2 * MARCA_BORNE,
			})),
		});
	}

	return hojas;
}

type GeometriaSimbolo = ReturnType<typeof simboloDe>;

/** Cada parte referencia el perfil del aparato; nunca copia un segundo aparato eléctrico. */
function simboloDeRepresentacion(d: Dispositivo, r: RepresentacionEsquema): GeometriaSimbolo | undefined {
	if (r.parte.tipo === 'completa') return simboloDe(d);
	const bornes = new Map(d.bornes.map((b) => [b.id, b]));
	if (r.parte.tipo === 'bobina') {
		const perfil = resolverComportamiento(d);
		if (perfil?.clase !== 'contactos-electromagneticos') return undefined;
		const { entrada, retorno } = perfil.bobina;
		const a = bornes.get(entrada);
		const b = bornes.get(retorno);
		if (!a || !b) return undefined;
		return {
			ancho: 12, alto: 20,
			pines: new Map([[entrada, { x: 0, y: -10 }], [retorno, { x: 0, y: 10 }]]),
			trazos: [
				{ tipo: 'linea', a: { x: 0, y: -10 }, b: { x: 0, y: -5 } },
				{ tipo: 'linea', a: { x: 0, y: 5 }, b: { x: 0, y: 10 } },
				{ tipo: 'linea', a: { x: -5, y: -5 }, b: { x: 5, y: -5 } },
				{ tipo: 'linea', a: { x: 5, y: -5 }, b: { x: 5, y: 5 } },
				{ tipo: 'linea', a: { x: 5, y: 5 }, b: { x: -5, y: 5 } },
				{ tipo: 'linea', a: { x: -5, y: 5 }, b: { x: -5, y: -5 } },
				{ tipo: 'texto', p: { x: 1, y: -11 }, texto: rotuloVisibleBorne(a), tam: 2.2 },
				{ tipo: 'texto', p: { x: 1, y: 13 }, texto: rotuloVisibleBorne(b), tam: 2.2 },
			],
		};
	}

	const perfil = resolverComportamiento(d);
	if (!perfil || r.parte.pares.length === 0) return undefined;
	const estadoContacto = (entrada: string, salida: string): boolean | undefined => {
		const igual = (p: { entrada: string; salida: string }) => p.entrada === entrada && p.salida === salida;
		if (perfil.clase === 'contactos-electromagneticos' || perfil.clase === 'proteccion') {
			const contacto = perfil.contactos.find(igual);
			if (contacto) return contacto.reposo === 'cerrado';
			if (perfil.polos.some(igual)) return perfil.clase === 'proteccion';
		} else if (perfil.clase === 'mando' || perfil.clase === 'sensor') {
			const contacto = perfil.contactos.find(igual);
			if (contacto) return contacto.reposo === 'cerrado';
		} else if (perfil.clase === 'variador' && perfil.contactoFallo && igual(perfil.contactoFallo)) {
			return perfil.contactoFallo.reposo === 'cerrado';
		}
		return undefined;
	};
	const ancho = Math.min(18, Math.max(10, r.parte.pares.length * 6));
	const pines = new Map<string, PuntoEsq>();
	const trazos: Trazo[] = [];
	for (const [i, par] of r.parte.pares.entries()) {
		// Un común compartido necesitaría un anclaje gráfico único: no sobrescribirlo en el Map.
		if (par.entrada === par.salida || pines.has(par.entrada) || pines.has(par.salida)) return undefined;
		const a = bornes.get(par.entrada);
		const b = bornes.get(par.salida);
		const cerrado = estadoContacto(par.entrada, par.salida);
		if (!a || !b || cerrado === undefined) return undefined;
		const x = -ancho / 2 + ancho * (i + 0.5) / r.parte.pares.length;
		pines.set(a.id, { x, y: -10 });
		pines.set(b.id, { x, y: 10 });
		trazos.push(
			{ tipo: 'linea', a: { x, y: -10 }, b: { x, y: -4 } },
			{ tipo: 'linea', a: { x, y: 4 }, b: { x, y: 10 } },
			{ tipo: 'linea', a: { x, y: 4 }, b: { x: x + (cerrado ? 0 : 3), y: -4 } },
			{ tipo: 'texto', p: { x: x + 1, y: -11 }, texto: rotuloVisibleBorne(a), tam: 2.2 },
			{ tipo: 'texto', p: { x: x + 1, y: 13 }, texto: rotuloVisibleBorne(b), tam: 2.2 },
		);
	}
	return { ancho, alto: 20, trazos, pines };
}

/** Montaje M2 opt-in: hoja/posición son referencias estables, no columnas globales legacy. */
function montarRepresentaciones(
	proyecto: Proyecto,
	potenciales: ResultadoPotenciales,
	opciones: { columnasPorHoja?: number; hoja?: { ancho: number; alto: number } },
): HojaEsq[] {
	const papel = opciones.hoja ?? HOJA_A3;
	const columnasDefecto = proyecto.esquema?.columnasPorHoja ?? 10;
	const cuentaHojas = new Map<string, number>();
	for (const h of proyecto.hojas) cuentaHojas.set(h.id, (cuentaHojas.get(h.id) ?? 0) + 1);
	const hojas: HojaEsq[] = proyecto.hojas
		.filter((h) => cuentaHojas.get(h.id) === 1)
		.sort((a, b) => a.numero - b.numero || a.id.localeCompare(b.id))
		.map((h) => ({
			id: h.id, numero: h.numero, titulo: h.titulo,
			anchoMm: papel.ancho, altoMm: papel.alto,
			columnas: Math.max(4, Math.min(20, opciones.columnasPorHoja ?? h.columnas ?? columnasDefecto)),
			simbolos: [], hilos: [], referencias: [], problemas: [],
		}));
	const hojaPorId = new Map(hojas.map((h) => [h.id, h]));
	const dispositivoPorId = new Map(proyecto.dispositivos.map((d) => [d.id, d]));
	type Lugar = { pin: PuntoEsq; hoja: HojaEsq; columna: number };
	const lugares = new Map<string, Lugar[]>();
	const simbolosDeAparato = new Map<string, { simbolo: SimboloEsq; hoja: HojaEsq }[]>();
	for (const r of proyecto.esquema?.representaciones ?? []) {
		const d = dispositivoPorId.get(r.dispositivoId);
		const hoja = hojaPorId.get(r.hojaId);
		if (!d || !hoja || esReferenciaVisualInerte(d)) {
			(hoja ?? hojas[0])?.problemas?.push({ codigo: 'representacion-invalida',
				representacionId: r.id, dispositivoId: r.dispositivoId,
				mensaje: `La vista ${r.id} refiere a una hoja o aparato inexistente/no esquemático.`,
			});
			continue;
		}
		const geometria = simboloDeRepresentacion(d, r);
		if (!geometria) {
			hoja.problemas!.push({ codigo: 'representacion-invalida', representacionId: r.id,
				dispositivoId: d.id, mensaje: `La vista ${r.id} no tiene anclajes gráficos inequívocos.` });
			continue;
		}
		const columna = Math.max(1, Math.min(hoja.columnas, r.posicion.columna));
		const fila = Math.max(1, Math.min(FILAS_ESQ, r.posicion.fila));
		const cx = MARGEN.izq + anchoColumna(papel, hoja.columnas) * (columna - 0.5);
		const cyIdeal = alturaDeFila(fila, papel);
		const mitad = geometria.alto / 2;
		const techo = MARGEN.arriba + BARRA_ARRIBA + mitad;
		const suelo = papel.alto - MARGEN.abajo - BARRA_ABAJO - mitad;
		const cy = suelo >= techo ? Math.min(Math.max(cyIdeal, techo), suelo) : (techo + suelo) / 2;
		const pines = new Map<string, PuntoEsq>();
		for (const [borneId, pin] of geometria.pines) {
			const abs = { x: cx + pin.x, y: cy + pin.y };
			pines.set(borneId, abs);
			const clave = JSON.stringify([d.id, borneId]);
			const lista = lugares.get(clave) ?? [];
			lista.push({ pin: abs, hoja, columna });
			lugares.set(clave, lista);
		}
		const simbolo: SimboloEsq = {
			dispositivoId: d.id, representacionId: r.id, parte: r.parte.tipo,
			designacion: d.designacion ?? d.id, columna,
			x: cx - geometria.ancho / 2, y: cy - geometria.alto / 2,
			ancho: geometria.ancho, alto: geometria.alto,
			trazos: geometria.trazos.map((t) => desplazar(t, cx, cy)), pines,
		};
		hoja.simbolos.push(simbolo);
		if (columna !== r.posicion.columna || fila !== r.posicion.fila) {
			hoja.problemas!.push({ codigo: 'posicion-fuera-de-hoja', representacionId: r.id,
				dispositivoId: d.id,
				mensaje: `La vista ${r.id} pide ${r.posicion.columna}.${r.posicion.fila}, fuera de la rejilla ${hoja.columnas}×${FILAS_ESQ}; se muestra en ${columna}.${fila} sin cambiar el proyecto.`,
			});
			hoja.referencias.push({ tipo: 'aviso', representacionId: r.id, dispositivoId: d.id,
				texto: `ubicación pendiente ${r.posicion.columna}.${r.posicion.fila}`,
				p: { x: cx, y: cy + geometria.alto / 2 + 7 },
			});
		}
		const anteriores = simbolosDeAparato.get(d.id) ?? [];
		anteriores.push({ simbolo, hoja });
		simbolosDeAparato.set(d.id, anteriores);
	}
	// Una lista explícita de vistas vacía o parcial NO borra aparatos del circuito. Si no se
	// señalan aquí, el plano aparenta estar terminado mientras oculta equipo real del proyecto.
	for (const d of [...proyecto.dispositivos].sort((a, b) => a.id.localeCompare(b.id))) {
		if (esReferenciaVisualInerte(d) || simbolosDeAparato.has(d.id)) continue;
		const hoja = hojaPorId.get(d.hojaId ?? '') ?? hojas[0];
		hoja?.problemas?.push({ codigo: 'aparato-sin-representacion', dispositivoId: d.id,
			mensaje: `El aparato ${d.designacion ?? d.id} [${d.id}] no tiene ninguna vista válida en el esquema; falta representarlo.`,
		});
	}

	for (const c of proyecto.conductores) {
		const a = lugares.get(JSON.stringify([c.de.dispositivoId, c.de.borneId]));
		const b = lugares.get(JSON.stringify([c.a.dispositivoId, c.a.borneId]));
		// Un borne sin vista o con dos anclajes no se asigna arbitrariamente a una hoja.
		if (a?.length !== 1 || b?.length !== 1) {
			const hoja = (a?.length === 1 ? a[0].hoja : b?.length === 1 ? b[0].hoja : hojas[0]);
			hoja?.problemas?.push({ codigo: 'conexion-sin-ancla', conductorId: c.id,
				mensaje: `El conductor ${c.id} necesita una vista única para cada borne extremo.`,
			});
			continue;
		}
		const origen = a[0], destino = b[0];
		const numero = c.numero ?? potenciales.porConductor.get(c.id)?.id;
		if (origen.hoja.id === destino.hoja.id) {
			const nodos = rutaHilo(origen.pin, destino.pin, origen.hoja);
			origen.hoja.hilos.push({ conductorId: c.id, numero, nodos, bornes: { de: c.de, a: c.a } });
			if (numero) origen.hoja.referencias.push({ texto: numero,
				p: puntoMedioDelTramoMasLargo(nodos), tipo: 'hilo', conductorId: c.id });
		} else {
			for (const [propia, otra, dispositivoId] of [
				[origen, destino, c.de.dispositivoId], [destino, origen, c.a.dispositivoId],
			] as const) {
				propia.hoja.referencias.push({
					dispositivoId, conductorId: c.id, tipo: 'enlace',
					texto: `${numero ? `${numero} ` : ''}→ /${otra.hoja.numero}.${otra.columna}`,
					p: { x: propia.pin.x, y: propia.pin.y + (propia.pin.y > papel.alto / 2 ? 6 : -6) },
				});
			}
		}
	}

	for (const [dispositivoId, vistas] of simbolosDeAparato) {
		const bobinas = vistas.filter(({ simbolo }) => simbolo.parte === 'bobina');
		if (bobinas.length !== 1) continue;
		const bobina = bobinas[0];
		for (const { simbolo, hoja } of vistas) {
			if (simbolo.parte !== 'contactos') continue;
			hoja.referencias.push({
				dispositivoId, representacionId: simbolo.representacionId, tipo: 'bobina',
				texto: `bobina /${bobina.hoja.numero}.${bobina.simbolo.columna}`,
				p: { x: simbolo.x + simbolo.ancho / 2, y: simbolo.y + simbolo.alto + 12 },
			});
		}
	}
	for (const hoja of hojas) separarEtiquetas(hoja.referencias, {
		altoMm: hoja.altoMm,
		obstaculos: hoja.simbolos.map((s) => ({
			x: s.x - 24, y: s.y - MARCA_BORNE, ancho: s.ancho + 24, alto: s.alto + 2 * MARCA_BORNE,
		})),
	});
	return hojas;
}

/**
 * Dónde quedó dibujado cada aparato, en la notación con la que se cita un esquema:
 * «hoja.columna» (p. ej. «2.4»). Es la ÚNICA posición válida para el índice, las
 * referencias cruzadas y el dossier: la que sale del montaje real de las hojas, no una
 * numeración inventada al añadir el aparato.
 */
export function posicionesEnEsquema(hojas: HojaEsq[]): Map<string, string> {
	const posiciones = new Map<string, string>();
	if (hojas.some((h) => h.simbolos.some((s) => s.representacionId))) {
		// El índice general conserva una sola posición por aparato: la bobina es su referencia primaria.
		for (const h of hojas) for (const s of h.simbolos) {
			if (s.parte === 'bobina') posiciones.set(s.dispositivoId, `${h.numero}.${s.columna}`);
		}
		for (const h of hojas) for (const s of h.simbolos) {
			if (!posiciones.has(s.dispositivoId)) posiciones.set(s.dispositivoId, `${h.numero}.${s.columna}`);
		}
		return posiciones;
	}
	for (const h of hojas) {
		for (const s of h.simbolos) posiciones.set(s.dispositivoId, `${h.numero}.${s.columna}`);
	}
	return posiciones;
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
 *
 * Y se apilan SIN SALIRSE DEL RECUADRO. Empujar una etiqueta hacia arriba sin más la sacaba del
 * marco y la dejaba justo encima del renglón de números de columna que va sobre él: dos textos
 * distintos en el mismo sitio, y el número de columna es de lo que más se mira en un plano para
 * decir «esto está en la 5». Cuando por ese lado ya no cabe, se prueba por el otro.
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
	// Dentro de qué puede moverse una etiqueta: el recuadro del plano, dejando el hueco que su
	// propio texto ocupa por encima de la línea base (2,6 mm) y por debajo (0,8 mm).
	const techo = MARGEN.arriba + 2.6;
	const suelo = alto - MARGEN.abajo - 0.8;
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
		const x0 = e.p.x - w / 2;
		const x1 = e.p.x + w / 2;
		const libre = (y: number): boolean =>
			!puestas.some((q) => q.x1 > x0 && q.x0 < x1 && Math.abs(q.y - y) < paso - 0.4)
			&& !bloques.some((b) => b.x1 > x0 && b.x0 < x1 && b.y1 > y - 3 && b.y0 < y + 1.5);
		// Las de la mitad de arriba se apilan hacia arriba; las de abajo, hacia abajo.
		const sentido = e.p.y < alto / 2 ? -1 : 1;
		const inicial = e.p.y;
		for (let intento = 1; intento <= 24 && !libre(e.p.y); intento++) {
			// Primero hacia fuera del dibujo; si por ahí ya no hay recuadro, hacia dentro.
			const candidatos = [inicial + sentido * paso * intento, inicial - sentido * paso * intento]
				.filter((y) => y >= techo && y <= suelo);
			e.p.y = candidatos.find(libre) ?? candidatos[0] ?? Math.min(suelo, Math.max(techo, inicial));
			if (candidatos.length === 0) break;   // no queda hueco por ninguno de los dos lados
		}
		puestas.push({ x0, x1, y: e.p.y });
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
