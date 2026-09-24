import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureDisenoAsistidoV9 } from '../ejemplo/fixtures-diseno-v9.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { hashSnapshotTecnico } from '../src/datos-tecnicos/hash.js';
import { referenciaTecnica } from '../src/datos-tecnicos/tipos.js';
import { resolverProyectoTecnico } from '../src/datos-tecnicos/resolver.js';
import { aplicarDisenoTransaccional, comprobarAplicacionDiseno, construirEspacioOpciones, crearSnapshotDisenoAsistido,
	evaluarDisenoAsistido, evaluarPlanDiseno, generarPlanesDiseno, prepararAplicacionDiseno, proyectarPlanDiseno } from '../src/diseno-asistido/core.js';
import { ejecutarSesionDisenoAsistido } from '../src/diseno-asistido/sesion.js';
import { informeDisenoCsv, informeDisenoHtml, informeDisenoJson, leerInformeDisenoJson } from '../src/diseno-asistido/documentacion.js';
import type { SolicitudDisenoAsistido } from '../src/diseno-asistido/tipos.js';

const contexto={conexionesCerradas:new Map([['q1',[['1','2']] as const]])};
function preparar(orden=false){const f=fixtureDisenoAsistidoV9();if(orden){f.proyecto.dispositivos.reverse();f.proyecto.conductores.reverse();f.proyecto.datosTecnicos!.revisiones.reverse();f.disponibles.reverse();}
	const solicitud:SolicitudDisenoAsistido={version:1,id:'laboratorio-v9',nombre:'Dimensionar ramal',objetivo:'CORREGIR_INCUMPLIMIENTOS',permitirDatosSinteticos:true,circuitoId:f.circuitoId,conductores:['w-fase-carga'],proteccionId:'q1',cambiosPermitidos:['PROTECCION','SECCION'],seccionesPermitidasMm2:[6,4,3,4],proteccionesPermitidas:f.protecciones.map(referenciaTecnica),condicionesProteccion:{sistema:'AC',tensionV:230,frecuenciaHz:50,polos:1},presupuesto:{maxCandidatos:20,maxMs:20_000,lote:2}};
	return{...f,solicitud,snapshot:crearSnapshotDisenoAsistido({proyecto:f.proyecto,solicitud,revisionesDisponibles:f.disponibles,contextoFisico:contexto})};}

