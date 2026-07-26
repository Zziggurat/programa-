/**
 * Dibuja una hoja de esquema como SVG. Es la única parte que sabe de píxeles: el motor
 * (`src/motores/esquema.ts`) entrega geometría en milímetros de papel y aquí se pinta.
 *
 * Se usa SVG y no Canvas a propósito: el esquema se lee con lupa, se imprime en A3 y se
 * exporta a PDF, y el SVG es nítido a cualquier tamaño y se puede volcar a papel tal cual.
 */
import { HojaEsq, MARGEN, Trazo } from '../src/motores/esquema.js';

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

/** Cajetín inferior derecho con el nombre del proyecto, el título de la hoja y su número. */
function pintarCajetin(hoja: HojaEsq, o: OpcionesEsquema, tinta: string, suave: string): string {
	const ancho = 120;
	const alto = 24;
	const x = hoja.anchoMm - MARGEN.der - ancho;
	const y = hoja.altoMm - MARGEN.abajo + 3;
	return [
		`<rect x="${n(x)}" y="${n(y)}" width="${ancho}" height="${alto}" fill="none" stroke="${tinta}" stroke-width="0.5"/>`,
		`<line x1="${n(x)}" y1="${n(y + 9)}" x2="${n(x + ancho)}" y2="${n(y + 9)}" stroke="${tinta}" stroke-width="0.3"/>`,
		`<line x1="${n(x + ancho - 30)}" y1="${n(y + 9)}" x2="${n(x + ancho - 30)}" y2="${n(y + alto)}" stroke="${tinta}" stroke-width="0.3"/>`,
		`<text x="${n(x + 3)}" y="${n(y + 6.2)}" font-size="4" fill="${tinta}" font-family="system-ui, sans-serif" font-weight="700">${esc(o.proyecto ?? 'TableroStudio')}</text>`,
		`<text x="${n(x + 3)}" y="${n(y + 16)}" font-size="3.4" fill="${tinta}" font-family="system-ui, sans-serif">${esc(hoja.titulo)}</text>`,
		`<text x="${n(x + 3)}" y="${n(y + 21)}" font-size="2.6" fill="${suave}" font-family="system-ui, sans-serif">Esquema según IEC 60617</text>`,
		`<text x="${n(x + ancho - 15)}" y="${n(y + 15)}" font-size="3" text-anchor="middle" fill="${suave}" font-family="system-ui, sans-serif">Hoja</text>`,
		`<text x="${n(x + ancho - 15)}" y="${n(y + 21)}" font-size="4.5" text-anchor="middle" fill="${tinta}" font-family="system-ui, sans-serif" font-weight="700">${hoja.numero}${o.totalHojas ? ` / ${o.totalHojas}` : ''}</text>`,
	].join('');
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

	// Hilos primero: los símbolos van encima y tapan las puntas.
	for (const hilo of hoja.hilos) {
		const d = hilo.nodos.map((p, i) => `${i ? 'L' : 'M'}${n(p.x)} ${n(p.y)}`).join(' ');
		partes.push(`<path d="${d}" fill="none" stroke="${tinta}" stroke-width="0.45" stroke-linejoin="round" data-conductor="${esc(hilo.conductorId)}"/>`);
		if (hilo.numero) {
			// El número del potencial va sobre el tramo más largo, que es donde se lee.
			const m = tramoMasLargo(hilo.nodos);
			partes.push(
				`<rect x="${n(m.x - 3)}" y="${n(m.y - 2.4)}" width="6" height="3.6" rx="0.6" fill="${papel}"/>`
				+ `<text x="${n(m.x)}" y="${n(m.y + 0.5)}" font-size="2.8" text-anchor="middle" fill="${tinta}" font-family="system-ui, sans-serif">${esc(hilo.numero)}</text>`,
			);
		}
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
		partes.push(
			`<g data-dispositivo="${esc(s.dispositivoId)}" class="simbolo">${marca}`
			+ s.trazos.map((t) => pintarTrazo(t, tinta)).join('')
			+ `<text x="${n(s.x - 5)}" y="${n(s.y + s.alto / 2 + 1.2)}" font-size="3.4" text-anchor="end" fill="${tinta}" `
			+ `font-family="system-ui, sans-serif" font-weight="700">${esc(s.designacion)}</text></g>`,
		);
	}

	for (const r of hoja.referencias) {
		partes.push(`<text x="${n(r.p.x)}" y="${n(r.p.y)}" font-size="2.8" text-anchor="middle" fill="${suave}" font-family="system-ui, sans-serif">${esc(r.texto)}</text>`);
	}

	partes.push(pintarCajetin(hoja, o, tinta, suave));
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${hoja.anchoMm} ${hoja.altoMm}" `
		+ `width="100%" height="100%" preserveAspectRatio="xMidYMid meet">${partes.join('')}</svg>`;
}

/** Punto medio del tramo más largo de una polilínea (donde cabe la etiqueta). */
function tramoMasLargo(nodos: { x: number; y: number }[]): { x: number; y: number } {
	let mejor = { x: nodos[0].x, y: nodos[0].y };
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
