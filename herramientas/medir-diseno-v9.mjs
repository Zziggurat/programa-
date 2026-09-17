/** Medición dirigida V9. Catálogo grande, evaluación deliberadamente acotada. */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { fixtureDisenoAsistidoV9, proteccionV9 } from '../dist/ejemplo/fixtures-diseno-v9.js';
import { referenciaTecnica } from '../dist/src/datos-tecnicos/tipos.js';
import { descubrirCircuitos } from '../dist/src/ingenieria/circuitos.js';
import {
	construirEspacioOpciones, crearSnapshotDisenoAsistido, evaluarPlanDiseno, generarPlanesDiseno,
	ordenarResultadosDiseno,
} from '../dist/src/diseno-asistido/core.js';
import { informeDisenoHtml, informeDisenoJson } from '../dist/src/diseno-asistido/documentacion.js';

const ahora=()=>performance.now();
const memoria=()=>process.memoryUsage().heapUsed;
const medir=(nombre,fn)=>{const m=memoria(),t=ahora(),valor=fn();return{nombre,ms:ahora()-t,heapDeltaBytes:memoria()-m,valor};};
const f=fixtureDisenoAsistidoV9(),c=descubrirCircuitos(f.proyecto).circuitos.find(x=>x.id===f.circuitoId);
const catalogo=medir('construccion_catalogo_10000',()=>Array.from({length:10_000},(_,i)=>proteccionV9(`stress-${String(i).padStart(5,'0')}`,10+(i%80),1+(i%25),1)));
const solicitud={version:1,id:'stress-v9',nombre:'Medición sintética V9',objetivo:'COMPARAR_MEJORAS',permitirDatosSinteticos:true,circuitoId:c.id,conductores:[...c.conductores],proteccionId:'q1',cambiosPermitidos:['SECCION','PROTECCION'],seccionesPermitidasMm2:[4,6],proteccionesPermitidas:catalogo.valor.map(referenciaTecnica),condicionesProteccion:{sistema:'AC',tensionV:230,frecuenciaHz:50,polos:1},preferencias:['MENOS_CAMBIOS','MENOR_SECCION_TOTAL','MENOR_IN','MENOR_PERDIDA'],presupuesto:{maxCandidatos:25,maxMs:20_000,lote:5}};
const contexto={conexionesCerradas:new Map([['q1',[['1','2']]]])};
const snapshot=medir('preparacion_snapshot',()=>crearSnapshotDisenoAsistido({proyecto:f.proyecto,solicitud,revisionesDisponibles:catalogo.valor,contextoFisico:contexto}));
const opciones=medir('filtrado_e_indices',()=>construirEspacioOpciones(snapshot.valor));
const planes=medir('generacion_perezosa_25',()=>{const out=[];for(const p of generarPlanesDiseno(snapshot.valor,opciones.valor)){out.push(p);if(out.length===25)break;}return out;});
const evaluacion=medir('evaluacion_25',()=>planes.valor.map(p=>evaluarPlanDiseno(snapshot.valor,p)));
const ranking=medir('ranking_25',()=>ordenarResultadosDiseno(evaluacion.valor,snapshot.valor.solicitud.preferencias));
const resultado={version:1,snapshotHash:snapshot.valor.hash,cobertura:'LIMITADA',motivoCobertura:'Medición: presupuesto fijo de 25 candidatos.',generados:25,evaluados:25,totalEstimado:1+opciones.valor.seccionesMm2.length+opciones.valor.protecciones.length+opciones.valor.seccionesMm2.length*opciones.valor.protecciones.length,duracionMs:evaluacion.ms,excluidas:opciones.valor.excluidas,resultados:ranking.valor};
const serializacion=medir('serializacion_json_html',()=>({json:informeDisenoJson(snapshot.valor,resultado,{projectId:'stress-v9',buildId:'STRESS-V9',generadoEn:'2026-09-17T00:00:00.000Z',aplicacion:{estado:'NO_APLICADA'}}),html:informeDisenoHtml(snapshot.valor,resultado)}));
assert.equal(opciones.valor.protecciones.length,10_000);assert.equal(planes.valor.length,25);assert.equal(resultado.cobertura,'LIMITADA');assert.ok(resultado.totalEstimado>20_000);assert.ok(serializacion.valor.json.length<5_000_000);
const fases=[catalogo,snapshot,opciones,planes,evaluacion,ranking,serializacion].map(({nombre,ms,heapDeltaBytes})=>({nombre,ms:Number(ms.toFixed(2)),heapDeltaMiB:Number((heapDeltaBytes/1024/1024).toFixed(2))}));
console.log(JSON.stringify({entorno:{node:process.version,plataforma:process.platform},configuracion:{productos:10_000,evaluaciones:25,conductores:c.conductores.length,totalEstimado:resultado.totalEstimado},fases,resultado:{evaluados:25,factibles:ranking.valor.filter(x=>x.estado==='FACTIBLE').length,jsonBytes:Buffer.byteLength(serializacion.valor.json),htmlBytes:Buffer.byteLength(serializacion.valor.html),heapFinalMiB:Number((memoria()/1024/1024).toFixed(2))},nota:'Medición local dirigida; no es un SLA universal ni ejecuta todo el universo.'},null,2));
