import { inspeccionarDatosNoConfiables, validarReferencia } from '../datos-tecnicos/schema.js';
import { hashSnapshotTecnico, jsonCanonico } from '../datos-tecnicos/hash.js';
import { referenciaTecnica, type RevisionTecnica } from '../datos-tecnicos/tipos.js';
import { aCSV } from '../modelo/csv.js';
import { resumenProcedenciaDocumento, type ProcedenciaDocumento } from '../modelo/procedencia-documental.js';
import type { Proyecto } from '../modelo/tipos.js';
import { BLOQUEOS_POR_DEFECTO, crearSnapshotDisenoAsistido, evaluarDisenoAsistido, hashPlanDiseno } from './core.js';
import type { ContextoInformeDiseno, ResultadoDisenoAsistido, SnapshotDisenoAsistido } from './tipos.js';

/** La procedencia confirmada es adicional al contexto V9 previo; el lector conserva compatibilidad. */
export type ContextoDocumentalDiseno = ContextoInformeDiseno & { procedencia?: ProcedenciaDocumento };

const LIMITE_INFORME = 5_000_000;
const ALCANCE_DISENO = 'Diseño asistido V9: búsqueda acotada a la BASE y revisiones fijadas; no certificación ni óptimo global' as const;
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
	contexto?: ContextoDocumentalDiseno;
	alcance?: typeof ALCANCE_DISENO;
	snapshot: {
		algoritmo: SnapshotDisenoAsistido['algoritmo'];
		bloqueosPorDefecto: SnapshotDisenoAsistido['bloqueosPorDefecto'];
		hash: string;
		hashBase: string;
		solicitud: SnapshotDisenoAsistido['solicitud'];
		revisiones: ReturnType<typeof referenciaTecnica>[];
	};
	resultado: Omit<ResultadoDisenoAsistido, 'resultados'> & {
		resultados: Array<Omit<ResultadoDisenoAsistido['resultados'][number], 'analisis' | 'proyecto'>>;
	};
}

function informe(snapshot: SnapshotDisenoAsistido, resultado: ResultadoDisenoAsistido, contexto?: ContextoDocumentalDiseno): InformeDisenoV9 {
	if (resultado.snapshotHash !== snapshot.hash) throw new Error('INFORME_SNAPSHOT_INCONSISTENTE');
	return {
		formato: 'tablerostudio-diseno-asistido', version: 1,
		alcance: ALCANCE_DISENO,
		...(contexto ? { contexto: structuredClone(contexto) } : {}),
		snapshot: {
			algoritmo: structuredClone(snapshot.algoritmo), bloqueosPorDefecto:structuredClone(snapshot.bloqueosPorDefecto), hash: snapshot.hash, hashBase: snapshot.hashBase, solicitud: structuredClone(snapshot.solicitud),
			revisiones: snapshot.revisiones.map(referenciaTecnica),
		},
		resultado: {
			...resultado,
			resultados: resultado.resultados.map(({ analisis: _a, proyecto: _p, ...r }) => structuredClone(r)),
		},
	};
}

