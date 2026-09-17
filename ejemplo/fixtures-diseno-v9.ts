/** Laboratorio sintético y explícito de V9. No representa selección comercial ni normativa. */
import { publicarRevision } from '../src/datos-tecnicos/hash.js';
import { referenciaTecnica, type RevisionCriteriosTecnicos, type RevisionProductoTecnico,
	type RevisionTablaAmpacidad, type RevisionTecnica } from '../src/datos-tecnicos/tipos.js';
import { descubrirCircuitos } from '../src/ingenieria/circuitos.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import { fixtureCaidaTensionV5 } from './fixtures-fisica-v5.js';

const proc={origen:'SINTETICO' as const,referencia:'Laboratorio aritmético V9; no apto para selección real'};
const base=(id:string,nombre:string,revision=1)=>({version:1 as const,canon:1 as const,catalogo:{id:'v9-sintetico',nombre:'Catálogo sintético V9'},id,revision,hash:`sha256:${'0'.repeat(64)}`,nombre,estado:'ACTIVA' as const,procedencia:proc});
const dato=(campo:RevisionProductoTecnico['campos'][number]['campo'],valor:number,unidad:string)=>({campo,valor,unidad,naturaleza:'NOMINAL' as const,procedencia:proc,condiciones:{sistema:'AC' as const,tensionV:230,frecuenciaHz:50,polos:1}});

export function proteccionV9(id:string,inA:number,icuKA:number,revision=1):RevisionProductoTecnico{return publicarRevision({...base(id,`Protección sintética ${inA} A`,revision),tipo:'PRODUCTO',familia:'PROTECCION',variante:'AC 230 V 1P',campos:[dato('proteccion.inA',inA,'A'),dato('proteccion.Icu',icuKA,'kA'),dato('proteccion.Icn',icuKA,'kA')]});}
export function conductorV9():RevisionProductoTecnico{return publicarRevision({...base('conductor-cu','Conductor sintético Cu 2,5 mm²'),tipo:'PRODUCTO',familia:'CONDUCTOR',variante:'Cu PVC',campos:[{campo:'conductor.seccionMm2',valor:2.5,unidad:'mm2',naturaleza:'NOMINAL',procedencia:proc},{campo:'conductor.material',valor:'COBRE',unidad:'1',naturaleza:'NOMINAL',procedencia:proc}]});}
export function tablaV9():RevisionTablaAmpacidad{return publicarRevision({...base('ampacidad-cu','Ampacidad sintética V9'),tipo:'AMPACIDAD',politicaSeccion:'EXACT_ONLY',filas:[2.5,4,6].map((seccionMm2,i)=>({material:'COBRE' as const,aislamiento:'PVC-V9',temperaturaAislamientoC:70,seccionMm2,metodo:'BANDEJA-V9',temperaturaBaseC:20,cargados:2,agrupamientoBase:1,izA:[18,26,34][i]})),factores:[],combinaciones:[]});}
export function criteriosV9():RevisionCriteriosTecnicos{return publicarRevision({...base('criterios-v9','Criterios sintéticos V9'),tipo:'CRITERIOS',ambitoDeclarado:'Fixture V9',parametros:{maxVoltageDropPercent:{modo:'VALOR',valor:.5},maxLossW:{modo:'VALOR',valor:25},maxLossPercent:{modo:'NO_APLICA',motivo:'Frontera energética porcentual fuera del laboratorio'},maxUnbalancePercent:{modo:'NO_APLICA',motivo:'Circuito monofásico'},capacidadCorte:{modo:'VALOR',valor:'Icu'},coordinarIbInIz:{modo:'NO_APLICA',motivo:'El laboratorio focal comprueba ampacidad y corte por separado'}}});}

export interface FixtureDisenoV9 { proyecto:Proyecto; circuitoId:string; disponibles:RevisionTecnica[]; protecciones:RevisionProductoTecnico[] }
export function fixtureDisenoAsistidoV9():FixtureDisenoV9{
	const proyecto=fixtureCaidaTensionV5();proyecto.nombre='Diseño asistido V9 — conductor y protección';
	const actual=proteccionV9('q16',16,.4),q20=proteccionV9('q20',20,2),q25=proteccionV9('q25',25,3),cable=conductorV9(),tabla=tablaV9(),criterios=criteriosV9();
	// El laboratorio lleva además las dos revisiones candidatas sintéticas para ser reproducible
	// offline. Al aplicar, la operación V8 congela únicamente la alternativa elegida.
	proyecto.datosTecnicos={version:1,revisiones:[actual,q20,q25,cable,tabla,criterios],vinculos:[
		{entidad:'DEVICE',entidadId:'q1',producto:referenciaTecnica(actual),condiciones:{sistema:'AC',tensionV:230,frecuenciaHz:50,polos:1},decisiones:Object.fromEntries(actual.campos.map(d=>[`${d.campo}@`,{modo:'CATALOGO' as const}]))},
		{entidad:'CONDUCTOR',entidadId:'w-fase-carga',producto:referenciaTecnica(cable),condiciones:{},decisiones:Object.fromEntries(cable.campos.map(d=>[`${d.campo}@`,{modo:'CATALOGO' as const}]))},
	],instalaciones:['w-fase-entrada','w-fase-carga','w-retorno'].map(conductorId=>({conductorId,tabla:referenciaTecnica(tabla),material:'COBRE' as const,aislamiento:'PVC-V9',temperaturaAislamientoC:70,metodo:'BANDEJA-V9',temperaturaAmbienteC:20,cargados:2,agrupamiento:1,factores:[]})),criterios:referenciaTecnica(criterios),prospectiva:[{proteccionId:'q1',de:{dispositivoId:'q1',borneId:'2'},a:{dispositivoId:'red',borneId:'N'},tipo:'L_N'}]};
	const circuitoId=descubrirCircuitos(proyecto).circuitos.find(c=>c.conductores.includes('w-fase-carga'))!.id;
	return{proyecto,circuitoId,disponibles:[q20,q25],protecciones:[q20,q25]};
}
