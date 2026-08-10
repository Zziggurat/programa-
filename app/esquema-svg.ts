/**
 * Dibuja una hoja de esquema como SVG. Es la única parte que sabe de píxeles: el motor
 * (`src/motores/esquema.ts`) entrega geometría en milímetros de papel y aquí se pinta.
 *
 * Se usa SVG y no Canvas a propósito: el esquema se lee con lupa, se imprime en A3 y se
 * exporta a PDF, y el SVG es nítido a cualquier tamaño y se puede volcar a papel tal cual.
 */
import { anchoEtiquetaMm, HojaEsq, MARGEN, Trazo } from '../src/motores/esquema.js';

/** Escapa texto para que un nombre con < o & no rompa el SVG. */
function esc(t: string): string {
	return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const n = (v: number) => Math.round(v * 100) / 100;

/** Un trazo del motor → su etiqueta SVG. */
function pintarTrazo(t: Trazo, color: string): string {
	if (t.tipo === 'linea') {
		const guion = t.trazos ? ' stroke-dasharray="2 1.5"' : '';
		return `<line x1="${n(t.a.x)}" y1="${n(t.a.y)}" x2="${n(t.b.x)}" y2="${n(t.b.y)}" `
			+ `stroke="${color}" stroke-width="${t.grosor ?? 0.4}"${guion}/>`;
	}
	if (t.tipo === 'circulo') {
		return `<circle cx="${n(t.c.x)}" cy="${n(t.c.y)}" r="${n(t.r)}" fill="${t.relleno ? color : 'none'}" `
			+ `stroke="${color}" stroke-width="0.4"/>`;
	}
	const anclaje = t.anclaje === 'centro' ? 'middle' : t.anclaje === 'der' ? 'end' : 'start';
	return `<text x="${n(t.p.x)}" y="${n(t.p.y)}" font-size="${t.tam ?? 3.2}" text-anchor="${anclaje}" `
		+ `fill="${color}" font-family="system-ui, sans-serif"${t.negrita ? ' font-weight="700"' : ''}>${esc(t.texto)}</text>`;
}

export interface OpcionesEsquema {
	/** Tinta y papel. En pantalla se usa el tema oscuro; en PDF, negro sobre blanco. */
	tinta?: string;
	papel?: string;
	/** Datos del cajetín (rótulo) de la esquina inferior derecha. */
	proyecto?: string;
	/** Cliente, obra, proyectista y revisión: lo que hace seguible un plano en obra. */
	datos?: { cliente?: string; obra?: string; proyectista?: string; revision?: string; fecha?: string };
	totalHojas?: number;
	/** Resalta un aparato (el seleccionado en el resto del programa). */
	resaltado?: string;
}

/**
 * Rejilla de columnas numeradas y filas con letra, como en cualquier plano eléctrico: es lo
 * que permite decir «la bobina está en /2.4» y que el electricista la encuentre.
 */
function pintarRejilla(hoja: HojaEsq, tinta: string, suave: string): string {
	const x0 = MARGEN.izq;
	const x1 = hoja.anchoMm - MARGEN.der;
	const y0 = MARGEN.arriba;
	const y1 = hoja.altoMm - MARGEN.abajo;
	const paso = (x1 - x0) / hoja.columnas;
	const partes: string[] = [
		`<rect x="${n(x0)}" y="${n(y0)}" width="${n(x1 - x0)}" height="${n(y1 - y0)}" fill="none" stroke="${tinta}" stroke-width="0.5"/>`,
	];
	for (let c = 0; c < hoja.columnas; c++) {
		const x = x0 + paso * c;
		if (c > 0) partes.push(`<line x1="${n(x)}" y1="${n(y0)}" x2="${n(x)}" y2="${n(y1)}" stroke="${suave}" stroke-width="0.15"/>`);
		partes.push(`<text x="${n(x + paso / 2)}" y="${n(y0 - 2)}" font-size="3" text-anchor="middle" fill="${suave}" font-family="system-ui, sans-serif">${c + 1}</text>`);
	}
	return partes.join('');
}

/**
 * Cajetín inferior derecho. Un cajetín profesional no lleva solo el título: lleva quién es
 * el cliente, qué obra es, quién lo dibujó, en qué revisión va y de qué fecha es. Sin eso
 * no se puede seguir un plano en obra ni saber si el que tienes en la mano es el vigente.
 */
function pintarCajetin(hoja: HojaEsq, o: OpcionesEsquema, tinta: string, suave: string): string {
	const ancho = 180;
	const alto = 26;
	const x = hoja.anchoMm - MARGEN.der - ancho;
	const y = hoja.altoMm - MARGEN.abajo + 1;
	const d = o.datos ?? {};
	const col2 = x + 96;   // segunda columna del cajetín
	const col3 = x + ancho - 34;
	const PAD = 3;         // aire a los lados de cada casilla
	// Las dos franjas de campos, y dónde cae la línea base del rótulo dentro de cada una: el bloque
	// (rótulo + salto + valor) se centra en su franja, así ninguno de los dos toca las rayas.
	const franja1 = y + 9;
	const franja2 = y + 17.5;
	const altoFranja = 8.5;
	const baseRotulo = (arriba: number): number =>
		baseCentrada(arriba, altoFranja, CUERPO_ROTULO, CUERPO_VALOR).rotulo;
	// Y el ancho de cada casilla en MILÍMETROS, sacado de la propia rejilla del cajetín.
	const anchoIzq = col2 - (x + PAD) - PAD;
	const anchoDer = col3 - (col2 + PAD) - PAD;
	/*
	 * Rótulo y valor. La línea base del valor NO se pone a ojo: se calcula del cuerpo de las dos
	 * letras, para que quede aire aunque la fuente del sistema sea otra. Y el ancho es el de la
	 * casilla EN MILÍMETROS, no un número de caracteres.
	 */
	const campo = (cx: number, cy: number, rotulo: string, valor: string, anchoCaja: number) => {
		const v = enCaja(valor || '—', CUERPO_VALOR, anchoCaja);
		return [
			`<text x="${n(cx)}" y="${n(cy)}" font-size="${CUERPO_ROTULO}" fill="${suave}" font-family="system-ui, sans-serif">${esc(rotulo)}</text>`,
			`<text x="${n(cx)}" y="${n(cy + SALTO_CAMPO)}" font-size="${CUERPO_VALOR}" fill="${tinta}" font-family="system-ui, sans-serif"${v.attr}>`
				+ `${esc(v.texto)}</text>`,
		].join('');
	};
	return [
		`<rect x="${n(x)}" y="${n(y)}" width="${ancho}" height="${alto}" fill="none" stroke="${tinta}" stroke-width="0.5"/>`,
		`<line x1="${n(x)}" y1="${n(y + 9)}" x2="${n(x + ancho)}" y2="${n(y + 9)}" stroke="${tinta}" stroke-width="0.3"/>`,
		`<line x1="${n(x)}" y1="${n(y + 17.5)}" x2="${n(x + ancho)}" y2="${n(y + 17.5)}" stroke="${tinta}" stroke-width="0.3"/>`,
		`<line x1="${n(col2)}" y1="${n(y + 9)}" x2="${n(col2)}" y2="${n(y + alto)}" stroke="${tinta}" stroke-width="0.3"/>`,
		`<line x1="${n(col3)}" y1="${n(y)}" x2="${n(col3)}" y2="${n(y + alto)}" stroke="${tinta}" stroke-width="0.3"/>`,
		// Franja superior: proyecto y nº de hoja.
		tituloProyecto(x + PAD, y + 6.3, o.proyecto ?? 'TableroStudio', col3 - (x + PAD) - PAD, tinta),
		/*
		 * HOJA y su número. Iban a 2,9 y 8,3 —5,4 mm de separación— cuando un rótulo de 2,3 sobre
		 * un número de 4,4 necesita 5,79 para no tocarse. Y el bloque entero no cabía en los 9 mm
		 * de la franja, así que el número baja a 4,0: sigue leyéndose de lejos y ya cabe con aire.
		 */
		`<text x="${n(col3 + 17)}" y="${n(baseCentrada(y, 9, CUERPO_ROTULO, 4).rotulo)}" font-size="${CUERPO_ROTULO}" text-anchor="middle" fill="${suave}" font-family="system-ui, sans-serif">HOJA</text>`,
		`<text x="${n(col3 + 17)}" y="${n(baseCentrada(y, 9, CUERPO_ROTULO, 4).valor)}" font-size="4" text-anchor="middle" fill="${tinta}" font-family="system-ui, sans-serif" font-weight="700">${hoja.numero}${o.totalHojas ? ` / ${o.totalHojas}` : ''}</text>`,
		campo(x + PAD, baseRotulo(franja1), 'CLIENTE', d.cliente ?? '', anchoIzq),
		campo(col2 + PAD, baseRotulo(franja1), 'OBRA', d.obra ?? '', anchoDer),
		campo(x + PAD, baseRotulo(franja2), 'DIBUJÓ', d.proyectista ?? '', anchoIzq),
		campo(col2 + PAD, baseRotulo(franja2), 'FECHA', d.fecha ?? '', anchoDer),
		/*
		 * REV. y su número. El rótulo va en la franja de arriba y el valor en la de abajo, con la
		 * raya en medio: el valor iba a 4,6 con la línea base en y+21, y su parte alta caía en
		 * y+16,5 —POR ENCIMA de la raya de y+17,5—, o sea, dentro de la casilla del rótulo. Ahora
		 * el rótulo se apoya en la raya por arriba y el número va centrado en SU casilla.
		 */
		`<text x="${n(col3 + 17)}" y="${n(franja2 - 0.4 - CUERPO_ROTULO * DESCENDENTE)}" font-size="${CUERPO_ROTULO}" text-anchor="middle" fill="${suave}" font-family="system-ui, sans-serif">REV.</text>`,
		`<text x="${n(col3 + 17)}" y="${n(franja2 + (altoFranja - 4.6 * (ASCENDENTE + DESCENDENTE)) / 2 + 4.6 * ASCENDENTE)}" font-size="4.6" text-anchor="middle" fill="${tinta}" font-family="system-ui, sans-serif" font-weight="700">${esc(d.revision || '—')}</text>`,
		// La nota de normas va FUERA de la casilla, a la izquierda del cajetín. Dentro caía justo
		// encima de los valores de DIBUJÓ y FECHA (la tercera franja ya está ocupada por ellos) y
		// tapaba el nombre del proyectista, que es de lo poco que nadie puede permitirse no leer.
		`<text x="${n(MARGEN.izq)}" y="${n(y + alto - 1.2)}" font-size="2.4" fill="${suave}" font-family="system-ui, sans-serif">Símbolos IEC 60617 · Conjunto según IEC 61439-1/-2</text>`,
	].join('');
}

/*
 * ----------------------------------------------------------------------------------------------
 * EL CAJETÍN SE MIDE EN MILÍMETROS, NO EN LETRAS NI A OJO.
 *
 * Segunda auditoría, TS2-P1-10. El PDF ya recortaba midiendo de verdad (`app/pdf-texto.ts`), pero
 * el SVG —que es el plano que se ve en pantalla y el que se exporta a DXF— seguía con dos apaños:
 *
 *   1. Recortaba por CANTIDAD DE CARACTERES. «40 caracteres» no es una medida: un nombre de
 *      cliente en mayúsculas ocupa casi el doble que en minúsculas y se sale de su casilla.
 *   2. Colocaba rótulo y valor a alturas FIJAS, con 4 mm entre líneas base.
 *
 * Lo segundo es lo que dio la cara. Medido sobre el plano dibujado, con la fuente de este equipo:
 *
 *      CLIENTE  0,56 mm de aire      OBRA   0,56 mm
 *      DIBUJÓ   0,13 mm de aire      FECHA  0,56 mm
 *
 * Trece centésimas. La `J` de DIBUJÓ baja por debajo de la línea base y se come el hueco. Con la
 * fuente que ponga OTRO sistema —`system-ui` es Segoe UI en Windows y aquí es otra— eso pasa a
 * negativo y el rótulo se pisa con el valor. Por eso la auditoría lo vio y aquí la suite pasaba en
 * verde: el defecto estaba, pero solo asomaba con la fuente del que mira.
 *
 * Un plano que se lee bien en la máquina del que lo dibuja y se pisa en la del que lo monta es un
 * plano roto. Así que la altura ya no se pone a ojo: sale de los cuerpos de letra, con el peor
 * caso de ascendente y descendente y una holgura declarada. Y el ancho se comprueba en milímetros;
 * `textLength` obliga además al navegador a meter el texto en su casilla sea cual sea la fuente,
 * que es la única garantía que no depende de acertar con las métricas.
 * ---------------------------------------------------------------------------------------------- */

/** Lo que baja una `J` o una `g` por debajo de la línea base, en fracción del cuerpo. */
const DESCENDENTE = 0.25;
/** Lo que sube una `Ó` o una `f` por encima de la línea base, en fracción del cuerpo. */
const ASCENDENTE = 0.98;
/** Aire que tiene que quedar SIEMPRE entre el rótulo y su valor, pase lo que pase con la fuente. */
const AIRE_MM = 0.9;
/** Ancho medio de una letra, en fracción del cuerpo. Conservador para una sans en mayúsculas. */
const ANCHO_LETRA = 0.62;

/** Cuerpo del rótulo (CLIENTE, OBRA…) y del valor, en mm. */
export const CUERPO_ROTULO = 2.3;
export const CUERPO_VALOR = 3.2;

/** Cuánto baja la línea base del valor respecto a la de su rótulo, para que no se toquen nunca. */
export function saltoDeLinea(cuerpoRotulo: number, cuerpoValor: number): number {
	return cuerpoRotulo * DESCENDENTE + AIRE_MM + cuerpoValor * ASCENDENTE;
}

const SALTO_CAMPO = saltoDeLinea(CUERPO_ROTULO, CUERPO_VALOR);

/**
 * Las dos líneas base de un par rótulo/valor, centrado en su franja.
 *
 * Es la cuenta que antes se hacía a ojo. Se pide la franja —dónde empieza y cuánto mide— y los dos
 * cuerpos de letra, y salen las alturas que dejan el bloque centrado y con aire por los dos lados.
 */
export function baseCentrada(
	arriba: number, alto: number, cuerpoRotulo: number, cuerpoValor: number,
): { rotulo: number; valor: number } {
	const salto = saltoDeLinea(cuerpoRotulo, cuerpoValor);
	const bloque = cuerpoRotulo * ASCENDENTE + salto + cuerpoValor * DESCENDENTE;
	const rotulo = arriba + (alto - bloque) / 2 + cuerpoRotulo * ASCENDENTE;
	return { rotulo, valor: rotulo + salto };
}

/**
 * El título del proyecto de la franja de arriba, recortado por medida como los demás.
 *
 * Iba con `recortar(…, 44)` —cuarenta y cuatro CARACTERES— sobre una casilla de 140 mm. Un nombre
 * de obra en mayúsculas ocupa casi el doble que en minúsculas: con 44 letras cortas sobra sitio, y
 * con 44 largas se metía en la casilla de la hoja.
 */
function tituloProyecto(cx: number, cy: number, titulo: string, anchoCaja: number, tinta: string): string {
	const t = enCaja(titulo, 4, anchoCaja);
	return `<text x="${n(cx)}" y="${n(cy)}" font-size="4" fill="${tinta}" `
		+ `font-family="system-ui, sans-serif" font-weight="700"${t.attr}>${esc(t.texto)}</text>`;
}

/** Ancho estimado de un texto en mm. No es exacto: es el techo con el que se decide si cabe. */
const anchoMm = (t: string, cuerpo: number): number => t.length * cuerpo * ANCHO_LETRA;

/**
 * Un texto que no se sale de su casilla: recortado por MEDIDA, y apretado por `textLength` si aun
 * así el navegador lo dibujase más ancho de lo previsto con su fuente.
 */
function enCaja(t: string, cuerpo: number, anchoCaja: number): { texto: string; attr: string } {
	let texto = t;
	if (anchoMm(texto, cuerpo) > anchoCaja) {
		const caben = Math.max(1, Math.floor(anchoCaja / (cuerpo * ANCHO_LETRA)) - 1);
		texto = `${texto.slice(0, caben)}…`;
	}
	/*
	 * `textLength` solo cuando el texto va APRETADO en su casilla —a más del 80 % del ancho—, que
	 * es donde una fuente más ancha de lo estimado lo sacaría fuera. Ponerlo siempre estiraría un
	 * «ACME» a lo largo de nueve centímetros, que es peor que el problema que resuelve.
	 */
	const apretado = anchoMm(texto, cuerpo) > anchoCaja * 0.8;
	return {
		texto,
		attr: apretado ? ` textLength="${n(anchoCaja)}" lengthAdjust="spacingAndGlyphs"` : '',
	};
}

/** Dibuja una hoja completa y devuelve el SVG como texto. */
export function hojaASvg(hoja: HojaEsq, o: OpcionesEsquema = {}): string {
	const tinta = o.tinta ?? '#0f1216';
	const papel = o.papel ?? '#ffffff';
	const suave = o.tinta ? mezcla(o.tinta, 0.45) : '#7b8794';
	const partes: string[] = [
		`<rect x="0" y="0" width="${hoja.anchoMm}" height="${hoja.altoMm}" fill="${papel}"/>`,
		pintarRejilla(hoja, tinta, suave),
	];

	// Hilos primero: los símbolos van encima y tapan las puntas. Los números NO se colocan
	// aquí: los coloca el motor junto con el resto del texto, para que nada tape a nada.
	for (const hilo of hoja.hilos) {
		const d = hilo.nodos.map((p, i) => `${i ? 'L' : 'M'}${n(p.x)} ${n(p.y)}`).join(' ');
		partes.push(`<path d="${d}" fill="none" stroke="${tinta}" stroke-width="0.45" stroke-linejoin="round" data-conductor="${esc(hilo.conductorId)}"/>`);
	}

	// Puntos de unión: donde tres o más hilos coinciden se marca el nudo, como en un plano real.
	for (const p of nudos(hoja)) {
		partes.push(`<circle cx="${n(p.x)}" cy="${n(p.y)}" r="0.9" fill="${tinta}"/>`);
	}

	for (const s of hoja.simbolos) {
		const marca = s.dispositivoId === o.resaltado
			? `<rect x="${n(s.x - 4)}" y="${n(s.y - 4)}" width="${n(s.ancho + 8)}" height="${n(s.alto + 8)}" rx="2" fill="none" stroke="#2ea3ff" stroke-width="0.8"/>`
			: '';
		// La designación va a la IZQUIERDA del símbolo, como en un esquema de verdad: encima se
		// pisaría con los números de los bornes y con los hilos que entran por arriba.
		// ZONA DE AGARRE. Un <g> de SVG solo recibe el ratón donde hay algo PINTADO, y un símbolo
		// eléctrico son cuatro líneas finas: sin esto había que acertar justo encima de un trazo
		// para seleccionarlo, y arrastrarlo era imposible. El rectángulo es invisible pero sí
		// recibe el puntero, así que se agarra el símbolo entero, rótulo incluido.
		const agarre = `<rect x="${n(s.x - 9)}" y="${n(s.y - 3)}" width="${n(s.ancho + 12)}" `
			+ `height="${n(s.alto + 6)}" fill="transparent" pointer-events="all"/>`;
		partes.push(
			`<g data-dispositivo="${esc(s.dispositivoId)}" class="simbolo">${marca}${agarre}`
			+ s.trazos.map((t) => pintarTrazo(t, tinta)).join('')
			+ `<text x="${n(s.x - 5)}" y="${n(s.y + s.alto / 2 + 1.2)}" font-size="3.4" text-anchor="end" fill="${tinta}" `
			+ `font-family="system-ui, sans-serif" font-weight="700">${esc(s.designacion)}</text></g>`,
		);
	}

	// Todo el texto suelto, ya repartido por el motor: números de hilo, enlaces y bobinas.
	for (const r of hoja.referencias) {
		const anchoCaja = anchoEtiquetaMm(r.texto);
		if (r.tipo === 'hilo') {
			// El número del hilo va sobre un recuadro de papel para que el hilo no lo cruce.
			partes.push(`<rect x="${n(r.p.x - anchoCaja / 2)}" y="${n(r.p.y - 2.4)}" width="${n(anchoCaja)}" height="3.6" rx="0.6" fill="${papel}"/>`);
		}
		const color = r.tipo === 'hilo' ? tinta : suave;
		partes.push(`<text x="${n(r.p.x)}" y="${n(r.p.y + (r.tipo === 'hilo' ? 0.5 : 0))}" font-size="2.8" text-anchor="middle" fill="${color}" font-family="system-ui, sans-serif">${esc(r.texto)}</text>`);
	}

	partes.push(pintarCajetin(hoja, o, tinta, suave));
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${hoja.anchoMm} ${hoja.altoMm}" `
		+ `width="100%" height="100%" preserveAspectRatio="xMidYMid meet">${partes.join('')}</svg>`;
}

/** Puntos donde coinciden tres o más extremos de hilo: son uniones eléctricas, no cruces. */
function nudos(hoja: HojaEsq): { x: number; y: number }[] {
	const cuenta = new Map<string, { p: { x: number; y: number }; n: number }>();
	for (const hilo of hoja.hilos) {
		for (const p of [hilo.nodos[0], hilo.nodos[hilo.nodos.length - 1]]) {
			const clave = `${Math.round(p.x * 2)}:${Math.round(p.y * 2)}`;
			const e = cuenta.get(clave);
			if (e) e.n++; else cuenta.set(clave, { p, n: 1 });
		}
	}
	return [...cuenta.values()].filter((e) => e.n >= 2).map((e) => e.p);
}

/** Aclara u oscurece un color hexadecimal hacia el gris (para los textos secundarios). */
function mezcla(hex: string, k: number): string {
	const v = hex.replace('#', '');
	const r = parseInt(v.slice(0, 2), 16);
	const g = parseInt(v.slice(2, 4), 16);
	const b = parseInt(v.slice(4, 6), 16);
	const m = (c: number) => Math.round(c + (128 - c) * k).toString(16).padStart(2, '0');
	return `#${m(r)}${m(g)}${m(b)}`;
}
