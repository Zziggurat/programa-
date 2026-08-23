/**
 * Exportaciones del proyecto que no son el dossier: las tiras de rótulos y el DXF.
 * Aquí se traduce el modelo a cada formato; los motores puros deciden el contenido.
 */
import { jsPDF } from 'jspdf';
import { Proyecto } from '../src/modelo/tipos.js';
import { esReferenciaVisualInerte } from '../src/modelo/apariencia.js';
import { ResultadoPotenciales } from '../src/motores/potenciales.js';
import { todasLasTiras } from '../src/motores/etiquetas.js';
import { EntidadDXF, generarDXF, rectangulo } from '../src/motores/dxf.js';
import { HojaEsq } from '../src/motores/esquema.js';

/* ------------------------------ Etiquetas imprimibles ------------------------------ */

/** Medidas de una etiqueta de borna típica (las tiras de 6×20 mm entran en casi toda regleta). */
const ETIQUETA = { ancho: 20, alto: 6 };

/**
 * PDF de rótulos, en A4 vertical y a ESCALA REAL: se imprime al 100 % (sin «ajustar a página»),
 * se corta por las guías y se mete en el portaetiquetas. Cada tira lleva su título para saber
 * a qué bornero pertenece.
 */
export function exportarEtiquetasPDF(proyecto: Proyecto, potenciales: ResultadoPotenciales, archivo: string): void {
	const tiras = todasLasTiras(proyecto, potenciales);
	if (tiras.length === 0) throw new Error('el proyecto no tiene bornes ni aparatos que rotular');
	const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
	const margen = 12;
	const anchoUtil = 210 - margen * 2;
	const porFila = Math.max(1, Math.floor(anchoUtil / ETIQUETA.ancho));
	let y = margen + 6;

	doc.setFontSize(9);
	doc.setFont('helvetica', 'normal');
	doc.setTextColor(120, 132, 145);
	doc.text('Imprimir al 100 % (sin ajustar a la página) — las etiquetas están a tamaño real', margen, margen);

	/** Cabecera de una tira. Se repite al cambiar de página: una hoja de rótulos sin saber a
	 *  qué bornero pertenecen no sirve de nada cuando estás con la regleta delante. */
	const cabecera = (titulo: string, continuacion = false) => {
		doc.setFontSize(11);
		doc.setFont('helvetica', 'bold');
		doc.setTextColor(15, 18, 22);
		doc.text(continuacion ? `${titulo} (continuación)` : titulo, margen, y + 4);
		y += 8;
	};

	for (const tira of tiras) {
		if (y + 14 + ETIQUETA.alto > 297 - margen) { doc.addPage(); y = margen + 6; }
		cabecera(tira.titulo);

		tira.etiquetas.forEach((e, i) => {
			const col = i % porFila;
			if (col === 0 && i > 0) y += ETIQUETA.alto;
			if (y + ETIQUETA.alto > 297 - margen) { doc.addPage(); y = margen + 6; cabecera(tira.titulo, true); }
			const x = margen + col * ETIQUETA.ancho;
			doc.setDrawColor(190, 196, 202);
			doc.setLineWidth(0.15);
			doc.rect(x, y, ETIQUETA.ancho, ETIQUETA.alto);
			doc.setTextColor(15, 18, 22);
			doc.setFontSize(e.principal.length > 6 ? 6.5 : 8);
			doc.setFont('helvetica', 'bold');
			doc.text(e.principal, x + ETIQUETA.ancho / 2, y + (e.secundaria ? 2.9 : 4), {
				align: 'center', maxWidth: ETIQUETA.ancho - 1.5,
			});
			if (e.secundaria) {
				doc.setFontSize(4);
				doc.setFont('helvetica', 'normal');
				doc.setTextColor(110, 120, 130);
				doc.text(e.secundaria, x + ETIQUETA.ancho / 2, y + 5, { align: 'center', maxWidth: ETIQUETA.ancho - 1.5 });
			}
		});
		y += ETIQUETA.alto + 7;
	}
	doc.save(archivo);
}

/* ---------------------------------- DXF ---------------------------------- */

/**
 * Placa de montaje en DXF: la caja, los rieles, las canaletas y la huella de cada aparato con
 * su designación, cada cosa en su capa. Es lo que se manda al taller para taladrar y montar.
 */
export function dxfDePlaca(proyecto: Proyecto): string {
	const g = proyecto.gabinete;
	if (!g) throw new Error('el proyecto no tiene gabinete');
	const e: EntidadDXF[] = [...rectangulo('PLACA', 0, 0, g.ancho, g.alto)];

	for (const r of g.rieles) {
		const ancho = r.orientacion === 'v' ? 35 : r.largo;
		const alto = r.orientacion === 'v' ? r.largo : 35;
		e.push(...rectangulo('RIELES', r.x, r.y - 17.5, ancho, alto));
	}
	for (const c of g.canaletas) {
		const ancho = c.orientacion === 'v' ? c.ancho : c.largo;
		const alto = c.orientacion === 'v' ? c.largo : c.ancho;
		e.push(...rectangulo('CANALETAS', c.x, c.y, ancho, alto));
	}
	for (const col of g.colocaciones) {
		const d = proyecto.dispositivos.find((x) => x.id === col.dispositivoId);
		if (!d || esReferenciaVisualInerte(d)) continue;
		e.push(...rectangulo('APARATOS', col.x, col.y, col.ancho, col.alto));
		e.push({
			capa: 'TEXTO',
			trazo: { tipo: 'texto', x: col.x + 1.5, y: col.y + col.alto / 2 + 1.5, texto: d.designacion ?? d.id, alto: 4 },
		});
	}
	// Cotas generales de la placa, que es lo primero que mira quien la fabrica.
	e.push({ capa: 'COTAS', trazo: { tipo: 'texto', x: 0, y: -6, texto: `Placa ${g.ancho} x ${g.alto} mm`, alto: 5 } });
	return generarDXF(e, g.alto);
}

/** Una hoja del esquema en DXF, para quien quiera seguir el plano en AutoCAD. */
export function dxfDeEsquema(hoja: HojaEsq): string {
	const e: EntidadDXF[] = [];
	for (const hilo of hoja.hilos) {
		for (let i = 0; i < hilo.nodos.length - 1; i++) {
			e.push({ capa: 'CABLES', trazo: {
				tipo: 'linea',
				x1: hilo.nodos[i].x, y1: hilo.nodos[i].y,
				x2: hilo.nodos[i + 1].x, y2: hilo.nodos[i + 1].y,
			} });
		}
	}
	for (const s of hoja.simbolos) {
		for (const t of s.trazos) {
			if (t.tipo === 'linea') e.push({ capa: 'APARATOS', trazo: { tipo: 'linea', x1: t.a.x, y1: t.a.y, x2: t.b.x, y2: t.b.y } });
			else if (t.tipo === 'circulo') e.push({ capa: 'APARATOS', trazo: { tipo: 'circulo', x: t.c.x, y: t.c.y, r: t.r } });
			else e.push({ capa: 'TEXTO', trazo: { tipo: 'texto', x: t.p.x, y: t.p.y, texto: t.texto, alto: t.tam ?? 3.2 } });
		}
		e.push({ capa: 'TEXTO', trazo: { tipo: 'texto', x: s.x - 4, y: s.y + s.alto / 2, texto: s.designacion, alto: 3.4 } });
	}
	e.push(...rectangulo('COTAS', 0, 0, hoja.anchoMm, hoja.altoMm));
	return generarDXF(e, hoja.altoMm);
}
