import { evaluarAmpacidad } from '../datos-tecnicos/ampacidad.js';
import { hashSnapshotTecnico, indexarRevisiones, jsonCanonico, sha256Texto, verificarRevision } from '../datos-tecnicos/hash.js';
import { cambiarConfiguracionTecnica, comprobarPreviewTecnico, prepararPreviewTecnico, validarAdopcionTecnica } from '../datos-tecnicos/operaciones.js';
import { resolverProyectoTecnico } from '../datos-tecnicos/resolver.js';
import { claveDato, claveRevision, referenciaTecnica, type CondicionesTecnicas, type DatoTecnico,
	type ReferenciaTecnica, type RevisionProductoTecnico, type RevisionTecnica, type VinculoTecnico } from '../datos-tecnicos/tipos.js';
import { ejecutarIngenieria } from '../ingenieria/engine.js';
import type { ResultadoReglaIngenieria } from '../ingenieria/validacion.js';
import type { Proyecto } from '../modelo/tipos.js';
import type { DecisionDisenoAsistidoPersistida } from '../modelo/ingenieria.js';
import type { CambioPlanDiseno, EspacioOpcionesDiseno, MetricasDiseno, ObligacionDiseno, PlanDisenoAsistido,
	PreferenciaDiseno, PreviewAplicacionDiseno, ResultadoCandidatoDiseno, ResultadoDisenoAsistido,
	SnapshotDisenoAsistido, SolicitudDisenoAsistido } from './tipos.js';

const LIMITE_CANDIDATOS = 2_000;
export const BLOQUEOS_POR_DEFECTO=['TOPOLOGIA','FUENTES','TENSION_FRECUENCIA','CARGAS','GEOMETRIA_RUTAS','INSTALACION','CRITERIOS','PE_BONDING'] as const;
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const unicoNumero = (xs: readonly number[]) => [...new Set(xs.filter(x => Number.isFinite(x) && x > 0))].sort((a,b)=>a-b);
const unicoTexto = (xs: readonly string[]) => [...new Set(xs.map(x=>x.trim()).filter(Boolean))].sort(cmp);
const refKey = (r: ReferenciaTecnica) => `${claveRevision(r)}\0${r.hash}`;
function serializable(v: unknown): unknown {
	if (v instanceof Map) return [...v.entries()].sort(([a],[b])=>cmp(String(a),String(b))).map(([k,x])=>[k,serializable(x)]);
	if (Array.isArray(v)) return v.map(serializable);
	if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string,unknown>).map(([k,x])=>[k,serializable(x)]));
	return v;
}

