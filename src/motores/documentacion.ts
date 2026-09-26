/**
 * Motor de documentación técnica.
 *
 * Sigue la idea de la base de datos de proyección de QElectroTech (projectdatabase.cpp):
 * los documentos son consultas sobre el modelo, no dibujos. Genera:
 *  - Lista de materiales (BOM) agrupada por identidad de producto persistente.
 *  - Lista de conductores (número, origen, destino, sección, color, longitud ruteada).
 *  - Exportadores CSV y un informe HTML completo.
 */
import { aCSV } from '../modelo/csv.js';
import { Proyecto } from '../modelo/tipos.js';
import { resumenProcedenciaDocumento, type ProcedenciaDocumento } from '../modelo/procedencia-documental.js';
import { extremoTexto } from '../modelo/proyecto.js';
import { Hallazgo } from './drc.js';
import { PlanBornero } from './bornes.js';
import { ResultadoPotenciales } from './potenciales.js';
import { ResultadoReferencias } from './referencias.js';
import { ResultadoRuteo } from './ruteo.js';
import { ResultadoSincronizacion } from './sincronizacion.js';
import { proyectarBomCanonica } from './bom.js';
import { proyectarLongitudesDocumentales } from './longitudes-documentales.js';

export interface FilaBOM {
	cantidad: number;
	descripcion: string;
	fabricante: string;
	referencia: string;
	varianteDeclarada: string;
	designaciones: string[];
}

export function generarBOM(proyecto: Proyecto): FilaBOM[] {
	return proyectarBomCanonica(proyecto).map((grupo) => ({
		cantidad: grupo.cantidad, descripcion: grupo.descripcion,
		fabricante: grupo.fabricante ?? '', referencia: grupo.referencia ?? '',
		varianteDeclarada: grupo.varianteDeclarada,
		designaciones: grupo.designaciones,
	}));
}

export interface FilaConductor {
	numero: string;
	de: string;
	a: string;
	seccion: string;
	color: string;
	longitudMm?: number;
	pendienteRuta?: boolean;
	rutaReferencia3D?: boolean;
	politicaLongitudElectrica?: 'DECLARADA' | 'RUTA_XYZ';
}

export function generarListaConductores(
	proyecto: Proyecto,
	ruteo?: ResultadoRuteo,
): FilaConductor[] {
	const longitudDe = new Map(ruteo?.rutas.map((r) => [r.conductorId, r.longitudMm]) ?? []);
	return proyecto.conductores
		.map((c) => ({
			numero: c.numero ?? c.id,
			de: extremoTexto(proyecto, c.de),
			a: extremoTexto(proyecto, c.a),
			seccion: c.seccion !== undefined ? `${c.seccion} mm²` : '',
			color: c.color ?? '',
			longitudMm: c.estadoRutaFisica === 'pendiente' || c.rutaFisica || c.planRutaAutomatica
				? undefined : longitudDe.get(c.id),
			pendienteRuta: c.estadoRutaFisica === 'pendiente' || undefined,
			rutaReferencia3D: c.estadoRutaFisica !== 'pendiente'
				&& (!!c.rutaFisica || !!c.planRutaAutomatica) || undefined,
			politicaLongitudElectrica: c.fisica?.politicaLongitudElectrica,
		}))
		.sort((a, b) => a.numero.localeCompare(b.numero, undefined, { numeric: true }));
}

/* --------------------------------- Exportadores --------------------------------- */

// El armador de CSV vive en el núcleo (`modelo/csv.ts`) porque lo comparten los listados del
// tablero y el parte de obra de la Planta. Se reexporta para no cambiar a quien ya lo importaba.
export { aCSV };

export function bomACSV(bom: FilaBOM[]): string {
	return aCSV([
		['Cantidad', 'Descripción', 'Fabricante', 'Referencia', 'Variante declarada', 'Designaciones'],
		...bom.map((f) => [f.cantidad, f.descripcion, f.fabricante, f.referencia, f.varianteDeclarada, f.designaciones.join(', ')]),
	]);
}

