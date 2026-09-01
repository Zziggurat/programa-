/** Fixtures pequeños y ordinarios para cerrar Ingeniería V7 sin ids conocidos por los motores. */
import { fixtureCaidaTensionV5, fixtureMotorTrifasicoV5, fixtureSelectividadV5 } from './fixtures-fisica-v5.js';
import { fixtureDesequilibrioV6, fixtureVfdMotorV6 } from './fixtures-fisica-v6.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import type { Conductor, Dispositivo, Proyecto } from '../src/modelo/tipos.js';

const extremo = (dispositivoId: string, borneId: string) => ({ dispositivoId, borneId });
const cable = (id: string, de: [string,string], a: [string,string], seccion=1): Conductor => ({ id,
	de: extremo(...de), a: extremo(...a), seccion, fisica: { material: 'COBRE', longitudManualM: 1 } });

/** Caso sano calculable: criterios y capacidad de corte están configurados, incluida una tabla local explícita. */
export function fixtureProyectoSanoV7(): Proyecto {
	const p = fixtureCaidaTensionV5(); p.nombre = 'Fixture V7 — proyecto sano';
	const q1 = p.dispositivos.find((d) => d.id === 'q1')!;
	q1.descripcion = 'Protección & distribución documentada';
	p.dispositivos.find((d) => d.id === 'q1')!.fisica!.proteccion!.capacidadCorte = { icnKA: 6, icuKA: 10, icsKA: 5 };
	p.dispositivos.push({ id: 'x1', tipo: 'bornero', designacion: '-X1', descripcion: 'Distribución de carga',
		bornes: [{ id: '1', tipo: 'L', maxConductores: 4 }] });
	const tramo = p.conductores.find((c) => c.id === 'w-fase-carga')!;
	tramo.a = extremo('x1', '1'); tramo.fisica = { ...tramo.fisica, longitudManualM: 8 };
	p.conductores.push({ ...structuredClone(tramo), id: 'w-bornero-carga',
		de: extremo('x1', '1'), a: extremo('r1', 'L'), fisica: { ...tramo.fisica, longitudManualM: 12 } });
	p.gabinete?.colocaciones.push({ dispositivoId: 'x1', x: 205, y: 75, ancho: 38, alto: 55, rielId: 'r1' });
	p.ingenieria = { version: 1, criterios: { maxVoltageDropPercent: 5, maxLossW: 100,
		ampacityProfile: { nombre: 'Tabla declarada del fixture', fuente: 'Fixture V7', puntos: [
			{ seccionMm2: 1.5, corrienteMaxA: 15 }, { seccionMm2: 2.5, corrienteMaxA: 20 }, { seccionMm2: 4, corrienteMaxA: 26 },
		] } } };
	return p;
}

export function fixtureCaidaFueraCriterioV7(): Proyecto {
	const p = fixtureProyectoSanoV7(); p.nombre = 'Fixture V7 — caída fuera de criterio';
	p.ingenieria!.criterios!.maxVoltageDropPercent = 0.5; return p;
}

/** Icc sí puede calcularse al inyectar la falla, pero Icu/Icn deliberadamente no están declaradas. */
export function fixtureProteccionSinCorteV7(): Proyecto {
	const p = fixtureSelectividadV5(); p.nombre = 'Fixture V7 — Icc con poder de corte ausente';
	for (const d of p.dispositivos) if (d.fisica?.proteccion) delete d.fisica.proteccion.capacidadCorte;
	return p;
}

/** Curvas genéricas superpuestas; la clasificación física esperada es PARCIAL, no certificada. */
export function fixtureSelectividadParcialV7(): Proyecto {
	const p = fixtureSelectividadV5(); p.nombre = 'Fixture V7 — selectividad parcial';
	/* Dos bandas B genéricas se solapan en la región instantánea de este ensayo. No se presenta
	 * como coordinación certificada de fabricante: es un caso explícito del modelo estimado. */
	const aguasArriba = p.dispositivos.find((d) => d.id === 'q1')!;
	aguasArriba.curvaDisparo = 'B'; aguasArriba.fisica!.proteccion!.curva = 'B';
	return p;
}