function normalizarSolicitud(s: SolicitudDisenoAsistido): SolicitudDisenoAsistido {
	if (s.version !== 1 || !s.id?.trim() || !s.nombre?.trim() || !s.circuitoId?.trim()) throw new Error('SOLICITUD_DISENO_INVALIDA');
	if(!['CORREGIR_INCUMPLIMIENTOS','COMPARAR_MEJORAS'].includes(s.objetivo)||typeof s.permitirDatosSinteticos!=='boolean')throw new Error('SOLICITUD_POLITICA_INVALIDA');
	const cambiosPermitidos = [...new Set(s.cambiosPermitidos)].filter(x => x === 'SECCION' || x === 'PROTECCION').sort();
	if (!cambiosPermitidos.length) throw new Error('SOLICITUD_SIN_CAMBIOS_PERMITIDOS');
	const conductores = unicoTexto(s.conductores);
	if(conductores.length>100)throw new Error('SOLICITUD_DEMASIADOS_CONDUCTORES');
	if (cambiosPermitidos.includes('SECCION') && !conductores.length) throw new Error('SOLICITUD_SIN_CONDUCTORES');
	if (cambiosPermitidos.includes('PROTECCION') && !s.proteccionId?.trim()) throw new Error('SOLICITUD_SIN_PROTECCION');
	const preferencias = [...new Set(s.preferencias ?? ['MENOS_CAMBIOS','MENOR_SECCION_TOTAL','MENOR_IN','MENOR_PERDIDA'])]
		.filter((x): x is PreferenciaDiseno => ['MENOS_CAMBIOS','MENOR_SECCION_TOTAL','MENOR_IN','MENOR_PERDIDA'].includes(x));
	const maxCandidatos = Math.min(LIMITE_CANDIDATOS, Math.max(1, Math.floor(s.presupuesto?.maxCandidatos ?? 250)));
	const maxMs = Math.min(120_000, Math.max(100, Math.floor(s.presupuesto?.maxMs ?? 10_000)));
	const lote = Math.min(50, Math.max(1, Math.floor(s.presupuesto?.lote ?? 5)));
	return { version: 1, id: s.id.trim().slice(0,200), nombre: s.nombre.trim().slice(0,300), objetivo:s.objetivo,permitirDatosSinteticos:s.permitirDatosSinteticos,circuitoId: s.circuitoId.trim(),
		conductores, proteccionId: s.proteccionId?.trim(), cambiosPermitidos,
		seccionesPermitidasMm2: s.seccionesPermitidasMm2 ? unicoNumero(s.seccionesPermitidasMm2).slice(0,500) : undefined,
		proteccionesPermitidas: s.proteccionesPermitidas ? [...new Map(s.proteccionesPermitidas.map(r=>[refKey(r), structuredClone(r)])).values()].sort((a,b)=>cmp(refKey(a),refKey(b))).slice(0,10_000) : undefined,
		condicionesProteccion: s.condicionesProteccion ? structuredClone(s.condicionesProteccion) : undefined,
		preferencias, presupuesto: { maxCandidatos, maxMs, lote } };
}

const rango = (v: number | readonly number[] | undefined): readonly [number, number] | undefined => typeof v === 'number' ? [v,v] : Array.isArray(v) && v.length===2 ? [v[0],v[1]] : undefined;
function condicionesCompatibles(solicitadas:CondicionesTecnicas|undefined,revision:RevisionProductoTecnico):string|undefined{
	if(!solicitadas)return undefined;
	for(const dato of revision.campos){const c=dato.condiciones;if(!c)continue;
		if(solicitadas.sistema&&c.sistema&&solicitadas.sistema!==c.sistema)return`Sistema ${c.sistema} incompatible con ${solicitadas.sistema}.`;
		for(const [campo,nombre] of [['tensionV','tensión'],['frecuenciaHz','frecuencia']] as const){const a=rango(solicitadas[campo]),b=rango(c[campo]);if(a&&b&&(a[1]<b[0]||b[1]<a[0]))return`${nombre} de la revisión fuera de las condiciones solicitadas.`;}
		if(solicitadas.polos!==undefined&&c.polos!==undefined&&solicitadas.polos!==c.polos)return`Polos ${c.polos} incompatibles con ${solicitadas.polos}.`;
	}
	return undefined;
}

export function crearSnapshotDisenoAsistido(entrada: { proyecto: Proyecto; solicitud: SolicitudDisenoAsistido;
	revisionesDisponibles?: readonly RevisionTecnica[]; contextoFisico?: SnapshotDisenoAsistido['contextoFisico']; buildId?: string }): SnapshotDisenoAsistido {
	const solicitud = normalizarSolicitud(entrada.solicitud), proyecto = structuredClone(entrada.proyecto);
	const algoritmo={id:'DISENO_ASISTIDO_V9' as const,version:1 as const,buildId:(entrada.buildId?.trim()||'CORE-V9').slice(0,200)},bloqueosPorDefecto=BLOQUEOS_POR_DEFECTO;
	const circuitos = ejecutarIngenieria({ proyecto, contextoFisico: entrada.contextoFisico }).circuitos;
	if (!circuitos.some(c => c.id === solicitud.circuitoId)) throw new Error(`CIRCUITO_NO_ENCONTRADO:${solicitud.circuitoId}`);
	for (const id of solicitud.conductores) if (!proyecto.conductores.some(c=>c.id===id)) throw new Error(`CONDUCTOR_NO_ENCONTRADO:${id}`);
	if (solicitud.proteccionId && !proyecto.dispositivos.some(d=>d.id===solicitud.proteccionId)) throw new Error(`PROTECCION_NO_ENCONTRADA:${solicitud.proteccionId}`);
	const todas = [...(proyecto.datosTecnicos?.revisiones ?? []), ...(entrada.revisionesDisponibles ?? [])];
	const revisiones = [...new Map(todas.map(r=>[refKey(referenciaTecnica(r)),structuredClone(r)])).values()].sort((a,b)=>cmp(refKey(referenciaTecnica(a)),refKey(referenciaTecnica(b))));
	for (const r of revisiones) verificarRevision(r);
	const hashBase = hashSnapshotTecnico(proyecto);
	const hash = hashSnapshotTecnico({ version: 1, algoritmo,bloqueosPorDefecto, hashBase, solicitud, revisiones: revisiones.map(referenciaTecnica), contextoFisico: serializable(entrada.contextoFisico) });
	return { version: 1, algoritmo,bloqueosPorDefecto, hash, hashBase, proyecto, solicitud, revisiones, contextoFisico: entrada.contextoFisico ? structuredClone(entrada.contextoFisico) : undefined };
}

