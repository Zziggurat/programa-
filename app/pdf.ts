/**
 * Dossier técnico del tablero en PDF (jsPDF).
 *
 * El documento describe EL TABLERO QUE HAY EN PANTALLA, no una plantilla: todo se recalcula
 * en el momento de exportar a partir del modelo. Por eso incluye el plano de la placa a
 * escala con los aparatos en su sitio, sus medidas reales y el recuento por familias: es lo
 * que permite a un cliente reconocer su tablero en el papel y a un taller fabricarlo.
 *
 * Orden del documento:
 *   Portada · 1 Ficha del tablero · 2 Disposición de la placa (a escala) · 3 Componentes
 *   4 Lista de materiales · 5 Índice de aparatos · 6 Conductores · 7 Referencias cruzadas
 *   8 Borneros · 9 Verificación eléctrica
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
import { fondoDe, generarFichaTablero } from '../src/motores/ficha-tablero.js';
import { montarEsquema, posicionesEnEsquema } from '../src/motores/esquema.js';
import { calcularBalanceTermico } from '../src/motores/termico.js';
import { opcionesDe } from '../src/modelo/proyecto.js';
import { CONTROLADORES } from './controladores.js';

const AZUL: [number, number, number] = [43, 74, 111];
const GRIS: [number, number, number] = [90, 98, 106];
const VERDE: [number, number, number] = [30, 130, 60];
const ROJO: [number, number, number] = [176, 48, 48];

/** #rrggbb → componentes 0-255. Los aparatos de catálogo traen su color real. */
function rgb(hex: string | undefined, porDefecto: [number, number, number]): [number, number, number] {
	if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return porDefecto;
	return [
		parseInt(hex.slice(1, 3), 16),
		parseInt(hex.slice(3, 5), 16),
		parseInt(hex.slice(5, 7), 16),
	];
}

const mm = (v: number): string => `${Math.round(v)} mm`;
const metros = (v: number): string => `${(v / 1000).toFixed(2)} m`;

/**
 * Plano de la placa de montaje A ESCALA, con canaletas, rieles y cada aparato en su sitio
 * y con su marca. Es la parte que hace fiel al dossier: se ve el tablero, no una lista.
 * Devuelve la escala usada (mm de papel por mm de tablero).
 */
