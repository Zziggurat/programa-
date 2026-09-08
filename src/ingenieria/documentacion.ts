/** Documentación de Ingeniería V7 derivada del Proyecto y del snapshot de EngineeringEngine. */
import { aCSV } from '../modelo/csv.js';
import type { OrigenDatoFisico } from '../modelo/fisica.js';
import type { Proyecto, TipoDispositivo } from '../modelo/tipos.js';
import { datosCoordinacion } from './protecciones.js';
import type { ejecutarIngenieria } from './engine.js';
import type { EngineeringIssue } from './validacion.js';
import { resolverCriteriosTecnicos } from '../datos-tecnicos/criterios.js';
import { resolverAmpacidadTecnica } from '../datos-tecnicos/ampacidad.js';
import { referenciaTecnica } from '../datos-tecnicos/tipos.js';

type AnalisisIngenieria = ReturnType<typeof ejecutarIngenieria>;

export interface TrazabilidadInformeIngenieria {
	projectId: string;
	revision?: string | number;
	snapshotId?: string;
	buildId: string;
	generadoEn: string;
}

export interface FilaBomIngenieria {
	tipo: TipoDispositivo;
	descripcion: string;
	cantidad: number;
	designaciones: string[];
	fabricante?: string;
	referencia?: string;
	perfil?: string;
	modeloFisico?: string[];
}

export interface FilaConductorIngenieria {
	id: string;
	numero: string;
	deDispositivo: string;
	deTerminal: string;
	aDispositivo: string;
	aTerminal: string;
	seccionMm2?: number;
	color?: string;
	material?: string;
	longitudM?: number;
	origenLongitud: OrigenDatoFisico | 'NO_DISPONIBLE';
	circuitos: string[];
}

export interface TotalConductoresIngenieria {
	material: string;
	seccionMm2?: number;
	color?: string;
	origenLongitud: FilaConductorIngenieria['origenLongitud'];
	cantidad: number;
	longitudTotalM?: number;
}

export interface FilaTerminalIngenieria {
	borneroId: string;
	designacion: string;
	borneId: string;
	tipo?: string;
	conexiones: { conductorId: string; dispositivoId: string; borneId: string }[];
	circuitos: string[];
}

export interface InformeIngenieriaV7 {
	datosTecnicos?: {
		version: 1; manifestHash?: string;
		revisiones: import('../datos-tecnicos/tipos.js').ReferenciaTecnica[];
		resoluciones: import('../datos-tecnicos/resolver.js').ResolucionDatoTecnico[];
		criterios: ReturnType<typeof resolverCriteriosTecnicos>[];
		ampacidad: ReturnType<typeof resolverAmpacidadTecnica>[];
		prospectiva: NonNullable<AnalisisIngenieria['prospectiva']> extends ReadonlyMap<string,infer T> ? T[] : never;
	};
	formato: 'tablerostudio-informe-ingenieria';
	version: 1;
	proyecto: { id: string; nombre: string; revision?: string | number; snapshotId?: string;
		dispositivos: number; conductores: number };
	trazabilidad: TrazabilidadInformeIngenieria;
	resumen: AnalisisIngenieria['validacion']['resumen'];
	circuitos: {
		id: string; nombre: string; tipo: string; estadoTopologia: string; fuenteId?: string;
		protecciones: string[]; conductores: string[]; cargas: string[]; subcircuitos: string[]; ambiguedades: string[];
	}[];
	potencia: AnalisisIngenieria['potencia'];
	issues: EngineeringIssue[];
	criterios: Proyecto['ingenieria'];
	datosFaltantes: string[];
	conductores: FilaConductorIngenieria[];
	totalesConductores: TotalConductoresIngenieria[];
	protecciones: {
		dispositivoId: string; corrienteA: number; inA?: number; region: string;
		capacidadCorte?: { icnKA?: number; icuKA?: number; icsKA?: number };
	}[];
	coordinacion: ReturnType<typeof datosCoordinacion>;
	balances: AnalisisIngenieria['potencia']['balances'];
	compatibilidad: EngineeringIssue[];
	diagnosticosV6: { codigo: string; mensaje: string; elementos?: string[] }[];
	bom: FilaBomIngenieria[];
	terminales: FilaTerminalIngenieria[];
	limitaciones: string[];
	leyenda: string;
}

