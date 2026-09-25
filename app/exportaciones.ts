/**
 * Exportaciones del proyecto que no son el dossier: las tiras de rótulos y el DXF.
 * Aquí se traduce el modelo a cada formato; los motores puros deciden el contenido.
 */
import { jsPDF } from 'jspdf';
import { Proyecto } from '../src/modelo/tipos.js';
import { resumenProcedenciaDocumento, type ProcedenciaDocumento } from '../src/modelo/procedencia-documental.js';
import { esReferenciaVisualInerte } from '../src/modelo/apariencia.js';
import { ResultadoPotenciales } from '../src/motores/potenciales.js';
import { todasLasTiras } from '../src/motores/etiquetas.js';
import { EntidadDXF, generarDXF, rectangulo, sinAcentos } from '../src/motores/dxf.js';
import { HojaEsq, resumenPendientesEsquema } from '../src/motores/esquema.js';
import { crucesSinUnion, nudosPorBorne, solapesColinealesSinResolver,
	tramosVisiblesDeHilo } from '../src/motores/cruces-esquema.js';

/* ------------------------------ Etiquetas imprimibles ------------------------------ */

/** Medidas de una etiqueta de borna típica (las tiras de 6×20 mm entran en casi toda regleta). */
const ETIQUETA = { ancho: 20, alto: 6 };

/**
 * PDF de rótulos, en A4 vertical y a ESCALA REAL: se imprime al 100 % (sin «ajustar a página»),
 * se corta por las guías y se mete en el portaetiquetas. Cada tira lleva su título para saber
 * a qué bornero pertenece.
 */