export function construirEspacioOpciones(snapshot: SnapshotDisenoAsistido): EspacioOpcionesDiseno {
	const { solicitud, proyecto } = snapshot, excluidas: EspacioOpcionesDiseno['excluidas'] = [];
	let secciones = solicitud.cambiosPermitidos.includes('SECCION') ? (solicitud.seccionesPermitidasMm2 ?? []) : [];
	if (secciones.length) for (const conductorId of solicitud.conductores) {
		const inst = proyecto.datosTecnicos?.instalaciones.filter(i=>i.conductorId===conductorId) ?? [];
		if (!inst.length) { for (const s of secciones) excluidas.push({tipo:'SECCION',identidad:`${conductorId}:${s}`,motivo:'No existe instalación técnica fijada para resolver ampacidad.'}); secciones=[]; break; }
		if (inst.length !== 1) { for (const s of secciones) excluidas.push({tipo:'SECCION',identidad:`${conductorId}:${s}`,motivo:'Instalación técnica ambigua.'}); secciones=[]; break; }
		const tabla = snapshot.revisiones.find(r=>r.tipo==='AMPACIDAD' && claveRevision(referenciaTecnica(r))===claveRevision(inst[0].tabla) && r.hash===inst[0].tabla.hash);
		if (!tabla || tabla.tipo !== 'AMPACIDAD') { for (const s of secciones) excluidas.push({tipo:'SECCION',identidad:`${conductorId}:${s}`,motivo:'Tabla exacta de ampacidad ausente.'}); secciones=[]; break; }
		secciones = secciones.filter(s => { const a=evaluarAmpacidad({tabla,instalacion:inst[0],seccionMm2:s});
			if (a.estado==='RESOLVED') return true; excluidas.push({tipo:'SECCION',identidad:`${conductorId}:${s}`,motivo:`Ampacidad ${a.estado}: ${a.motivos.join(' ')}`}); return false; });
	}
	secciones=secciones.filter(s=>{const cambia=solicitud.conductores.some(id=>proyecto.conductores.find(c=>c.id===id)?.seccion!==s);if(!cambia)excluidas.push({tipo:'SECCION',identidad:`grupo:${s}`,motivo:'La opción no cambia la sección efectiva de ningún conductor seleccionado.'});return cambia;});
	const indice = indexarRevisiones(snapshot.revisiones);
	const protecciones: ReferenciaTecnica[] = [];
	if (solicitud.cambiosPermitidos.includes('PROTECCION')) for (const ref of solicitud.proteccionesPermitidas ?? []) {
		const r=indice.get(claveRevision(ref));
		if (!r || r.hash!==ref.hash || r.tipo!=='PRODUCTO' || r.familia!=='PROTECCION') { excluidas.push({tipo:'PROTECCION',identidad:refKey(ref),motivo:'Revisión exacta ausente, corrupta o de familia incompatible.'}); continue; }
		if(r.estado!=='ACTIVA'){excluidas.push({tipo:'PROTECCION',identidad:refKey(ref),motivo:'La revisión no está activa y no puede seleccionarse automáticamente.'});continue;}
		if(r.procedencia.origen==='SINTETICO'&&!solicitud.permitirDatosSinteticos){excluidas.push({tipo:'PROTECCION',identidad:refKey(ref),motivo:'La política de la solicitud no permite datos sintéticos.'});continue;}
		const incompatibilidad=condicionesCompatibles(solicitud.condicionesProteccion,r);if(incompatibilidad){excluidas.push({tipo:'PROTECCION',identidad:refKey(ref),motivo:incompatibilidad});continue;}
		const vinculo=proyecto.datosTecnicos?.vinculos.find(v=>v.entidad==='DEVICE'&&v.entidadId===solicitud.proteccionId);
		if(vinculo&&refKey(vinculo.producto)===refKey(ref)){excluidas.push({tipo:'PROTECCION',identidad:refKey(ref),motivo:'La revisión ya es la protección efectiva de BASE.'});continue;}
		const bloqueada=r.campos.map(claveDato).find(k=>{const d=vinculo?.decisiones[k];return d&&d.modo!=='CATALOGO';});
		if(bloqueada){excluidas.push({tipo:'PROTECCION',identidad:refKey(ref),motivo:`El campo ${bloqueada} conserva una decisión protegida; autoriza su edición antes de buscar.`});continue;}
		protecciones.push(structuredClone(ref));
	}
	return { seccionesMm2: unicoNumero(secciones), protecciones: [...new Map(protecciones.map(r=>[refKey(r),r])).values()].sort((a,b)=>cmp(refKey(a),refKey(b))), excluidas };
}

