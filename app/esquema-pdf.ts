/**
 * Exporta el esquema a PDF: una página A3 apaisada por hoja, en tinta negra sobre papel
 * blanco, que es como se imprime y se archiva un plano.
 *
 * Se dibuja con las primitivas vectoriales de jsPDF (no una imagen): el PDF queda ligero,
 * se puede ampliar sin pixelarse y el texto se busca y se copia, como en un plano de verdad.
 */
import { jsPDF } from 'jspdf';
import { anchoEtiquetaMm, HojaEsq, MARGEN, Trazo } from '../src/motores/esquema.js';

const TINTA: [number, number, number] = [15, 18, 22];
const SUAVE: [number, number, number] = [120, 132, 145];

/** Dibuja un trazo del motor en el PDF. Las coordenadas ya vienen en mm de papel. */
function trazar(doc: jsPDF, t: Trazo): void {
	if (t.tipo === 'linea') {
		doc.setLineWidth(t.grosor ?? 0.25);
		if (t.trazos) doc.setLineDashPattern([1.2, 1], 0);
		doc.line(t.a.x, t.a.y, t.b.x, t.b.y);
		if (t.trazos) doc.setLineDashPattern([], 0);
		return;
	}
	if (t.tipo === 'circulo') {
		doc.setLineWidth(0.25);
		doc.circle(t.c.x, t.c.y, t.r, t.relleno ? 'F' : 'S');
		return;
	}
	doc.setFontSize((t.tam ?? 3.2) * 2.55); // mm → puntos
	doc.setFont('helvetica', t.negrita ? 'bold' : 'normal');
	doc.text(t.texto, t.p.x, t.p.y, { align: t.anclaje === 'centro' ? 'center' : t.anclaje === 'der' ? 'right' : 'left' });
}

function rejilla(doc: jsPDF, hoja: HojaEsq): void {
	const x0 = MARGEN.izq;
	const x1 = hoja.anchoMm - MARGEN.der;
	const y0 = MARGEN.arriba;
	const y1 = hoja.altoMm - MARGEN.abajo;
	const paso = (x1 - x0) / hoja.columnas;
	doc.setDrawColor(...TINTA);
	doc.setLineWidth(0.35);
	doc.rect(x0, y0, x1 - x0, y1 - y0);
	doc.setLineWidth(0.1);
	doc.setDrawColor(...SUAVE);
	for (let c = 1; c < hoja.columnas; c++) {
		const x = x0 + paso * c;
		doc.line(x, y0, x, y1);
	}
	doc.setTextColor(...SUAVE);
	doc.setFontSize(7);
	doc.setFont('helvetica', 'normal');
	for (let c = 0; c < hoja.columnas; c++) {
		doc.text(String(c + 1), x0 + paso * (c + 0.5), y0 - 1.6, { align: 'center' });
	}
}

export interface DatosCajetin {
	cliente?: string; obra?: string; proyectista?: string; revision?: string; fecha?: string;
}