const unico = (v: readonly string[]) => [...new Set(v)].sort((a, b) => a.localeCompare(b));
const clonar = <T>(v: T): T => structuredClone(v);

function perfilDe(proyecto: Proyecto, id: string): string | undefined {
	return proyecto.dispositivos.find((d) => d.id === id)?.comportamiento?.clase;
}

function modelosFisicos(d: Proyecto['dispositivos'][number]): string[] | undefined {
	if (!d.fisica) return undefined;
	const r = Object.entries(d.fisica).filter(([k, v]) => k !== 'version' && v !== undefined).map(([k]) => k).sort();
	return r.length ? r : undefined;
}

export function generarBomIngenieria(proyecto: Proyecto): FilaBomIngenieria[] {
	const grupos = new Map<string, FilaBomIngenieria>();
	for (const d of [...proyecto.dispositivos].sort((a, b) => a.id.localeCompare(b.id))) {
		if (d.tipo === 'cable') continue;
		const perfil = perfilDe(proyecto, d.id); const fisicos = modelosFisicos(d);
		const clave = JSON.stringify([d.tipo, d.descripcion ?? '', d.fabricante ?? '', d.referencia ?? '', perfil ?? '', fisicos ?? []]);
		const fila = grupos.get(clave) ?? { tipo: d.tipo, descripcion: d.descripcion ?? '', cantidad: 0,
			designaciones: [], ...(d.fabricante ? { fabricante: d.fabricante } : {}),
			...(d.referencia ? { referencia: d.referencia } : {}), ...(perfil ? { perfil } : {}),
			...(fisicos ? { modeloFisico: fisicos } : {}) };
		fila.cantidad++; fila.designaciones.push(d.designacion ?? d.id); grupos.set(clave, fila);
	}
	return [...grupos.values()].map((x) => ({ ...x, designaciones: [...x.designaciones].sort((a, b) => a.localeCompare(b)) }))
		.sort((a, b) => a.tipo.localeCompare(b.tipo) || (a.fabricante ?? '').localeCompare(b.fabricante ?? '')
			|| (a.referencia ?? '').localeCompare(b.referencia ?? '') || a.descripcion.localeCompare(b.descripcion));
}

export function generarListaConductoresIngenieria(proyecto: Proyecto, analisis: AnalisisIngenieria): FilaConductorIngenieria[] {
	return [...proyecto.conductores].sort((a, b) => a.id.localeCompare(b.id)).map((c) => {
		const f = analisis.fisica.conductores.get(c.id);
		return { id: c.id, numero: c.numero ?? c.id, deDispositivo: c.de.dispositivoId, deTerminal: c.de.borneId,
			aDispositivo: c.a.dispositivoId, aTerminal: c.a.borneId, seccionMm2: c.seccion, color: c.color,
			material: c.fisica?.material, longitudM: f?.longitudM,
			origenLongitud: f?.origenLongitud ?? 'NO_DISPONIBLE',
			circuitos: analisis.circuitos.filter((x) => x.conductores.includes(c.id)).map((x) => x.id).sort(),
		};
	});
}

