/**
 * Exportación del proyecto a PDF (dossier técnico) con jsPDF.
 *
 * Incluye: portada con datos del gabinete, verificación DRC, LISTA DE MATERIALES
 * completa (BOM), índice de dispositivos, lista de conductores con longitudes y
 * planes de borneros. Se apoya en los motores del núcleo (src/motores).
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

import { Proyecto } from '../src/modelo/tipos.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';
import { numerarConductores, numerarDispositivos } from '../src/motores/numeracion.js';
import { verificarProyecto } from '../src/motores/drc.js';
import { rutearConductores } from '../src/motores/ruteo.js';
import { generarReferencias } from '../src/motores/referencias.js';
import { generarPlanBorneros } from '../src/motores/bornes.js';
import { generarBOM, generarListaConductores } from '../src/motores/documentacion.js';
import { cajaDe } from './escena3d.js';

const AZUL: [number, number, number] = [43, 74, 111];
const GRIS: [number, number, number] = [90, 98, 106];

/** Genera y descarga el dossier técnico del proyecto en PDF. */
export function exportarPDF(proyecto: Proyecto): void {
	// Recalcular todo para que el PDF refleje el estado actual del tablero.
	numerarDispositivos(proyecto);
	const potenciales = calcularPotenciales(proyecto);
	numerarConductores(proyecto, potenciales);
	const ruteo = rutearConductores(proyecto);
	const hallazgos = verificarProyecto(proyecto, potenciales);
	const referencias = generarReferencias(proyecto);
	const bom = generarBOM(proyecto);
	const conductores = generarListaConductores(proyecto, ruteo);
	const planes = generarPlanBorneros(proyecto, potenciales);

	const doc = new jsPDF({ unit: 'mm', format: 'a4' });
	const anchoPag = doc.internal.pageSize.getWidth();
	const fecha = new Date().toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' });

	// Numeración de página y pie, común a todas las páginas al final.
	const secciones: string[] = [];
	let y = 0;

	const cabecera = (titulo: string): void => {
		doc.setFillColor(...AZUL);
		doc.rect(0, 0, anchoPag, 16, 'F');
		doc.setTextColor(255);
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(11);
		doc.text('TableroStudio', 12, 10);
		doc.setFont('helvetica', 'normal');
		doc.setFontSize(9);
		doc.text(proyecto.nombre, anchoPag - 12, 10, { align: 'right' });
		doc.setTextColor(0);
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(14);
		doc.text(titulo, 12, 27);
		doc.setDrawColor(...AZUL);
		doc.setLineWidth(0.5);
		doc.line(12, 30, anchoPag - 12, 30);
		y = 38;
		secciones.push(titulo);
	};

	const tabla = (cabeceras: string[], filas: (string | number)[][], anchos?: Record<number, number>): void => {
		autoTable(doc, {
			startY: y,
			head: [cabeceras],
			body: filas.map((f) => f.map((c) => (c === undefined || c === null ? '' : String(c)))),
			theme: 'striped',
			headStyles: { fillColor: AZUL, fontSize: 9 },
			bodyStyles: { fontSize: 8.5 },
			alternateRowStyles: { fillColor: [244, 246, 248] },
			margin: { left: 12, right: 12 },
			columnStyles: anchos ? Object.fromEntries(Object.entries(anchos).map(([k, v]) => [k, { cellWidth: v }])) : undefined,
		});
		// @ts-expect-error autotable añade lastAutoTable
		y = (doc.lastAutoTable?.finalY ?? y) + 8;
	};

	/* ---------------------------- Portada ---------------------------- */
	doc.setFillColor(...AZUL);
	doc.rect(0, 0, anchoPag, 70, 'F');
	doc.setTextColor(255);
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(26);
	doc.text('Dossier técnico', 20, 38);
	doc.setFontSize(16);
	doc.setFont('helvetica', 'normal');
	doc.text(proyecto.nombre, 20, 50);
	doc.setFontSize(10);
	doc.text('Generado por TableroStudio · ' + fecha, 20, 60);

	doc.setTextColor(0);
	const g = proyecto.gabinete;
	const caja = g ? cajaDe(g) : undefined;
	const internos = proyecto.dispositivos.filter((d) => !d.campo && !d.imagen);
	const errores = hallazgos.filter((h) => h.severidad === 'error').length;
	const avisos = hallazgos.length - errores;
	const totalCable = ruteo.rutas.reduce((s, r) => s + r.longitudMm, 0);

	y = 88;
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(12);
	doc.text('Resumen del proyecto', 20, y);
	y += 4;
	const resumen: [string, string][] = [
		['Aparatos (dentro del gabinete)', String(internos.length)],
		['Conductores', String(proyecto.conductores.length)],
		['Longitud total de cable', `${(totalCable / 1000).toFixed(1)} m`],
		['Referencias de material distintas', String(bom.length)],
		['Caja eléctrica', caja ? `${(caja.ancho / 10).toFixed(0)} × ${(caja.alto / 10).toFixed(0)} × ${(caja.profundidad / 10).toFixed(0)} cm` : '—'],
		['Placa de montaje', g ? `${(g.ancho / 10).toFixed(0)} × ${(g.alto / 10).toFixed(0)} cm` : '—'],
		['Verificación eléctrica (DRC)', errores ? `${errores} errores · ${avisos} avisos` : (avisos ? `${avisos} avisos` : 'Sin hallazgos')],
	];
	autoTable(doc, {
		startY: y,
		body: resumen,
		theme: 'plain',
		bodyStyles: { fontSize: 10 },
		columnStyles: { 0: { fontStyle: 'bold', cellWidth: 90, textColor: GRIS }, 1: { cellWidth: 80 } },
		margin: { left: 20, right: 20 },
	});

	/* --------------------- 1. Lista de materiales --------------------- */
	doc.addPage();
	cabecera('1. Lista de materiales (BOM)');
	if (bom.length === 0) {
		doc.setFontSize(10);
		doc.text('El proyecto no tiene aparatos.', 12, y);
	} else {
		let totalUnidades = 0;
		const filas = bom.map((f, i) => {
			totalUnidades += f.cantidad;
			return [i + 1, f.cantidad, f.descripcion || '—', f.fabricante || '—', f.referencia || '—', f.designaciones.join(', ')];
		});
		filas.push(['', totalUnidades, 'TOTAL DE UNIDADES', '', '', '']);
		tabla(['#', 'Cant.', 'Descripción', 'Fabricante', 'Referencia', 'Marcado'], filas,
			{ 0: 8, 1: 12, 3: 30, 4: 30 });
	}

	/* --------------------- 2. Índice de dispositivos --------------------- */
	doc.addPage();
	cabecera('2. Índice de dispositivos');
	tabla(['Designación', 'Descripción', 'Tensión', 'Posición esquema'],
		referencias.indice.map((e) => {
			const d = proyecto.dispositivos.find((x) => x.id === e.dispositivoId);
			return [e.designacion, e.descripcion || '—', d?.tensionNominal ? `${d.tensionNominal} V` : '—', e.posicion];
		}), { 0: 28, 2: 22, 3: 30 });

	/* --------------------- 3. Lista de conductores --------------------- */
	doc.addPage();
	cabecera('3. Lista de conductores');
	if (conductores.length === 0) {
		doc.setFontSize(10);
		doc.text('El proyecto no tiene conductores.', 12, y);
	} else {
		tabla(['Nº', 'Desde', 'Hacia', 'Sección', 'Color', 'Longitud'],
			conductores.map((c) => [c.numero, c.de, c.a, c.seccion || '—', c.color || '—',
				c.longitudMm ? `${(c.longitudMm / 1000).toFixed(2)} m` : '—']),
			{ 0: 14, 3: 20, 5: 22 });
	}

	/* --------------------- 4. Referencias cruzadas --------------------- */
	if (referencias.cruzadas.length > 0) {
		doc.addPage();
		cabecera('4. Referencias cruzadas');
		const filas = referencias.cruzadas.flatMap((x) =>
			x.contactos.length === 0
				? [[x.designacion, x.posicion, '(sin contactos)', '', '']]
				: x.contactos.map((c) => [x.designacion, x.posicion, c.designacion, c.contacto, c.posicion]));
		tabla(['Maestro', 'Posición', 'Contacto', 'Tipo', 'Posición'], filas);
	}

	/* --------------------- 5. Planes de borneros --------------------- */
	for (const plan of planes) {
		doc.addPage();
		cabecera(`Bornero ${plan.designacion}`);
		tabla(['Borna', 'Interna', 'Externa', 'Nº cond.', 'Puentes'],
			plan.filas.map((f) => [f.borna, f.internas.join(' / ') || '—', f.externas.join(' / ') || '—',
				f.numeroConductor || '—', f.puenteCon.join(', ') || '—']));
	}

	/* --------------------- 6. Verificación DRC --------------------- */
	doc.addPage();
	cabecera('Verificación eléctrica (DRC)');
	if (hallazgos.length === 0) {
		doc.setFontSize(11);
		doc.setTextColor(30, 130, 60);
		doc.text('Sin errores ni avisos. El tablero pasa todas las reglas.', 12, y);
		doc.setTextColor(0);
	} else {
		tabla(['Severidad', 'Regla', 'Detalle'],
			hallazgos.map((h) => [h.severidad === 'error' ? 'ERROR' : 'aviso', h.regla, h.mensaje]),
			{ 0: 22, 1: 42 });
	}

	/* --------------------- Pie de página en todas --------------------- */
	const paginas = doc.getNumberOfPages();
	for (let i = 1; i <= paginas; i++) {
		doc.setPage(i);
		doc.setFontSize(8);
		doc.setTextColor(...GRIS);
		doc.text(`Página ${i} de ${paginas}`, anchoPag - 12, 290, { align: 'right' });
		doc.text('TableroStudio — dossier técnico', 12, 290);
	}

	const nombre = proyecto.nombre.replace(/[^\wáéíóúñ -]/gi, '').trim() || 'tablero';
	doc.save(`${nombre} - dossier.pdf`);
}
