import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureDisenoAsistidoV9 } from '../ejemplo/fixtures-diseno-v9.js';
import { crearPaqueteProyecto, leerPaqueteProyecto } from '../src/componentes/personalizados.js';
import { referenciaTecnica, type DatoTecnico } from '../src/datos-tecnicos/tipos.js';
import { descubrirCircuitos } from '../src/ingenieria/circuitos.js';
import {
	aplicarDisenoTransaccional, construirEspacioOpciones, crearSnapshotDisenoAsistido, evaluarDisenoAsistido,
	generarPlanesDiseno, hashPlanDiseno, ordenarResultadosDiseno, prepararAplicacionDiseno,
} from '../src/diseno-asistido/core.js';
import {
	informeDisenoCsv, informeDisenoHtml, informeDisenoJson, leerInformeDisenoJson, reevaluarInformeDisenoImportado,
} from '../src/diseno-asistido/documentacion.js';
import type { PlanDisenoAsistido, ResultadoCandidatoDiseno, SolicitudDisenoAsistido } from '../src/diseno-asistido/tipos.js';

const contexto={conexionesCerradas:new Map([['q1',[['1','2']] as const]])};
function prepararTodo(maxCandidatos=50){
	const f=fixtureDisenoAsistidoV9(),c=descubrirCircuitos(f.proyecto).circuitos.find(x=>x.id===f.circuitoId)!;
	const solicitud:SolicitudDisenoAsistido={version:1,id:'adversarial-v9',nombre:'Laboratorio combinado',circuitoId:c.id,conductores:[...c.conductores],proteccionId:'q1',cambiosPermitidos:['SECCION','PROTECCION'],seccionesPermitidasMm2:[2.5,3,4,6],proteccionesPermitidas:[...f.protecciones].reverse().map(referenciaTecnica),condicionesProteccion:{sistema:'AC',tensionV:230,frecuenciaHz:50,polos:1},preferencias:['MENOS_CAMBIOS','MENOR_SECCION_TOTAL','MENOR_IN','MENOR_PERDIDA'],presupuesto:{maxCandidatos,maxMs:20_000,lote:2}};
	return{...f,solicitud,snapshot:crearSnapshotDisenoAsistido({proyecto:f.proyecto,solicitud,revisionesDisponibles:f.disponibles,contextoFisico:contexto})};
}

test('V9 laboratorio exige el cambio combinado y no hardcodea una solución aislada',()=>{
	const{snapshot}=prepararTodo(),r=evaluarDisenoAsistido(snapshot);
	assert.equal(r.cobertura,'EXHAUSTIVA');assert.equal(r.totalEstimado,9);
	assert.equal(r.resultados.find(x=>x.plan.tipo==='BASE')?.estado,'INVIABLE');
	assert.ok(r.resultados.filter(x=>x.plan.tipo==='SECCION'||x.plan.tipo==='PROTECCION').every(x=>x.estado==='INVIABLE'));
	assert.ok(r.resultados.some(x=>x.plan.tipo==='COMBINADO'&&x.estado==='FACTIBLE'));
	assert.ok(r.resultados.some(x=>x.plan.tipo==='COMBINADO'&&x.estado==='INVIABLE'),'sumar cambios no garantiza factibilidad');
});

test('V9 BASE factible recomienda mantener el diseño y no fuerza otra mejora',()=>{
	const x=prepararTodo(),r=evaluarDisenoAsistido(x.snapshot),elegido=r.resultados.find(y=>y.plan.tipo==='COMBINADO'&&y.estado==='FACTIBLE')!;
	const aplicado=prepararAplicacionDiseno(x.snapshot,elegido).candidato;
	const s=crearSnapshotDisenoAsistido({proyecto:aplicado,solicitud:x.solicitud,revisionesDisponibles:x.disponibles,contextoFisico:contexto}),nuevo=evaluarDisenoAsistido(s);
	assert.equal(nuevo.resultados[0].plan.tipo,'BASE');assert.equal(nuevo.resultados[0].estado,'FACTIBLE');assert.equal(nuevo.resultados[0].metricas.cambios,0);
});