function dibujarPlaca(
	doc: jsPDF,
	proyecto: Proyecto,
	marco: { x: number; y: number; ancho: number; alto: number },
): number {
	const g = proyecto.gabinete;
	if (!g || g.ancho <= 0 || g.alto <= 0) return 0;
	const k = Math.min(marco.ancho / g.ancho, marco.alto / g.alto);
	// Centrado dentro del hueco disponible.
	const x0 = marco.x + (marco.ancho - g.ancho * k) / 2;
	const y0 = marco.y + (marco.alto - g.alto * k) / 2;
	const px = (v: number): number => x0 + v * k;
	const py = (v: number): number => y0 + v * k;

	// Placa de montaje.
	doc.setFillColor(246, 247, 248);
	doc.setDrawColor(...GRIS);
	doc.setLineWidth(0.4);
	doc.rect(x0, y0, g.ancho * k, g.alto * k, 'FD');

	// Canaletas: banda ámbar con su tapa insinuada.
	doc.setDrawColor(190, 150, 70);
	doc.setFillColor(240, 219, 176);
	for (const c of g.canaletas) {
		const w = c.orientacion === 'v' ? c.ancho : c.largo;
		const h = c.orientacion === 'v' ? c.largo : c.ancho;
		doc.rect(px(c.x), py(c.y), w * k, h * k, 'FD');
	}
	// Rieles DIN: barra gris de 35 mm.
	doc.setFillColor(203, 209, 214);
	doc.setDrawColor(150, 158, 165);
	for (const r of g.rieles) {
		const w = r.orientacion === 'v' ? 35 : r.largo;
		const h = r.orientacion === 'v' ? r.largo : 35;
		doc.rect(px(r.x), py(r.y), w * k, h * k, 'FD');
	}

	// Aparatos, con su color real y su designación si cabe.
	doc.setLineWidth(0.25);
	for (const col of g.colocaciones) {
		const d = proyecto.dispositivos.find((x) => x.id === col.dispositivoId);
		if (!d) continue;
		const [r, gg, b] = rgb(d.colorCuerpo, [120, 128, 136]);
		doc.setFillColor(r, gg, b);
		doc.setDrawColor(40, 46, 52);
		doc.rect(px(col.x), py(col.y), col.ancho * k, col.alto * k, 'FD');
		const marca = d.designacion ?? '';
		const anchoPapel = col.ancho * k;
		const altoPapel = col.alto * k;
		if (!marca) continue;
		// Tinta clara sobre cuerpo oscuro y al revés, para que la marca se lea siempre.
		const claro = (r * 299 + gg * 587 + b * 114) / 1000 > 150;
		doc.setTextColor(claro ? 25 : 245);
		const cx = px(col.x) + anchoPapel / 2;
		const cy = py(col.y) + altoPapel / 2;
		// Un aparato estrecho (un modular de 18 mm) no admite el rótulo en horizontal: se gira,
		// que es exactamente lo que se hace en un plano de montaje real.
		const largoTexto = marca.length * 0.62;
		if (anchoPapel >= largoTexto * 3.2 && altoPapel > 3) {
			doc.setFontSize(Math.min(6, Math.max(3.6, anchoPapel * 0.3)));
			doc.text(marca, cx, cy + 1, { align: 'center', maxWidth: anchoPapel - 1 });
		} else if (altoPapel >= largoTexto * 3.2 && anchoPapel > 3) {
			doc.setFontSize(Math.min(6, Math.max(3.6, altoPapel * 0.3)));
			doc.text(marca, cx + 1, cy, { align: 'center', angle: 90 });
		}
		// Si no cabe de ninguna de las dos formas, el aparato queda sin rotular en el plano y
		// se localiza por la tabla de posiciones: mejor eso que un texto ilegible encima.
	}

	// Cotas exteriores de la placa, en cm, como se pide una placa al taller.
	doc.setDrawColor(...AZUL);
	doc.setTextColor(...AZUL);
	doc.setFontSize(7.5);
	doc.setLineWidth(0.3);
	const yc = y0 + g.alto * k + 6;
	doc.line(x0, yc, x0 + g.ancho * k, yc);
	doc.line(x0, yc - 1.5, x0, yc + 1.5);
	doc.line(x0 + g.ancho * k, yc - 1.5, x0 + g.ancho * k, yc + 1.5);
	doc.text(mm(g.ancho), x0 + (g.ancho * k) / 2, yc - 1.6, { align: 'center' });
	const xc = x0 + g.ancho * k + 6;
	doc.line(xc, y0, xc, y0 + g.alto * k);
	doc.line(xc - 1.5, y0, xc + 1.5, y0);
	doc.line(xc - 1.5, y0 + g.alto * k, xc + 1.5, y0 + g.alto * k);
	doc.text(mm(g.alto), xc + 1.5, y0 + (g.alto * k) / 2, { angle: 90, align: 'center' });

	doc.setTextColor(0);
	return k;
}