/** Evidencia acotada: nunca incluye clones de Proyecto ni resultados internos del solver. */
export function informeDisenoJson(snapshot: SnapshotDisenoAsistido, resultado: ResultadoDisenoAsistido, contexto?: ContextoDocumentalDiseno): string {
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
	const raiz = objeto(valor, '$'); allowlist(raiz, ['formato', 'version', 'contexto', 'alcance', 'snapshot', 'resultado'], '$');
	if (raiz.formato !== 'tablerostudio-diseno-asistido' || raiz.version !== 1) throw new Error('INFORME_SCHEMA_NO_SOPORTADO');
	if (raiz.alcance !== undefined && raiz.alcance !== ALCANCE_DISENO) throw new Error('$.alcance: valor no permitido');
	if (raiz.contexto !== undefined) {
		const c = objeto(raiz.contexto, '$.contexto'); allowlist(c, ['projectId', 'revision', 'snapshotId', 'buildId', 'generadoEn', 'aplicacion', 'procedencia'], '$.contexto');
		for (const k of ['projectId', 'buildId', 'generadoEn']) texto(c[k], `$.contexto.${k}`);
		if (!Number.isFinite(Date.parse(c.generadoEn as string))) throw new Error('$.contexto.generadoEn: fecha ISO inválida');
		if (c.procedencia !== undefined) {
			const p = objeto(c.procedencia, '$.contexto.procedencia');
			if (p.estado === 'confirmado') {
				allowlist(p, ['estado', 'projectId', 'revisionRepositorio', 'buildId', 'generadoEn'], '$.contexto.procedencia');
				for (const k of ['projectId', 'buildId', 'generadoEn']) texto(p[k], `$.contexto.procedencia.${k}`);
				if (!Number.isSafeInteger(p.revisionRepositorio) || Number(p.revisionRepositorio) < 0
					|| c.projectId !== p.projectId || c.revision !== p.revisionRepositorio)
					throw new Error('$.contexto.procedencia: revisión confirmada inconsistente');
			} else if (p.estado === 'efimero') {
				allowlist(p, ['estado', 'motivo', 'buildId', 'generadoEn'], '$.contexto.procedencia');
				if (!['ejemplo', 'sin-repositorio'].includes(String(p.motivo)) || c.revision !== undefined
					|| c.projectId !== (p.motivo === 'ejemplo' ? 'EJEMPLO_EFIMERO' : 'SIN_REPOSITORIO'))
					throw new Error('$.contexto.procedencia: documento efímero inconsistente');
				for (const k of ['buildId', 'generadoEn']) texto(p[k], `$.contexto.procedencia.${k}`);
			} else throw new Error('$.contexto.procedencia.estado: valor inválido');
			if (p.buildId !== c.buildId || p.generadoEn !== c.generadoEn
				|| !Number.isFinite(Date.parse(p.generadoEn as string))) throw new Error('$.contexto.procedencia: fecha o build inconsistente');
		}
		if (c.aplicacion !== undefined) {
			const a = objeto(c.aplicacion, '$.contexto.aplicacion'); allowlist(a, ['estado', 'planId', 'decisionId'], '$.contexto.aplicacion');
			if (!['NO_APLICADA', 'APLICADA'].includes(String(a.estado))) throw new Error('$.contexto.aplicacion.estado: valor inválido');
			for (const k of ['planId', 'decisionId']) if (a[k] !== undefined) texto(a[k], `$.contexto.aplicacion.${k}`);
		}
	}
	const s = objeto(raiz.snapshot, '$.snapshot');
	allowlist(s, ['algoritmo', 'bloqueosPorDefecto', 'hash', 'hashBase', 'solicitud', 'revisiones'], '$.snapshot');
	hash(s.hash, '$.snapshot.hash'); hash(s.hashBase, '$.snapshot.hashBase');
	const algoritmo = objeto(s.algoritmo, '$.snapshot.algoritmo');
	allowlist(algoritmo, ['id', 'version', 'buildId'], '$.snapshot.algoritmo');
	if (algoritmo.id !== 'DISENO_ASISTIDO_V9' || algoritmo.version !== 1) throw new Error('$.snapshot.algoritmo: versión no soportada');
	texto(algoritmo.buildId, '$.snapshot.algoritmo.buildId', 200);
	const bloqueos = s.bloqueosPorDefecto;
	if (!Array.isArray(bloqueos)
		|| bloqueos.length !== BLOQUEOS_POR_DEFECTO.length
		|| BLOQUEOS_POR_DEFECTO.some((bloqueo, i) => bloqueos[i] !== bloqueo)) {
		throw new Error('$.snapshot.bloqueosPorDefecto: frontera inválida');
	}
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
	const snapshot = crearSnapshotDisenoAsistido({ proyecto: entrada.proyecto, solicitud: antiguo.snapshot.solicitud, revisionesDisponibles: revisiones, contextoFisico: entrada.contextoFisico, buildId: antiguo.snapshot.algoritmo.buildId });
	const baseOriginalCoincide = hashSnapshotTecnico(entrada.proyecto) === antiguo.snapshot.hashBase;
	return {
		snapshot, resultado: evaluarDisenoAsistido(snapshot), baseOriginalCoincide,
		advertencias: baseOriginalCoincide ? ['El informe fue reevaluado; sus resultados importados no se reutilizaron.']
			: ['La BASE cambió: se creó una búsqueda nueva y ningún resultado importado es aplicable.'],
	};
}

