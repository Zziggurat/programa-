/**
 * Utilidades de consulta y construcción sobre el modelo de proyecto.
 */
import {
	Borne, Conductor, Dispositivo, Gabinete, Hoja, OPCIONES_POR_DEFECTO,
	OpcionesProyecto, Proyecto, RefBorne,
} from './tipos.js';

export function crearProyecto(nombre: string, opciones?: OpcionesProyecto): Proyecto {
	return {
		formato: 'tablero-studio',
		version: 1,
		nombre,
		hojas: [],
		dispositivos: [],
		conductores: [],
		opciones,
	};
}

export function opcionesDe(proyecto: Proyecto): Required<OpcionesProyecto> {
	/*
	 * Una clave con valor `undefined` NO pisa el valor por defecto.
	 *
	 * `{ ...{t: 35}, ...{t: undefined} }` da `{t: undefined}`: en JavaScript una clave PRESENTE
	 * con valor `undefined` gana igual. Como el formulario de datos del proyecto escribía
	 * `temperaturaAmbienteC: undefined` al dejar el campo en blanco, el balance térmico calculaba
	 * `undefined + salto` = NaN… hasta que se recargaba la página, momento en el que
	 * `JSON.stringify` ya había omitido la clave y el valor por defecto volvía. Un cálculo que
	 * depende de si has recargado no es un cálculo.
	 */
	const declaradas = Object.fromEntries(
		Object.entries(proyecto.opciones ?? {}).filter(([, v]) => v !== undefined),
	);
	return { ...OPCIONES_POR_DEFECTO, ...declaradas } as Required<OpcionesProyecto>;
}

/**
 * ¿Este dato lo DECLARA el proyecto, o es el valor por defecto del programa?
 *
 * `opcionesDe()` funde los valores por defecto para que los motores siempre tengan con qué
 * calcular, y eso está bien para calcular. Pero para IMPRIMIR no: la placa de características de
 * IEC 61439-1 §6.1 es un documento que firma quien monta el conjunto, y poner en ella «50 Hz» o
 * «35 °C» porque son los valores por defecto del programa es afirmar algo que nadie ha
 * declarado. Con esto, el dossier puede escribir «a declarar» en su lugar.
 */
export function declarado<K extends keyof OpcionesProyecto>(proyecto: Proyecto, campo: K): boolean {
	const v = proyecto.opciones?.[campo];
	return v !== undefined && v !== '';
}

/**
 * Caja envolvente del gabinete. Si el proyecto no la declara se ESTIMA a partir de la placa
 * (margen estándar de 30 mm por lado y 160 mm de fondo), y se dice que es una estimación:
 * dar por bueno un fondo supuesto es lo que hace que un tablero no cierre. Nunca puede ser
 * más pequeña que su propia placa.
 *
 * Vive aquí, en el modelo, porque la usan por igual el dibujo 3D y la ficha del tablero: si
 * cada uno la calculara a su manera, el plano y el papel dirían medidas distintas.
 */
export function cajaDeGabinete(g: Gabinete): {
	ancho: number; alto: number; profundidad: number; estimada: boolean;
} {
	/*
	 * LA PLACA NO TOCA LAS PAREDES, Y ESE MARGEN NO ES DECORATIVO.
	 *
	 * El recorte mínimo era «la placa más un centímetro», o sea cinco milímetros de aire por lado.
	 * Con eso, cualquier cosa que asome del canto de la placa —una canaleta de 40 mm colocada a
	 * 15 mm del borde, que es lo normal— acaba EXACTAMENTE en el plano del costado del armario.
	 * Se veía: pidiendo una caja de 30 × 40 sobre una placa de 30 × 40 aparecía la escalerilla de
	 * las ranuras de la canaleta dibujada sobre la chapa del lateral, porque las dos superficies
	 * se disputaban la misma profundidad. Medido con el rayo: pared del armario y canaleta
	 * devolvían el mismo punto, x = −155,0 las dos.
	 *
	 * Un armario de verdad monta la placa sobre espárragos y deja tres centímetros largos hasta
	 * la pared, que es por donde suben los cables y se atornillan los pasamuros. Así que el
	 * mínimo pasa a ser el MISMO margen que ya se usa cuando nadie declara la caja: si la placa
	 * mide 300, la envolvente no puede medir menos de 360. Deja de ser posible pedir un armario
	 * en el que la placa no cabe.
	 */
	const AIRE = 60;
	return {
		ancho: Math.max(g.caja?.ancho ?? g.ancho + AIRE, g.ancho + AIRE),
		alto: Math.max(g.caja?.alto ?? g.alto + AIRE, g.alto + AIRE),
		profundidad: g.caja?.profundidad ?? 160,
		estimada: !g.caja,
	};
}

export function dispositivo(proyecto: Proyecto, id: string): Dispositivo {
	const d = proyecto.dispositivos.find((d) => d.id === id);
	if (!d) throw new Error(`Dispositivo desconocido: ${id}`);
	return d;
}

export function hoja(proyecto: Proyecto, id: string): Hoja | undefined {
	return proyecto.hojas.find((h) => h.id === id);
}

export function borneDe(d: Dispositivo, borneId: string): Borne | undefined {
	return d.bornes.find((b) => b.id === borneId);
}

/** Clave única de un punto de conexión, usada por el motor de potenciales. */
export function claveBorne(ref: RefBorne): string {
	return `${ref.dispositivoId}::${ref.borneId}`;
}

/** Conductores que llegan a un borne concreto. */
export function conductoresEn(proyecto: Proyecto, ref: RefBorne): Conductor[] {
	return proyecto.conductores.filter(
		(c) =>
			(c.de.dispositivoId === ref.dispositivoId && c.de.borneId === ref.borneId) ||
			(c.a.dispositivoId === ref.dispositivoId && c.a.borneId === ref.borneId),
	);
}

/**
 * Posición legible al estilo QElectroTech: "hoja.FilaColumna", p. ej. "2.B3".
 * Las filas se nombran con letras (A, B, C…) y las columnas con números desde 1.
 */
export function posicionTexto(proyecto: Proyecto, d: Dispositivo): string {
	if (!d.hojaId || !d.posicion) return '?';
	const h = hoja(proyecto, d.hojaId);
	const numero = h ? h.numero : '?';
	const fila = String.fromCharCode(65 + Math.max(0, Math.floor(d.posicion.y)));
	const columna = Math.max(1, Math.floor(d.posicion.x) + 1);
	return `${numero}.${fila}${columna}`;
}

/** Descripción corta de un extremo de conductor: "K1:A1" (usa designación si existe). */
export function extremoTexto(proyecto: Proyecto, ref: RefBorne): string {
	const d = dispositivo(proyecto, ref.dispositivoId);
	return `${d.designacion ?? d.id}:${ref.borneId}`;
}