/** Cajetín con los datos que hacen seguible un plano en obra (mismo diseño que en pantalla). */
function cajetin(doc: jsPDF, hoja: HojaEsq, proyecto: string, total: number, d: DatosCajetin = {}): void {
	const ancho = 180;
	const alto = 26;
	const x = hoja.anchoMm - MARGEN.der - ancho;
	const y = hoja.altoMm - MARGEN.abajo + 1;
	const col2 = x + 96;
	const col3 = x + ancho - 34;
	doc.setDrawColor(...TINTA);
	doc.setLineWidth(0.35);
	doc.rect(x, y, ancho, alto);
	doc.setLineWidth(0.2);
	doc.line(x, y + 9, x + ancho, y + 9);
	doc.line(x, y + 17.5, x + ancho, y + 17.5);
	doc.line(col2, y + 9, col2, y + alto);
	doc.line(col3, y, col3, y + alto);

	const campo = (cx: number, cy: number, rotulo: string, valor: string, max: number) => {
		doc.setFontSize(5.4);
		doc.setTextColor(...SUAVE);
		doc.setFont('helvetica', 'normal');
		doc.text(rotulo, cx, cy);
		doc.setFontSize(7.6);
		doc.setTextColor(...TINTA);
		doc.text(valor || '—', cx, cy + 4, { maxWidth: max });
	};

	doc.setFontSize(10);
	doc.setFont('helvetica', 'bold');
	doc.setTextColor(...TINTA);
	doc.text(proyecto, x + 3, y + 6.3, { maxWidth: col3 - x - 6 });
	doc.setFontSize(5.4);
	doc.setFont('helvetica', 'normal');
	doc.setTextColor(...SUAVE);
	doc.text('HOJA', col3 + 17, y + 3.4, { align: 'center' });
	doc.setFontSize(11);
	doc.setFont('helvetica', 'bold');
	doc.setTextColor(...TINTA);
	doc.text(`${hoja.numero} / ${total}`, col3 + 17, y + 8.6, { align: 'center' });

	doc.setFont('helvetica', 'normal');
	campo(x + 3, y + 12.4, 'CLIENTE', d.cliente ?? '', 88);
	campo(col2 + 3, y + 12.4, 'OBRA', d.obra ?? '', 74);
	campo(x + 3, y + 21, 'DIBUJÓ', d.proyectista ?? '', 88);
	campo(col2 + 3, y + 21, 'FECHA', d.fecha ?? '', 74);
	doc.setFontSize(5.4);
	doc.setTextColor(...SUAVE);
	doc.text('REV.', col3 + 17, y + 15.5, { align: 'center' });
	doc.setFontSize(11);
	doc.setFont('helvetica', 'bold');
	doc.setTextColor(...TINTA);
	doc.text(d.revision || '—', col3 + 17, y + 21, { align: 'center' });
	doc.setFontSize(5.4);
	doc.setFont('helvetica', 'normal');
	doc.setTextColor(...SUAVE);
	// Fuera de la casilla, a la izquierda del cajetín: dentro caía encima de los valores de
	// DIBUJÓ y FECHA, que ocupan esa misma franja.
	doc.text('Símbolos IEC 60617 · Conjunto según IEC 61439-1/-2', MARGEN.izq, y + alto - 1.4);
}

/** Genera el PDF con todas las hojas y lo descarga. */
export async function exportarEsquemaPDF(
	hojas: HojaEsq[], proyecto: string, archivo: string, datos: DatosCajetin = {},
): Promise<void> {
	if (hojas.length === 0) throw new Error('el esquema no tiene hojas');
	const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [hojas[0].anchoMm, hojas[0].altoMm] });

	hojas.forEach((hoja, i) => {
		if (i > 0) doc.addPage([hoja.anchoMm, hoja.altoMm], 'landscape');
		rejilla(doc, hoja);

		// Hilos. Sus números los coloca el motor junto al resto del texto (ver más abajo).
		doc.setDrawColor(...TINTA);
		doc.setLineWidth(0.3);
		for (const hilo of hoja.hilos) {
			for (let k = 0; k < hilo.nodos.length - 1; k++) {
				doc.line(hilo.nodos[k].x, hilo.nodos[k].y, hilo.nodos[k + 1].x, hilo.nodos[k + 1].y);
			}
		}

		// Símbolos con su designación.
		doc.setDrawColor(...TINTA);
		doc.setTextColor(...TINTA);
		for (const s of hoja.simbolos) {
			for (const t of s.trazos) trazar(doc, t);
			doc.setFontSize(8.5);
			doc.setFont('helvetica', 'bold');
			doc.setTextColor(...TINTA);
			doc.text(s.designacion, s.x - 5, s.y + s.alto / 2 + 1.2, { align: 'right' });
		}

		// Todo el texto suelto, ya repartido por el motor: nada puede tapar a nada.
		doc.setFont('helvetica', 'normal');
		doc.setFontSize(7);
		for (const r of hoja.referencias) {
			if (r.tipo === 'hilo') {
				const ancho = anchoEtiquetaMm(r.texto);
				doc.setFillColor(255, 255, 255);
				doc.rect(r.p.x - ancho / 2, r.p.y - 2.4, ancho, 3.6, 'F');
			}
			doc.setTextColor(...(r.tipo === 'hilo' ? TINTA : SUAVE));
			doc.text(r.texto, r.p.x, r.p.y + (r.tipo === 'hilo' ? 0.6 : 0), { align: 'center' });
		}

		cajetin(doc, hoja, proyecto, hojas.length, datos);
	});

	doc.save(archivo);
}