export function informeDisenoCsv(resultado: ResultadoDisenoAsistido, contexto?: ContextoDocumentalDiseno,
	snapshot?: SnapshotDisenoAsistido): string {
	if (snapshot && resultado.snapshotHash !== snapshot.hash) throw new Error('INFORME_SNAPSHOT_INCONSISTENTE');
	const columnas = ['orden', 'id', 'tipo', 'estado', 'pareto', 'cambios', 'seccion_total_mm2', 'in_a', 'perdida_w', 'icc_a', 'razon_orden', 'limitaciones'];
	const filas: (string | number | undefined)[][] = resultado.resultados.map(r => [r.orden, r.plan.id, r.plan.tipo, r.estado, r.pareto ? 'SI' : 'NO', r.metricas.cambios,
		r.metricas.seccionTotalMm2, r.metricas.proteccionInA, r.metricas.perdidaW, r.metricas.iccProspectivaA, r.razonOrden, r.limitaciones.join('; ')]);
	if (!contexto) return aCSV([columnas, ...filas]);
	const p = resumenProcedenciaDocumento(contexto.procedencia);
	const meta = [p.estado, p.projectId, p.revisionRepositorio, contexto.generadoEn, contexto.buildId, ALCANCE_DISENO,
		resultado.snapshotHash, snapshot?.hashBase ?? 'NO DISPONIBLE'];
	return aCSV([[...columnas, 'estado_documental', 'project_id', 'revision_repositorio', 'generado_en', 'build_id', 'alcance', 'snapshot_hash', 'base_hash', 'tipo_fila'],
		...filas.map(f => [...f, ...meta, 'DATO']),
		...(filas.length ? [] : [[...Array(columnas.length).fill(''), ...meta, 'META']])]);
}