test('V9 A0: sección candidata modifica la resolución técnica efectiva, no solo el campo legacy',()=>{const{snapshot}=preparar();const p=[...generarPlanesDiseno(snapshot)].find(x=>x.tipo==='SECCION'&&x.cambios.some(c=>c.tipo==='SECCION'&&c.seccionMm2===4))!;const candidato=proyectarPlanDiseno(snapshot,p);assert.equal(candidato.conductores.find(c=>c.id==='w-fase-carga')!.seccion,4);const r=resolverProyectoTecnico(candidato);assert.equal(r.proyecto.conductores.find(c=>c.id==='w-fase-carga')!.seccion,4);assert.equal(r.resoluciones.find(x=>x.entidadId==='w-fase-carga'&&x.campo==='conductor.seccionMm2')?.origen,'OVERRIDE');});
test('V9 A0: protección candidata sustituye una revisión exacta sin ensamblar campos de otra ficha',()=>{const{snapshot,protecciones}=preparar();const ref=referenciaTecnica(protecciones[0]);const p=[...generarPlanesDiseno(snapshot)].find(x=>x.tipo==='PROTECCION'&&x.cambios.some(c=>c.tipo==='PROTECCION'&&c.referencia.hash===ref.hash))!;const candidato=proyectarPlanDiseno(snapshot,p),v=candidato.datosTecnicos!.vinculos.find(x=>x.entidadId==='q1')!;assert.deepEqual(v.producto,ref);assert.deepEqual(Object.keys(v.decisiones).sort(),protecciones[0].campos.map(d=>`${d.campo}@`).sort());assert.equal(resolverProyectoTecnico(candidato).proyecto.dispositivos.find(d=>d.id==='q1')!.fisica!.proteccion!.inA,20);});
test('V9 A0: cada alternativa usa la prospectiva del punto configurado',()=>{const{snapshot}=preparar();const p=[...generarPlanesDiseno(snapshot)].find(x=>x.tipo==='PROTECCION')!,r=evaluarPlanDiseno(snapshot,p);assert.notEqual(r.estado,'ERROR');assert.ok((r.metricas.iccProspectivaA??0)>0);assert.equal(r.metricas.iccProspectivaA,r.analisis!.prospectiva!.get('q1')!.iccA);assert.match(r.analisis!.prospectiva!.get('q1')!.ensayo!.de.borneId,/2/);});
test('V9 opciones: solo secciones con fila aplicable y revisiones exactas',()=>{const{snapshot}=preparar();const o=construirEspacioOpciones(snapshot);assert.deepEqual(o.seccionesMm2,[4,6]);assert.equal(o.protecciones.length,2);assert.ok(o.excluidas.some(x=>x.identidad.endsWith(':3')&&/Ampacidad/.test(x.motivo)));});
test('V9 genera BASE, sección, protección y combinados de forma canónica independiente del orden',()=>{const a=preparar(),b=preparar(true),pa=[...generarPlanesDiseno(a.snapshot)],pb=[...generarPlanesDiseno(b.snapshot)];assert.deepEqual(pa,pb);assert.deepEqual(new Set(pa.map(x=>x.tipo)),new Set(['BASE','SECCION','PROTECCION','COMBINADO']));assert.equal(pa.length,9);});
test('V9 evalúa espacio acotado, conserva ausencias y publica Pareto explicable',()=>{const{snapshot}=preparar(),r=evaluarDisenoAsistido(snapshot);assert.equal(r.cobertura,'EXHAUSTIVA');assert.equal(r.evaluados,9);assert.ok(r.resultados.some(x=>x.pareto));assert.deepEqual(r.resultados.map(x=>x.orden),[1,2,3,4,5,6,7,8,9]);assert.ok(r.resultados.every(x=>Number.isFinite(x.metricas.cambios)));});
test('V9 aplicación es transaccional, persistente y rechaza stale/tamper',async()=>{const{snapshot}=preparar(),r=evaluarDisenoAsistido(snapshot),elegido=r.resultados.find(x=>x.plan.tipo==='COMBINADO'&&x.estado!=='ERROR')!;assert.equal(snapshot.algoritmo.id,'DISENO_ASISTIDO_V9');assert.equal(snapshot.bloqueosPorDefecto.length,8);const preview=prepararAplicacionDiseno(snapshot,elegido);let guardado='';const aplicado=await aplicarDisenoTransaccional({base:snapshot.proyecto,preview,persistir:p=>{guardado=JSON.stringify(p);}});assert.equal(guardado,JSON.stringify(aplicado));assert.equal(aplicado.ingenieria!.disenoAsistido!.decisiones.length,1);assert.equal(aplicado.ingenieria!.disenoAsistido!.decisiones[0].objetivo,'CORREGIR_INCUMPLIMIENTOS');assert.equal(aplicado.ingenieria!.disenoAsistido!.decisiones[0].snapshotHash,snapshot.hash);const cargado=cargarProyecto(guardado).proyecto;assert.deepEqual(cargado.ingenieria!.disenoAsistido,aplicado.ingenieria!.disenoAsistido);const editado=structuredClone(snapshot.proyecto);editado.nombre='cambió';assert.throws(()=>comprobarAplicacionDiseno(editado,preview),/STALE_RESULT/);preview.candidato.nombre='manipulado';await assert.rejects(aplicarDisenoTransaccional({base:snapshot.proyecto,preview,persistir(){throw new Error('no debería');}}),/STALE_RESULT/);assert.equal(hashSnapshotTecnico(snapshot.proyecto),snapshot.hashBase);});
test('V9 una falla de almacenamiento no muta BASE',async()=>{const{snapshot}=preparar(),r=evaluarDisenoAsistido(snapshot),preview=prepararAplicacionDiseno(snapshot,r.resultados.find(x=>x.plan.tipo==='SECCION'&&x.estado!=='ERROR')!);const antes=JSON.stringify(snapshot.proyecto);await assert.rejects(aplicarDisenoTransaccional({base:snapshot.proyecto,preview,persistir(){throw new Error('ALMACENAMIENTO_CAIDO');}}),/ALMACENAMIENTO_CAIDO/);assert.equal(JSON.stringify(snapshot.proyecto),antes);});
test('V9 sesión cede, informa progreso y cancela sin declarar cobertura exhaustiva',async()=>{const{snapshot}=preparar();const ac=new AbortController(),eventos:string[]=[];const r=await ejecutarSesionDisenoAsistido(snapshot,{signal:ac.signal,progreso:p=>{eventos.push(p.fase);if(p.fase==='EVALUANDO')ac.abort();}});assert.equal(r.cobertura,'CANCELADA');assert.ok(r.evaluados>0&&r.evaluados<r.totalEstimado);assert.ok(eventos.includes('EVALUANDO')&&eventos.at(-1)==='TERMINADO');});
test('V9 presupuesto limitado no se disfraza de exhaustivo',()=>{const x=preparar();x.solicitud.presupuesto!.maxCandidatos=2;const s=crearSnapshotDisenoAsistido({proyecto:x.proyecto,solicitud:x.solicitud,revisionesDisponibles:x.disponibles,contextoFisico:contexto}),r=evaluarDisenoAsistido(s);assert.equal(r.cobertura,'LIMITADA');assert.equal(r.evaluados,2);assert.match(r.motivoCobertura,/Presupuesto/);});
test('V9 informes JSON/CSV/HTML son portables y escapan contenido no confiable',()=>{const{snapshot}=preparar(),r=evaluarDisenoAsistido(snapshot);snapshot.solicitud.nombre='<img src=x onerror=alert(1)>';const html=informeDisenoHtml(snapshot,r),json=informeDisenoJson(snapshot,r),csv=informeDisenoCsv(r);assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);assert.match(csv,/orden;id/);assert.equal(csv.charCodeAt(0),0xfeff);assert.doesNotThrow(()=>leerInformeDisenoJson(json));assert.throws(()=>leerInformeDisenoJson('{"__proto__":{"x":1}}'),/prohibida|peligrosa|clave/i);});
test('DOC-01: diseño V9 exporta la misma BASE, snapshot y revisión confirmada en JSON/HTML/CSV',()=>{
	const {snapshot}=preparar(),r=evaluarDisenoAsistido(snapshot);
	const procedencia={estado:'confirmado' as const,projectId:'proyecto-v9',revisionRepositorio:9,buildId:'BUILD-DOC-01',generadoEn:'2026-09-24T12:00:00.000Z'};
	const c={projectId:procedencia.projectId,revision:procedencia.revisionRepositorio,buildId:procedencia.buildId,
		generadoEn:procedencia.generadoEn,procedencia,aplicacion:{estado:'NO_APLICADA' as const}};
	const json=informeDisenoJson(snapshot,r,c),html=informeDisenoHtml(snapshot,r,c),csv=informeDisenoCsv(r,c,snapshot);
	assert.deepEqual(leerInformeDisenoJson(json).contexto?.procedencia,procedencia);
	assert.match(json,/"alcance"/);assert.match(json,new RegExp(snapshot.hashBase));
	assert.match(html,/Revisión confirmada/);assert.match(html,/Revisión del repositorio<\/dt><dd>9/);
	assert.match(html,new RegExp(snapshot.hashBase));assert.match(csv,/estado_documental;project_id;revision_repositorio/);
	assert.match(csv,/Revisión confirmada;proyecto-v9;9;2026-09-24T12:00:00.000Z;BUILD-DOC-01/);
	assert.match(csv,new RegExp(snapshot.hashBase));assert.equal(csv.charCodeAt(0),0xfeff);
	const manipulado=JSON.parse(json);manipulado.contexto.revision=10;
	assert.throws(()=>leerInformeDisenoJson(JSON.stringify(manipulado)),/revisión confirmada inconsistente/);
	const alcanceFalso=JSON.parse(json);alcanceFalso.alcance='certificación automática';
	assert.throws(()=>leerInformeDisenoJson(JSON.stringify(alcanceFalso)),/alcance: valor no permitido/);
	const resultadoAjeno={...r,snapshotHash:'sha256:'+'0'.repeat(64)};
	assert.throws(()=>informeDisenoCsv(resultadoAjeno,c,snapshot),/INFORME_SNAPSHOT_INCONSISTENTE/);
});
test('DOC-01: ejemplo V9 es efímero también en HTML y CSV, sin revisión inventada',()=>{
	const {snapshot}=preparar(),r=evaluarDisenoAsistido(snapshot);
	const procedencia={estado:'efimero' as const,motivo:'ejemplo' as const,buildId:'BUILD-DOC-01',generadoEn:'2026-09-24T12:00:00.000Z'};
	const c={projectId:'EJEMPLO_EFIMERO',buildId:procedencia.buildId,generadoEn:procedencia.generadoEn,
		procedencia,aplicacion:{estado:'NO_APLICADA' as const}};
	const json=informeDisenoJson(snapshot,r,c),html=informeDisenoHtml(snapshot,r,c),csv=informeDisenoCsv(r,c,snapshot);
	assert.equal(leerInformeDisenoJson(json).contexto?.procedencia?.estado,'efimero');
	assert.match(html,/Ejemplo efímero/);assert.match(html,/Project ID confirmado<\/dt><dd>No asignado/);
	assert.match(csv,/Ejemplo efímero;No asignado;No asignada/);assert.doesNotMatch(csv,/EJEMPLO_EFIMERO/);
	const falso=JSON.parse(json);falso.contexto.projectId='proyecto-permanente';
	assert.throws(()=>leerInformeDisenoJson(JSON.stringify(falso)),/documento efímero inconsistente/);
});
test('V9 un ejemplo se puede evaluar pero exige copia antes de aplicar',()=>{const{proyecto,solicitud,disponibles}=preparar();proyecto.esEjemplo=true;const s=crearSnapshotDisenoAsistido({proyecto,solicitud,revisionesDisponibles:disponibles,contextoFisico:contexto}),r=evaluarDisenoAsistido(s);assert.ok(r.resultados.length);assert.throws(()=>prepararAplicacionDiseno(s,r.resultados.find(x=>x.estado!=='ERROR')!),/COPIAR/);});
