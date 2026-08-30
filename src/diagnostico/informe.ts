import type { ResultadoFallaFisica } from '../fisica/fallas.js';
import type { ResultadoFisicaElectrica } from '../fisica/topologia-proyecto.js';
import type { OrigenDatoFisico } from '../modelo/fisica.js';
import type { Proyecto } from '../modelo/tipos.js';
import type { ResultadoAnalisisTecnico } from './analisis.js';

export interface TrazabilidadInformeV6 {
	projectId: string;
	revision?: number;
	snapshotId?: string;
	buildId: string;
	generadoEn: string;
}

export interface FallaInformeV6 {
	id: string;
	tipo: string;
	estado: 'ACTIVA' | 'DESPEJADA';
	origen: OrigenDatoFisico;
	iccA?: number;
}

export interface InformeAnalisisV6 {
	formato: 'tablerostudio-informe-analisis';
	version: 1;
	proyecto: {
		id: string;
		nombre: string;
		revision?: number;
		snapshotId?: string;
		equipos: number;
		conductores: number;
	};
	trazabilidad: TrazabilidadInformeV6;
	objetivo: { id: string; tipo: string; titulo: string; estado: string };
	configuracionRelevante?: unknown;
	resumen: string;
	magnitudes: ResultadoAnalisisTecnico['magnitudes'];
	protecciones: {
		dispositivoId: string;
		corrienteA: number;
		inA?: number;
		region: string;
		corrienteResidualA?: number;
	}[];
	fallasActivas: FallaInformeV6[];
	diagnosticos: ResultadoAnalisisTecnico['diagnosticos'];
	causas: string[];
	consecuencias: string[];
	provenance: OrigenDatoFisico[];
	limitaciones: string[];
	leyenda: string;
}

export interface EntradaInformeAnalisisV6 {
	proyecto: Proyecto;
	fisica: ResultadoFisicaElectrica;
	analisis: ResultadoAnalisisTecnico;
	trazabilidad: TrazabilidadInformeV6;
}

const clonar = <T>(valor: T): T => structuredClone(valor);
const magnitud = (v: { re: number; im: number } | undefined): number | undefined => v ? Math.hypot(v.re, v.im) : undefined;

function fallaInforme(f: ResultadoFallaFisica): FallaInformeV6 {
	return { id: f.id, tipo: f.tipo, estado: f.despejada ? 'DESPEJADA' : 'ACTIVA', origen: f.origen, iccA: magnitud(f.iccA) };
}

/** Fotografía técnica pura. La hora y la identidad entran explícitas para hacerla reproducible. */
export function crearInformeAnalisisV6(entrada: EntradaInformeAnalisisV6): InformeAnalisisV6 {
	const { proyecto, fisica, analisis, trazabilidad } = entrada;
	const equipo = analisis.objetivoId === '@circuito' ? undefined : proyecto.dispositivos.find((d) => d.id === analisis.objetivoId);
	const diagnosticos = clonar(analisis.diagnosticos);
	const provenance = [...new Set<OrigenDatoFisico>([
		...analisis.magnitudes.map((m) => m.origen),
		...fisica.fallas.map((f) => f.origen),
		...diagnosticos.flatMap((d) => d.evidencias.map((e) => e.origen === 'OBSERVADO' ? 'CALCULADO' as const : e.origen)),
	])].sort();
	return {
		formato: 'tablerostudio-informe-analisis', version: 1,
		proyecto: { id: trazabilidad.projectId, nombre: proyecto.nombre, revision: trazabilidad.revision,
			snapshotId: trazabilidad.snapshotId, equipos: proyecto.dispositivos.length, conductores: proyecto.conductores.length },
		trazabilidad: clonar(trazabilidad),
		objetivo: { id: analisis.objetivoId, tipo: analisis.tipo, titulo: analisis.titulo, estado: analisis.estado },
		configuracionRelevante: equipo ? clonar({ comportamiento: equipo.comportamiento, fisica: equipo.fisica,
			tensionNominal: equipo.tensionNominal, corrienteNominal: equipo.corrienteNominal, curvaDisparo: equipo.curvaDisparo })
			: clonar(proyecto.opciones),
		resumen: analisis.resumen,
		magnitudes: clonar(analisis.magnitudes),
		protecciones: [...fisica.protecciones.values()].filter((p) => !equipo || p.dispositivoId === equipo.id
			|| analisis.topologia.aguasArriba.includes(p.dispositivoId)).map((p) => ({ dispositivoId: p.dispositivoId,
				corrienteA: p.corrienteA, inA: p.inA, region: p.evaluacion.region, corrienteResidualA: p.corrienteResidualA }))
			.sort((a, b) => a.dispositivoId.localeCompare(b.dispositivoId)),
		fallasActivas: fisica.fallas.map(fallaInforme).sort((a, b) => a.id.localeCompare(b.id)),
		diagnosticos,
		causas: diagnosticos.filter((d) => d.clasificacion === 'ROOT_CAUSE' && d.estado === 'SOSTENIDA').map((d) => d.id),
		consecuencias: diagnosticos.filter((d) => d.clasificacion === 'CONSEQUENCE' || d.clasificacion === 'SECONDARY_EFFECT').map((d) => d.id),
		provenance,
		limitaciones: clonar(analisis.limitaciones),
		leyenda: 'Resultados derivados del modelo de simulación TableroStudio. No constituyen certificación, conformidad legal ni informe oficial.',
	};
}