export function totalizarConductores(filas: readonly FilaConductorIngenieria[]): TotalConductoresIngenieria[] {
	const grupos = new Map<string, { fila: TotalConductoresIngenieria; longitudes: number[]; completos: boolean }>();
	for (const f of filas) {
		const clave = JSON.stringify([f.material ?? '', f.seccionMm2 ?? null, f.color ?? '', f.origenLongitud]);
		const g = grupos.get(clave) ?? { fila: { material: f.material ?? '', seccionMm2: f.seccionMm2, color: f.color,
			origenLongitud: f.origenLongitud, cantidad: 0 }, longitudes: [], completos: true };
		g.fila.cantidad++; if (f.longitudM === undefined) g.completos = false; else g.longitudes.push(f.longitudM); grupos.set(clave, g);
	}
	return [...grupos.values()].map((g) => ({ ...g.fila,
		...(g.completos ? { longitudTotalM: g.longitudes.reduce((s, x) => s + x, 0) } : {}) }))
		.sort((a, b) => a.material.localeCompare(b.material) || (a.seccionMm2 ?? 0) - (b.seccionMm2 ?? 0)
			|| (a.color ?? '').localeCompare(b.color ?? '') || a.origenLongitud.localeCompare(b.origenLongitud));
}

export function generarListaTerminalesIngenieria(proyecto: Proyecto, analisis: AnalisisIngenieria): FilaTerminalIngenieria[] {
	const salida: FilaTerminalIngenieria[] = [];
	for (const d of [...proyecto.dispositivos].filter((x) => x.tipo === 'bornero').sort((a, b) => a.id.localeCompare(b.id))) {
		for (const b of [...d.bornes].sort((a, z) => a.id.localeCompare(z.id, undefined, { numeric: true }))) {
			const conexiones = proyecto.conductores.flatMap((c) => {
				const esDe = c.de.dispositivoId === d.id && c.de.borneId === b.id;
				const esA = c.a.dispositivoId === d.id && c.a.borneId === b.id;
				return esDe ? [{ conductorId: c.id, dispositivoId: c.a.dispositivoId, borneId: c.a.borneId }]
					: esA ? [{ conductorId: c.id, dispositivoId: c.de.dispositivoId, borneId: c.de.borneId }] : [];
			}).sort((a, z) => a.conductorId.localeCompare(z.conductorId));
			const idsConductores = new Set(conexiones.map((x) => x.conductorId));
			salida.push({ borneroId: d.id, designacion: d.designacion ?? d.id, borneId: b.id, tipo: b.tipo,
				conexiones, circuitos: unico(analisis.circuitos.filter((c) => c.conductores.some((id) => idsConductores.has(id))).map((c) => c.id)) });
		}
	}
	return salida;
}

