/**
 * Panel profesional de Ingeniería V7.
 *
 * La UI no contiene ecuaciones: presenta snapshots producidos por EngineeringEngine,
 * ScenarioEngine y PhysicsEngine. Tampoco persiste issues ni resultados derivados.
 */
import { perfilCurvaProteccionDispositivo, type ContextoTopologiaFisica } from '../src/fisica/topologia-proyecto.js';
import { resolverComportamiento } from '../src/modelo/comportamiento.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import {
	bomIngenieriaACsv, conductoresIngenieriaACsv, crearInformeIngenieriaV7,
	informeIngenieriaV7AHtml, informeIngenieriaV7AJson, terminalesIngenieriaACsv,
	type InformeIngenieriaV7,
} from '../src/ingenieria/documentacion.js';
import { ejecutarIngenieria } from '../src/ingenieria/engine.js';
import {
	aplicarEscenarioTransaccional, evaluarEscenarios, type DefinicionEscenarioIngenieria,
	type ResultadoAlternativaEscenario,
} from '../src/ingenieria/escenarios.js';
import { datosCoordinacion } from '../src/ingenieria/protecciones.js';
import type { EngineeringIssue } from '../src/ingenieria/validacion.js';
import { descargar, escaparHtml } from './dialogos.js';

declare const __VERSION__: string;

type Analisis = ReturnType<typeof ejecutarIngenieria>;
type Vista = 'circuitos' | 'validacion' | 'protecciones' | 'potencia' | 'escenarios' | 'documentacion';

export interface ContextoUIIngenieria {
	proyecto(): Proyecto;
	seleccionarDispositivo(id: string): void;
	seleccionarConductor(id: string): void;
	avisar(mensaje: string, tipo?: 'info' | 'ok' | 'error'): void;
	confirmar(mensaje: string): Promise<boolean>;
	/** Integra el candidato ya confirmado con historial/autoguardado del editor. */
	aplicarProyecto(candidato: Proyecto): Promise<boolean> | boolean;
	trazabilidad(): Promise<{ projectId: string; revision?: string | number; snapshotId?: string }>;
	abrirDossierPDF(): void;
}

export interface PanelIngenieria {
	validar(): Analisis;
	invalidar(): void;
	analisisActual(): Analisis | undefined;
}

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const esc = (v: unknown): string => escaparHtml(String(v ?? ''));
const numero = (v: number | undefined, unidad = ''): string => v === undefined || !Number.isFinite(v)
	? 'NO DISPONIBLE' : `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 }).format(v)}${unidad ? ` ${unidad}` : ''}`;

/** Condición de cálculo explícita; no representa el runtime ni se guarda en Proyecto. */
export function contextoDisenoIngenieria(proyecto: Proyecto): ContextoTopologiaFisica {
	const conexionesCerradas = new Map<string, readonly (readonly [string, string])[]>();
	for (const d of [...proyecto.dispositivos].sort((a, b) => a.id.localeCompare(b.id))) {
		const p = resolverComportamiento(d); let pares: readonly { entrada: string; salida: string }[] = [];
		if (p?.clase === 'proteccion' || p?.clase === 'contactos-electromagneticos') pares = p.polos;
		else if (p?.clase === 'pasivo') pares = p.conexiones;
		if (pares.length) conexionesCerradas.set(d.id, pares.map((x) => [x.entrada, x.salida] as const));
	}
	return { conexionesCerradas };
}

function buildId(): string {
	return (window as Window & { __TABLEROSTUDIO_BUILD_ID__?: string }).__TABLEROSTUDIO_BUILD_ID__
		?? `DEV-${__VERSION__}`;
}

function etiquetaDispositivo(p: Proyecto, id: string): string {
	const d = p.dispositivos.find((x) => x.id === id); return d ? `${d.designacion ?? d.id} · ${d.descripcion ?? d.tipo}` : id;
}

function botonEntidad(issue: EngineeringIssue): string {
	const e = (issue.category === 'CIRCUIT' ? issue.relatedEntities.find((x) => x.tipo === 'CIRCUIT') : undefined)
		?? issue.relatedEntities.find((x) => x.tipo === 'DEVICE')
		?? issue.relatedEntities.find((x) => x.tipo === 'CONDUCTOR')
		?? issue.relatedEntities.find((x) => x.tipo === 'CIRCUIT');
	if (!e) return '';
	const atributo = e.tipo === 'DEVICE' ? 'device' : e.tipo === 'CONDUCTOR' ? 'conductor' : 'circuit';
	return `<button class="ing-enlace" data-ing-${atributo}="${esc(e.id)}">Localizar ${esc(e.tipo.toLowerCase())}</button>`;
}