export function fixtureDoBobinaInsuficienteV7(): Proyecto {
	const p = crearProyecto('Fixture V7 — DO insuficiente para bobina');
	p.gabinete = { ancho: 400, alto: 300, rieles: [], canaletas: [], colocaciones: [] };
	p.dispositivos = [
		{ id:'plc', tipo:'plc', designacion:'-PLC1', bornes:['+24','0V','DO1'].map((id)=>({id,tipo:'control' as const})),
			comportamiento:{version:1,clase:'controlador',alimentacion:{entradas:['+24'],retornos:['0V']},
				salidasDigitales:[{borne:'DO1',comun:'+24',electrica:{tensionV:24,sistema:'DC',tipoSalida:'PNP',corrienteMaxA:0.1}}],salidasAnalogicas:[]} },
		{ id:'km', tipo:'contactor', designacion:'-KM1', bornes:['A1','A2','1','2'].map((id)=>({id,tipo:'control' as const})),
			comportamiento:{version:1,clase:'contactos-electromagneticos',bobina:{entrada:'A1',retorno:'A2',electrica:{tensionNominalV:24,sistema:'DC',corrienteA:0.18}},
				polos:[{entrada:'1',salida:'2'}],contactos:[]} },
	];
	p.conductores=[cable('w-do',['plc','DO1'],['km','A1'])]; return p;
}

export function fixtureAnalogicaIncompatibleV7(): Proyecto {
	const p=crearProyecto('Fixture V7 — analógica 4–20 mA contra 0–10 V');
	p.gabinete={ancho:400,alto:300,rieles:[],canaletas:[],colocaciones:[]};
	p.dispositivos=[
		{id:'tx',tipo:'sensor',designacion:'-BT1',bornes:[{id:'+24',tipo:'control'},{id:'OUT',tipo:'senal'},{id:'COM',tipo:'control'}],
			comportamiento:{version:1,clase:'sensor',contactos:[],alimentacion:{entrada:'+24',retorno:'COM'},transmisor:{modoConexion:'3-hilos',modoSalida:'activa',
				salida:{borne:'OUT',comun:'COM',unidad:'mA',rango:[4,20]},variable:{magnitud:'presion',unidad:'bar',minimo:0,maximo:10}}},
			fisica:{version:1,analogica:{tensionComplianceV:12,tensionMinimaTransmisorV:10}}},
		{id:'plc',tipo:'plc',designacion:'-PLC1',bornes:[{id:'AI1',tipo:'senal'},{id:'AIC',tipo:'control'},{id:'+24',tipo:'control'},{id:'0V',tipo:'control'}],
			comportamiento:{version:1,clase:'controlador',alimentacion:{entradas:['+24'],retornos:['0V']},salidasDigitales:[],salidasAnalogicas:[],
				entradasAnalogicas:[{borne:'AI1',comun:'AIC',unidad:'V',rango:[0,10],modoEntrada:'pasiva',variable:{magnitud:'presion',unidad:'bar',minimo:0,maximo:10}}]},
			fisica:{version:1,analogica:{burdenOhm:1000}}},
	];
	p.conductores=[cable('ws',['tx','OUT'],['plc','AI1']),cable('wc',['tx','COM'],['plc','AIC'])];return p;
}

export const fixtureDesbalanceIngenieriaV7 = (): Proyecto => {
	const p=fixtureDesequilibrioV6();p.nombre='Fixture V7 — trifásico desbalanceado';
	p.conductores.find((c)=>c.id==='wl1')!.seccion=2.5;
	p.ingenieria={version:1,criterios:{maxUnbalancePercent:10},circuitos:{
		'circuito:red->z1':{version:1,conductoresReasignablesFase:['wl1']},
	}};return p;
};