const esc = (valor: unknown): string => String(valor ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
	.replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const numero = (valor: number | undefined): string => valor === undefined || !Number.isFinite(valor) ? '—'
	: new Intl.NumberFormat('es-CL', { maximumFractionDigits: 4 }).format(valor);
const tabla = (cabeceras: string[], filas: unknown[][]): string => `<table><thead><tr>${cabeceras.map((x) => `<th>${esc(x)}</th>`).join('')}</tr></thead>`
	+ `<tbody>${filas.map((f) => `<tr>${f.map((x) => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

/** HTML autocontenido e imprimible; no incluye scripts ni dependencias externas. */
export function informeAnalisisV6AHtml(informe: InformeAnalisisV6): string {
	const evidencias = informe.diagnosticos.flatMap((d) => d.evidencias.map((e) => [d.id, d.clasificacion, d.confianza,
		e.codigo, e.descripcion, e.valor === undefined ? '' : `${numero(e.valor)} ${e.unidad ?? ''}`, e.origen]));
	return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(informe.proyecto.nombre)} — Análisis V6</title><style>
	body{font:14px system-ui,sans-serif;max-width:1100px;margin:32px auto;padding:0 20px;color:#18232b}h1,h2{color:#183f58}
	.meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 16px;padding:12px;background:#eef4f7}
	table{border-collapse:collapse;width:100%;margin:10px 0 24px;font-size:12px}th,td{border:1px solid #b9c5cc;padding:5px;text-align:left}th{background:#e8f0f4}
	.leyenda{border-left:4px solid #b16c27;padding:10px;background:#fff5e8}.provenance{font-family:ui-monospace,monospace}</style></head><body>
	<h1>Informe de análisis industrial V6</h1><div class="meta"><b>Proyecto</b><span>${esc(informe.proyecto.nombre)}</span>
	<b>Project ID</b><span>${esc(informe.proyecto.id)}</span><b>Revisión / snapshot</b><span>${esc(informe.proyecto.revision ?? '—')} / ${esc(informe.proyecto.snapshotId ?? '—')}</span>
	<b>Build ID</b><span>${esc(informe.trazabilidad.buildId)}</span><b>Fecha/hora</b><span>${esc(informe.trazabilidad.generadoEn)}</span>
	<b>Objetivo</b><span>${esc(informe.objetivo.titulo)}</span><b>Estado</b><span>${esc(informe.objetivo.estado)}</span></div>
	<h2>Resumen técnico</h2><p>${esc(informe.resumen)}</p>
	<h2>Magnitudes</h2>${tabla(['Código', 'Magnitud', 'Valor', 'Unidad', 'Provenance'], informe.magnitudes.map((m) => [m.codigo, m.etiqueta, numero(m.valor), m.unidad, m.origen]))}
	<h2>Protecciones</h2>${tabla(['Equipo', 'I (A)', 'In (A)', 'Región', 'IΔ (A)'], informe.protecciones.map((p) => [p.dispositivoId, numero(p.corrienteA), numero(p.inA), p.region, numero(p.corrienteResidualA)]))}
	<h2>Fallas de ensayo</h2>${tabla(['ID', 'Tipo', 'Estado', 'Icc (A)', 'Origen'], informe.fallasActivas.map((f) => [f.id, f.tipo, f.estado, numero(f.iccA), f.origen]))}
	<h2>Diagnósticos y evidencia</h2>${tabla(['Diagnóstico', 'Clase', 'Confianza', 'Evidencia', 'Descripción', 'Medición', 'Origen'], evidencias)}
	<h2>Trazabilidad causal</h2><p>Causas: ${esc(informe.causas.join(', ') || '—')}<br>Consecuencias: ${esc(informe.consecuencias.join(', ') || '—')}</p>
	<h2>Provenance</h2><p class="provenance">${esc(informe.provenance.join(' · ') || 'NO_MODELADO')}</p>
	<h2>Limitaciones</h2><ul>${informe.limitaciones.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
	<p class="leyenda">${esc(informe.leyenda)}</p></body></html>`;
}