test('V9 excluye no-op, sección sin tabla y condiciones eléctricas incompatibles',()=>{
	const x=prepararTodo();const o=construirEspacioOpciones(x.snapshot);
	assert.deepEqual(o.seccionesMm2,[4,6]);assert.ok(o.excluidas.some(e=>/no cambia la sección efectiva/.test(e.motivo)));
	x.solicitud.condicionesProteccion={sistema:'AC',tensionV:400,frecuenciaHz:50,polos:1};
	const s400=crearSnapshotDisenoAsistido({proyecto:x.proyecto,solicitud:x.solicitud,revisionesDisponibles:x.disponibles,contextoFisico:contexto}),o400=construirEspacioOpciones(s400);
	assert.equal(o400.protecciones.length,0);assert.ok(o400.excluidas.some(e=>/tensión/.test(e.motivo)));
	const sin=structuredClone(x.proyecto);sin.datosTecnicos!.instalaciones=sin.datosTecnicos!.instalaciones.filter(i=>i.conductorId!==x.solicitud.conductores[0]);
	const ss=crearSnapshotDisenoAsistido({proyecto:sin,solicitud:x.solicitud,revisionesDisponibles:x.disponibles,contextoFisico:contexto});assert.equal(construirEspacioOpciones(ss).seccionesMm2.length,0);
});

test('V9 una decisión técnica protegida no se borra ni se sortea',()=>{
	const x=prepararTodo(),p=structuredClone(x.proyecto),v=p.datosTecnicos!.vinculos.find(b=>b.entidad==='DEVICE'&&b.entidadId==='q1')!;
	const dato:DatoTecnico={campo:'proteccion.inA',valor:17,unidad:'A',naturaleza:'NOMINAL',procedencia:{origen:'USUARIO',referencia:'Ajuste bloqueado por el proyectista'}};
	v.decisiones['proteccion.inA@']={modo:'CONSERVAR',dato};
	const s=crearSnapshotDisenoAsistido({proyecto:p,solicitud:x.solicitud,revisionesDisponibles:x.disponibles,contextoFisico:contexto}),o=construirEspacioOpciones(s);
	assert.equal(o.protecciones.length,0);assert.ok(o.excluidas.some(e=>/decisión protegida/.test(e.motivo)));assert.equal(v.decisiones['proteccion.inA@'].modo,'CONSERVAR');
});

test('V9 enumerador exhaustivo pequeño coincide con un oráculo semántico independiente',()=>{
	const{snapshot}=prepararTodo(),planes=[...generarPlanesDiseno(snapshot)];
	const firma=(p:PlanDisenoAsistido)=>`${p.tipo}:${p.cambios.map(c=>c.tipo==='SECCION'?`${c.conductorId}=${c.seccionMm2}`:`${c.dispositivoId}=${c.referencia.id}`).sort().join('|')}`;
	const esperadas=['BASE:','SECCION:w-fase-carga=4|w-fase-entrada=4','SECCION:w-fase-carga=6|w-fase-entrada=6','PROTECCION:q1=q20','PROTECCION:q1=q25',
		'COMBINADO:q1=q20|w-fase-carga=4|w-fase-entrada=4','COMBINADO:q1=q25|w-fase-carga=4|w-fase-entrada=4','COMBINADO:q1=q20|w-fase-carga=6|w-fase-entrada=6','COMBINADO:q1=q25|w-fase-carga=6|w-fase-entrada=6'].sort();
	assert.deepEqual(planes.map(firma).sort(),esperadas);assert.equal(new Set(planes.map(p=>p.id)).size,planes.length);
});

test('V9 presupuesto ampliado conserva el prefijo determinista del generador',()=>{
	const corto=prepararTodo(4),largo=prepararTodo(50),a=evaluarDisenoAsistido(corto.snapshot),b=evaluarDisenoAsistido(largo.snapshot);
	const generados=[...generarPlanesDiseno(largo.snapshot)].map(x=>x.id);assert.deepEqual(new Set(a.resultados.map(x=>x.plan.id)),new Set(generados.slice(0,4)));assert.equal(a.cobertura,'LIMITADA');assert.equal(b.cobertura,'EXHAUSTIVA');
});