function canonCambios(cambios: readonly CambioPlanDiseno[]): CambioPlanDiseno[] {
	return [...cambios].map(c=>structuredClone(c)).sort((a,b)=>cmp(a.tipo==='SECCION'?`0:${a.conductorId}`:`1:${a.dispositivoId}`,b.tipo==='SECCION'?`0:${b.conductorId}`:`1:${b.dispositivoId}`));
}
export function hashPlanDiseno(plan: Pick<PlanDisenoAsistido,'version'|'tipo'|'cambios'>): string { return sha256Texto(jsonCanonico({version:plan.version,tipo:plan.tipo,cambios:canonCambios(plan.cambios)})); }
function plan(tipo: PlanDisenoAsistido['tipo'], cambios: CambioPlanDiseno[]): PlanDisenoAsistido { const base={version:1 as const,tipo,cambios:canonCambios(cambios)}; return {...base,id:hashPlanDiseno(base)}; }

export function *generarPlanesDiseno(snapshot: SnapshotDisenoAsistido, espacio=construirEspacioOpciones(snapshot)): Generator<PlanDisenoAsistido> {
	yield plan('BASE',[]); const s=snapshot.solicitud;
	const secciones=espacio.seccionesMm2.map(mm=>plan('SECCION',s.conductores.map(conductorId=>({tipo:'SECCION' as const,conductorId,seccionMm2:mm}))));
	for (const p of secciones) yield p;
	for (const referencia of espacio.protecciones) yield plan('PROTECCION',[{tipo:'PROTECCION',dispositivoId:s.proteccionId!,referencia}]);
	// No materializa ni la lista de protecciones ni el producto cartesiano: un presupuesto pequeño
	// puede detener un catálogo grande sin clonar decenas de miles de planes que no serán evaluados.
	for (const sec of secciones) for (const referencia of espacio.protecciones)
		yield plan('COMBINADO',[...sec.cambios,{tipo:'PROTECCION',dispositivoId:s.proteccionId!,referencia}]);
}

function datoSeccion(seccionMm2:number): DatoTecnico { return { campo:'conductor.seccionMm2',valor:seccionMm2,unidad:'mm2',naturaleza:'NOMINAL',procedencia:{origen:'USUARIO',referencia:'Decisión explícita de diseño asistido V9'} }; }
function condicionesProducto(r: RevisionProductoTecnico, solicitud: SolicitudDisenoAsistido, anterior?: VinculoTecnico): CondicionesTecnicas {
	return structuredClone(solicitud.condicionesProteccion ?? anterior?.condiciones ?? r.campos.find(x=>x.condiciones)?.condiciones ?? {});
}

