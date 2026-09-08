/** Biblioteca pequeña SINTÉTICA: oráculos de herramientas, nunca fichas certificadas. */
import { publicarRevision } from '../src/datos-tecnicos/hash.js';
import { referenciaTecnica, type BaseRevisionTecnica, type DatoTecnico, type RevisionProductoTecnico, type RevisionTecnica } from '../src/datos-tecnicos/tipos.js';
import { fixtureProyectoSanoV7 } from './fixtures-ingenieria-v7.js';
import { configuracionTecnicaVacia } from '../src/datos-tecnicos/operaciones.js';
export const FUENTE_SINTETICA_V8 = { origen: 'SINTETICO' as const, referencia: 'Dataset aritmético TableroStudio V8 — no normativo, no apto para selección real' };
const base = (id: string, nombre: string, revision = 1): BaseRevisionTecnica => ({ version: 1, canon: 1, catalogo: { id: 'ts-sintetico-v8', nombre: 'Laboratorio técnico V8 · SINTÉTICO' }, id, nombre, revision, hash: '', estado: 'ACTIVA', procedencia: FUENTE_SINTETICA_V8 });
const dato = (campo: DatoTecnico['campo'], valor: DatoTecnico['valor'], unidad: string): DatoTecnico => ({ campo, valor, unidad, naturaleza: Array.isArray(valor) ? 'INTERVALO' : 'NOMINAL', procedencia: FUENTE_SINTETICA_V8 });
export function catalogoSinteticoV8(): RevisionTecnica[] {
	const q = (revision: number, capacidad: number): RevisionProductoTecnico => publicarRevision({ ...base('proteccion-25', 'Protección de prueba 25 A', revision), tipo: 'PRODUCTO', familia: 'PROTECCION', variante: 'AC 230 V · 1 polo', campos: [dato('proteccion.inA', 25, 'A'), { ...dato('proteccion.Icu', capacidad, 'kA'), condiciones: { sistema: 'AC', tensionV: 230, polos: 1 } }] });
	const condicion = { material: 'COBRE' as const, aislamiento: 'PVC-sintetico', metodo: 'CANAL_SINTETICO' };
	return [q(1, 6), q(2, .1),
		publicarRevision({ ...base('bobina-24', 'Bobina de prueba 24 V DC'), tipo: 'PRODUCTO', familia: 'BOBINA', variante: 'DC sostenido/llamada', campos: [dato('bobina.tensionNominalV',24,'V'), dato('bobina.sistema','DC','1'), dato('bobina.corrienteA',.08,'A'), dato('bobina.corrienteLlamadaA',.12,'A'), dato('bobina.tensionRangoV',[20.4,26.4],'V')] }),
		publicarRevision({ ...base('do-24', 'Canal de prueba PLC 100 mA'), tipo: 'PRODUCTO', familia: 'PLC', variante: 'DO1 PNP', campos: [dato('plc.tensionV',24,'V'), dato('plc.sistema','DC','1'), dato('plc.tipoSalida','PNP','1'), dato('plc.corrienteMaxA',.1,'A'), dato('plc.corrienteLlamadaMaxA',.15,'A')].map(d => ({ ...d, canal: 'DO1' })), gruposSalidas: [{ id:'grupo1',canales:['DO1'],corrienteMaxA:.1,corrienteLlamadaMaxA:.15,condiciones:{sistema:'DC',tensionV:24}}] }),
		publicarRevision({ ...base('ampacidad-cu', 'Cobre PVC — tabla sintética 30 A'), tipo: 'AMPACIDAD', politicaSeccion: 'EXACT_ONLY', filas: [
			{ ...condicion, temperaturaAislamientoC:70,seccionMm2:4,metodo:'CANAL_SINTETICO',temperaturaBaseC:20,cargados:3,agrupamientoBase:1,izA:30 },
			{ ...condicion, temperaturaAislamientoC:70,seccionMm2:6,metodo:'CANAL_SINTETICO',temperaturaBaseC:20,cargados:3,agrupamientoBase:1,izA:42 },
		], factores: [
			{ ...condicion,id:'ambiente',dimension:'AMBIENTE',politica:'EXACT_ONLY',puntos:[{valor:20,factor:1},{valor:30,factor:.94}] },
			{ ...condicion,id:'agrupamiento',dimension:'AGRUPAMIENTO',politica:'EXACT_ONLY',puntos:[{valor:1,factor:1},{valor:2,factor:.8}] },
		], combinaciones:[['ambiente','agrupamiento']] }),
		publicarRevision({ ...base('criterios-internos', 'Criterios de laboratorio V8'), tipo:'CRITERIOS',ambitoDeclarado:'Política interna sintética — NO certifica cumplimiento normativo',parametros:{
			capacidadCorte:{modo:'VALOR',valor:'Icu'},coordinarIbInIz:{modo:'VALOR',valor:true},maxVoltageDropPercent:{modo:'VALOR',valor:5},maxLossW:{modo:'VALOR',valor:100},maxLossPercent:{modo:'NO_APLICA',motivo:'La frontera porcentual no está modelada para este ensayo'},maxUnbalancePercent:{modo:'NO_APLICA',motivo:'Ensayo monofásico'},
		} }),
	];
}
/** Se abre como ejemplo readonly desde la UI; realizar copia para adoptar revisiones. */
export function fixtureDatosTecnicosV8() {
	const p = fixtureProyectoSanoV7(); p.nombre = 'Laboratorio V8 — datos técnicos y ampacidad'; p.esEjemplo = true;
	const rs = catalogoSinteticoV8(); const q = rs[0], tabla = rs.find(r => r.tipo === 'AMPACIDAD')!, criterio = rs.find(r => r.tipo === 'CRITERIOS')!;
	const w = p.conductores.find(c => c.id === 'w-fase-carga')!; w.seccion = 4;
	p.datosTecnicos = { ...configuracionTecnicaVacia(), revisiones: [q,tabla,criterio], criterios: referenciaTecnica(criterio),
		vinculos: [{ entidad:'DEVICE',entidadId:'q1',producto:referenciaTecnica(q),condiciones:{sistema:'AC',tensionV:230,polos:1},decisiones:{'proteccion.inA@':{modo:'CATALOGO'},'proteccion.Icu@':{modo:'CATALOGO'}} }],
		instalaciones:[{conductorId:w.id,tabla:referenciaTecnica(tabla),material:'COBRE',aislamiento:'PVC-sintetico',temperaturaAislamientoC:70,metodo:'CANAL_SINTETICO',temperaturaAmbienteC:30,cargados:3,agrupamiento:2,factores:['ambiente','agrupamiento']}],
		prospectiva:[{proteccionId:'q1',de:{dispositivoId:'q1',borneId:'2'},a:{dispositivoId:'red',borneId:'N'},tipo:'L_N'}],
	}; return p;
}