export function informeDisenoHtml(snapshot: SnapshotDisenoAsistido, resultado: ResultadoDisenoAsistido, contexto?: ContextoDocumentalDiseno): string {
	const procedencia = resumenProcedenciaDocumento(contexto?.procedencia);
	const limiteRefs=200,omitidas=Math.max(0,snapshot.revisiones.length-limiteRefs);
	const refs = snapshot.revisiones.slice(0,limiteRefs).map(r => `<tr><td>${esc(r.tipo)}</td><td>${esc(r.catalogo.nombre)}</td><td>${esc(r.nombre)}</td><td>${r.revision}</td><td><code>${esc(r.hash)}</code></td><td>${esc(r.procedencia.origen)}</td></tr>`).join('');
	const n=(v:number|undefined,u='')=>v===undefined?'NO DISPONIBLE':`${new Intl.NumberFormat('es-ES',{maximumFractionDigits:3}).format(v)}${u}`;
	const filas = resultado.resultados.map(r => {const cambios=r.plan.cambios.map(c=>c.tipo==='SECCION'?`${c.conductorId} → ${c.seccionMm2} mm²`:`${c.dispositivoId} → ${c.referencia.id} r${c.referencia.revision}`).join('; ')||'Mantener BASE';const avisos=[...new Set([...r.limitaciones,...r.obligaciones.filter(o=>!['PASS','NOT_APPLICABLE'].includes(o.estado)).map(o=>`${o.estado} ${o.descripcion}${o.datosFaltantes.length?` · falta ${o.datosFaltantes.join(', ')}`:''}`)])];return`<tr><td>${r.orden}</td><td><b>${esc(r.plan.tipo)}</b><br><small><code>${esc(r.plan.id)}</code></small></td><td>${esc(cambios)}</td><td><b>${esc(r.estado)}</b><br>${r.pareto?'Pareto':''}</td><td>ΣS ${n(r.metricas.seccionTotalMm2,' mm²')}<br>In ${n(r.metricas.proteccionInA,' A')}<br>Pérd. ${n(r.metricas.perdidaW,' W')}<br>Icc ${n(r.metricas.iccProspectivaA,' A')}</td><td>${esc(r.razonOrden)}${avisos.length?`<ul>${avisos.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}</td></tr>`;}).join('');
	return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Diseño asistido V9</title><style>@page{size:A4 landscape;margin:10mm}body{font:13px system-ui;margin:2rem;color:#17202a;line-height:1.35}table{border-collapse:collapse;width:100%;margin:1rem 0;table-layout:fixed}th,td{border:1px solid #ccd;padding:.42rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}th:nth-child(1){width:2%}th:nth-child(2){width:15%}th:nth-child(3){width:17%}th:nth-child(4){width:9%}th:nth-child(5){width:14%}small{color:#566}code{overflow-wrap:anywhere}ul{margin:.35rem 0;padding-left:1rem}.aviso{padding:.7rem;background:#fff5d6;border-left:4px solid #ba7a00}@media print{body{margin:0;font-size:9pt}h1{margin-top:0}table{font-size:7.5pt;break-inside:auto}tr{break-inside:avoid}}</style></head><body><h1>Diseño asistido V9</h1>
		<p><b>${esc(snapshot.solicitud.nombre)}</b> · cobertura ${esc(resultado.cobertura)} · ${resultado.evaluados}/${resultado.totalEstimado}</p>
		<p class="aviso">Mejor alternativa según las preferencias declaradas entre las evaluadas; no es certificación ni óptimo global. ${esc(resultado.motivoCobertura)}</p>
		<h2>Contexto e intención</h2><dl><dt>Estado documental</dt><dd>${esc(procedencia.estado)}</dd><dt>Project ID confirmado</dt><dd>${esc(procedencia.projectId)}</dd><dt>Revisión del repositorio</dt><dd>${esc(procedencia.revisionRepositorio)}</dd><dt>Snapshot de recuperación</dt><dd>${esc(contexto?.snapshotId ?? 'NO DISPONIBLE')}</dd><dt>Fecha explícita</dt><dd>${esc(contexto?.generadoEn ?? 'NO DECLARADA')}</dd><dt>Build ID</dt><dd>${esc(contexto?.buildId ?? 'NO DECLARADO')}</dd><dt>Alcance</dt><dd>${esc(ALCANCE_DISENO)}</dd><dt>Aplicación</dt><dd>${esc(contexto?.aplicacion?.estado ?? 'NO DECLARADA')}</dd><dt>Objetivo</dt><dd>${esc(snapshot.solicitud.objetivo)}</dd><dt>Circuito</dt><dd>${esc(snapshot.solicitud.circuitoId)}</dd><dt>Conductores autorizados</dt><dd>${esc(snapshot.solicitud.conductores.join(', '))}</dd><dt>Protección autorizada</dt><dd>${esc(snapshot.solicitud.proteccionId ?? 'ninguna')}</dd><dt>Bloqueado</dt><dd>${esc(snapshot.bloqueosPorDefecto.join(', '))}</dd></dl>
		<h2>Método y terminación</h2><p>Cambios permitidos: ${esc(snapshot.solicitud.cambiosPermitidos.join(', '))}. Preferencias: ${esc(snapshot.solicitud.preferencias?.join(' → '))}. Presupuesto: ${esc(JSON.stringify(snapshot.solicitud.presupuesto))}. Generados/evaluados: ${resultado.generados}/${resultado.evaluados}. Duración registrada: ${resultado.duracionMs.toFixed(1)} ms.</p>
		<h2>Alternativas</h2><table><thead><tr><th>#</th><th>Plan</th><th>Cambios exactos</th><th>Estado</th><th>Métricas</th><th>Orden, datos faltantes y límites</th></tr></thead><tbody>${filas}</tbody></table>
		<h2>Revisiones fijadas</h2><p>${snapshot.revisiones.length} revisiones forman el manifiesto exacto.${omitidas?` La vista imprimible muestra las primeras ${limiteRefs}; el JSON conserva las ${snapshot.revisiones.length}.`:''}</p><table><thead><tr><th>Tipo</th><th>Catálogo</th><th>Revisión</th><th>r</th><th>Hash</th><th>Procedencia</th></tr></thead><tbody>${refs}</tbody></table>
		<h2>Trazabilidad</h2><p>Algoritmo ${esc(snapshot.algoritmo.id)} v${snapshot.algoritmo.version} · build ${esc(snapshot.algoritmo.buildId)}<br>BASE <code>${esc(snapshot.hashBase)}</code><br>Snapshot <code>${esc(snapshot.hash)}</code></p><p>Las cifras sintéticas permanecen identificadas como SINTETICO. La compatibilidad mecánica no demostrada requiere revisión humana.</p></body></html>`;
}