export function crearInformeIngenieriaV7(entrada: {
	proyecto: Proyecto;
	analisis: AnalisisIngenieria;
	trazabilidad: TrazabilidadInformeIngenieria;
}): InformeIngenieriaV7 {
	const { analisis, trazabilidad } = entrada;
	const proyecto = analisis.tecnica?.proyecto ?? entrada.proyecto;
	const conductores = generarListaConductoresIngenieria(proyecto, analisis);
	const issues = clonar(analisis.validacion.issues);
	return {
		formato: 'tablerostudio-informe-ingenieria', version: 1,
		...(proyecto.datosTecnicos ? { datosTecnicos: {
			version: 1 as const, manifestHash: analisis.tecnica.manifestHash,
			revisiones: proyecto.datosTecnicos.revisiones.map(referenciaTecnica).sort((a,b)=>a.hash.localeCompare(b.hash)),
			resoluciones: clonar(analisis.tecnica.resoluciones),
			criterios: analisis.circuitos.map(c=>resolverCriteriosTecnicos(proyecto.datosTecnicos,c.id,c.criterios)),
			ampacidad: [...proyecto.datosTecnicos.instalaciones].sort((a,b)=>a.conductorId.localeCompare(b.conductorId)).map(i=>resolverAmpacidadTecnica(proyecto.datosTecnicos,i.conductorId,proyecto.conductores.find(w=>w.id===i.conductorId)?.seccion)),
			prospectiva: [...(analisis.prospectiva?.values() ?? [])].map(clonar),
		} } : {}),
		proyecto: { id: trazabilidad.projectId, nombre: proyecto.nombre, revision: trazabilidad.revision,
			snapshotId: trazabilidad.snapshotId, dispositivos: proyecto.dispositivos.length, conductores: proyecto.conductores.length },
		trazabilidad: clonar(trazabilidad), resumen: clonar(analisis.validacion.resumen),
		circuitos: analisis.circuitos.map((c) => ({ id: c.id, nombre: c.nombre, tipo: c.tipo,
			estadoTopologia: c.estadoTopologia, fuenteId: c.fuenteId, protecciones: [...c.protecciones],
			conductores: [...c.conductores], cargas: [...c.cargas], subcircuitos: [...c.subcircuitos], ambiguedades: [...c.ambiguedades] })),
		potencia: clonar(analisis.potencia), issues, criterios: clonar(proyecto.ingenieria),
		datosFaltantes: unico(analisis.validacion.resultados.flatMap((x) => x.missingData)), conductores,
		totalesConductores: totalizarConductores(conductores),
		protecciones: [...analisis.fisica.protecciones.values()].map((p) => ({ dispositivoId: p.dispositivoId,
			corrienteA: p.corrienteA, inA: p.inA, region: p.evaluacion.region,
			capacidadCorte: proyecto.dispositivos.find((d) => d.id === p.dispositivoId)?.fisica?.proteccion?.capacidadCorte }))
			.sort((a, b) => a.dispositivoId.localeCompare(b.dispositivoId)),
		coordinacion: clonar(datosCoordinacion(proyecto, analisis.circuitos, analisis.fisica)), balances: clonar(analisis.potencia.balances),
		compatibilidad: issues.filter((x) => ['IO', 'ANALOG', 'MOTOR', 'VFD', 'PE'].includes(x.category)),
		diagnosticosV6: analisis.fisica.diagnosticos.map((d) => ({ codigo: d.codigo, mensaje: d.mensaje,
			elementos: d.elementos ? [...d.elementos].sort() : undefined })).sort((a, b) => a.codigo.localeCompare(b.codigo) || a.mensaje.localeCompare(b.mensaje)),
		bom: generarBomIngenieria(proyecto), terminales: generarListaTerminalesIngenieria(proyecto, analisis),
		limitaciones: [
			'Las validaciones se limitan a criterios y perfiles explícitos del proyecto.',
			'NO_MODELADO y NO_DISPONIBLE no equivalen a conformidad ni a incumplimiento.',
			'Curvas genéricas, estimaciones e inyecciones se identifican por su procedencia.',
		], leyenda: 'Informe técnico derivado del modelo TableroStudio. No constituye certificación normativa ni reemplaza revisión profesional.',
	};
}

const esc = (v: unknown) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
	.replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const n = (v: number | undefined) => v === undefined || !Number.isFinite(v) ? '—' : String(Math.round(v * 10000) / 10000);
