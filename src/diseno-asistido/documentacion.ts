import { inspeccionarDatosNoConfiables, validarReferencia } from '../datos-tecnicos/schema.js';
import { hashSnapshotTecnico, jsonCanonico } from '../datos-tecnicos/hash.js';
import { referenciaTecnica, type RevisionTecnica } from '../datos-tecnicos/tipos.js';
import { aCSV } from '../modelo/csv.js';
import type { Proyecto } from '../modelo/tipos.js';
import { crearSnapshotDisenoAsistido, evaluarDisenoAsistido, hashPlanDiseno } from './core.js';
import type { ContextoInformeDiseno, ResultadoDisenoAsistido, SnapshotDisenoAsistido } from './tipos.js';

const LIMITE_INFORME = 5_000_000;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const refKey = (r: { tipo: string; catalogoId: string; id: string; revision: number; hash: string }) => `${r.tipo}:${r.catalogoId}:${r.id}:${r.revision}:${r.hash}`;

type Obj = Record<string, unknown>;
function objeto(v: unknown, ruta: string): Obj {
	if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${ruta}: objeto requerido`);
	return v as Obj;
}
function allowlist(o: Obj, claves: readonly string[], ruta: string): void {
	for (const k of Object.keys(o)) if (!claves.includes(k)) throw new Error(`${ruta}.${k}: campo no permitido`);
}
function texto(v: unknown, ruta: string, max = 2_000): asserts v is string {
	if (typeof v !== 'string' || !v.length || v.length > max) throw new Error(`${ruta}: texto inválido`);
}
function hash(v: unknown, ruta: string): asserts v is string {
	if (typeof v !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(v)) throw new Error(`${ruta}: hash inválido`);
}

export interface InformeDisenoV9 {
	formato: 'tablerostudio-diseno-asistido';
	version: 1;
	contexto?: ContextoInformeDiseno;
	snapshot: {
		hash: string;
		hashBase: string;
		solicitud: SnapshotDisenoAsistido['solicitud'];
		revisiones: ReturnType<typeof referenciaTecnica>[];
	};
	resultado: Omit<ResultadoDisenoAsistido, 'resultados'> & {
		resultados: Array<Omit<ResultadoDisenoAsistido['resultados'][number], 'analisis' | 'proyecto'>>;
	};
}

function informe(snapshot: SnapshotDisenoAsistido, resultado: ResultadoDisenoAsistido, contexto?: ContextoInformeDiseno): InformeDisenoV9 {
	if (resultado.snapshotHash !== snapshot.hash) throw new Error('INFORME_SNAPSHOT_INCONSISTENTE');
	return {
		formato: 'tablerostudio-diseno-asistido', version: 1,
		...(contexto ? { contexto: structuredClone(contexto) } : {}),
		snapshot: {
			hash: snapshot.hash, hashBase: snapshot.hashBase, solicitud: structuredClone(snapshot.solicitud),
			revisiones: snapshot.revisiones.map(referenciaTecnica),
		},
		resultado: {
			...resultado,
			resultados: resultado.resultados.map(({ analisis: _a, proyecto: _p, ...r }) => structuredClone(r)),
		},
	};
}

/** Evidencia acotada: nunca incluye clones de Proyecto ni resultados internos del solver. */
export function informeDisenoJson(snapshot: SnapshotDisenoAsistido, resultado: ResultadoDisenoAsistido, contexto?: ContextoInformeDiseno): string {
	return jsonCanonico(informe(snapshot, resultado, contexto));
}

/**
 * Lee evidencia importada como datos no confiables. Un informe jamás es un comando de aplicación:
 * sus planes se validan, pero para volver a usarlos deben reconstruirse y reevaluarse sobre una BASE.
 */
export function leerInformeDisenoJson(textoJson: string): InformeDisenoV9 {
	if (textoJson.length > LIMITE_INFORME) throw new Error('INFORME_DEMASIADO_GRANDE');
	let valor: unknown;
	try { valor = JSON.parse(textoJson); } catch { throw new Error('INFORME_JSON_INVALIDO'); }
	inspeccionarDatosNoConfiables(valor);
	const raiz = objeto(valor, '$'); allowlist(raiz, ['formato', 'version', 'contexto', 'snapshot', 'resultado'], '$');
	if (raiz.formato !== 'tablerostudio-diseno-asistido' || raiz.version !== 1) throw new Error('INFORME_SCHEMA_NO_SOPORTADO');
	if (raiz.contexto !== undefined) {
		const c = objeto(raiz.contexto, '$.contexto'); allowlist(c, ['projectId', 'revision', 'snapshotId', 'buildId', 'generadoEn', 'aplicacion'], '$.contexto');
		for (const k of ['projectId', 'buildId', 'generadoEn']) texto(c[k], `$.contexto.${k}`);
		if (!Number.isFinite(Date.parse(c.generadoEn as string))) throw new Error('$.contexto.generadoEn: fecha ISO inválida');
		if (c.aplicacion !== undefined) {
			const a = objeto(c.aplicacion, '$.contexto.aplicacion'); allowlist(a, ['estado', 'planId', 'decisionId'], '$.contexto.aplicacion');
			if (!['NO_APLICADA', 'APLICADA'].includes(String(a.estado))) throw new Error('$.contexto.aplicacion.estado: valor inválido');
			for (const k of ['planId', 'decisionId']) if (a[k] !== undefined) texto(a[k], `$.contexto.aplicacion.${k}`);
		}
	}
	const s = objeto(raiz.snapshot, '$.snapshot'); allowlist(s, ['hash', 'hashBase', 'solicitud', 'revisiones'], '$.snapshot'); hash(s.hash, '$.snapshot.hash'); hash(s.hashBase, '$.snapshot.hashBase');
	if (!Array.isArray(s.revisiones) || s.revisiones.length > 12_000) throw new Error('$.snapshot.revisiones: colección inválida');
	for (const [i, r] of s.revisiones.entries()) validarReferencia(r, `$.snapshot.revisiones[${i}]`);
	const resultado = objeto(raiz.resultado, '$.resultado');
	allowlist(resultado, ['version', 'snapshotHash', 'cobertura', 'motivoCobertura', 'generados', 'evaluados', 'totalEstimado', 'duracionMs', 'excluidas', 'resultados'], '$.resultado');
	if (resultado.version !== 1 || resultado.snapshotHash !== s.hash) throw new Error('$.resultado: snapshot o versión inconsistente');
	if (!Array.isArray(resultado.resultados) || resultado.resultados.length > 2_000) throw new Error('$.resultado.resultados: colección inválida');
	for (const [i, bruto] of resultado.resultados.entries()) {
		const r = objeto(bruto, `$.resultado.resultados[${i}]`); const p = objeto(r.plan, `$.resultado.resultados[${i}].plan`);
		allowlist(p, ['version', 'id', 'tipo', 'cambios'], `$.resultado.resultados[${i}].plan`);
		if (p.version !== 1 || !['BASE', 'SECCION', 'PROTECCION', 'COMBINADO'].includes(String(p.tipo))) throw new Error(`$.resultado.resultados[${i}].plan: tipo inválido`);
		hash(p.id, `$.resultado.resultados[${i}].plan.id`);
		if (!Array.isArray(p.cambios) || p.cambios.length > 101) throw new Error(`$.resultado.resultados[${i}].plan.cambios: colección inválida`);
		for (const [j, cambio] of p.cambios.entries()) {
			const c = objeto(cambio, `plan.cambios[${j}]`);
			if (c.tipo === 'SECCION') {
				allowlist(c, ['tipo', 'conductorId', 'seccionMm2'], `plan.cambios[${j}]`); texto(c.conductorId, `plan.cambios[${j}].conductorId`, 200);
				if (typeof c.seccionMm2 !== 'number' || !Number.isFinite(c.seccionMm2) || c.seccionMm2 <= 0 || c.seccionMm2 > 1_000) throw new Error(`plan.cambios[${j}].seccionMm2: rango inválido`);
			} else if (c.tipo === 'PROTECCION') {
				allowlist(c, ['tipo', 'dispositivoId', 'referencia'], `plan.cambios[${j}]`); texto(c.dispositivoId, `plan.cambios[${j}].dispositivoId`, 200); validarReferencia(c.referencia, `plan.cambios[${j}].referencia`);
			} else throw new Error(`plan.cambios[${j}].tipo: cambio no permitido`);
		}
		if (hashPlanDiseno(p as unknown as InformeDisenoV9['resultado']['resultados'][number]['plan']) !== p.id) throw new Error(`$.resultado.resultados[${i}].plan: identidad manipulada`);
	}
	return valor as InformeDisenoV9;
}

export interface ReevaluacionInformeDiseno {
	snapshot: SnapshotDisenoAsistido;
	resultado: ResultadoDisenoAsistido;
	baseOriginalCoincide: boolean;
	advertencias: string[];
}

/**
 * Un informe importado solo aporta intención y referencias exactas. Se crea un snapshot nuevo y se
 * ejecuta otra vez el motor común; nunca se confía en la clasificación ni en el candidato exportado.
 */
export function reevaluarInformeDisenoImportado(entrada: {
	textoJson: string;
	proyecto: Proyecto;
	revisionesDisponibles?: readonly RevisionTecnica[];
	contextoFisico?: SnapshotDisenoAsistido['contextoFisico'];
}): ReevaluacionInformeDiseno {
	const antiguo = leerInformeDisenoJson(entrada.textoJson);
	const disponibles = [...(entrada.proyecto.datosTecnicos?.revisiones ?? []), ...(entrada.revisionesDisponibles ?? [])];
	const indice = new Map(disponibles.map(r => [refKey(referenciaTecnica(r)), r]));
	const revisiones: RevisionTecnica[] = [];
	for (const ref of antiguo.snapshot.revisiones) {
		const r = indice.get(refKey(ref)); if (!r) throw new Error(`REVISION_FIJADA_NO_DISPONIBLE:${refKey(ref)}`); revisiones.push(r);
	}
	const snapshot = crearSnapshotDisenoAsistido({ proyecto: entrada.proyecto, solicitud: antiguo.snapshot.solicitud, revisionesDisponibles: revisiones, contextoFisico: entrada.contextoFisico });
	const baseOriginalCoincide = hashSnapshotTecnico(entrada.proyecto) === antiguo.snapshot.hashBase;
	return {
		snapshot, resultado: evaluarDisenoAsistido(snapshot), baseOriginalCoincide,
		advertencias: baseOriginalCoincide ? ['El informe fue reevaluado; sus resultados importados no se reutilizaron.']
			: ['La BASE cambió: se creó una búsqueda nueva y ningún resultado importado es aplicable.'],
	};
}

export function informeDisenoCsv(resultado: ResultadoDisenoAsistido): string {
	return aCSV([
		['orden', 'id', 'tipo', 'estado', 'pareto', 'cambios', 'seccion_total_mm2', 'in_a', 'perdida_w', 'icc_a', 'razon_orden', 'limitaciones'],
		...resultado.resultados.map(r => [r.orden, r.plan.id, r.plan.tipo, r.estado, r.pareto ? 'SI' : 'NO', r.metricas.cambios,
			r.metricas.seccionTotalMm2, r.metricas.proteccionInA, r.metricas.perdidaW, r.metricas.iccProspectivaA, r.razonOrden, r.limitaciones.join('; ')]),
	]);
}

export function informeDisenoHtml(snapshot: SnapshotDisenoAsistido, resultado: ResultadoDisenoAsistido, contexto?: ContextoInformeDiseno): string {
	const refs = snapshot.revisiones.map(r => `<tr><td>${esc(r.tipo)}</td><td>${esc(r.catalogo.nombre)}</td><td>${esc(r.nombre)}</td><td>${r.revision}</td><td><code>${esc(r.hash)}</code></td><td>${esc(r.procedencia.origen)}</td></tr>`).join('');
	const filas = resultado.resultados.map(r => `<tr><td>${r.orden}</td><td>${esc(r.plan.tipo)}<br><small><code>${esc(r.plan.id)}</code></small></td><td>${esc(r.estado)}</td><td>${r.pareto ? 'sí' : 'no'}</td><td><pre>${esc(JSON.stringify(r.metricas, null, 2))}</pre></td><td>${esc(r.razonOrden)}</td><td>${esc([...r.limitaciones, ...r.obligaciones.filter(o => o.estado !== 'CUMPLE').map(o => `${o.estado}: ${o.descripcion}`)].join('; '))}</td></tr>`).join('');
	return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Diseño asistido V9</title><style>body{font:14px system-ui;margin:2rem;color:#17202a;line-height:1.4}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #ccd;padding:.45rem;text-align:left;vertical-align:top}small{color:#566}code{overflow-wrap:anywhere}pre{white-space:pre-wrap;margin:0}.aviso{padding:.7rem;background:#fff5d6;border-left:4px solid #ba7a00}@media print{body{margin:12mm}.no-print{display:none}table{font-size:9pt;break-inside:auto}tr{break-inside:avoid}}</style></head><body><h1>Diseño asistido V9</h1>
		<p><b>${esc(snapshot.solicitud.nombre)}</b> · cobertura ${esc(resultado.cobertura)} · ${resultado.evaluados}/${resultado.totalEstimado}</p>
		<p class="aviso">Mejor alternativa según las preferencias declaradas entre las evaluadas; no es certificación ni óptimo global. ${esc(resultado.motivoCobertura)}</p>
		<h2>Contexto e intención</h2><dl><dt>Proyecto</dt><dd>${esc(contexto?.projectId ?? 'NO DECLARADO')}</dd><dt>Revisión documental</dt><dd>${esc(contexto?.revision ?? 'NO DECLARADA')}</dd><dt>Fecha explícita</dt><dd>${esc(contexto?.generadoEn ?? 'NO DECLARADA')}</dd><dt>Build ID</dt><dd>${esc(contexto?.buildId ?? 'NO DECLARADO')}</dd><dt>Aplicación</dt><dd>${esc(contexto?.aplicacion?.estado ?? 'NO DECLARADA')}</dd><dt>Circuito</dt><dd>${esc(snapshot.solicitud.circuitoId)}</dd><dt>Conductores autorizados</dt><dd>${esc(snapshot.solicitud.conductores.join(', '))}</dd><dt>Protección autorizada</dt><dd>${esc(snapshot.solicitud.proteccionId ?? 'ninguna')}</dd></dl>
		<h2>Método y terminación</h2><p>Cambios permitidos: ${esc(snapshot.solicitud.cambiosPermitidos.join(', '))}. Preferencias: ${esc(snapshot.solicitud.preferencias?.join(' → '))}. Presupuesto: ${esc(JSON.stringify(snapshot.solicitud.presupuesto))}. Generados/evaluados: ${resultado.generados}/${resultado.evaluados}. Duración registrada: ${resultado.duracionMs.toFixed(1)} ms.</p>
		<h2>Alternativas</h2><table><thead><tr><th>#</th><th>Plan</th><th>Estado</th><th>Pareto</th><th>Métricas</th><th>Orden</th><th>Datos faltantes / límites</th></tr></thead><tbody>${filas}</tbody></table>
		<h2>Revisiones fijadas</h2><table><thead><tr><th>Tipo</th><th>Catálogo</th><th>Revisión</th><th>r</th><th>Hash</th><th>Procedencia</th></tr></thead><tbody>${refs}</tbody></table>
		<h2>Trazabilidad</h2><p>BASE <code>${esc(snapshot.hashBase)}</code><br>Snapshot <code>${esc(snapshot.hash)}</code></p><p>Las cifras sintéticas permanecen identificadas como SINTETICO. La compatibilidad mecánica no demostrada requiere revisión humana.</p></body></html>`;
}