export function exportarEtiquetasPDF(proyecto: Proyecto, potenciales: ResultadoPotenciales, archivo: string,
	procedencia?: ProcedenciaDocumento): void {
	const tiras = todasLasTiras(proyecto, potenciales);
	if (tiras.length === 0) throw new Error('el proyecto no tiene bornes ni aparatos que rotular');
	const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
	const margen = 12;
	const anchoUtil = 210 - margen * 2;
	const porFila = Math.max(1, Math.floor(anchoUtil / ETIQUETA.ancho));
	let y = margen + 6;
	// La identidad ocupa una banda propia; jamás cambia la escala de las etiquetas.
	const limiteEtiquetas = procedencia ? 278 : 297 - margen;

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
		if (y + 14 + ETIQUETA.alto > limiteEtiquetas) { doc.addPage(); y = margen + 6; }
		cabecera(tira.titulo);

		tira.etiquetas.forEach((e, i) => {
			const col = i % porFila;
			if (col === 0 && i > 0) y += ETIQUETA.alto;
			if (y + ETIQUETA.alto > limiteEtiquetas) { doc.addPage(); y = margen + 6; cabecera(tira.titulo, true); }
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
	if (procedencia) {
		const identidad = resumenProcedenciaDocumento(procedencia);
		const unaLinea = (valor: string) => valor.replace(/[\x00-\x1f\x7f]+/g, ' ').trim();
		doc.setProperties({ title: `Rótulos — ${proyecto.nombre}`,
			subject: `Project ID ${identidad.projectId}; revisión repositorio ${identidad.revisionRepositorio}; `
				+ `revisión editorial ${proyecto.datos?.revision ?? 'no declarada'}; `
				+ `fecha editorial ${proyecto.datos?.fecha ?? 'no declarada'}; ${identidad.estado}`,
			keywords: `Build ID ${identidad.buildId}; generado ${identidad.generadoEn}` });
		for (let pagina = 1; pagina <= doc.getNumberOfPages(); pagina++) {
			doc.setPage(pagina);
			doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5);
			doc.setTextColor(80, 90, 100);
			doc.text(unaLinea(`Tablero ${proyecto.nombre} · ${identidad.estado} · Rev. ed. ${proyecto.datos?.revision ?? 'no declarada'}`),
				margen, 282, { maxWidth: anchoUtil });
			doc.text(unaLinea(`Project ID ${identidad.projectId} · Revisión repositorio ${identidad.revisionRepositorio} · Build ID ${identidad.buildId}`),
				margen, 285.5, { maxWidth: anchoUtil });
			doc.text(unaLinea(`Generado ${identidad.generadoEn} · Alcance: rótulos a escala real; no certifica montaje.`),
				margen, 289, { maxWidth: anchoUtil });
			doc.text('Límites: revisar diseño y contenido antes de fabricar; las rutas físicas pendientes no definen metros.',
				margen, 292.5, { maxWidth: anchoUtil });
		}
	}
	doc.save(archivo);
}

/* ---------------------------------- DXF ---------------------------------- */

/**
 * Placa de montaje en DXF: la caja, los rieles, las canaletas y la huella de cada aparato con
 * su designación, cada cosa en su capa. Es lo que se manda al taller para taladrar y montar.
 */
export function dxfDePlaca(proyecto: Proyecto, procedencia?: ProcedenciaDocumento): string {
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
	let comentarios = '';
	if (procedencia) {
		const identidad = resumenProcedenciaDocumento(procedencia);
		const lineas = [
			`Tablero ${proyecto.nombre} | ${identidad.estado}`,
			`Project ID ${identidad.projectId} | Revision repositorio ${identidad.revisionRepositorio}`,
			`Generado ${identidad.generadoEn} | Build ID ${identidad.buildId}`,
			`Revision editorial ${proyecto.datos?.revision ?? 'no declarada'} | Fecha editorial ${proyecto.datos?.fecha ?? 'no declarada'}`,
			'Alcance: placa de montaje en milimetros; no certifica fabricacion ni dimensiones de aparatos sin ficha.',
			'Limites: conexiones con ruta fisica pendiente no representan cable ni longitud en este plano.',
		].map(textoSeguroEsquemaDxf);
		comentarios = lineas.map((linea) => `999\n${linea.slice(0, 240)}\n`).join('');
		lineas.forEach((texto, i) => e.push({ capa: 'TEXTO', trazo: {
			tipo: 'texto', x: 0, y: -12 - i * 5, texto: texto.slice(0, 180), alto: 2.5,
		} }));
	}
	const dibujo = generarDXF(e, g.alto);
	return comentarios ? dibujo.replace('0\nSECTION\n2\nENTITIES\n',
		`0\nSECTION\n2\nENTITIES\n${comentarios}`) : dibujo;
}

/** Una línea segura para DXF R12: ningún salto de línea puede fingir un grupo o una entidad. */
function textoSeguroEsquemaDxf(valor: string): string {
	return sinAcentos(valor.replace(/[\x00-\x1F\x7F]/g, ' ')).replace(/\s+/g, ' ').trim();
}

export interface OpcionesDxfEsquema {
	proyecto?: string;
	datos?: { revision?: string; fecha?: string };
	totalHojas?: number;
	procedencia?: ProcedenciaDocumento;
	rutasPendientes?: number;
}

/** Una hoja del esquema en DXF R12, con identidad de entrega separada del rótulo editorial. */
export function dxfDeEsquema(hoja: HojaEsq, opciones: OpcionesDxfEsquema = {}): string {
	const e: EntidadDXF[] = [];
	const cruces = crucesSinUnion(hoja);
	const nudos = nudosPorBorne(hoja);
	const solapes = solapesColinealesSinResolver(hoja);
	for (const hilo of hoja.hilos) {
		for (const tramo of tramosVisiblesDeHilo(hilo, cruces, 1, nudos)) {
			e.push({ capa: 'CABLES', trazo: {
				tipo: 'linea',
				x1: tramo.a.x, y1: tramo.a.y,
				x2: tramo.b.x, y2: tramo.b.y,
			} });
		}
	}
	for (const { punto } of nudos) {
		e.push({ capa: 'CABLES', trazo: { tipo: 'circulo', x: punto.x, y: punto.y, r: 0.9 } });
	}
	// Una anotación ajena a CABLES no representa una unión eléctrica ni oculta
	// el trazado coincidente: exige corregir el plano antes de usarlo.
	for (const solape of solapes) {
		const x = (solape.inicio.x + solape.fin.x) / 2;
		const y = (solape.inicio.y + solape.fin.y) / 2;
		e.push({ capa: 'TEXTO', trazo: { tipo: 'texto', x: x + 2.5, y: y - 2.5,
			texto: textoSeguroEsquemaDxf(`SOLAPE SIN RESOLVER ${solape.primero.conductorId}/${solape.segundo.conductorId} ${Math.round(solape.longitudMm * 10) / 10} mm`),
			alto: 2.4 } });
	}
	for (const s of hoja.simbolos) {
		for (const t of s.trazos) {
			if (t.tipo === 'linea') e.push({ capa: 'APARATOS', trazo: { tipo: 'linea', x1: t.a.x, y1: t.a.y, x2: t.b.x, y2: t.b.y } });
			else if (t.tipo === 'circulo') e.push({ capa: 'APARATOS', trazo: { tipo: 'circulo', x: t.c.x, y: t.c.y, r: t.r } });
			else e.push({ capa: 'TEXTO', trazo: { tipo: 'texto', x: t.p.x, y: t.p.y,
				texto: textoSeguroEsquemaDxf(t.texto), alto: t.tam ?? 3.2 } });
		}
		e.push({ capa: 'TEXTO', trazo: { tipo: 'texto', x: s.x - 4, y: s.y + s.alto / 2,
			texto: textoSeguroEsquemaDxf(s.designacion), alto: 3.4 } });
	}
	let comentarios = '';
	if (opciones.procedencia) {
		const identidad = resumenProcedenciaDocumento(opciones.procedencia);
		const pendientes = opciones.rutasPendientes ?? 'no informadas';
		const lineas = [
			`${identidad.estado} | Project ID ${identidad.projectId} | Revision repositorio ${identidad.revisionRepositorio}`,
			`Generado ${identidad.generadoEn} | Build ID ${identidad.buildId}`,
			`Proyecto ${opciones.proyecto ?? ''} | Hoja ${hoja.numero} / ${opciones.totalHojas ?? 1}`,
			`Revision editorial ${opciones.datos?.revision ?? 'no declarada'} | Fecha editorial ${opciones.datos?.fecha ?? 'no declarada'}`,
			`Alcance: esquema electrico; no certifica instalacion ni fabricacion.`,
			`Rutas fisicas pendientes del proyecto: ${pendientes}. Sin trayecto, longitud ni material.`,
		].map(textoSeguroEsquemaDxf);
		// Grupo 999 es comentario estándar R12. No cambia una sola entidad eléctrica del dibujo.
		comentarios = lineas.map((linea) => `999\n${linea.slice(0, 240)}\n`).join('');
		const anotacion = (y: number, texto: string, alto = 2.2): void => {
			e.push({ capa: 'TEXTO', trazo: { tipo: 'texto', x: 20, y,
				texto: texto.slice(0, 180), alto } });
		};
		anotacion(5, lineas[0]);
		anotacion(9.5, lineas[1]);
		const pie = hoja.altoMm - 34 + 1;
		anotacion(pie + 5, lineas[2]);
		anotacion(pie + 9.2, lineas[3]);
		anotacion(pie + 13.4, lineas[4]);
		anotacion(pie + 17.6, lineas[5]);
	}
	if (solapes.length) {
		const ids = [...new Set(solapes.map((s) => `${s.primero.conductorId}/${s.segundo.conductorId} ${Math.round(s.longitudMm * 10) / 10} mm`))];
		const texto = textoSeguroEsquemaDxf(`SOLAPE SIN RESOLVER: ${solapes.length} tramo(s) (${ids.join(', ')}). Reubicar hilos; no asumir union.`);
		e.push({ capa: 'TEXTO', trazo: { tipo: 'texto', x: 20, y: hoja.altoMm - 34 + 22.2,
			texto: texto.slice(0, 180), alto: 2.2 } });
		comentarios += `999\n${texto.slice(0, 240)}\n`;
	}
	const pendientesEsquema = resumenPendientesEsquema(hoja);
	if (pendientesEsquema) {
		const texto = textoSeguroEsquemaDxf(pendientesEsquema);
		e.push({ capa: 'TEXTO', trazo: { tipo: 'texto', x: 20,
			y: hoja.altoMm - 34 + 26.4, texto: texto.slice(0, 180), alto: 2.2 } });
		comentarios += `999\n${texto.slice(0, 240)}\n`;
	}
	e.push(...rectangulo('COTAS', 0, 0, hoja.anchoMm, hoja.altoMm));
	const dibujo = generarDXF(e, hoja.altoMm);
	return comentarios ? dibujo.replace('0\nSECTION\n2\nENTITIES\n',
		`0\nSECTION\n2\nENTITIES\n${comentarios}`) : dibujo;
}