function tabla(cabeceras: string[], filas: (string | number | undefined)[][]): string {
	return `<div class="ing-tabla-wrap"><table class="ing-tabla"><thead><tr>${cabeceras.map((x) => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>`
		+ `${filas.map((f) => `<tr>${f.map((x) => `<td>${esc(x ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export function instalarIngenieria(ctx: ContextoUIIngenieria): PanelIngenieria {
	const contenido = $('ingenieria-contenido');
	let analisis: Analisis | undefined;
	let vista: Vista = 'circuitos';
	let circuitoId: string | undefined;
	let filtroSeveridad = '';
	let filtroCategoria = '';
	let filtroCircuito = '';
	let alternativas: ResultadoAlternativaEscenario[] = [];
	let definicionesAlternativas: DefinicionEscenarioIngenieria[] = [];
	let slotEscenario: 'A' | 'B' = 'A';
	let tipoEscenario: 'SECCION_CONDUCTOR' | 'PROTECCION' | 'ASIGNACION_FASE' = 'SECCION_CONDUCTOR';
	let informe: InformeIngenieriaV7 | undefined;

	const pintarEstado = (texto: string, clase = '') => {
		const e = $('ingenieria-estado'); e.textContent = texto; e.className = clase;
	};

	function asegurar(): Analisis {
		return analisis ?? validar();
	}

	function validar(): Analisis {
		const inicio = performance.now(); const p = ctx.proyecto();
		analisis = ejecutarIngenieria({ proyecto: p, contextoFisico: contextoDisenoIngenieria(p) });
		circuitoId = analisis.circuitos.some((x) => x.id === circuitoId) ? circuitoId : analisis.circuitos[0]?.id;
		alternativas = []; definicionesAlternativas = []; informe = undefined;
		pintarEstado(`Snapshot derivado en ${(performance.now() - inicio).toFixed(1)} ms · no persistido`, 'ok');
		pintar();
		ctx.avisar(`Ingeniería V7: ${analisis.validacion.resumen.fail} fallos, ${analisis.validacion.resumen.warning} advertencias y ${analisis.validacion.resumen.indeterminate} indeterminadas.`,
			analisis.validacion.resumen.fail ? 'error' : 'ok');
		return analisis;
	}

	function invalidar(): void {
		if (!analisis) return;
		analisis = undefined; alternativas = []; definicionesAlternativas = []; informe = undefined;
		filtroSeveridad = ''; filtroCategoria = ''; filtroCircuito = '';
		pintarEstado('El proyecto cambió. Ejecuta Validar proyecto para crear un snapshot nuevo.', 'pendiente');
		pintar();
	}

	function resumen(a: Analisis): string {
		const r = a.validacion.resumen;
		return `<div class="ing-resumen" data-ing-issue-center>
			<span class="fail"><b>${r.errores}</b> Errores</span><span class="warn"><b>${r.advertencias}</b> Advertencias</span>
			<span class="info"><b>${r.informacion}</b> Información</span><span class="ind"><b>${r.indeterminate}</b> Indeterminadas</span>
		</div>`;
	}

	function vistaCircuitos(a: Analisis): string {
		const p = ctx.proyecto(); const elegido = a.circuitos.find((x) => x.id === circuitoId);
		const arbol = a.circuitos.length ? a.circuitos.map((c) => `<button class="ing-circuito ${c.id === circuitoId ? 'activo' : ''}"
			data-ing-circuit="${esc(c.id)}"><b>${esc(c.nombre)}</b><small>${esc(c.tipo)} · ${esc(c.estadoTopologia)}</small></button>`).join('')
			: '<p class="ing-vacio">No existen cargas con un perfil que permita descubrir circuitos.</p>';
		if (!elegido) return `<div class="ing-arbol">${arbol}</div>`;
		const conductores = elegido.conductores.map((id) => a.fisica.conductores.get(id)).filter(Boolean);
		const corriente = Math.max(0, ...conductores.map((x) => x!.corrienteA));
		const caida = conductores.reduce((s, x) => s + (x?.caidaV ?? 0), 0);
		const pwr = a.potencia.porCircuito.find((x) => x.circuitoId === elegido.id);
		const fallas = a.fisica.fallas.filter((f) => elegido.protecciones.some((id) => a.fisica.protecciones.get(id)?.fallas.includes(f.id)));
		const icc = Math.max(0, ...fallas.flatMap((x) => x.iccA ? [Math.hypot(x.iccA.re, x.iccA.im)] : []));
		const issues = a.validacion.issues.filter((x) => x.circuitId === elegido.id);
		const diag = a.fisica.diagnosticos.filter((d) => d.elementos?.some((id) => elegido.equipos.includes(id) || elegido.conductores.includes(id)));
		return `<div class="ing-circuitos"><div class="ing-arbol">${arbol}</div><article class="ing-inspector" data-ing-circuit-inspector>
			<h3>${esc(elegido.nombre)} <span class="ing-estado ${esc(elegido.estadoTopologia.toLowerCase())}">${esc(elegido.estadoTopologia)}</span></h3>
			${elegido.estadoTopologia === 'AMBIGUA' ? `<p class="ing-alerta">RED / MÚLTIPLES FUENTES: no se dibuja una jerarquía aguas arriba falsa.</p>` : ''}
			<dl class="ing-magnitudes"><dt>Fuente</dt><dd>${esc(elegido.fuenteId ? etiquetaDispositivo(p, elegido.fuenteId) : 'NO DISPONIBLE')}</dd>
			<dt>Protecciones</dt><dd>${esc(elegido.protecciones.map((id) => etiquetaDispositivo(p, id)).join(' · ') || '—')}</dd>
			<dt>Maniobra</dt><dd>${esc(elegido.maniobra.map((id) => etiquetaDispositivo(p, id)).join(' · ') || '—')}</dd>
			<dt>Conductores</dt><dd>${elegido.conductores.map((id) => `<button data-ing-conductor="${esc(id)}">${esc(id)}</button>`).join(' ') || '—'}</dd>
			<dt>Cargas</dt><dd>${elegido.cargas.map((id) => `<button data-ing-device="${esc(id)}">${esc(etiquetaDispositivo(p, id))}</button>`).join(' ') || '—'}</dd>
			<dt>I</dt><dd>${numero(corriente, 'A')}</dd><dt>ΔV</dt><dd>${numero(caida, 'V')}</dd><dt>Icc</dt><dd>${icc ? numero(icc, 'A') : 'NO MODELADA'}</dd>
			<dt>P / Q / S</dt><dd>${pwr ? `${numero(pwr.pW, 'W')} / ${numero(pwr.qVar, 'var')} / ${numero(pwr.sVA, 'VA')}` : 'NO DISPONIBLE'}</dd>
			<dt>PF</dt><dd>${numero(pwr?.factorPotencia)}</dd></dl>
			<h4>Issues (${issues.length})</h4>${issues.map((x) => `<button class="ing-mini-issue" data-ing-issue="${esc(x.id)}">${esc(x.code)} · ${esc(x.title)}</button>`).join('') || '<p>Sin issues.</p>'}
			<h4>Diagnósticos V6 relevantes</h4>${diag.map((d) => `<p><code>${esc(d.codigo)}</code> ${esc(d.mensaje)}</p>`).join('') || '<p>Sin diagnósticos V6 relacionados.</p>'}
		</article></div>`;
	}

	function vistaValidacion(a: Analisis): string {
		const categorias = [...new Set(a.validacion.issues.map((x) => x.category))].sort();
		const circuitos = a.circuitos.map((x) => x.id);
		const issues = a.validacion.issues.filter((x) => !filtroSeveridad || x.severity === filtroSeveridad)
			.filter((x) => !filtroCategoria || x.category === filtroCategoria)
			.filter((x) => !filtroCircuito || x.circuitId === filtroCircuito);
		return `${resumen(a)}<div class="ing-filtros"><label>Severidad<select data-ing-filter="severity"><option value="">Todas</option>
			${['ERROR','WARNING','INFO'].map((x) => `<option ${filtroSeveridad === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
			<label>Categoría<select data-ing-filter="category"><option value="">Todas</option>${categorias.map((x) => `<option ${filtroCategoria === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
			<label>Circuito<select data-ing-filter="circuit"><option value="">Todos</option>${circuitos.map((x) => `<option ${filtroCircuito === x ? 'selected' : ''} value="${esc(x)}">${esc(x)}</option>`).join('')}</select></label></div>
			<div class="ing-issues">${issues.map((x) => `<article class="ing-issue ${x.status.toLowerCase()}" data-ing-issue-card="${esc(x.id)}">
			<header><code>${esc(x.code)}</code><b>${esc(x.title)}</b><span>${esc(x.status)} · ${esc(x.severity)}</span></header>
			<p>${esc(x.description)}</p><p class="ing-meta">${esc(x.category)} · ${esc(x.circuitId ?? 'Proyecto')} · procedencia ${esc(x.provenance)}</p>
			${x.evidence.length ? `<details><summary>Evidencia (${x.evidence.length})</summary>${tabla(['Código','Descripción','Valor','Origen'], x.evidence.map((e) => [e.codigo,e.descripcion,`${e.valor ?? '—'}${e.unidad ? ` ${e.unidad}` : ''}`,e.origen]))}</details>` : ''}
			${x.criterion ? `<p><b>Criterio:</b> ${esc(x.criterion.descripcion)} <small>${esc(x.criterion.origen)}</small></p>` : ''}
			${x.missingData.length ? `<p><b>Datos faltantes:</b> ${esc(x.missingData.join(' · '))}</p>` : ''}
			${x.remediationHints.length ? `<p><b>Acciones:</b> ${esc(x.remediationHints.join(' · '))}</p>` : ''}${botonEntidad(x)}</article>`).join('') || '<p class="ing-vacio">Ningún issue coincide con los filtros.</p>'}</div>`;
	}

	function vistaProtecciones(a: Analisis): string {
		const p = ctx.proyecto();
		const tarjetas = [...a.fisica.protecciones].sort(([x], [y]) => x.localeCompare(y)).map(([id, r]) => {
			const d = p.dispositivos.find((x) => x.id === id)!; const curva = perfilCurvaProteccionDispositivo(d);
			const cfg = d.fisica?.proteccion; const arranque = a.validacion.resultados.find((x) => x.code === 'TS-PROT-MOTOR-START' && x.relatedEntities.some((e) => e.id === id));
			const iDesign = a.validacion.resultados.find((x) => x.code === 'TS-PROT-RATING' && x.relatedEntities.some((e) => e.id === id))?.evidence.find((e) => e.codigo === 'I_DESIGN')?.valor;
			const icc = a.validacion.resultados.find((x) => x.code.startsWith('TS-PROT-BREAKING') && x.relatedEntities.some((e) => e.id === id))?.evidence.find((e) => e.codigo === 'ICC')?.valor;
			return `<article class="ing-proteccion" data-ing-protection-card="${esc(id)}"><h3><button data-ing-device="${esc(id)}">${esc(etiquetaDispositivo(p,id))}</button></h3>
				<dl class="ing-magnitudes"><dt>I diseño</dt><dd>${typeof iDesign === 'number' ? numero(iDesign,'A') : 'NO DISPONIBLE'}</dd><dt>In</dt><dd>${numero(r.inA,'A')}</dd>
				<dt>I / In</dt><dd>${r.inA ? numero(r.corrienteA / r.inA) : 'NO DISPONIBLE'}</dd><dt>I startup</dt><dd>${esc(arranque?.evidence.find((e) => e.codigo === 'I_START')?.valor ?? 'NO DISPONIBLE')}</dd>
				<dt>Icc</dt><dd>${typeof icc === 'number' ? numero(icc,'kA') : 'NO MODELADA'}</dd><dt>Icn / Icu / Ics</dt><dd>${numero(cfg?.capacidadCorte?.icnKA,'kA')} / ${numero(cfg?.capacidadCorte?.icuKA,'kA')} / ${numero(cfg?.capacidadCorte?.icsKA,'kA')}</dd>
				<dt>Estado</dt><dd>${esc(r.evaluacion.region)} · ${esc(r.evaluacion.origen)}</dd><dt>Curva</dt><dd>${esc(curva?.id ?? 'NO MODELADA')}</dd></dl>
				${curva ? `<div class="ing-curva" data-ing-curve><p><b>${esc(curva.descripcion)}</b> · ${esc(curva.origen)}${curva.instantaneoDesdeIn ? ` · instantáneo ≥ ${numero(curva.instantaneoDesdeIn)} In` : ''}</p>
				${tabla(['I / In','t mín (s)','t máx (s)'], curva.puntos.map((x) => [x.multiploIn,x.tMinS,x.tMaxS]))}</div>` : '<p class="ing-alerta">Curva NO MODELADA.</p>'}</article>`;
		}).join('');
		const coord = datosCoordinacion(p, a.circuitos, a.fisica);
		return `${tarjetas || '<p class="ing-vacio">No hay protecciones físicas evaluables.</p>'}<h3>Coordinación</h3>${tabla(['Circuito','Aguas arriba','Aguas abajo','Resultado','Evidencia'], coord.map((x) => [x.circuitId,x.aguasArriba.dispositivoId,x.aguasAbajo.dispositivoId,x.clasificacion,x.explicacion]))}`;
	}

	function vistaPotencia(a: Analisis): string {
		const t = a.potencia.totalTablero; const l = a.potencia.perdidas;
		return `<div class="ing-potencia" data-ing-power><div class="ing-kpis"><span><b>${numero(t.pW,'W')}</b>P</span><span><b>${numero(t.qVar,'var')}</b>Q</span>
			<span><b>${numero(t.sVA,'VA')}</b>S</span><span><b>${numero(t.factorPotencia)}</b>PF</span><span><b>${numero(l.totalModeladoW,'W')}</b>Pérdidas</span></div>
			<p class="ing-meta">Frontera: ${esc(a.potencia.fronteraTotal)}. Salidas de VFD y secundarios se muestran sin volver a sumarse.</p>
			<h3>Por circuito</h3>${tabla(['Circuito','Frontera','En total','P W','Q var','S VA','PF','Origen'], a.potencia.porCircuito.map((x) => [x.circuitoId,x.frontera,x.incluidaEnTotalTablero ? 'Sí' : 'No',numero(x.pW),numero(x.qVar),numero(x.sVA),numero(x.factorPotencia),x.origen]))}
			<h3>Pérdidas</h3>${tabla(['Conductores W','Transformadores W','Variadores W','Otras W','Total W','Origen'], [[numero(l.conductoresW),numero(l.transformadoresW),numero(l.variadoresW),numero(l.otrasModeladasW),numero(l.totalModeladoW),l.origen]])}
			<h3>Balance de fases</h3>${a.potencia.balances.map((b) => `${tabla(['Fuente','I L1','I L2','I L3','I N','Desbalance I','Desbalance V','Métrica','Criterio'], [[b.fuenteId,...b.fases.map((x) => numero(x.corrienteA,'A')),numero(b.corrienteNeutroA,'A'),numero(b.desequilibrioCorrientePct,'%'),numero(b.desequilibrioTensionPct,'%'),b.metrica,numero(b.criterioMaxPct,'%')]])}<p class="ing-meta">Métrica de ingeniería ${esc(b.metrica)}; no se presenta como conformidad normativa.</p>`).join('') || '<p>Sin fuente trifásica evaluable.</p>'}</div>`;
	}

	function vistaEscenarios(a: Analisis): string {
		const p = ctx.proyecto(); const cables = [...p.conductores].sort((x,y) => x.id.localeCompare(y.id));
		const protecciones = [...p.dispositivos].filter((d) => d.fisica?.proteccion).sort((x,y) => x.id.localeCompare(y.id));
		const reasignables = [...new Set(Object.values(p.ingenieria?.circuitos ?? {}).flatMap((x) => x.conductoresReasignablesFase ?? []))].sort();
		const fuentes = [...p.dispositivos].filter((d) => d.fisica?.fuente?.sistema === 'AC_TRIFASICA').sort((x,y) => x.id.localeCompare(y.id));
		const controles = tipoEscenario === 'SECCION_CONDUCTOR'
			? `<label>Conductor<select data-ing-scenario-conductor>${cables.map((c) => `<option value="${esc(c.id)}">${esc(c.numero ?? c.id)} · ${numero(c.seccion,'mm²')}</option>`).join('')}</select></label>
				<label>Sección alternativa<input data-ing-scenario-section type="number" min="0.1" step="0.1" value="4"></label>`
			: tipoEscenario === 'PROTECCION'
				? `<label>Protección<select data-ing-scenario-protection>${protecciones.map((d) => `<option value="${esc(d.id)}">${esc(etiquetaDispositivo(p,d.id))}</option>`).join('')}</select></label>
					<label>In alternativa<input data-ing-scenario-in type="number" min="0.1" step="0.1" value="20"></label><label>Curva<input data-ing-scenario-curve value="C"></label>`
				: `<label>Conductor reasignable<select data-ing-scenario-phase-conductor>${reasignables.map((id) => `<option value="${esc(id)}">${esc(id)}</option>`).join('')}</select></label>
					<label>Fuente trifásica<select data-ing-scenario-source>${fuentes.map((d) => `<option value="${esc(d.id)}">${esc(etiquetaDispositivo(p,d.id))}</option>`).join('')}</select></label>
					<label>Nueva fase<select data-ing-scenario-phase><option>L1</option><option>L2</option><option>L3</option></select></label>`;
		const resultados = alternativas.map((alternativa) => `<article class="ing-resultado-escenario" data-ing-scenario-result="${esc(alternativa.escenario.id)}"><h3>BASE vs ${esc(alternativa.escenario.nombre)}</h3>
			<p class="ing-base-intacta">BASE NO MODIFICADA</p>${tabla(['Métrica','Delta'], [
				['Pérdidas',numero(alternativa.delta.potenciaPerdidasW,'W')],['Icc máx',numero(alternativa.delta.iccMaxA,'A')],
				['Desequilibrio',numero(alternativa.delta.desequilibrioMaxPct,'%')],['Neutro',numero(alternativa.delta.corrienteNeutroMaxA,'A')],
				['Issues nuevos',alternativa.delta.issuesNuevos.length],['Issues resueltos',alternativa.delta.issuesResueltos.length],
			])}<h4>Deltas de conductores</h4>${tabla(['ID','ΔI A','ΔV V','Δpérdida W'], Object.entries(alternativa.delta.conductores).map(([id,x]) => [id,numero(x.corrienteA),numero(x.caidaV),numero(x.perdidaW)]))}
			<h4>Deltas de protecciones</h4>${tabla(['ID','ΔI A','ΔIn A','Región antes','Región después'], Object.entries(alternativa.delta.protecciones).map(([id,x]) => [id,numero(x.corrienteA),numero(x.inA),x.regionAntes,x.regionDespues]))}
			<p>Selectividad nueva: ${esc(alternativa.delta.selectividadNueva.join(' · ') || '—')}<br>Selectividad resuelta: ${esc(alternativa.delta.selectividadResuelta.join(' · ') || '—')}</p>
			<button class="boton primario" data-ing-scenario-apply="${esc(alternativa.escenario.id)}">Aplicar ${esc(alternativa.escenario.id)} al proyecto</button></article>`).join('');
		return `<section data-ing-scenarios><div class="ing-scenario-form"><label>Alternativa<select data-ing-scenario-slot><option ${slotEscenario === 'A' ? 'selected' : ''}>A</option><option ${slotEscenario === 'B' ? 'selected' : ''}>B</option></select></label>
			<label>Cambio<select data-ing-scenario-type><option value="SECCION_CONDUCTOR" ${tipoEscenario === 'SECCION_CONDUCTOR' ? 'selected' : ''}>Sección</option><option value="PROTECCION" ${tipoEscenario === 'PROTECCION' ? 'selected' : ''}>Protección / curva</option><option value="ASIGNACION_FASE" ${tipoEscenario === 'ASIGNACION_FASE' ? 'selected' : ''}>Fase reasignable</option></select></label>
			${controles}<button class="boton" data-ing-scenario-run>Guardar ${slotEscenario} y comparar BASE/A/B</button></div>
			<p class="ing-meta">ScenarioEngine calcula overlays temporales. Solo aparecen conductores marcados como reasignables; cambiar selectores nunca aplica nada.</p>
			${definicionesAlternativas.length ? `<p><b>Definidas:</b> ${esc(definicionesAlternativas.map((x) => `${x.id}: ${x.nombre}`).join(' · '))}</p>` : ''}
			${resultados || '<p class="ing-vacio">Configura A o B y compárala. BASE permanece intacta.</p>'}</section>`;
	}

	function vistaDocumentacion(): string {
		return `<section data-ing-documentation><p>Los entregables consumen el mismo snapshot de Ingeniería; la UI no reconstruye BOM, cableado ni borneras.</p>
			<div class="botonera"><button class="boton primario" data-ing-doc="prepare">Preparar informe</button>
			<button class="boton" data-ing-doc="json" ${informe ? '' : 'disabled'}>JSON</button><button class="boton" data-ing-doc="html" ${informe ? '' : 'disabled'}>HTML / imprimir</button>
			<button class="boton" data-ing-doc="bom" ${informe ? '' : 'disabled'}>BOM CSV</button><button class="boton" data-ing-doc="wiring" ${informe ? '' : 'disabled'}>Wiring CSV</button>
			<button class="boton" data-ing-doc="terminal" ${informe ? '' : 'disabled'}>Terminales CSV</button><button class="boton" data-ing-doc="pdf">Dossier PDF existente</button></div>
			${informe ? `<article class="ing-doc-preview"><h3>Informe listo</h3><dl class="ing-magnitudes"><dt>Project ID</dt><dd>${esc(informe.proyecto.id)}</dd><dt>Revisión</dt><dd>${esc(informe.proyecto.revision ?? '—')}</dd>
			<dt>Snapshot</dt><dd>${esc(informe.proyecto.snapshotId ?? '—')}</dd><dt>Build ID</dt><dd>${esc(informe.trazabilidad.buildId)}</dd><dt>Circuitos</dt><dd>${informe.circuitos.length}</dd><dt>BOM</dt><dd>${informe.bom.length} líneas</dd>
			<dt>Conductores</dt><dd>${informe.conductores.length}</dd><dt>Borneras</dt><dd>${informe.terminales.length}</dd></dl><p class="ing-meta">${esc(informe.leyenda)}</p></article>` : ''}</section>`;
	}

	function pintar(): void {
		for (const b of document.querySelectorAll<HTMLButtonElement>('[data-ing-view]')) b.classList.toggle('activo', b.dataset.ingView === vista);
		if (!analisis) {
			contenido.innerHTML = '<div class="ing-inicio"><h3>Validación de diseño</h3><p>Ejecuta el motor de Ingeniería sobre una fotografía estática del proyecto. No hace falta energizar.</p><p><b>Condición física:</b> protecciones y polos de potencia cerrados. Estados de mando, fallos y transitorios no se suponen; si faltan datos, el resultado será INDETERMINATE o NO DISPONIBLE.</p></div>';
			return;
		}
		contenido.innerHTML = vista === 'circuitos' ? vistaCircuitos(analisis) : vista === 'validacion' ? vistaValidacion(analisis)
			: vista === 'protecciones' ? vistaProtecciones(analisis) : vista === 'potencia' ? vistaPotencia(analisis)
				: vista === 'escenarios' ? vistaEscenarios(analisis) : vistaDocumentacion();
	}

	function navegarIssue(id: string): void {
		const issue = analisis?.validacion.issues.find((x) => x.id === id); if (!issue) return;
		const dispositivo = issue.relatedEntities.find((x) => x.tipo === 'DEVICE');
		const conductor = issue.relatedEntities.find((x) => x.tipo === 'CONDUCTOR');
		const circuito = issue.relatedEntities.find((x) => x.tipo === 'CIRCUIT')?.id ?? issue.circuitId;
		if (circuito && issue.category === 'CIRCUIT') { circuitoId = circuito; vista = 'circuitos'; pintar(); }
		else if (dispositivo) ctx.seleccionarDispositivo(dispositivo.id);
		else if (conductor) ctx.seleccionarConductor(conductor.id);
		else if (circuito) { circuitoId = circuito; vista = 'circuitos'; pintar(); }
	}

	async function prepararInforme(): Promise<void> {
		const a = asegurar(); const identidad = await ctx.trazabilidad();
		informe = crearInformeIngenieriaV7({ proyecto: ctx.proyecto(), analisis: a,
			trazabilidad: { ...identidad, buildId: buildId(), generadoEn: new Date().toISOString() } });
		pintar(); ctx.avisar(`Informe V7 preparado · ${informe.trazabilidad.buildId}`, 'ok');
	}

	async function documento(accion: string): Promise<void> {
		if (accion === 'prepare') return prepararInforme();
		if (accion === 'pdf') { ctx.abrirDossierPDF(); return; }
		if (!informe) return;
		const base = `${ctx.proyecto().nombre} - ingenieria-v7`;
		if (accion === 'json') descargar(`${base}.json`, informeIngenieriaV7AJson(informe), 'application/json');
		if (accion === 'html') {
			const html = informeIngenieriaV7AHtml(informe); descargar(`${base}.html`, html, 'text/html');
			const w = window.open('', '_blank'); if (w) { w.opener = null; w.document.open(); w.document.write(html); w.document.close(); }
		}
		if (accion === 'bom') descargar(`${base}-bom.csv`, bomIngenieriaACsv(informe.bom), 'text/csv');
		if (accion === 'wiring') descargar(`${base}-wiring.csv`, conductoresIngenieriaACsv(informe.conductores), 'text/csv');
		if (accion === 'terminal') descargar(`${base}-terminales.csv`, terminalesIngenieriaACsv(informe.terminales), 'text/csv');
	}

	$('ingenieria-validar').onclick = () => validar();
	for (const b of document.querySelectorAll<HTMLButtonElement>('[data-ing-view]')) b.onclick = () => {
		vista = b.dataset.ingView as Vista; if (vista !== 'documentacion') informe = undefined; pintar();
	};
	contenido.onchange = (ev) => {
		const e = ev.target as HTMLSelectElement; const f = e.dataset.ingFilter;
		if (f === 'severity') filtroSeveridad = e.value;
		if (f === 'category') filtroCategoria = e.value;
		if (f === 'circuit') filtroCircuito = e.value;
		if (f) pintar();
		if (e.dataset.ingScenarioSlot !== undefined) { slotEscenario = e.value as 'A' | 'B'; pintar(); }
		if (e.dataset.ingScenarioType !== undefined) { tipoEscenario = e.value as typeof tipoEscenario; pintar(); }
	};
	contenido.onclick = (ev) => {
		const objetivo = ev.target as HTMLElement;
		const b = objetivo.closest<HTMLButtonElement>('button');
		if (!b) {
			const tarjeta = objetivo.closest<HTMLElement>('[data-ing-issue-card]');
			if (tarjeta?.dataset.ingIssueCard) navegarIssue(tarjeta.dataset.ingIssueCard);
			return;
		}
		if (b.dataset.ingDevice) ctx.seleccionarDispositivo(b.dataset.ingDevice);
		if (b.dataset.ingConductor) ctx.seleccionarConductor(b.dataset.ingConductor);
		if (b.dataset.ingCircuit) { circuitoId = b.dataset.ingCircuit; vista = 'circuitos'; pintar(); }
		if (b.dataset.ingIssue) navegarIssue(b.dataset.ingIssue);
		if (b.dataset.ingScenarioRun !== undefined) {
			let definicion: DefinicionEscenarioIngenieria;
			if (tipoEscenario === 'SECCION_CONDUCTOR') {
				const id = contenido.querySelector<HTMLSelectElement>('[data-ing-scenario-conductor]')?.value;
				const seccionMm2 = Number(contenido.querySelector<HTMLInputElement>('[data-ing-scenario-section]')?.value);
				if (!id) { ctx.avisar('No existe un conductor para el escenario.', 'error'); return; }
				definicion = { id: slotEscenario, nombre: `${id} → ${seccionMm2} mm²`, parches: [{ tipo: 'SECCION_CONDUCTOR', conductorId: id, seccionMm2 }] };
			} else if (tipoEscenario === 'PROTECCION') {
				const id = contenido.querySelector<HTMLSelectElement>('[data-ing-scenario-protection]')?.value;
				const inA = Number(contenido.querySelector<HTMLInputElement>('[data-ing-scenario-in]')?.value);
				const curva = contenido.querySelector<HTMLInputElement>('[data-ing-scenario-curve]')?.value.trim();
				if (!id) { ctx.avisar('No existe una protección física para el escenario.', 'error'); return; }
				definicion = { id: slotEscenario, nombre: `${id} → ${inA} A ${curva || ''}`.trim(), parches: [{ tipo: 'PROTECCION', dispositivoId: id, inA, ...(curva ? { curva } : {}) }] };
			} else {
				const conductorId = contenido.querySelector<HTMLSelectElement>('[data-ing-scenario-phase-conductor]')?.value;
				const fuenteId = contenido.querySelector<HTMLSelectElement>('[data-ing-scenario-source]')?.value;
				const fase = contenido.querySelector<HTMLSelectElement>('[data-ing-scenario-phase]')?.value as 'L1' | 'L2' | 'L3' | undefined;
				if (!conductorId || !fuenteId || !fase) { ctx.avisar('La fase solo puede compararse en conductores marcados como reasignables y con fuente trifásica.', 'error'); return; }
				definicion = { id: slotEscenario, nombre: `${conductorId} → ${fase}`, parches: [{ tipo: 'ASIGNACION_FASE', conductorId, fuenteId, fase }] };
			}
			definicionesAlternativas = [...definicionesAlternativas.filter((x) => x.id !== slotEscenario), definicion].sort((x,y) => x.id.localeCompare(y.id));
			try { alternativas = evaluarEscenarios({ proyecto: ctx.proyecto(), alternativas: definicionesAlternativas, contextoFisico: contextoDisenoIngenieria(ctx.proyecto()) }).alternativas; pintar(); }
			catch (e) { ctx.avisar(`Escenario inválido: ${(e as Error).message}`, 'error'); }
		}
		if (b.dataset.ingScenarioApply) void (async () => {
			const definicion = definicionesAlternativas.find((x) => x.id === b.dataset.ingScenarioApply); if (!definicion) return;
			if (!(await ctx.confirmar(`Aplicar ${definicion.nombre} al proyecto? Esta acción sí modifica BASE.`))) return;
			try {
				await aplicarEscenarioTransaccional({ proyecto: ctx.proyecto(), escenario: definicion, persistir: async (candidato) => {
					if (!(await ctx.aplicarProyecto(candidato))) throw new Error('APLICACION_CANCELADA');
				} });
				analisis = undefined; alternativas = []; definicionesAlternativas = []; pintarEstado('Escenario aplicado. Valida el nuevo proyecto.', 'ok'); pintar();
				ctx.avisar('Escenario aplicado al proyecto y enviado al autoguardado.', 'ok');
			} catch (e) { ctx.avisar(`No se aplicó el escenario: ${(e as Error).message}`, 'error'); }
		})();
		if (b.dataset.ingDoc) void documento(b.dataset.ingDoc);
	};

	pintarEstado('Sin snapshot de ingeniería', 'pendiente'); pintar();
	return { validar, invalidar, analisisActual: () => analisis };
}
