/** DOC-02: archivos de una sola revisión; el ZIP/manifiesto y el gesto UI viven aparte. */
import type { Proyecto } from '../src/modelo/tipos.js';
import type { ProcedenciaDocumento } from '../src/modelo/procedencia-documental.js';
import { resumenProcedenciaDocumento } from '../src/modelo/procedencia-documental.js';
import type { ArchivoPaqueteDocumental } from '../src/modelo/manifiesto-paquete-documental.js';
import { aCSV } from '../src/modelo/csv.js';
import { hashSnapshotTecnico } from '../src/datos-tecnicos/hash.js';
import { revisarTablero } from '../src/motores/revision.js';
import { prepararMarcadores } from '../src/motores/marcadores.js';
import { proyectarLongitudesDocumentales } from '../src/motores/longitudes-documentales.js';
import { proyectarReferenciasEsquemaM2 } from '../src/motores/referencias-esquema-m2.js';
import { etiquetaClaseHojaEsquema, type HojaEsq } from '../src/motores/esquema.js';
import { longitudesDibujadasMm, longitudesParaRevisionMm, referenciasManualesAdoptadasMm } from './escena3d.js';
import { hojaASvg } from './esquema-svg.js';
import { esquemaComoBlob } from './esquema-pdf.js';
import { dossierComoBlob } from './pdf.js';
import { generarInformeHTML } from '../src/motores/documentacion.js';
import { ejecutarIngenieria } from '../src/ingenieria/engine.js';
import { contextoEstaticoIngenieria } from '../src/ingenieria/contexto-estatico.js';
import { generarListaSenalesIO } from '../src/ingenieria/senales-io.js';
import {
	bomIngenieriaACsv, conductoresIngenieriaACsv, crearInformeIngenieriaV7,
	datosTecnicosIngenieriaACsv, informeIngenieriaV7AHtml, informeIngenieriaV7AJson,
	terminalesIngenieriaACsv,
} from '../src/ingenieria/documentacion.js';

const esc = (valor: unknown): string => String(valor ?? '').replace(/[\u0000-\u001f\ufffe\uffff]/g, ' ')
	.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
	.replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const porId = <T extends { id: string }>(filas: readonly T[]): T[] =>
	[...filas].sort((a, b) => a.id.localeCompare(b.id));

/** El encabezado conserva procedencia aun en una lista vacía (fila META explícita). */
function listaCsv(cabeceras: string[], filas: (string | number | undefined)[][],
	procedencia: ProcedenciaDocumento, alcance: string): string {
	const p = resumenProcedenciaDocumento(procedencia);
	const meta = [p.estado, p.projectId, p.revisionRepositorio, p.generadoEn, p.buildId, alcance];
	const extras = ['Estado documental', 'Project ID', 'Revisión repositorio', 'Generado en', 'Build ID', 'Alcance', 'Tipo fila'];
	return aCSV([[...cabeceras, ...extras],
		...filas.map((fila) => [...fila, ...meta, 'DATO']),
		...(filas.length ? [] : [[...cabeceras.map(() => ''), ...meta, 'META']])]);
}

function indiceHtml(proyecto: Proyecto, procedencia: ProcedenciaDocumento,
	archivos: readonly ArchivoPaqueteDocumental[], errores: number, avisos: number,
	rutasPendientes: number, ioDiagnosticos: number, hojas: readonly HojaEsq[]): string {
	const p = resumenProcedenciaDocumento(procedencia);
	const rutasFolio = new Set(hojas.map((h) => `esquema/hoja-${String(h.numero).padStart(3, '0')}.svg`));
	// Cada pieza conserva un solo enlace en el índice: el SVG se presenta con su título arriba.
	const enlaces = archivos.filter((a) => !rutasFolio.has(a.ruta))
		.map((a) => `<li><a href="${esc(a.ruta)}">${esc(a.ruta)}</a> <small>${esc(a.mime)}</small></li>`).join('');
	const folios = [...hojas].sort((a, b) => a.numero - b.numero || a.id.localeCompare(b.id))
		.map((h) => `<tr><td>${h.numero}</td><td><a href="esquema/hoja-${String(h.numero).padStart(3, '0')}.svg">${esc(h.titulo)}</a></td>`
			+ `<td>${esc(h.clase ? etiquetaClaseHojaEsquema(h.clase) : 'Sin clase declarada')}</td>`
			+ `<td>${h.anchoMm} × ${h.altoMm} mm</td><td><code>${esc(h.id)}</code></td></tr>`).join('');
	return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(proyecto.nombre)} — paquete de revisión</title>