/** Proyecta exclusivamente los cambios autorizados sobre la fuente efectiva consumida por V8. */
export function proyectarPlanDiseno(snapshot: SnapshotDisenoAsistido, planEntrada: PlanDisenoAsistido): Proyecto {
	if (hashPlanDiseno(planEntrada)!==planEntrada.id) throw new Error('PLAN_DISENO_MANIPULADO');
	const permitidos=new Set(snapshot.solicitud.cambiosPermitidos), objetivos=new Set(snapshot.solicitud.conductores);
	let proyecto=structuredClone(snapshot.proyecto), ejemplo=proyecto.esEjemplo; delete proyecto.esEjemplo;
	for (const cambio of canonCambios(planEntrada.cambios)) {
		if (!permitidos.has(cambio.tipo)) throw new Error(`CAMBIO_NO_PERMITIDO:${cambio.tipo}`);
		if (cambio.tipo==='SECCION') {
			if (!objetivos.has(cambio.conductorId)) throw new Error(`ENTIDAD_BLOQUEADA:${cambio.conductorId}`);
			const c=proyecto.conductores.find(x=>x.id===cambio.conductorId); if(!c) throw new Error(`CONDUCTOR_NO_ENCONTRADO:${cambio.conductorId}`); c.seccion=cambio.seccionMm2;
			const v=proyecto.datosTecnicos?.vinculos.find(x=>x.entidad==='CONDUCTOR'&&x.entidadId===cambio.conductorId);
			if(v) proyecto=cambiarConfiguracionTecnica(proyecto,cfg=>{const x=cfg.vinculos.find(q=>q.entidad==='CONDUCTOR'&&q.entidadId===cambio.conductorId)!;x.decisiones['conductor.seccionMm2@']={modo:'OVERRIDE',dato:datoSeccion(cambio.seccionMm2)};},snapshot.revisiones);
		} else {
			if(cambio.dispositivoId!==snapshot.solicitud.proteccionId) throw new Error(`ENTIDAD_BLOQUEADA:${cambio.dispositivoId}`);
			const revision=snapshot.revisiones.find(r=>r.tipo==='PRODUCTO'&&claveRevision(referenciaTecnica(r))===claveRevision(cambio.referencia)&&r.hash===cambio.referencia.hash);
			if(!revision||revision.tipo!=='PRODUCTO'||revision.familia!=='PROTECCION') throw new Error('PROTECCION_EXACTA_NO_DISPONIBLE');
			const anterior=proyecto.datosTecnicos?.vinculos.find(v=>v.entidad==='DEVICE'&&v.entidadId===cambio.dispositivoId);
			proyecto=cambiarConfiguracionTecnica(proyecto,cfg=>{const protegidas=Object.fromEntries(Object.entries(anterior?.decisiones??{}).filter(([,d])=>d.modo!=='CATALOGO'));cfg.vinculos=cfg.vinculos.filter(v=>!(v.entidad==='DEVICE'&&v.entidadId===cambio.dispositivoId));cfg.vinculos.push({entidad:'DEVICE',entidadId:cambio.dispositivoId,producto:structuredClone(cambio.referencia),condiciones:condicionesProducto(revision,snapshot.solicitud,anterior),decisiones:{...Object.fromEntries(revision.campos.map(d=>[claveDato(d),{modo:'CATALOGO' as const}])),...protegidas}});},snapshot.revisiones);
		}
	}
	if(ejemplo) proyecto.esEjemplo=true; validarAdopcionTecnica(proyecto); return proyecto;
}

