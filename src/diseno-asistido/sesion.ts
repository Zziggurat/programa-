import { construirEspacioOpciones, evaluarPlanDiseno, generarPlanesDiseno, ordenarResultadosDiseno } from './core.js';
import type { ProgresoDisenoAsistido, ResultadoDisenoAsistido, SnapshotDisenoAsistido } from './tipos.js';

const ceder=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
export async function ejecutarSesionDisenoAsistido(snapshot:SnapshotDisenoAsistido,opciones:{signal?:AbortSignal;progreso?:(p:ProgresoDisenoAsistido)=>void}={}):Promise<ResultadoDisenoAsistido>{
	const inicio=performance.now(),espacio=construirEspacioOpciones(snapshot),planes=[...generarPlanesDiseno(snapshot,espacio)],max=snapshot.solicitud.presupuesto!.maxCandidatos!,maxMs=snapshot.solicitud.presupuesto!.maxMs!,lote=snapshot.solicitud.presupuesto!.lote!;
	const elegidos=planes.slice(0,max),resultados:ResultadoDisenoAsistido['resultados']=[];let cobertura:ResultadoDisenoAsistido['cobertura']=planes.length>max?'LIMITADA':'EXHAUSTIVA',motivo=planes.length>max?`Presupuesto de ${max} candidatos alcanzado.`:'Se evaluó todo el espacio canónico permitido.';
	opciones.progreso?.({fase:'PREPARANDO',generados:planes.length,evaluados:0,totalEstimado:planes.length,transcurridoMs:performance.now()-inicio});
	for(let i=0;i<elegidos.length;i++){
		if(opciones.signal?.aborted){cobertura='CANCELADA';motivo='Cancelación solicitada por el usuario.';break;}
		if(performance.now()-inicio>maxMs){cobertura='LIMITADA';motivo=`Presupuesto temporal de ${maxMs} ms alcanzado.`;break;}
		resultados.push(evaluarPlanDiseno(snapshot,elegidos[i]));
		if((i+1)%lote===0){opciones.progreso?.({fase:'EVALUANDO',generados:planes.length,evaluados:resultados.length,totalEstimado:planes.length,transcurridoMs:performance.now()-inicio});await ceder();}
	}
	opciones.progreso?.({fase:'ORDENANDO',generados:planes.length,evaluados:resultados.length,totalEstimado:planes.length,transcurridoMs:performance.now()-inicio});
	const ordenados=ordenarResultadosDiseno(resultados,snapshot.solicitud.preferencias!);const duracionMs=performance.now()-inicio;
	opciones.progreso?.({fase:'TERMINADO',generados:planes.length,evaluados:ordenados.length,totalEstimado:planes.length,transcurridoMs:duracionMs});
	return{version:1,snapshotHash:snapshot.hash,cobertura,motivoCobertura:motivo,generados:planes.length,evaluados:ordenados.length,totalEstimado:planes.length,duracionMs,excluidas:espacio.excluidas,resultados:ordenados};
}