<style>body{font:16px/1.55 system-ui,sans-serif;max-width:68rem;margin:0 auto;padding:2rem;color:#142535}h1{border-bottom:4px solid #154c70;padding-bottom:.6rem}dt{font-weight:700}dd{margin:0 0 .7rem}ul{columns:2}li{break-inside:avoid;padding:.2rem 0}a{color:#14547e}small{color:#506473}table{border-collapse:collapse;width:100%}th,td{text-align:left;border-bottom:1px solid #c6d4dc;padding:.35rem;vertical-align:top}code{overflow-wrap:anywhere}.aviso{border-left:5px solid #b16e0d;background:#fff5df;padding:1rem}@media(max-width:700px){ul{columns:1}body{padding:1rem}}</style></head><body>
<h1>${esc(proyecto.nombre)} — paquete eléctrico</h1>
<p class="aviso"><strong>Borrador técnico para revisión profesional.</strong> No certifica, aprueba ni autoriza fabricación. DRC: ${errores} errores y ${avisos} avisos; ${rutasPendientes} conexiones con ruta física pendiente; ${ioDiagnosticos} diagnósticos de E/S. Una longitud estimada no es un metraje de corte.</p>
<dl><dt>Estado documental</dt><dd>${esc(p.estado)}</dd><dt>Project ID</dt><dd>${esc(p.projectId)}</dd><dt>Revisión del repositorio</dt><dd>${esc(p.revisionRepositorio)}</dd><dt>Revisión editorial</dt><dd>${esc(proyecto.datos?.revision ?? 'No declarada')}</dd><dt>Generado</dt><dd>${esc(p.generadoEn)}</dd><dt>Build ID</dt><dd>${esc(p.buildId)}</dd></dl>
<h2>Folios de esta revisión</h2><p>La clase es editorial y solo aparece si se declaró; no certifica la función eléctrica. Los enlaces abren cada hoja de esta misma revisión.</p>
<table><thead><tr><th>N.º</th><th>Título</th><th>Clase</th><th>Formato físico</th><th>ID estable</th></tr></thead><tbody>${folios}</tbody></table>
<h2>Archivos de esta revisión</h2><ul>${enlaces}</ul>
<p>Las hojas gráficas no duplican aparatos ni conductores: los listados se derivan de las identidades persistentes. El manifiesto externo incluye SHA-256 de cada archivo. El informe de Ingeniería usa condición estática declarada, no un estado de simulación energizada.</p>
</body></html>`;
}

/**
 * Genera todos los documentos desde una copia privada. El caller debe haber confirmado
 * previamente el flush de la revisión y comprobar que el proyecto activo sigue siendo el mismo.
 * Ningún generador recibe la instancia mutable del editor.
 */
export async function crearArchivosPaqueteDocumental(proyecto: Proyecto,
	procedencia: ProcedenciaDocumento): Promise<ArchivoPaqueteDocumental[]> {
	if (proyecto.esEjemplo && procedencia.estado === 'confirmado')
		throw new Error('Un ejemplo efímero no puede publicarse con identidad de revisión confirmada.');
	const fuente = structuredClone(proyecto);
	const snapshotId = hashSnapshotTecnico(fuente);
	const copia = structuredClone(fuente);
	// Una revisión emitida no inventa designaciones distintas de las guardadas. La persona puede
	// renumerar con vista previa antes de emitir; si falta una etiqueta, se muestra el ID estable.
	const revision = revisarTablero(copia, { renumerarAparatos: false,
		longitudesMm: longitudesParaRevisionMm(copia),
		referenciasManualesMm: referenciasManualesAdoptadasMm(copia) });
	const analisis = ejecutarIngenieria({ proyecto: copia,
		contextoFisico: contextoEstaticoIngenieria(copia, referenciasManualesAdoptadasMm(copia)) });
	const informe = crearInformeIngenieriaV7({ proyecto: copia, analisis,
		trazabilidad: { projectId: procedencia.estado === 'confirmado' ? procedencia.projectId
			: procedencia.motivo === 'ejemplo' ? 'EJEMPLO_EFIMERO' : 'SIN_REPOSITORIO',
			...(procedencia.estado === 'confirmado' ? { revision: procedencia.revisionRepositorio } : {}),
			snapshotId, buildId: procedencia.buildId, generadoEn: procedencia.generadoEn,
			procedencia: structuredClone(procedencia) } });
	const io = generarListaSenalesIO(copia);
	const referenciasEsquema = proyectarReferenciasEsquemaM2(copia, revision.hojasEsquema);
	const pendientes = copia.conductores.filter((c) => c.estadoRutaFisica === 'pendiente').length;
	const archivos: ArchivoPaqueteDocumental[] = [];
	const agregar = (ruta: string, contenido: string | Uint8Array, mime: string) =>
		archivos.push({ ruta, contenido, mime });
	const pdf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
	const csv = (ruta: string, cabeceras: string[], filas: (string | number | undefined)[][], alcance: string) =>
		agregar(ruta, listaCsv(cabeceras, filas, procedencia, alcance), 'text/csv; charset=utf-8');

	for (const hoja of revision.hojasEsquema) {
		const ruta = `esquema/hoja-${String(hoja.numero).padStart(3, '0')}.svg`;
		agregar(ruta, hojaASvg(hoja, { proyecto: copia.nombre, datos: copia.datos,
			totalHojas: revision.hojasEsquema.length, procedencia, rutasPendientes: pendientes }),
			'image/svg+xml');
	}
	if (revision.hojasEsquema.length) agregar('esquema/esquema.pdf',
		await pdf(esquemaComoBlob(revision.hojasEsquema, copia.nombre, copia.datos ?? {}, procedencia, pendientes)),
		'application/pdf');
	agregar('dossier/dossier.pdf', await pdf(dossierComoBlob(copia, procedencia)), 'application/pdf');
	agregar('dossier/dossier.html',
		generarInformeHTML(revision, procedencia, longitudesDibujadasMm(copia)), 'text/html; charset=utf-8');
	agregar('ingenieria/informe.json', informeIngenieriaV7AJson(informe), 'application/json');
	agregar('ingenieria/informe.html', informeIngenieriaV7AHtml(informe), 'text/html; charset=utf-8');
	agregar('ingenieria/bom.csv', bomIngenieriaACsv(informe.bom, informe), 'text/csv; charset=utf-8');
	agregar('ingenieria/conductores.csv', conductoresIngenieriaACsv(informe.conductores, informe), 'text/csv; charset=utf-8');
	agregar('ingenieria/borneros.csv', terminalesIngenieriaACsv(informe.terminales, informe), 'text/csv; charset=utf-8');
	if (informe.datosTecnicos) agregar('ingenieria/datos-tecnicos.csv',
		datosTecnicosIngenieriaACsv(informe), 'text/csv; charset=utf-8');

	const posicion = new Map(revision.referencias.indice.map((r) => [r.dispositivoId, r.posicion]));
	const conductorPorId = new Map(copia.conductores.map((c) => [c.id, c]));
	const estadoRuta = (id: string): string => {
		const c = conductorPorId.get(id);
		return c?.estadoRutaFisica === 'pendiente' ? 'PENDIENTE'
			: c?.rutaFisica ? 'RUTA_M6_XYZ_REFERENCIA'
				: c?.planRutaAutomatica ? 'PLAN_AUTO_XYZ_REFERENCIA' : 'LEGACY_O_DECLARADA';
	};
	csv('listas/aparatos.csv', ['ID', 'Designación', 'Tipo', 'Descripción', 'Fabricante', 'Referencia', 'Posición'],
		porId(copia.dispositivos).map((d) => [d.id, d.designacion ?? d.id, d.tipo,
			d.descripcion, d.fabricante, d.referencia, posicion.get(d.id)]),
		'Aparatos persistentes, una fila por identidad; las representaciones de esquema no son aparatos.');
	csv('listas/conexiones.csv', ['Conductor ID', 'Número', 'De dispositivo', 'De borne', 'A dispositivo', 'A borne', 'Ruta física'],
		informe.conductores.map((c) => [c.id, c.numero, c.deDispositivo, c.deTerminal,
			c.aDispositivo, c.aTerminal, estadoRuta(c.id)]),
		'Conexiones eléctricas del proyecto, una fila por Conductor persistente; no por trazo de hoja.');
	csv('listas/conductores.csv', ['ID', 'Número', 'Sección mm²', 'Color', 'Material', 'Longitud m', 'Origen longitud', 'Circuitos', 'Ruta física'],
		informe.conductores.map((c) => [c.id, c.numero, c.seccionMm2, c.color, c.material,
			c.longitudM, c.origenLongitud, c.circuitos.join(', '), estadoRuta(c.id)]),
		'Longitud m corresponde a la política eléctrica de Ingeniería, no a un corte verificado ni a metros de manguera multiconductora.');
	csv('listas/longitudes-conductores.csv', ['Conductor ID', 'Estado de ruta',
		'Longitud eléctrica declarada (m)', 'Ruta 2D estimada (mm)', 'Referencia XYZ persistente (mm)',
		'Origen referencia XYZ', 'Política eléctrica', 'Longitud eléctrica adoptada (m)',
		'Origen longitud eléctrica',
		'Reserva (%)', 'Origen reserva', 'Reserva (mm)', 'Extra por conexión (mm)',
		'Origen puntas', 'Puntas total (mm)', 'Redondeo (mm)',
		'Propuesta de corte estimada (mm)', 'Corte verificado (mm)'],
		proyectarLongitudesDocumentales(copia, revision.ruteo, longitudesDibujadasMm(copia)).map((l) => [
			l.conductorId, l.estadoRuta, l.longitudDeclaradaElectricaM, l.longitudRutaMm,
			l.longitudReferencia3DMm, l.origenReferencia3D,
			l.politicaLongitudElectrica, l.longitudElectricaAdoptadaM, l.origenLongitudElectrica,
			l.reservaPorcentaje * 100, l.origenReserva, l.reservaMm, l.extraPorConexionMm,
			l.origenPuntas, l.puntasMm, l.redondeoMm, l.propuestaCorteMm,
			l.longitudCorteVerificadaMm,
		]),
		'Una propuesta de corte legacy usa recorrido 2D y márgenes. Un plan V4 o ruta manual M6 mide XYZ persistente, pero no es longitud eléctrica adoptada ni corte verificado; no se le inventa un corte desde otra ruta.');
	csv('listas/borneros.csv', ['Bornero ID', 'Designación', 'Borne', 'Tipo', 'Conexiones', 'Circuitos'],
		informe.terminales.map((t) => [t.borneroId, t.designacion, t.borneId, t.tipo,
			t.conexiones.map((c) => `${c.conductorId}:${c.dispositivoId}:${c.borneId}`).join(' / '), t.circuitos.join(', ')]),
		'Bornes y conexiones reales, no referencias gráficas duplicadas.');
	csv('listas/marcadores.csv', ['Tipo', 'Entidad ID', 'Extremo', 'Dispositivo ID', 'Borne ID', 'Ubicación borne',
		'Identificador', 'Designación', 'Borne', 'Destino dispositivo', 'Destino borne',
		'Número conductor', 'Descripción',
		'Campo principal', 'Texto principal', 'Campo secundario', 'Texto secundario', 'Cantidad'],
		prepararMarcadores(copia).map((m) => [m.tipo, m.entidadId, m.lado ?? '', m.dispositivoId,
			m.borneId ?? '', m.ubicacionBorne ?? '', m.campos.identificador, m.campos.designacion, m.campos.borne,
			m.campos.destinoDispositivo, m.campos.destinoBorne,
			m.campos.numeroConductor, m.campos.descripcion,
			m.campoPrincipal, m.principal, m.campoSecundario ?? '', m.secundaria ?? '', m.cantidad]),
		'Un marcador por aparato/borne físico y uno por cada extremo de conductor. Ubicación borne distingue regleta y terminal de aparato; filtrar antes de imprimir. Cantidad = copias por marcador.');
	csv('listas/referencias-cruzadas.csv', ['Maestro ID', 'Designación', 'Posición', 'Contacto ID', 'Tipo contacto', 'Posición contacto'],
		revision.referencias.cruzadas.flatMap((r) => r.contactos.length
			? r.contactos.map((c) => [r.maestroId, r.designacion, r.posicion, c.dispositivoId, c.contacto, c.posicion])
			: [[r.maestroId, r.designacion, r.posicion, '', '', '']]),
		'Referencias cruzadas de funciones reales; posiciones gráficas derivadas del esquema de la revisión.');
	csv('listas/referencias-plc-terminales.csv', ['Controlador ID', 'Canal borne ID', 'Clase', 'Origen', 'Calidad',
		'Conductor ID', 'Hoja canal ID', 'Hoja canal número', 'Columna canal', 'Representación canal ID',
		'Terminal dispositivo ID', 'Terminal borne ID', 'Hoja terminal ID', 'Hoja terminal número',
		'Columna terminal', 'Representación terminal ID'],
		referenciasEsquema.canales.map((r) => [r.controladorId, r.canalBorneId, r.clase, r.origen, r.calidad,
			r.conductorId, r.canal.hojaId, r.canal.numeroHoja, r.canal.columna, r.canal.representacionId,
			r.terminal.dispositivoId, r.terminal.borneId, r.terminal.ubicacion.hojaId,
			r.terminal.ubicacion.numeroHoja, r.terminal.ubicacion.columna,
			r.terminal.ubicacion.representacionId]),
		'Referencias de canal PLC a terminal real con anclaje único en ambas vistas; extremos ambiguos u omitidos constan en diagnósticos.');
	csv('listas/referencias-circuitos-hojas.csv', ['Circuito ID', 'Nombre', 'Estado topología', 'Alcance',
		'Conductores identificados', 'Conductores sin ancla única', 'Hoja ID', 'Hoja número'],
		referenciasEsquema.circuitos.flatMap((r) => r.hojas.length
			? r.hojas.map((h) => [r.circuitoId, r.nombre, r.estadoTopologia, r.alcance,
				r.conductores.join(' / '), r.conductoresSinAncla.join(' / '), h.id, h.numero])
			: [[r.circuitoId, r.nombre, r.estadoTopologia, r.alcance,
				r.conductores.join(' / '), r.conductoresSinAncla.join(' / '), '', '']]),
		'Solo trayectos de alimentación identificados; no afirma retorno exhaustivo ni ubica conductores sin ancla única.');
	if (referenciasEsquema.diagnosticos.length)
		csv('listas/referencias-esquema-diagnosticos.csv', ['Código', 'Entidad ID', 'Conductor ID', 'Detalle'],
			referenciasEsquema.diagnosticos.map((d) => [d.codigo, d.entidadId, d.conductorId, d.detalle]),
			'Diagnósticos de referencias no verificables o ambiguas; no se elige una hoja por orden de arrays.');
	csv('listas/senales-io.csv', ['Dispositivo ID', 'Designación', 'Borne', 'Rótulo', 'Clase', 'Origen', 'Origen perfil', 'Calidad', 'Etiquetas', 'Común', 'Unidad', 'Rango', 'Conexiones', 'Estado'],
		io.filas.map((f) => [f.dispositivoId, f.designacion, f.borneId, f.rotulo, f.clase,
			f.origen, f.origenPerfil, f.calidad, f.etiquetas.join(' / '), f.comun, f.unidad,
			f.rango?.join('–'), f.conexiones.map((c) => `${c.conductorId}:${c.otroDispositivoId}:${c.otroBorneId}`).join(' / '), f.estadoConexion]),
		'E/S declaradas o inferidas con calidad explícita; sin certificar semántica del fabricante.');
	if (io.diagnosticos.length) csv('listas/senales-io-diagnosticos.csv', ['Dispositivo ID', 'Código', 'Borne', 'Mensaje'],
		io.diagnosticos.map((d) => [d.dispositivoId, d.codigo, d.borneId, d.mensaje]),
		'Diagnósticos de E/S; los perfiles inválidos no se silencian ni se clasifican arbitrariamente.');
	if (copia.ingenieria?.disenoAsistido?.decisiones.length) agregar('ingenieria/decisiones-v9-historicas.json',
		JSON.stringify({ formato: 'tablerostudio-decisiones-v9-historicas', version: 1,
			procedencia, estado: 'HISTORICO_NO_REEVALUADO',
			limitacion: 'La intención aplicada persiste, pero no el resultado completo de búsqueda. No equivale a una recomendación V9 vigente.',
			decisiones: copia.ingenieria.disenoAsistido.decisiones }, null, 2), 'application/json');
	agregar('index.html', indiceHtml(copia, procedencia, archivos, revision.resumen.errores,
		revision.resumen.avisos, pendientes, io.diagnosticos.length, revision.hojasEsquema), 'text/html; charset=utf-8');
	return archivos;
}