function resultadosObjetivo(snapshot:SnapshotDisenoAsistido,analisis:ReturnType<typeof ejecutarIngenieria>):ResultadoReglaIngenieria[]{
	const ids=new Set([...snapshot.solicitud.conductores,...(snapshot.solicitud.proteccionId?[snapshot.solicitud.proteccionId]:[])]);
	return analisis.validacion.resultados.filter(r=>r.circuitId===snapshot.solicitud.circuitoId||r.relatedEntities.some(e=>ids.has(e.id)));
}
function obligaciones(snapshot:SnapshotDisenoAsistido,analisis:ReturnType<typeof ejecutarIngenieria>,planEntrada:PlanDisenoAsistido):ObligacionDiseno[]{
	const out:ObligacionDiseno[]=resultadosObjetivo(snapshot,analisis).map(r=>({id:`${r.code}:${r.circuitId??''}:${r.relatedEntities.map(e=>e.id).join(',')}`,estado:r.status,descripcion:`[${r.code}] ${r.title}: ${r.description}`,evidencia:r.evidence.map(e=>`${e.codigo}: ${e.valor??e.descripcion}${e.unidad?` ${e.unidad}`:''}`),datosFaltantes:[...r.missingData],procedencia:r.provenance,criterio:r.criterion?`${r.criterion.descripcion}${r.criterion.valor!==undefined?`: ${r.criterion.valor}${r.criterion.unidad?` ${r.criterion.unidad}`:''}`:''}`:undefined}));
	if(!out.length) out.push({id:'COBERTURA_OBJETIVO',estado:'INDETERMINATE',descripcion:'El motor común no produjo obligaciones relacionadas con el objetivo.',evidencia:[],datosFaltantes:['Cobertura de reglas para el objetivo'],procedencia:'NO_DISPONIBLE'});
	return out;
}
function metricas(snapshot:SnapshotDisenoAsistido,proyecto:Proyecto,analisis:ReturnType<typeof ejecutarIngenieria>,planEntrada:PlanDisenoAsistido):MetricasDiseno{
	const secciones=snapshot.solicitud.conductores.map(id=>proyecto.conductores.find(c=>c.id===id)?.seccion).filter((x):x is number=>typeof x==='number');
	const prot=snapshot.solicitud.proteccionId?analisis.fisica.protecciones.get(snapshot.solicitud.proteccionId):undefined;
	const pros=snapshot.solicitud.proteccionId?analisis.prospectiva?.get(snapshot.solicitud.proteccionId):undefined;
	return {cambios:planEntrada.cambios.length,seccionTotalMm2:secciones.length===snapshot.solicitud.conductores.length?secciones.reduce((a,b)=>a+b,0):undefined,proteccionInA:prot?.inA,perdidaW:analisis.potencia.perdidas.totalModeladoW,iccProspectivaA:pros?.estado==='RESUELTO'?pros.iccA:undefined,fallos:analisis.validacion.resumen.fail,indeterminados:analisis.validacion.resumen.indeterminate};
}

export function evaluarPlanDiseno(snapshot:SnapshotDisenoAsistido,planEntrada:PlanDisenoAsistido):ResultadoCandidatoDiseno{
	try{
		const proyecto=proyectarPlanDiseno(snapshot,planEntrada),analisis=ejecutarIngenieria({proyecto,contextoFisico:snapshot.contextoFisico});
		for(const c of planEntrada.cambios) if(c.tipo==='SECCION') { const efectiva=analisis.tecnica.proyecto.conductores.find(x=>x.id===c.conductorId)?.seccion; if(efectiva!==c.seccionMm2) throw new Error(`CAMBIO_NO_EFECTIVO:seccion:${c.conductorId}`); }
		for(const c of planEntrada.cambios) if(c.tipo==='PROTECCION') { const v=analisis.tecnica.proyecto.datosTecnicos?.vinculos.find(x=>x.entidad==='DEVICE'&&x.entidadId===c.dispositivoId); if(!v||refKey(v.producto)!==refKey(c.referencia)) throw new Error(`CAMBIO_NO_EFECTIVO:proteccion:${c.dispositivoId}`); }
		const obs=obligaciones(snapshot,analisis,planEntrada),estado=obs.some(o=>o.estado==='FAIL')?'INVIABLE':obs.some(o=>o.estado==='INDETERMINATE')?'INDETERMINADO':'FACTIBLE';
		const limitaciones:string[]=[]; if(planEntrada.cambios.some(c=>c.tipo==='PROTECCION')) limitaciones.push('Compatibilidad dimensional/mecánica del producto no modelada: requiere verificación humana.');
		const pros=snapshot.solicitud.proteccionId?analisis.prospectiva?.get(snapshot.solicitud.proteccionId):undefined; if(pros&&pros.estado!=='RESUELTO') limitaciones.push(`Prospectiva ${pros.estado}: ${pros.motivos.join(' ')}`);
		return {plan:structuredClone(planEntrada),hashPlan:hashPlanDiseno(planEntrada),estado,analisis,proyecto,obligaciones:obs,metricas:metricas(snapshot,proyecto,analisis,planEntrada),deltaBase:{},limitaciones,pareto:false,orden:0,razonOrden:''};
	}catch(e){return {plan:structuredClone(planEntrada),hashPlan:hashPlanDiseno(planEntrada),estado:'ERROR',obligaciones:[],metricas:{cambios:planEntrada.cambios.length,fallos:0,indeterminados:0},deltaBase:{},limitaciones:[],error:e instanceof Error?e.message:String(e),pareto:false,orden:0,razonOrden:''};}
}