function candidato(nombre:string,metricas:ResultadoCandidatoDiseno['metricas']):ResultadoCandidatoDiseno{
	const base={version:1 as const,tipo:'SECCION' as const,cambios:[{tipo:'SECCION' as const,conductorId:nombre,seccionMm2:4}]};const plan={...base,id:hashPlanDiseno(base)};
	return{plan,hashPlan:plan.id,estado:'FACTIBLE',obligaciones:[],metricas,deltaBase:{},limitaciones:[],pareto:false,orden:0,razonOrden:''};
}
test('V9 Pareto y empates no convierten una métrica ausente en cero',()=>{
	const desconocida=candidato('z',{cambios:1,seccionTotalMm2:4,fallos:0,indeterminados:0}),medida=candidato('a',{cambios:1,seccionTotalMm2:4,perdidaW:1,fallos:0,indeterminados:0});
	const orden=ordenarResultadosDiseno([desconocida,medida],['MENOR_PERDIDA']);assert.equal(orden[0].plan.cambios[0].tipo,'SECCION');assert.equal((orden[0].plan.cambios[0] as {conductorId:string}).conductorId,'a');assert.equal(desconocida.deltaBase.perdidaW,undefined);
});

test('V9 portable conserva decisión y revisiones exactas sin biblioteca global',async()=>{
	const x=prepararTodo(),r=evaluarDisenoAsistido(x.snapshot),elegido=r.resultados.find(y=>y.plan.tipo==='COMBINADO'&&y.estado==='FACTIBLE')!,preview=prepararAplicacionDiseno(x.snapshot,elegido);
	const aplicado=await aplicarDisenoTransaccional({base:x.proyecto,preview,persistir:()=>{}}),paquete=crearPaqueteProyecto(aplicado,[],[]),limpio=leerPaqueteProyecto(JSON.stringify(paquete)).proyecto;
	assert.deepEqual(limpio.ingenieria?.disenoAsistido,aplicado.ingenieria?.disenoAsistido);const ref=(elegido.plan.cambios.find(c=>c.tipo==='PROTECCION') as {referencia:ReturnType<typeof referenciaTecnica>}).referencia;assert.ok(limpio.datosTecnicos?.revisiones.some(v=>v.hash===ref.hash));
});

test('V9 informe importado se valida y reevalúa; nunca aplica resultados antiguos',()=>{
	const x=prepararTodo(),r=evaluarDisenoAsistido(x.snapshot);r.resultados[0].limitaciones=['=HYPERLINK("https://invalid")'];
	const contextoInforme={projectId:'proyecto-v9',revision:'R1',snapshotId:'s1',buildId:'TEST-V9',generadoEn:'2026-09-17T12:00:00.000Z',aplicacion:{estado:'NO_APLICADA' as const}};
	const json=informeDisenoJson(x.snapshot,r,contextoInforme),csv=informeDisenoCsv(r),html=informeDisenoHtml(x.snapshot,r,contextoInforme);
	assert.match(csv,/'=HYPERLINK/);assert.match(html,/TEST-V9/);assert.doesNotMatch(html,/<script/i);assert.equal(leerInformeDisenoJson(json).contexto?.projectId,'proyecto-v9');
	const cambiada=structuredClone(x.proyecto);cambiada.nombre='Otra revisión';const rr=reevaluarInformeDisenoImportado({textoJson:json,proyecto:cambiada,revisionesDisponibles:x.disponibles,contextoFisico:contexto});
	assert.equal(rr.baseOriginalCoincide,false);assert.ok(rr.advertencias.some(a=>/BASE cambió/.test(a)));assert.equal(cambiada.ingenieria?.disenoAsistido?.decisiones.length??0,0);
	const hostil=JSON.parse(json);hostil.version=2;assert.throws(()=>leerInformeDisenoJson(JSON.stringify(hostil)),/SCHEMA/);
	const manipulado=JSON.parse(json);manipulado.resultado.resultados[0].plan.cambios.push({tipo:'SECCION',conductorId:'x',seccionMm2:999});assert.throws(()=>leerInformeDisenoJson(JSON.stringify(manipulado)),/manipulada/);
});

test('V9 reordenar arrays no semánticos conserva clasificación, métricas y ranking',()=>{
	const a=prepararTodo(),b=prepararTodo();b.proyecto.dispositivos.reverse();b.proyecto.conductores.reverse();b.proyecto.datosTecnicos!.revisiones.reverse();b.disponibles.reverse();
	const sb=crearSnapshotDisenoAsistido({proyecto:b.proyecto,solicitud:b.solicitud,revisionesDisponibles:b.disponibles,contextoFisico:contexto}),ra=evaluarDisenoAsistido(a.snapshot),rb=evaluarDisenoAsistido(sb);
	const resumir=(r:typeof ra)=>r.resultados.map(x=>({id:x.plan.id,estado:x.estado,metricas:x.metricas,pareto:x.pareto,orden:x.orden}));assert.deepEqual(resumir(ra),resumir(rb));
});
