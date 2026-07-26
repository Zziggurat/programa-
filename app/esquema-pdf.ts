/**
 * Exporta el esquema a PDF: una página A3 apaisada por hoja, en tinta negra sobre papel
 * blanco, que es como se imprime y se archiva un plano.
 *
 * Se dibuja con las primitivas vectoriales de jsPDF (no una imagen): el PDF queda ligero,
 * se puede ampliar sin pixelarse y el texto se busca y se copia, como en un plano de verdad.
 */
import { jsPDF } from 'jspdf';
import { HojaEsq, MARGEN, Trazo } from '../src/motores/esquema.js';

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

function cajetin(doc: jsPDF, hoja: HojaEsq, proyecto: string, total: number): void {
	const ancho = 120;
	const alto = 24;
	const x = hoja.anchoMm - MARGEN.der - ancho;
	const y = hoja.altoMm - MARGEN.abajo + 3;
	doc.setDrawColor(...TINTA);
	doc.setLineWidth(0.35);
	doc.rect(x, y, ancho, alto);
	doc.setLineWidth(0.2);
	doc.line(x, y + 9, x + ancho, y + 9);
	doc.line(x + ancho - 30, y + 9, x + ancho - 30, y + alto);
	doc.setTextColor(...TINTA);
	doc.setFontSize(10);
	doc.setFont('helvetica', 'bold');
	doc.text(proyecto, x + 3, y + 6.2);
	doc.setFontSize(8.5);
	doc.setFont('helvetica', 'normal');
	doc.text(hoja.titulo, x + 3, y + 16);
	doc.setFontSize(6.5);
	doc.setTextColor(...SUAVE);
	doc.text('Esquema según IEC 60617', x + 3, y + 21);
	doc.setFontSize(7.5);
	doc.text('Hoja', x + ancho - 15, y + 15, { align: 'center' });
	doc.setFontSize(11);
	doc.setFont('helvetica', 'bold');
	doc.setTextColor(...TINTA);
	doc.text(`${hoja.numero} / ${total}`, x + ancho - 15, y + 21, { align: 'center' });
}

/** Genera el PDF con todas las hojas y lo descarga. */
export async function exportarEsquemaPDF(hojas: HojaEsq[], proyecto: string, archivo: string): Promise<void> {
	if (hojas.length === 0) throw new Error('el esquema no tiene hojas');
	const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [hojas[0].anchoMm, hojas[0].altoMm] });

	hojas.forEach((hoja, i) => {
		if (i > 0) doc.addPage([hoja.anchoMm, hoja.altoMm], 'landscape');
		rejilla(doc, hoja);

		// Hilos y sus números.
		doc.setDrawColor(...TINTA);
		doc.setLineWidth(0.3);
		for (const hilo of hoja.hilos) {
			for (let k = 0; k < hilo.nodos.length - 1; k++) {
				doc.line(hilo.nodos[k].x, hilo.nodos[k].y, hilo.nodos[k + 1].x, hilo.nodos[k + 1].y);
			}
			if (!hilo.numero) continue;
			const m = medio(hilo.nodos);
			doc.setFillColor(255, 255, 255);
			doc.rect(m.x - 3, m.y - 2.4, 6, 3.6, 'F');
			doc.setTextColor(...TINTA);
			doc.setFontSize(7);
			doc.setFont('helvetica', 'normal');
			doc.text(hilo.numero, m.x, m.y + 0.6, { align: 'center' });
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

		// Referencias cruzadas y enlaces entre hojas.
		doc.setFontSize(7);
		doc.setFont('helvetica', 'normal');
		doc.setTextColor(...SUAVE);
		for (const r of hoja.referencias) doc.text(r.texto, r.p.x, r.p.y, { align: 'center' });

		cajetin(doc, hoja, proyecto, hojas.length);
	});

	doc.save(archivo);
}

function medio(nodos: { x: number; y: number }[]): { x: number; y: number } {
	let mejor = nodos[0];
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