const estadoOrden:Record<ResultadoCandidatoDiseno['estado'],number>={FACTIBLE:0,INDETERMINADO:1,INVIABLE:2,ERROR:3};
function valorPreferencia(r:ResultadoCandidatoDiseno,p:PreferenciaDiseno):number|undefined{if(p==='MENOS_CAMBIOS')return r.metricas.cambios;if(p==='MENOR_SECCION_TOTAL')return r.metricas.seccionTotalMm2;if(p==='MENOR_IN')return r.metricas.proteccionInA;return r.metricas.perdidaW;}
function domina(a:ResultadoCandidatoDiseno,b:ResultadoCandidatoDiseno):boolean{const ks:(keyof MetricasDiseno)[]=['cambios','seccionTotalMm2','proteccionInA','perdidaW','fallos','indeterminados'];let mejor=false;for(const k of ks){const x=a.metricas[k],y=b.metricas[k];if(typeof x!=='number'||typeof y!=='number')continue;if(x>y)return false;if(x<y)mejor=true;}return mejor;}
export function ordenarResultadosDiseno(resultados:ResultadoCandidatoDiseno[],preferencias:readonly PreferenciaDiseno[]):ResultadoCandidatoDiseno[]{
	const base=resultados.find(r=>r.plan.tipo==='BASE');
	if(base)for(const r of resultados)for(const k of ['cambios','seccionTotalMm2','proteccionInA','perdidaW','iccProspectivaA','fallos','indeterminados'] as const){const x=r.metricas[k],b=base.metricas[k];if(typeof x==='number'&&typeof b==='number')r.deltaBase[k]=x-b;}
	for(const r of resultados) r.pareto=r.estado!=='ERROR'&&!resultados.some(o=>o!==r&&o.estado===r.estado&&domina(o,r));
	return resultados.sort((a,b)=>estadoOrden[a.estado]-estadoOrden[b.estado]||Number(b.pareto)-Number(a.pareto)||preferencias.reduce((v,p)=>{if(v)return v;const x=valorPreferencia(a,p),y=valorPreferencia(b,p);return x===undefined?y===undefined?0:1:y===undefined?-1:x-y;},0)||cmp(a.plan.id,b.plan.id)).map((r,i)=>({...r,orden:i+1,razonOrden:`${r.estado}; ${r.pareto?'no dominada':'dominada'}; desempate ${preferencias.join(' → ')}.`}));
}

function totalPlanes(espacio:EspacioOpcionesDiseno):number{return 1+espacio.seccionesMm2.length+espacio.protecciones.length+espacio.seccionesMm2.length*espacio.protecciones.length;}

