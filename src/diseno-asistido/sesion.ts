import { construirEspacioOpciones, evaluarPlanDiseno, generarPlanesDiseno, ordenarResultadosDiseno } from './core.js';
import type { ProgresoDisenoAsistido, ResultadoDisenoAsistido, SnapshotDisenoAsistido } from './tipos.js';

const ceder=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
export async function ejecutarSesionDisenoAsistido(snapshot:SnapshotDisenoAsistido,opciones:{signal?:AbortSignal;progreso?:(p:ProgresoDisenoAsistido)=>void}={}):Promise<ResultadoDisenoAsistido>{
	const inicio=performance.now(),espacio=construirEspacioOpciones(snapshot),total=1+espacio.seccionesMm2.length+espacio.protecciones.length+espacio.seccionesMm2.length*espacio.protecciones.length,max=snapshot.solicitud.presupuesto!.maxCandidatos!,maxMs=snapshot.solicitud.presupuesto!.maxMs!,lote=snapshot.solicitud.presupuesto!.lote!;
	const resultados:ResultadoDisenoAsistido['resultados']=[];let cobertura:ResultadoDisenoAsistido['cobertura']=total>max?'LIMITADA':'EXHAUSTIVA',motivo=total>max?`Presupuesto de ${max} candidatos alcanzado.`:'Se evaluó todo el espacio canónico permitido.',generados=0;
	opciones.progreso?.({fase:'PREPARANDO',generados:0,evaluados:0,totalEstimado:total,transcurridoMs:performance.now()-inicio});
	for(const p of generarPlanesDiseno(snapshot,espacio)){
		if(generados>=max)break;generados++;
		if(opciones.signal?.aborted){cobertura='CANCELADA';motivo='Cancelación solicitada por el usuario.';break;}
		if(performance.now()-inicio>maxMs){cobertura='LIMITADA';motivo=`Presupuesto temporal de ${maxMs} ms alcanzado.`;break;}
		resultados.push(evaluarPlanDiseno(snapshot,p));
		if(resultados.length%lote===0){opciones.progreso?.({fase:'EVALUANDO',generados,evaluados:resultados.length,totalEstimado:total,transcurridoMs:performance.now()-inicio});await ceder();}
	}
	opciones.progreso?.({fase:'ORDENANDO',generados,evaluados:resultados.length,totalEstimado:total,transcurridoMs:performance.now()-inicio});
	const ordenados=ordenarResultadosDiseno(resultados,snapshot.solicitud.preferencias!);const duracionMs=performance.now()-inicio;
	opciones.progreso?.({fase:'TERMINADO',generados,evaluados:ordenados.length,totalEstimado:total,transcurridoMs:duracionMs});
	return{version:1,snapshotHash:snapshot.hash,cobertura,motivoCobertura:motivo,generados,evaluados:ordenados.length,totalEstimado:total,duracionMs,excluidas:espacio.excluidas,resultados:ordenados};
}