export function conductoresACSV(filas: FilaConductor[]): string {
	return aCSV([
		['Número', 'De', 'A', 'Sección', 'Color', 'Longitud (mm)'],
		...filas.map((f) => [f.numero, f.de, f.a, f.seccion, f.color, f.longitudMm]),
	]);
}

export function borneroACSV(plan: PlanBornero): string {
	return aCSV([
		['Borna', 'Conexión interna', 'Conexión externa', 'Nº conductor', 'Puente con', 'Avisos'],
		...plan.filas.map((f) => [
			f.borna,
			f.internas.join(' / '),
			f.externas.join(' / '),
			f.numeroConductor,
			f.puenteCon.join(', '),
			f.avisos.join('; '),
		]),
	]);
}

export interface Dossier {
	proyecto: Proyecto;
	potenciales: ResultadoPotenciales;
	hallazgos: Hallazgo[];
	referencias: ResultadoReferencias;
	planesBorneros: PlanBornero[];
	ruteo: ResultadoRuteo;
	sincronizacion: ResultadoSincronizacion;
}

const esc = (s: string) =>
	s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function tabla(cabeceras: string[], filas: (string | number | undefined)[][]): string {
	const th = cabeceras.map((c) => `<th scope="col">${esc(c)}</th>`).join('');
	const trs = filas
		.map((f) => `<tr>${f.map((c) => `<td${typeof c === 'number' ? ' class="numero"' : ''}>${esc(c === undefined ? '' : String(c))}</td>`).join('')}</tr>`)
		.join('\n');
	return `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

/** Informe HTML autocontenido con toda la documentación del proyecto. */
export function generarInformeHTML(d: Dossier, procedencia?: ProcedenciaDocumento,
	referencias3DMm?: ReadonlyMap<string, number>): string {
	const { proyecto } = d;
	const identidad = resumenProcedenciaDocumento(procedencia);
	const bom = generarBOM(proyecto);
	const conductores = generarListaConductores(proyecto, d.ruteo);
	const errores = d.hallazgos.filter((h) => h.severidad === 'error');
	const avisos = d.hallazgos.filter((h) => h.severidad === 'aviso');

	const secciones: string[] = [];

	secciones.push(`<h2>1. Verificación eléctrica (DRC)</h2>
<p>${errores.length} errores, ${avisos.length} avisos.</p>
${d.hallazgos.length === 0
	? '<p>Sin hallazgos en las reglas implementadas. No equivale a una aprobación de fabricación.</p>'
	: tabla(['Severidad', 'Regla', 'Detalle'], d.hallazgos.map((h) => [h.severidad, h.regla, h.mensaje]))}`);

	secciones.push(`<h2>2. Lista de materiales</h2>
<p>El número de partida vincula la referencia de compra con su variante y marcado, sin comprimir seis columnas en una hoja A4.</p>
${tabla(['Partida', 'Cant.', 'Descripción', 'Fabricante', 'Referencia'],
		bom.map((f, i) => [i + 1, f.cantidad, f.descripcion, f.fabricante, f.referencia]))}
<h3>Variante y marcado por partida</h3>
${tabla(['Partida', 'Variante declarada', 'Designaciones'],
		bom.map((f, i) => [i + 1, f.varianteDeclarada, f.designaciones.join(', ')]))}`);

	secciones.push(`<h2>3. Índice de dispositivos</h2>
${tabla(['Designación', 'Descripción', 'Posición'],
		d.referencias.indice.map((e) => [e.designacion, e.descripcion, e.posicion]))}`);

	const filasXref = d.referencias.cruzadas.flatMap((x) =>
		x.contactos.length === 0
			? [[x.designacion, x.posicion, '(sin contactos)', '', '']]
			: x.contactos.map((c) => [x.designacion, x.posicion, c.designacion, c.contacto, c.posicion]),
	);
	secciones.push(`<h2>4. Referencias cruzadas</h2>
${filasXref.length ? tabla(['Maestro', 'Posición', 'Contacto', 'Tipo', 'Posición'], filasXref)
	: '<p>Sin referencias cruzadas declaradas.</p>'}`);

	const formatoNumero = (v: number): string => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(v);
	const numeroMm = (v: number | undefined): string => v === undefined ? '—' : `${formatoNumero(v)} mm`;
	const estadoRutaLegible = { PENDIENTE: 'Ruta física pendiente', SIN_RUTA: 'Sin ruta calculada',
		SIN_DESGLOSE: 'Ruta sin desglose', RUTA_2D_ESTIMADA: 'Ruta 2D estimada',
		RUTA_3D_REFERENCIA: 'Ruta XYZ persistente de referencia; corte no verificado' } as const;
	const origenLegible = { CONFIGURADO: 'Configurado en el proyecto', POR_DEFECTO: 'Valor por defecto' } as const;
	secciones.push(`<h2>5. Lista de conductores</h2>
${tabla(['Número', 'De', 'A', 'Sección', 'Color', 'Ruteo 2D + margen/puntas (mm)', 'Estado físico'],
		conductores.map((f) => [f.numero, f.de, f.a, f.seccion, f.color,
			f.longitudMm === undefined ? '' : formatoNumero(f.longitudMm),
			f.pendienteRuta ? 'Ruta física pendiente' : f.rutaReferencia3D ? 'Ruta XYZ; corte no verificado'
				: f.longitudMm === undefined ? 'Ruta sin corte calculado' : 'Con ruta']))}`);
	const longitudes = proyectarLongitudesDocumentales(proyecto, d.ruteo, referencias3DMm);
	secciones.push(`<h3>Desglose de longitudes por conductor</h3>
<p>La longitud eléctrica declarada, el recorrido ortogonal 2D y la referencia XYZ persistente son magnitudes diferentes. Una propuesta legacy no mide profundidad Z, curvas ni corte real de taller. Un plan XYZ no recibe una propuesta de corte 2D ajena. Un corte verificado no está disponible en esta revisión.</p>
${tabla(['Conductor', 'Estado', 'Eléctrica declarada', 'Ruta 2D', 'Referencia XYZ', 'Origen XYZ', 'Política eléctrica', 'Eléctrica adoptada', 'Corte propuesto (estimado)'],
	longitudes.map((l) => [l.conductorId, estadoRutaLegible[l.estadoRuta],
		l.longitudDeclaradaElectricaM === undefined ? '—' : `${formatoNumero(l.longitudDeclaradaElectricaM)} m`,
		numeroMm(l.longitudRutaMm), numeroMm(l.longitudReferencia3DMm), l.origenReferencia3D ?? '—',
		l.politicaLongitudElectrica,
		l.longitudElectricaAdoptadaM === undefined ? '—' : `${formatoNumero(l.longitudElectricaAdoptadaM)} m (${l.origenLongitudElectrica})`,
		numeroMm(l.propuestaCorteMm)]))}
<section class="tabla-reserva"><h3>Reserva, puntas y verificación de corte</h3>
${tabla(['Conductor', 'Reserva', 'Puntas', 'Redondeo', 'Corte verificado'],
	longitudes.map((l) => [l.conductorId,
		`${formatoNumero(l.reservaPorcentaje * 100)} % (${origenLegible[l.origenReserva]}); ${numeroMm(l.reservaMm)}`,
		`${numeroMm(l.puntasMm)} (${origenLegible[l.origenPuntas]})`, numeroMm(l.redondeoMm),
		numeroMm(l.longitudCorteVerificadaMm)]))}</section>`);

	for (const plan of d.planesBorneros) {
		secciones.push(`<h3>Plan de bornero ${esc(plan.designacion)}</h3>
${tabla(['Borna', 'Interna', 'Externa', 'Nº cond.', 'Puentes', 'Avisos'],
			plan.filas.map((f) => [
				f.borna, f.internas.join(' / '), f.externas.join(' / '),
				f.numeroConductor, f.puenteCon.join(', '), f.avisos.join('; '),
			]))}`);
	}

	secciones.push(`<h2>7. Índice estimado de canaletas</h2>
<p>El ruteo 2D utiliza dimensiones nominales de ducto; donde falta diámetro exterior se estima la cubierta. Un índice bajo no verifica empaque, entradas, tapa ni capacidad térmica.</p>
${tabla(['Canaleta', 'Índice', 'Diámetros', 'Estado'],
		d.ruteo.ocupaciones.map((o) => [
			o.canaletaId,
			`${Math.round(o.ocupacion * 100)} % del criterio legacy`,
			`${o.diametrosDeclarados ?? 0} declarados / ${o.diametrosEstimados ?? 0} estimados`,
			o.excedida ? 'REVISAR: estimación alta' : 'NO VERIFICADO',
		]))}`);

	const sync = d.sincronizacion;
	secciones.push(`<h2>8. Sincronización esquema ↔ gabinete</h2>
<p>${sync.sincronizado ? 'Sincronizado ✔' : 'Con diferencias:'}</p>
${sync.sincronizado ? '' : tabla(['Problema', 'Dispositivos'], [
		['Faltan en gabinete', sync.faltanEnGabinete.join(', ')],
		['Sobran en gabinete', sync.sobranEnGabinete.join(', ')],
		['Campo dentro del gabinete', sync.campoDentroDelGabinete.join(', ')],
		['Solapes', sync.solapes.map((s) => s.join(' × ')).join('; ')],
		['Fuera de placa', sync.fueraDePlaca.join(', ')],
	])}`);

	return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>${esc(proyecto.nombre)} — Dossier técnico</title>
<style>
	body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 60rem; padding: 0 1rem; }
	table { border-collapse: collapse; width: 100%; margin: .8rem 0 1.6rem; font-size: .9rem; }
	th, td { border: 1px solid #bbb; padding: .3rem .5rem; text-align: left; vertical-align: top; overflow-wrap: break-word; }
	th { background: #eee; overflow-wrap: normal; }
	td.numero { text-align: right; font-variant-numeric: tabular-nums; }
	h1 { border-bottom: 2px solid #444; padding-bottom: .3rem; }
	dl { display: grid; grid-template-columns: 11rem minmax(0, 1fr); gap: .2rem .75rem; }
	dt { font-weight: 600; } dd { margin: 0; overflow-wrap: break-word; }
	@media print {
		@page { size: A4; margin: 14mm; }
		body { margin: 0; padding: 0; max-width: none; font-size: 10pt; }
		table { font-size: 8.5pt; break-inside: auto; }
		thead { display: table-header-group; }
		tr { break-inside: avoid; page-break-inside: avoid; }
		h2, h3 { break-after: avoid; page-break-after: avoid; }
		.tabla-reserva { break-inside: avoid; }
	}
</style></head><body>
<h1>${esc(proyecto.nombre)} — Dossier técnico</h1>
<p>Generado por TableroStudio. Hojas: ${proyecto.hojas.length}. Dispositivos: ${proyecto.dispositivos.length}. Conductores: ${proyecto.conductores.length}.</p>
<dl><dt>Estado documental</dt><dd>${esc(identidad.estado)}</dd>
<dt>Project ID</dt><dd>${esc(identidad.projectId)}</dd>
<dt>Revisión del repositorio</dt><dd>${esc(identidad.revisionRepositorio)}</dd>
<dt>Revisión editorial</dt><dd>${esc(proyecto.datos?.revision ?? 'No declarada')}</dd>
<dt>Fecha editorial</dt><dd>${esc(proyecto.datos?.fecha ?? 'No declarada')}</dd>
<dt>Generado</dt><dd>${esc(identidad.generadoEn)}</dd>
<dt>Build ID</dt><dd>${esc(identidad.buildId)}</dd>
<dt>Alcance y límites</dt><dd>Informe HTML de revisión eléctrica, materiales y conexiones del proyecto visible. No constituye certificación ni aprobación de fabricación.</dd></dl>
${secciones.join('\n')}</body></html>`;
}