export function evaluarDisenoAsistido(snapshot:SnapshotDisenoAsistido):ResultadoDisenoAsistido{
	const inicio=performance.now(),espacio=construirEspacioOpciones(snapshot),total=totalPlanes(espacio),max=snapshot.solicitud.presupuesto!.maxCandidatos!,resultadosBrutos:ResultadoCandidatoDiseno[]=[];
	let generados=0;for(const p of generarPlanesDiseno(snapshot,espacio)){if(generados>=max)break;generados++;resultadosBrutos.push(evaluarPlanDiseno(snapshot,p));}
	const resultados=ordenarResultadosDiseno(resultadosBrutos,snapshot.solicitud.preferencias!);
	return {version:1,snapshotHash:snapshot.hash,cobertura:generados===total?'EXHAUSTIVA':'LIMITADA',motivoCobertura:generados===total?'Se evaluó todo el espacio canónico permitido.':`Presupuesto de ${max} candidatos alcanzado.`,generados,evaluados:resultados.length,totalEstimado:total,duracionMs:performance.now()-inicio,excluidas:espacio.excluidas,resultados};
}

function registrarDecision(proyecto:Proyecto,snapshot:SnapshotDisenoAsistido,planEntrada:PlanDisenoAsistido):void{
	const d:DecisionDisenoAsistidoPersistida={version:1,id:sha256Texto(jsonCanonico({snapshot:snapshot.hash,plan:planEntrada.id})),solicitudId:snapshot.solicitud.id,nombreSolicitud:snapshot.solicitud.nombre,objetivo:snapshot.solicitud.objetivo,snapshotHash:snapshot.hash,algoritmoBuildId:snapshot.algoritmo.buildId,planId:planEntrada.id,hashBase:snapshot.hashBase,circuitoId:snapshot.solicitud.circuitoId,cambios:canonCambios(planEntrada.cambios).map(c=>c.tipo==='SECCION'?c:{...c,referencia:{...c.referencia,tipo:'PRODUCTO' as const}})};
	proyecto.ingenieria??={version:1};proyecto.ingenieria.disenoAsistido??={version:1,decisiones:[]};proyecto.ingenieria.disenoAsistido.decisiones=[...proyecto.ingenieria.disenoAsistido.decisiones.filter(x=>x.id!==d.id),d].slice(-200);
}
export function prepararAplicacionDiseno(snapshot:SnapshotDisenoAsistido,resultado:ResultadoCandidatoDiseno):PreviewAplicacionDiseno{
	if(resultado.estado==='ERROR'||resultado.hashPlan!==hashPlanDiseno(resultado.plan)||resultado.plan.id!==resultado.hashPlan)throw new Error('RESULTADO_DISENO_MANIPULADO');
	let candidato=proyectarPlanDiseno(snapshot,resultado.plan);if(candidato.esEjemplo)throw new Error('EJEMPLO_SOLO_LECTURA:COPIAR_ANTES_DE_APLICAR');registrarDecision(candidato,snapshot,resultado.plan);
	const tecnico=prepararPreviewTecnico(snapshot.proyecto,candidato);return{version:1,snapshotHash:snapshot.hash,hashBase:snapshot.hashBase,hashCandidato:tecnico.hashCandidato,plan:structuredClone(resultado.plan),candidato:tecnico.candidato,cambios:canonCambios(resultado.plan.cambios)};
}
export function comprobarAplicacionDiseno(base:Proyecto,preview:PreviewAplicacionDiseno):void{
	if(hashSnapshotTecnico(base)!==preview.hashBase)throw new Error('STALE_RESULT: BASE cambió.');if(hashSnapshotTecnico(preview.candidato)!==preview.hashCandidato)throw new Error('STALE_RESULT: candidato manipulado.');if(hashPlanDiseno(preview.plan)!==preview.plan.id)throw new Error('PLAN_DISENO_MANIPULADO');
	comprobarPreviewTecnico(base,{hashBase:preview.hashBase,hashCandidato:preview.hashCandidato,candidato:preview.candidato,cambios:[]});
}
export async function aplicarDisenoTransaccional(entrada:{base:Proyecto;preview:PreviewAplicacionDiseno;persistir:(p:Proyecto)=>void|Promise<void>}):Promise<Proyecto>{comprobarAplicacionDiseno(entrada.base,entrada.preview);const candidato=structuredClone(entrada.preview.candidato);await entrada.persistir(candidato);return candidato;}