export function fixtureEscenarioSeccionV7(): Proyecto {
	const p=fixtureCaidaFueraCriterioV7();p.nombre='Fixture V7 — escenario 2.5 vs 4 mm²';return p;
}

export function fixtureTopologiaAmbiguaV7(): Proyecto {
	const p=crearProyecto('Fixture V7 — múltiples fuentes');p.gabinete={ancho:400,alto:300,rieles:[],canaletas:[],colocaciones:[]};
	const fuente=(id:string):Dispositivo=>({id,tipo:'fuente',bornes:[{id:'L',tipo:'L'},{id:'N',tipo:'N'}],comportamiento:{version:1,clase:'fuente',salidas:[{borne:'L',papel:'fase',tensionV:230},{borne:'N',papel:'retorno',tensionV:0}]},
		fisica:{version:1,fuente:{sistema:'AC_MONOFASICA',tensionNominalV:230,referencia:'N',fases:[{borne:'L',fase:'L'}]}}});
	p.dispositivos=[fuente('f1'),fuente('f2'),{id:'z1',tipo:'resistencia',bornes:[{id:'L',tipo:'L'},{id:'N',tipo:'N'}],
		comportamiento:{version:1,clase:'carga',efecto:'calor',alimentacion:{fases:['L'],retornos:['N'],fasesMinimas:1}},fisica:{version:1,carga:{modelo:'CONSTANT_Z',terminales:['L','N'],rOhm:100}}}];
	p.conductores=[cable('wa',['f1','L'],['z1','L']),cable('wb',['f2','L'],['z1','L']),cable('wn',['z1','N'],['f1','N'])];return p;
}

function prefijar(parte:Proyecto,prefijo:string,p:Proyecto):void{
	for(const d of parte.dispositivos)p.dispositivos.push({...structuredClone(d),id:prefijo+d.id});
	for(const c of parte.conductores)p.conductores.push({...structuredClone(c),id:prefijo+c.id,
		de:{...c.de,dispositivoId:prefijo+c.de.dispositivoId},a:{...c.a,dispositivoId:prefijo+c.a.dispositivoId}});
}

/** Banco de navegador: reúne los fixtures focales sin sustituir sus regresiones individuales. */
export function fixtureBancoValidacionV7():Proyecto{
	const p=crearProyecto('Fixture V7 — banco de validación');p.gabinete={ancho:900,alto:700,rieles:[],canaletas:[],colocaciones:[]};
	const partes=[fixtureCaidaFueraCriterioV7(),fixtureProteccionSinCorteV7(),fixtureSelectividadParcialV7(),
		fixtureDoBobinaInsuficienteV7(),fixtureAnalogicaIncompatibleV7(),fixtureDesbalanceIngenieriaV7(),fixtureTopologiaAmbiguaV7()];
	for(let i=0;i<partes.length;i++)prefijar(partes[i]!,`v${i+1}-`,p);
	p.ingenieria={version:1,criterios:{maxVoltageDropPercent:0.5,maxUnbalancePercent:10}};return p;
}

/** Cientos de entidades, con los mismos perfiles ordinarios que usa la aplicación. */
export function fixtureEstresIngenieriaV7(grupos=60):Proyecto{
	const p=crearProyecto(`Fixture V7 — estrés ${grupos} grupos`);p.gabinete={ancho:1600,alto:1200,rieles:[],canaletas:[],colocaciones:[]};
	const fabricas=[fixtureCaidaTensionV5,fixtureMotorTrifasicoV5,fixtureVfdMotorV6,fixtureDesequilibrioV6,fixtureDoBobinaInsuficienteV7];
	for(let i=0;i<grupos;i++)prefijar(fabricas[i%fabricas.length](),`g${String(i).padStart(3,'0')}-`,p);
	return p;
}