/** Genera y descarga el dossier técnico del proyecto en PDF. */
export function exportarPDF(proyecto: Proyecto): void {
	// Recalcular todo para que el PDF refleje el estado actual del tablero.
	numerarDispositivos(proyecto);
	const potenciales = calcularPotenciales(proyecto);
	numerarConductores(proyecto, potenciales);
	const ruteo = rutearConductores(proyecto);
	const hallazgos = verificarProyecto(proyecto, potenciales, {
		longitudesMm: new Map(ruteo.rutas.map((r) => [r.conductorId, r.longitudMm])),
		canaletas: ruteo.ocupaciones,
	});
	const hojasEsquema = montarEsquema(proyecto, potenciales);
	const referencias = generarReferencias(proyecto, posicionesEnEsquema(hojasEsquema));
	const bom = generarBOM(proyecto);
	const conductores = generarListaConductores(proyecto, ruteo);
	const planes = generarPlanBorneros(proyecto, potenciales);
	const ficha = generarFichaTablero(proyecto, ruteo);
	const termico = calcularBalanceTermico(proyecto);
	const datos = proyecto.datos ?? {};
	const opciones = opcionesDe(proyecto);

	const doc = new jsPDF({ unit: 'mm', format: 'a4' });
	const anchoPag = doc.internal.pageSize.getWidth();
	const altoPag = doc.internal.pageSize.getHeight();
	const fecha = new Date().toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' });

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

	const errores = hallazgos.filter((h) => h.severidad === 'error').length;
	const avisos = hallazgos.length - errores;

	/* ---------------------------- Portada ---------------------------- */
	doc.setFillColor(...AZUL);
	doc.rect(0, 0, anchoPag, 62, 'F');
	doc.setTextColor(255);
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(24);
	doc.text('Dossier técnico', 20, 32);
	doc.setFontSize(15);
	doc.setFont('helvetica', 'normal');
	doc.text(proyecto.nombre, 20, 44);
	doc.setFontSize(10);
	const lineaCliente = [datos.cliente, datos.obra].filter(Boolean).join(' · ');
	if (lineaCliente) doc.text(lineaCliente, 20, 53, { maxWidth: anchoPag - 40 });
	doc.setFontSize(9);
	const pie = [
		datos.proyectista ? `Proyectista: ${datos.proyectista}` : '',
		datos.revision ? `Revisión ${datos.revision}` : '',
		datos.fecha || fecha,
	].filter(Boolean).join('  ·  ');
	doc.text(pie, 20, lineaCliente ? 59 : 54);

	// Tarjetas con las cifras que definen el tablero: es lo que se mira primero.
	doc.setTextColor(0);
	const tarjetas: [string, string][] = [
		['Aparatos', String(ficha.aparatos.total)],
		['Conexiones', String(ficha.conductores.total)],
		['Caja (an × al × f)', ficha.caja ? `${Math.round(ficha.caja.ancho)} × ${Math.round(ficha.caja.alto)} × ${mm(ficha.caja.profundidad)}` : '—'],
		['Placa de montaje', ficha.placa ? `${Math.round(ficha.placa.ancho)} × ${mm(ficha.placa.alto)}` : '—'],
		['Cable total', metros(ficha.conductores.longitudTotalMm)],
		['Verificación', errores ? `${errores} error${errores > 1 ? 'es' : ''}` : (avisos ? `${avisos} aviso${avisos > 1 ? 's' : ''}` : 'Conforme')],
	];
	const anchoTarjeta = (anchoPag - 40 - 2 * 6) / 3;
	tarjetas.forEach(([titulo, valor], i) => {
		const cx = 20 + (i % 3) * (anchoTarjeta + 6);
		const cy = 72 + Math.floor(i / 3) * 26;
		doc.setFillColor(244, 246, 248);
		doc.setDrawColor(220, 225, 230);
		doc.roundedRect(cx, cy, anchoTarjeta, 21, 2, 2, 'FD');
		doc.setFontSize(7.5);
		doc.setTextColor(...GRIS);
		doc.text(titulo.toUpperCase(), cx + 4, cy + 6.5);
		doc.setFontSize(11);
		doc.setFont('helvetica', 'bold');
		const esVerificacion = titulo === 'Verificación';
		doc.setTextColor(...(esVerificacion ? (errores ? ROJO : VERDE) : [20, 24, 28] as [number, number, number]));
		doc.text(valor, cx + 4, cy + 15, { maxWidth: anchoTarjeta - 8 });
		doc.setFont('helvetica', 'normal');
	});

	// Vista del tablero en la propia portada: el cliente reconoce su tablero de un vistazo.
	doc.setTextColor(...GRIS);
	doc.setFontSize(9);
	doc.text('Disposición de la placa de montaje', 20, 132);
	doc.setTextColor(0);
	const escalaPortada = dibujarPlaca(doc, proyecto, { x: 20, y: 138, ancho: anchoPag - 46, alto: 118 });
	doc.setFontSize(7.5);
	doc.setTextColor(...GRIS);
	doc.text(
		escalaPortada
			? `Escala aproximada 1:${Math.round(1 / escalaPortada)} · medidas en milímetros`
			: 'El proyecto todavía no tiene gabinete definido.',
		20, altoPag - 22,
	);
	doc.setTextColor(0);

	/* --------------------- 1. Ficha del tablero --------------------- */
	doc.addPage();
	cabecera('1. Ficha del tablero');
	// Si el proyecto no declara la caja, la ficha la deduce de la placa: hay que decirlo, no
	// dar por buena una medida supuesta en un papel que se usa para pedir el armario.
	const cajaTexto = ficha.caja
		? `${mm(ficha.caja.ancho)} × ${mm(ficha.caja.alto)} × ${mm(ficha.caja.profundidad)}`
			+ (ficha.caja.estimada ? ' (estimada: placa + margen estándar)' : '')
		: '—';
	const filasFicha: [string, string][] = [
		['Caja eléctrica (an × al × fondo)', cajaTexto],
		['Placa de montaje (an × al)', ficha.placa ? `${mm(ficha.placa.ancho)} × ${mm(ficha.placa.alto)}` : '—'],
		['Ocupación de la placa', `${ficha.ocupacionPlacaPct} %`],
		['Riel DIN', `${ficha.rieles.cantidad} tramo${ficha.rieles.cantidad === 1 ? '' : 's'} · ${metros(ficha.rieles.largoTotalMm)} en total`],
		['Canaleta', `${ficha.canaletas.cantidad} tramo${ficha.canaletas.cantidad === 1 ? '' : 's'} · ${metros(ficha.canaletas.largoTotalMm)} en total`],
		['Llenado máximo de canaleta', ficha.canaletas.cantidad ? `${ficha.canaletas.llenadoMaxPct} % del máximo admisible` : '—'],
		['Aparatos en la placa', String(ficha.aparatos.enPlaca)],
		['Aparatos de campo (fuera del tablero)', String(ficha.aparatos.deCampo)],
		['Conductores', String(ficha.conductores.total)],
		['Longitud total de cable', metros(ficha.conductores.longitudTotalMm)],
		['Tensiones de trabajo', ficha.tensiones.length ? ficha.tensiones.map((v) => `${v} V`).join(' · ') : '—'],
		['Fondo libre tras el aparato más profundo', ficha.holguraFondoMm !== undefined ? mm(ficha.holguraFondoMm) : '—'],
		['Referencias de material distintas', String(bom.length)],
		['Icc presunta en la acometida', opciones.iccPresuntaKA ? `${opciones.iccPresuntaKA} kA` : 'sin declarar'],
		['Temperatura ambiente de proyecto', `${opciones.temperaturaAmbienteC} °C`],
		['Potencia disipada en el interior', termico ? `${termico.disipacionW} W` : '—'],
		['Temperatura interior estimada', termico ? `${termico.temperaturaInteriorC} °C (+${termico.saltoTermicoK} K)` : '—'],
		['Verificación eléctrica (DRC)', errores ? `${errores} errores · ${avisos} avisos` : (avisos ? `${avisos} avisos` : 'Sin hallazgos')],
	];
	autoTable(doc, {
		startY: y,
		body: filasFicha,
		theme: 'plain',
		bodyStyles: { fontSize: 9.5 },
		columnStyles: { 0: { fontStyle: 'bold', cellWidth: 92, textColor: GRIS }, 1: { cellWidth: 80 } },
		margin: { left: 12, right: 12 },
	});
	// @ts-expect-error autotable añade lastAutoTable
	y = (doc.lastAutoTable?.finalY ?? y) + 10;

	doc.setFont('helvetica', 'bold');
	doc.setFontSize(11);
	doc.text('Componentes por familia', 12, y);
	doc.setFont('helvetica', 'normal');
	y += 4;
	tabla(['Familia', 'Cantidad', 'Marcado de los aparatos'],
		ficha.aparatos.porFamilia.map((f) => [f.familia, f.cantidad, f.designaciones.join(', ')]),
		{ 0: 34, 1: 20 });

	// Honestidad con el cliente: si algún equipo lleva medidas estimadas y no de hoja de datos,
	// el dossier lo dice. Un fondo mal supuesto es un tablero que no cierra.
	const nominales = proyecto.dispositivos.filter((d) =>
		CONTROLADORES.some((f) => f.referencia === d.referencia && f.medidas === 'nominal'));
	if (nominales.length > 0) {
		doc.setFontSize(8.5);
		doc.setTextColor(...ROJO);
		doc.text('Medidas por confirmar', 12, y);
		doc.setTextColor(...GRIS);
		doc.text(
			`Las dimensiones de ${nominales.map((d) => `${d.designacion} (${d.referencia})`).join(', ')} son `
			+ 'estimaciones de su familia de producto. Contrástalas con la hoja de datos del fabricante antes de fabricar.',
			12, y + 4.5, { maxWidth: anchoPag - 24 },
		);
		doc.setTextColor(0);
		y += 16;
	}

	if (ficha.conductores.porSeccion.length > 0) {
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(11);
		doc.text('Cable por sección', 12, y);
		doc.setFont('helvetica', 'normal');
		y += 4;
		tabla(['Sección', 'Conductores', 'Longitud'],
			ficha.conductores.porSeccion.map((s) => [
				s.seccion !== undefined ? `${s.seccion} mm²` : 'sin definir',
				s.cantidad,
				// Los conductores que no pasan por canaleta (los que van a campo) no tienen
				// recorrido calculado: se dice, en vez de sumarles cero y falsear el metraje.
				s.conRuta === 0
					? 'sin recorrido calculado'
					: `${metros(s.longitudMm)}${s.conRuta < s.cantidad ? ` (${s.cantidad - s.conRuta} sin rutear)` : ''}`,
			]), { 0: 32, 1: 30 });
	}

	/* --------------- 2. Disposición de la placa (a escala) --------------- */
	doc.addPage();
	cabecera('2. Disposición de la placa');
	// La altura del hueco deja sitio bajo el dibujo para la cota, la leyenda y el pie.
	const escala = dibujarPlaca(doc, proyecto, { x: 12, y: 38, ancho: anchoPag - 32, alto: 142 });
	y = 194;
	// Leyenda: sin ella el plano se lee mal, sobre todo quien no armó el tablero.
	const leyenda: [string, [number, number, number], [number, number, number]][] = [
		['Canaleta', [240, 219, 176], [190, 150, 70]],
		['Riel DIN', [203, 209, 214], [150, 158, 165]],
		['Aparato', [120, 128, 136], [40, 46, 52]],
	];
	let lx = 12;
	doc.setFontSize(8);
	for (const [texto, relleno, borde] of leyenda) {
		doc.setFillColor(...relleno);
		doc.setDrawColor(...borde);
		doc.setLineWidth(0.3);
		doc.rect(lx, y - 3, 6, 3.4, 'FD');
		doc.setTextColor(...GRIS);
		doc.text(texto, lx + 8, y);
		lx += 8 + doc.getTextWidth(texto) + 8;
	}
	y += 7;
	doc.setFontSize(8);
	doc.setTextColor(...GRIS);
	doc.text(escala
		? `Vista frontal de la placa de montaje. Escala aproximada 1:${Math.round(1 / escala)}. Medidas en milímetros desde la esquina superior izquierda.`
		: 'El proyecto todavía no tiene gabinete definido.', 12, y);
	doc.setTextColor(0);
	y += 7;
	const colocaciones = proyecto.gabinete?.colocaciones ?? [];
	if (colocaciones.length > 0) {
		tabla(['Marcado', 'Aparato', 'Posición x · y', 'Huella (an × al)', 'Fondo'],
			colocaciones
				.map((c) => {
					const d = proyecto.dispositivos.find((x) => x.id === c.dispositivoId);
					return { c, d };
				})
				.filter((e): e is { c: typeof colocaciones[number]; d: NonNullable<typeof e.d> } => !!e.d)
				.sort((a, b) => (a.d.designacion ?? '').localeCompare(b.d.designacion ?? '', undefined, { numeric: true }))
				.map(({ c, d }) => [
					d.designacion ?? d.id,
					d.descripcion ?? d.tipo,
					`${Math.round(c.x)} · ${Math.round(c.y)} mm`,
					`${Math.round(c.ancho)} × ${Math.round(c.alto)} mm`,
					mm(fondoDe(d)),
				]),
			{ 0: 22, 2: 30, 3: 32, 4: 18 });
	}

	/* --------------------- 3. Lista de materiales --------------------- */
	doc.addPage();
	cabecera('3. Lista de materiales (BOM)');
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

	/* --------------------- 4. Índice de aparatos --------------------- */
	doc.addPage();
	cabecera('4. Índice de aparatos');
	tabla(['Marcado', 'Descripción', 'Tensión', 'In / Ib', 'En el esquema'],
		referencias.indice.map((e) => {
			const d = proyecto.dispositivos.find((x) => x.id === e.dispositivoId);
			return [
				e.designacion,
				e.descripcion || '—',
				d?.tensionNominal ? `${d.tensionNominal} V` : '—',
				d?.corrienteNominal ? `${d.corrienteNominal} A` : '—',
				e.posicion,
			];
		}), { 0: 24, 2: 20, 3: 20, 4: 26 });

	/* --------------------- 5. Lista de conductores --------------------- */
	doc.addPage();
	cabecera('5. Lista de conductores');
	if (conductores.length === 0) {
		doc.setFontSize(10);
		doc.text('El proyecto no tiene conductores.', 12, y);
	} else {
		tabla(['Nº', 'Desde', 'Hacia', 'Sección', 'Color', 'Longitud'],
			conductores.map((c) => [c.numero, c.de, c.a, c.seccion || '—', c.color || '—',
				c.longitudMm ? metros(c.longitudMm) : '—']),
			{ 0: 14, 3: 20, 5: 22 });
	}

	/* --------------------- 6. Referencias cruzadas --------------------- */
	if (referencias.cruzadas.length > 0) {
		doc.addPage();
		cabecera('6. Referencias cruzadas');
		const filas = referencias.cruzadas.flatMap((x) =>
			x.contactos.length === 0
				? [[x.designacion, x.posicion, '(sin contactos)', '', '']]
				: x.contactos.map((c) => [x.designacion, x.posicion, c.designacion, c.contacto, c.posicion]));
		tabla(['Maestro', 'Hoja.col', 'Contacto', 'Tipo', 'Hoja.col'], filas);
	}

	/* --------------------- 7. Balance térmico --------------------- */
	if (termico) {
		doc.addPage();
		cabecera('7. Balance térmico del gabinete');
		const MONTAJES: Record<string, string> = {
			mural: 'adosado a pared (cara trasera sin disipar)',
			exento: 'exento (disipa por todas las caras)',
			empotrado: 'empotrado entre otros armarios (solo frente y techo)',
		};
		autoTable(doc, {
			startY: y,
			body: [
				['Instalación supuesta', MONTAJES[termico.montaje]],
				['Superficie efectiva de disipación', `${termico.superficieM2.toFixed(2)} m²`],
				['Potencia disipada en el interior', `${termico.disipacionW} W`],
				['Densidad de disipación', `${(termico.superficieM2 > 0 ? termico.disipacionW / termico.superficieM2 : 0).toFixed(0)} W/m²`],
				['Temperatura ambiente de proyecto', `${termico.temperaturaAmbienteC} °C`],
				['Salto térmico estimado', `+${termico.saltoTermicoK} K`],
				['Temperatura interior estimada', `${termico.temperaturaInteriorC} °C`],
			] as [string, string][],
			theme: 'plain',
			bodyStyles: { fontSize: 9.5 },
			columnStyles: { 0: { fontStyle: 'bold', cellWidth: 92, textColor: GRIS }, 1: { cellWidth: 88 } },
			margin: { left: 12, right: 12 },
		});
		// @ts-expect-error autotable añade lastAutoTable
		y = (doc.lastAutoTable?.finalY ?? y) + 8;

		// El veredicto va en un banner del color de su gravedad: es la línea que decide si el
		// armario se pide con rejilla, con ventilador o con climatizador.
		const colorVeredicto: [number, number, number] =
			termico.veredicto === 'holgado' ? VERDE
				: termico.veredicto === 'justo' ? [176, 132, 30]
					: termico.veredicto === 'ventilacion' ? [190, 100, 30] : ROJO;
		const TITULO_VEREDICTO: Record<string, string> = {
			holgado: 'Refrigeración natural suficiente',
			justo: 'Al límite de la refrigeración natural',
			ventilacion: 'Requiere ventilación forzada',
			climatizacion: 'Requiere climatización',
		};
		doc.setFillColor(...colorVeredicto);
		doc.rect(12, y, anchoPag - 24, 1.6, 'F');
		doc.setFillColor(248, 249, 250);
		doc.setDrawColor(226, 230, 234);
		doc.rect(12, y + 1.6, anchoPag - 24, 20, 'FD');
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(10.5);
		doc.setTextColor(...colorVeredicto);
		doc.text(TITULO_VEREDICTO[termico.veredicto], 16, y + 8.5);
		doc.setFont('helvetica', 'normal');
		doc.setFontSize(9);
		doc.setTextColor(...GRIS);
		doc.text(termico.recomendacion, 16, y + 14.5, { maxWidth: anchoPag - 32 });
		doc.setTextColor(0);
		y += 30;

		if (termico.principales.length > 0) {
			doc.setFont('helvetica', 'bold');
			doc.setFontSize(11);
			doc.text('Aparatos que más calientan', 12, y);
			doc.setFont('helvetica', 'normal');
			y += 4;
			tabla(['Aparato', 'Disipación', 'Origen del dato'],
				termico.principales.map((p) => [
					p.designacion,
					`${p.watts} W`,
					p.estimado ? 'estimada por tipo de aparato' : 'declarada en la ficha del aparato',
				]), { 0: 50, 1: 28 });
		}

		// Un cálculo de proyecto no es un ensayo: decirlo evita que el papel se use como
		// certificado. Y si casi toda la disipación es estimada, el número vale lo que valen
		// las estimaciones — el cliente tiene que saberlo.
		const pctDeclarada = Math.round(termico.fraccionDeclarada * 100);
		doc.setFontSize(8);
		doc.setTextColor(...GRIS);
		doc.text(
			`Estimación por el método simplificado de IEC 60890. ${pctDeclarada} % de la potencia disipada procede de `
			+ 'datos declarados en la ficha de los aparatos; el resto son valores típicos por tipo. Para una verificación '
			+ 'formal del calentamiento (IEC 61439-1, apartado 10.10) hay que introducir la disipación de catálogo de cada '
			+ 'aparato o realizar el ensayo.',
			12, y, { maxWidth: anchoPag - 24 },
		);
		doc.setTextColor(0);
	}

	/* --------------------- 8. Planes de borneros --------------------- */
	for (const plan of planes) {
		doc.addPage();
		cabecera(`Bornero ${plan.designacion}`);
		tabla(['Borna', 'Interna', 'Externa', 'Nº cond.', 'Puentes'],
			plan.filas.map((f) => [f.borna, f.internas.join(' / ') || '—', f.externas.join(' / ') || '—',
				f.numeroConductor || '—', f.puenteCon.join(', ') || '—']));
	}

	/* --------------------- 9. Verificación DRC --------------------- */
	doc.addPage();
	cabecera('Verificación eléctrica (DRC)');
	if (hallazgos.length === 0) {
		doc.setFontSize(11);
		doc.setTextColor(...VERDE);
		doc.text('Sin errores ni avisos. El tablero pasa todas las reglas.', 12, y);
		doc.setTextColor(0);
	} else {
		tabla(['Severidad', 'Regla', 'Detalle'],
			hallazgos.map((h) => [h.severidad === 'error' ? 'ERROR' : 'aviso', h.regla, h.mensaje]),
			{ 0: 22, 1: 42 });
	}

	/* ------------- Anexo A · Placa de características IEC 61439 ------------- */
	doc.addPage();
	cabecera('Anexo A · Placa de características');
	doc.setFontSize(9);
	doc.setTextColor(...GRIS);
	doc.text(
		'IEC 61439-1 apartado 6 exige que todo conjunto lleve una placa de características indeleble y visible con el '
		+ 'montaje terminado. Esta es la placa del tablero con lo que declara el proyecto; los campos marcados «a declarar» '
		+ 'los completa el fabricante del conjunto antes de la entrega.',
		12, y, { maxWidth: anchoPag - 24 },
	);
	doc.setTextColor(0);
	y += 16;

	const SIN = 'a declarar';
	const tensionMax = ficha.tensiones.length ? Math.max(...ficha.tensiones) : undefined;
	// Ui y Uimp no se inventan: se toma el escalón normalizado inmediatamente por encima de la
	// tensión de empleo, que es lo que hace un proyectista, y se marca como valor propuesto.
	const ui = tensionMax === undefined ? undefined : tensionMax <= 250 ? 500 : tensionMax <= 500 ? 690 : 1000;
	const uimp = tensionMax === undefined ? undefined : tensionMax <= 250 ? 4 : 6;
	const camposPlaca: [string, string][] = [
		['Fabricante del conjunto', datos.fabricante || SIN],
		['Designación de tipo', proyecto.nombre],
		['Número de serie / identificación', SIN],
		['Fecha de fabricación', SIN],
		['Norma de referencia', 'IEC 61439-2'],
		['Tensión asignada de empleo  Ue', tensionMax !== undefined ? `${tensionMax} V` : SIN],
		['Tensión asignada de aislamiento  Ui', ui !== undefined ? `${ui} V (propuesto)` : SIN],
		['Tensión soportada a impulsos  Uimp', uimp !== undefined ? `${uimp} kV (propuesto)` : SIN],
		['Frecuencia asignada', `${opciones.frecuenciaHz} Hz`],
		['Corriente asignada del conjunto  InA', opciones.corrienteAsignadaA ? `${opciones.corrienteAsignadaA} A` : SIN],
		['Corriente de cortocircuito presunta  Icp', opciones.iccPresuntaKA ? `${opciones.iccPresuntaKA} kA` : SIN],
		['Factor de diversidad  RDF', SIN],
		['Grado de protección', opciones.gradoIP || SIN],
		['Régimen de neutro', opciones.regimenNeutro || SIN],
		['Uso previsto', 'Interior'],
		['Temperatura ambiente de proyecto', `${opciones.temperaturaAmbienteC} °C`],
		['Temperatura interior estimada', termico ? `${termico.temperaturaInteriorC} °C` : SIN],
		['Dimensiones (an × al × f)', ficha.caja ? `${mm(ficha.caja.ancho)} × ${mm(ficha.caja.alto)} × ${mm(ficha.caja.profundidad)}` : SIN],
		['Masa', SIN],
		['Forma de separación interna', SIN],
	];

	// La placa se dibuja a tamaño de impresión para poderla recortar y pegar en la puerta.
	const placaX = 12;
	const placaAncho = anchoPag - 24;
	const altoFila = 6.6;
	const altoPlaca = 20 + camposPlaca.length * altoFila + 8;
	doc.setDrawColor(...AZUL);
	doc.setLineWidth(0.8);
	doc.rect(placaX, y, placaAncho, altoPlaca);
	doc.setFillColor(...AZUL);
	doc.rect(placaX, y, placaAncho, 13, 'F');
	doc.setTextColor(255);
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(11);
	doc.text('CONJUNTO DE APARAMENTA DE BAJA TENSIÓN', placaX + 5, y + 6);
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(8);
	doc.text('IEC 61439-1 / IEC 61439-2', placaX + 5, y + 10.6);
	doc.setTextColor(0);

	let fy = y + 19;
	doc.setFontSize(8.5);
	for (const [campo, valor] of camposPlaca) {
		const pendiente = valor === SIN;
		doc.setTextColor(...GRIS);
		doc.text(campo, placaX + 5, fy);
		const finCampo = placaX + 7 + doc.getTextWidth(campo);
		doc.setFont('helvetica', pendiente ? 'italic' : 'bold');
		doc.setTextColor(...(pendiente ? ROJO : [20, 24, 28] as [number, number, number]));
		// El ancho se mide con la MISMA tipografía con la que se dibuja, o el filete se solapa.
		const inicioValor = placaX + placaAncho - 8 - doc.getTextWidth(valor);
		doc.text(valor, placaX + placaAncho - 5, fy, { align: 'right' });
		doc.setFont('helvetica', 'normal');
		// Filete entre campo y valor: se lee la fila sin perder el renglón.
		if (inicioValor > finCampo + 3) {
			doc.setDrawColor(228, 232, 236);
			doc.setLineWidth(0.2);
			doc.line(finCampo, fy - 1.1, inicioValor, fy - 1.1);
		}
		fy += altoFila;
	}
	doc.setTextColor(0);
	y += altoPlaca + 8;

	const pendientes = camposPlaca.filter(([, v]) => v === SIN).length;
	doc.setFontSize(8);
	doc.setTextColor(...(pendientes ? ROJO : VERDE));
	doc.text(
		pendientes
			? `Quedan ${pendientes} campos por declarar antes de que la placa sea válida.`
			: 'Todos los campos de la placa están declarados.',
		12, y,
	);
	doc.setTextColor(...GRIS);
	doc.text(
		'Los valores marcados «propuesto» salen de la tensión de empleo del proyecto y hay que confirmarlos contra la '
		+ 'coordinación de aislamiento real. Esta placa no sustituye a la verificación de diseño de IEC 61439-1 capítulo 10.',
		12, y + 5, { maxWidth: anchoPag - 24 },
	);
	doc.setTextColor(0);

	/* --------------------- Pie de página en todas --------------------- */
	const paginas = doc.getNumberOfPages();
	for (let i = 1; i <= paginas; i++) {
		doc.setPage(i);
		doc.setFontSize(8);
		doc.setTextColor(...GRIS);
		doc.text(`Página ${i} de ${paginas}`, anchoPag - 12, 290, { align: 'right' });
		doc.text(`${proyecto.nombre} — dossier técnico`, 12, 290);
	}

	const nombre = proyecto.nombre.replace(/[^\wáéíóúñ -]/gi, '').trim() || 'tablero';
	doc.save(`${nombre} - dossier.pdf`);
}
