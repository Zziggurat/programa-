/**
 * Motor de documentación técnica.
 *
 * Sigue la idea de la base de datos de proyección de QElectroTech (projectdatabase.cpp):
 * los documentos son consultas sobre el modelo, no dibujos. Genera:
 *  - Lista de materiales (BOM) agrupada por referencia de fabricante.
 *  - Lista de conductores (número, origen, destino, sección, color, longitud ruteada).
 *  - Exportadores CSV y un informe HTML completo.
 */
import { Proyecto } from '../modelo/tipos.js';
import { extremoTexto } from '../modelo/proyecto.js';
import { Hallazgo } from './drc.js';
import { PlanBornero } from './bornes.js';
import { ResultadoPotenciales } from './potenciales.js';
import { ResultadoReferencias } from './referencias.js';
import { ResultadoRuteo } from './ruteo.js';
import { ResultadoSincronizacion } from './sincronizacion.js';

export interface FilaBOM {
	cantidad: number;
	descripcion: string;
	fabricante: string;
	referencia: string;
	designaciones: string[];
}

export function generarBOM(proyecto: Proyecto): FilaBOM[] {
	const grupos = new Map<string, FilaBOM>();
	for (const d of proyecto.dispositivos) {
		if (d.tipo === 'cable') continue;
		const clave = `${d.fabricante ?? ''}|${d.referencia ?? ''}|${d.descripcion ?? ''}`;
		const fila = grupos.get(clave) ?? {
			cantidad: 0,
			descripcion: d.descripcion ?? '',
			fabricante: d.fabricante ?? '',
			referencia: d.referencia ?? '',
			designaciones: [],
		};
		fila.cantidad += 1;
		fila.designaciones.push(d.designacion ?? d.id);
		grupos.set(clave, fila);
	}
	return [...grupos.values()].sort(
		(a, b) => a.fabricante.localeCompare(b.fabricante) || a.referencia.localeCompare(b.referencia),
	);
}

export interface FilaConductor {
	numero: string;
	de: string;
	a: string;
	seccion: string;
	color: string;
	longitudMm?: number;
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
			longitudMm: longitudDe.get(c.id),
		}))
		.sort((a, b) => a.numero.localeCompare(b.numero, undefined, { numeric: true }));
}

/* --------------------------------- Exportadores --------------------------------- */

export function aCSV(filas: (string | number | undefined)[][]): string {
	return filas
		.map((fila) =>
			fila
				.map((celda) => {
					const s = celda === undefined ? '' : String(celda);
					return /[";\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
				})
				.join(';'),
		)
		.join('\n');
}

export function bomACSV(bom: FilaBOM[]): string {
	return aCSV([
		['Cantidad', 'Descripción', 'Fabricante', 'Referencia', 'Designaciones'],
		...bom.map((f) => [f.cantidad, f.descripcion, f.fabricante, f.referencia, f.designaciones.join(', ')]),
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
	const th = cabeceras.map((c) => `<th>${esc(c)}</th>`).join('');
	const trs = filas
		.map((f) => `<tr>${f.map((c) => `<td>${esc(c === undefined ? '' : String(c))}</td>`).join('')}</tr>`)
		.join('\n');
	return `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

/** Informe HTML autocontenido con toda la documentación del proyecto. */
export function generarInformeHTML(d: Dossier): string {
	const { proyecto } = d;
	const bom = generarBOM(proyecto);
	const conductores = generarListaConductores(proyecto, d.ruteo);
	const errores = d.hallazgos.filter((h) => h.severidad === 'error');
	const avisos = d.hallazgos.filter((h) => h.severidad === 'aviso');

	const secciones: string[] = [];

	secciones.push(`<h2>1. Verificación eléctrica (DRC)</h2>
<p>${errores.length} errores, ${avisos.length} avisos.</p>
${tabla(['Severidad', 'Regla', 'Detalle'], d.hallazgos.map((h) => [h.severidad, h.regla, h.mensaje]))}`);

	secciones.push(`<h2>2. Lista de materiales</h2>
${tabla(['Cant.', 'Descripción', 'Fabricante', 'Referencia', 'Designaciones'],
		bom.map((f) => [f.cantidad, f.descripcion, f.fabricante, f.referencia, f.designaciones.join(', ')]))}`);

	secciones.push(`<h2>3. Índice de dispositivos</h2>
${tabla(['Designación', 'Descripción', 'Posición'],
		d.referencias.indice.map((e) => [e.designacion, e.descripcion, e.posicion]))}`);

	const filasXref = d.referencias.cruzadas.flatMap((x) =>
		x.contactos.length === 0
			? [[x.designacion, x.posicion, '(sin contactos)', '', '']]
			: x.contactos.map((c) => [x.designacion, x.posicion, c.designacion, c.contacto, c.posicion]),
	);
	secciones.push(`<h2>4. Referencias cruzadas</h2>
${tabla(['Maestro', 'Posición', 'Contacto', 'Tipo', 'Posición'], filasXref)}`);

	secciones.push(`<h2>5. Lista de conductores</h2>
${tabla(['Número', 'De', 'A', 'Sección', 'Color', 'Longitud (mm)'],
		conductores.map((f) => [f.numero, f.de, f.a, f.seccion, f.color, f.longitudMm]))}`);

	for (const plan of d.planesBorneros) {
		secciones.push(`<h3>Plan de bornero ${esc(plan.designacion)}</h3>
${tabla(['Borna', 'Interna', 'Externa', 'Nº cond.', 'Puentes', 'Avisos'],
			plan.filas.map((f) => [
				f.borna, f.internas.join(' / '), f.externas.join(' / '),
				f.numeroConductor, f.puenteCon.join(', '), f.avisos.join('; '),
			]))}`);
	}

	secciones.push(`<h2>7. Ocupación de canaletas</h2>
${tabla(['Canaleta', 'Ocupación', 'Estado'],
		d.ruteo.ocupaciones.map((o) => [
			o.canaletaId,
			`${Math.round(o.ocupacion * 100)} % del máximo recomendado`,
			o.excedida ? 'EXCEDIDA' : 'ok',
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

	return `<meta charset="utf-8">
<title>${esc(proyecto.nombre)} — Dossier técnico</title>
<style>
	body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 60rem; padding: 0 1rem; }
	table { border-collapse: collapse; width: 100%; margin: .8rem 0 1.6rem; font-size: .9rem; }
	th, td { border: 1px solid #bbb; padding: .3rem .5rem; text-align: left; }
	th { background: #eee; }
	h1 { border-bottom: 2px solid #444; padding-bottom: .3rem; }
</style>
<h1>${esc(proyecto.nombre)} — Dossier técnico</h1>
<p>Generado por TableroStudio. Hojas: ${proyecto.hojas.length}. Dispositivos: ${proyecto.dispositivos.length}. Conductores: ${proyecto.conductores.length}.</p>
${secciones.join('\n')}`;
}