const tabla = (h: string[], filas: unknown[][]) => `<table><thead><tr>${h.map((x) => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>`
	+ `${filas.map((f) => `<tr>${f.map((x) => `<td${typeof x === 'number' ? ' class="numero"' : ''}>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const seccion = (titulo: string, contenido: string) => `<section><h2>${esc(titulo)}</h2>${contenido}</section>`;

function informeDatosTecnicosHtml(d: NonNullable<InformeIngenieriaV7['datosTecnicos']>): string {
	const dato = (v: unknown): string => typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—');
	return seccion('Datos técnicos V8 — revisiones y procedencia', `<p>Manifest ${esc(d.manifestHash)}. Integridad local, no autenticación ni certificación. Datos SINTÉTICOS permanecen sintéticos; fuentes documentales son declaradas salvo evidencia humana independiente.</p>`
		+ tabla(['Catálogo','Producto / tabla / perfil','Revisión','Hash'],d.revisiones.map(r=>[r.catalogoId,r.id,r.revision,r.hash]))
		+ tabla(['Entidad / campo','Valor resuelto','Estado','Decisión / fuente','Condiciones','Transformación / motivo'],d.resoluciones.map(r=>[`${r.entidadId} / ${r.clave}`,r.dato?`${dato(r.dato.valor)} ${r.dato.unidad}`:'—',r.estado,`${r.origen} / ${r.dato?.procedencia.origen??'—'}: ${r.dato?.procedencia.referencia??''}`,dato(r.dato?.condiciones??{}),[...r.pasos,...r.motivos,...r.advertencias].join('; ')])))
		+ seccion('Ampacidad e instalación V8', tabla(['Conductor','Estado','Iz base A','Factores','Iz A','Condiciones','Procedencia / revisión'],d.ampacidad.map(a=>[a.conductorId,a.estado,a.izBaseA,a.factoresAplicados.map(f=>`${f.id}=${f.factor}`).join(' × '),a.izA,dato(a.condiciones),`${a.procedencia?.origen??'—'} · ${a.procedencia?.referencia??''} · r${a.referencia?.revision??'—'} ${a.referencia?.hash??''}`]))
			+ `<ul>${d.ampacidad.flatMap(a=>[...a.transformaciones,...a.motivos,...a.faltantes]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`)
		+ seccion('Criterios versionados y cobertura V8', tabla(['Circuito','Parámetro','Estado','Decisión','Procedencia / herencia'],d.criterios.flatMap(c=>Object.entries(c.parametros).map(([k,p])=>[c.circuitoId,k,p.estado,dato(p.decision),p.ruta.map(x=>`${x.origen} r${x.referencia?.revision??'—'}`).join(' → ')]))))
		+ seccion('Ensayos prospectivos aislados', tabla(['Protección','Estado','Icc A','Origen','Motivo / límites'],d.prospectiva.map(p=>[p.proteccionId,p.estado,p.iccA,p.origen,[...p.motivos,...p.limitaciones].join('; ')])));
}

export const datosTecnicosIngenieriaACsv = (i: InformeIngenieriaV7) => aCSV([
	['Entidad','Campo','Estado','Valor','Unidad','Decisión','Origen declarado','Fuente','Revisión','Hash','Condiciones'],
	...(i.datosTecnicos?.resoluciones ?? []).map(r=>[r.entidadId,r.clave,r.estado,Array.isArray(r.dato?.valor)?r.dato.valor.join(' … '):typeof r.dato?.valor==='boolean'?String(r.dato.valor):r.dato?.valor,r.dato?.unidad,r.origen,r.dato?.procedencia.origen,r.dato?.procedencia.referencia,r.referencia.revision,r.referencia.hash,JSON.stringify(r.dato?.condiciones??{})]),
]);

export function informeIngenieriaV7AHtml(i: InformeIngenieriaV7): string {
	return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(i.proyecto.nombre)} — Ingeniería V7</title><style>
	:root{color-scheme:light;--ink:#172630;--muted:#526675;--brand:#15506f;--brand-dark:#103b53;--line:#c7d2d9;--soft:#eef4f7;--stripe:#f7fafb;--warning:#fff5df}*{box-sizing:border-box}body{font:14px/1.48 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;max-width:1180px;margin:0 auto;padding:32px 28px 48px;color:var(--ink);background:#fff}.cabecera{border-top:7px solid var(--brand);padding:22px 24px 20px;background:linear-gradient(135deg,#f5f9fb,#e8f1f5);border-radius:0 0 8px 8px}.cabecera h1{margin:0;color:var(--brand-dark);font-size:28px;letter-spacing:.01em}.subtitulo{margin:5px 0 0;color:var(--muted);font-size:13px}.meta{display:grid;grid-template-columns:minmax(130px,180px) 1fr;gap:7px 18px;margin-top:18px;padding-top:16px;border-top:1px solid var(--line)}.meta b{color:var(--brand-dark)}.meta span{overflow-wrap:anywhere}section{margin:30px 0 0;break-inside:avoid-page}h2{margin:0 0 12px;padding-bottom:6px;border-bottom:2px solid var(--brand);color:var(--brand-dark);font-size:19px;break-after:avoid-page}table{border-collapse:collapse;width:100%;font-size:12px;margin:0 0 22px;table-layout:auto}thead{display:table-header-group}tr{break-inside:avoid-page}th,td{border:1px solid var(--line);padding:7px 8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#dfeaf0;color:#183d52;font-weight:650}tbody tr:nth-child(even){background:var(--stripe)}td.numero{text-align:right;font-variant-numeric:tabular-nums}ul{margin:8px 0;padding-left:22px}.limit{margin-top:34px;border:1px solid #e4c98d;border-left:5px solid #b47a18;border-radius:4px;padding:14px 16px;background:var(--warning);break-inside:avoid-page}.limit>strong{color:#704600}.pie{margin:26px 0 0;padding-top:12px;border-top:1px solid var(--line);color:var(--muted);font-size:11px}@page{size:A4;margin:14mm}@media print{body{max-width:none;margin:0;padding:0;font-size:10pt}.cabecera{border-radius:0;padding:14px 16px}.cabecera h1{font-size:22pt}section{margin-top:20px}h2{font-size:14pt}table{font-size:8.5pt}th,td{padding:5px 6px}.limit{margin-top:22px}a{color:inherit;text-decoration:none}}
	</style></head><body>
	<header class="cabecera"><h1>Informe de Ingeniería V7</h1><p class="subtitulo">Validación técnica derivada del modelo TableroStudio</p><div class="meta"><b>Proyecto</b><span>${esc(i.proyecto.nombre)}</span><b>Project ID</b><span>${esc(i.proyecto.id)}</span><b>Revisión / snapshot</b><span>${esc(i.proyecto.revision ?? '—')} / ${esc(i.proyecto.snapshotId ?? '—')}</span><b>Build ID</b><span>${esc(i.trazabilidad.buildId)}</span><b>Generado</b><span>${esc(i.trazabilidad.generadoEn)}</span></div></header>
	${seccion('Resumen', tabla(['PASS','WARNING','FAIL','INDETERMINATE','N/A'], [[i.resumen.pass,i.resumen.warning,i.resumen.fail,i.resumen.indeterminate,i.resumen.notApplicable]]))}
	${i.datosTecnicos ? informeDatosTecnicosHtml(i.datosTecnicos) : ''}
	${seccion('Circuitos', tabla(['ID','Nombre','Tipo','Topología','Fuente','Cargas'], i.circuitos.map((c) => [c.id,c.nombre,c.tipo,c.estadoTopologia,c.fuenteId,c.cargas.join(', ')])))}
	${seccion('Potencia', tabla(['P (W)','Q (var)','S (VA)','PF','Pérdidas (W)','Frontera'], [[n(i.potencia.totalTablero.pW),n(i.potencia.totalTablero.qVar),n(i.potencia.totalTablero.sVA),n(i.potencia.totalTablero.factorPotencia),n(i.potencia.perdidas.totalModeladoW),i.potencia.fronteraTotal]]))}
	${seccion('Issues', tabla(['Código','Estado','Severidad','Circuito','Descripción','Procedencia'], i.issues.map((x) => [x.code,x.status,x.severity,x.circuitId,x.description,x.provenance])))}
	${seccion('Datos faltantes', `<ul>${i.datosFaltantes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`)}
	${seccion('Conductores', tabla(['ID','De','Terminal','A','Terminal','mm²','m','Origen','Circuitos'], i.conductores.map((x) => [x.id,x.deDispositivo,x.deTerminal,x.aDispositivo,x.aTerminal,n(x.seccionMm2),n(x.longitudM),x.origenLongitud,x.circuitos.join(', ')])))}
	${seccion('Protecciones y coordinación', tabla(['Equipo','I (A)','In (A)','Región','Icu/Icn (kA)'], i.protecciones.map((x) => [x.dispositivoId,n(x.corrienteA),n(x.inA),x.region,n(x.capacidadCorte?.icuKA ?? x.capacidadCorte?.icnKA)])) + tabla(['Circuito','Arriba','Abajo','Clasificación','Explicación'], i.coordinacion.map((x) => [x.circuitId,x.aguasArriba.dispositivoId,x.aguasAbajo.dispositivoId,x.clasificacion,x.explicacion])))}
	${seccion('Balance de fases', tabla(['Fuente','Desequilibrio I (%)','Desequilibrio V (%)','IN (A)','Métrica'], i.balances.map((x) => [x.fuenteId,n(x.desequilibrioCorrientePct),n(x.desequilibrioTensionPct),n(x.corrienteNeutroA),x.metrica])))}
	${seccion('BOM', tabla(['Cant.','Tipo','Descripción','Fabricante','Referencia','Perfil/modelo','Designaciones'], i.bom.map((x) => [x.cantidad,x.tipo,x.descripcion,x.fabricante,x.referencia,[x.perfil,...(x.modeloFisico??[])].filter(Boolean).join(' / '),x.designaciones.join(', ')])))}
	${seccion('Terminales', tabla(['Bornero','Borne','Tipo','Conexiones','Circuitos'], i.terminales.map((x) => [x.designacion,x.borneId,x.tipo,x.conexiones.map((c) => `${c.conductorId}: ${c.dispositivoId}:${c.borneId}`).join(' / '),x.circuitos.join(', ')])))}
	${seccion('Diagnósticos V6 relevantes', tabla(['Código','Mensaje','Elementos'], i.diagnosticosV6.map((x) => [x.codigo,x.mensaje,x.elementos?.join(', ')])))}
	<aside class="limit"><strong>Limitaciones</strong><ul>${i.limitaciones.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p>${esc(i.leyenda)}</p></aside><footer class="pie">Generado por TableroStudio · Build ${esc(i.trazabilidad.buildId)}</footer></body></html>`;
}

export const bomIngenieriaACsv = (filas: readonly FilaBomIngenieria[]) => aCSV([
	['Cantidad','Tipo','Descripción','Fabricante','Referencia','Perfil','Modelo físico','Designaciones'],
	...filas.map((x) => [x.cantidad,x.tipo,x.descripcion,x.fabricante,x.referencia,x.perfil,x.modeloFisico?.join(' / '),x.designaciones.join(', ')]),
]);
export const conductoresIngenieriaACsv = (filas: readonly FilaConductorIngenieria[]) => aCSV([
	['ID','Número','De dispositivo','De terminal','A dispositivo','A terminal','Sección mm²','Color','Material','Longitud m','Provenance','Circuitos'],
	...filas.map((x) => [x.id,x.numero,x.deDispositivo,x.deTerminal,x.aDispositivo,x.aTerminal,x.seccionMm2,x.color,x.material,x.longitudM,x.origenLongitud,x.circuitos.join(', ')]),
]);
export const terminalesIngenieriaACsv = (filas: readonly FilaTerminalIngenieria[]) => aCSV([
	['Bornero','Designación','Borne','Tipo','Conexiones','Circuitos'],
	...filas.map((x) => [x.borneroId,x.designacion,x.borneId,x.tipo,x.conexiones.map((c) => `${c.conductorId}:${c.dispositivoId}:${c.borneId}`).join(' / '),x.circuitos.join(', ')]),
]);

/** Exportación autocontenida. El orden de las colecciones ya fue normalizado al crear el informe. */
export const informeIngenieriaV7AJson = (informe: InformeIngenieriaV7): string => JSON.stringify(informe, null, 2);
