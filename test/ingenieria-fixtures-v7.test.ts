import assert from 'node:assert/strict';
import test from 'node:test';
import {
	fixtureAnalogicaIncompatibleV7, fixtureCaidaFueraCriterioV7, fixtureDesbalanceIngenieriaV7,
	fixtureDoBobinaInsuficienteV7, fixtureEscenarioSeccionV7, fixtureEstresIngenieriaV7,
	fixtureProteccionSinCorteV7, fixtureProyectoSanoV7, fixtureSelectividadParcialV7,
	fixtureTopologiaAmbiguaV7,
} from '../ejemplo/fixtures-ingenieria-v7.js';
import { crearInformeIngenieriaV7, informeIngenieriaV7AJson } from '../src/ingenieria/documentacion.js';
import { ejecutarIngenieria } from '../src/ingenieria/engine.js';
import { evaluarEscenarios } from '../src/ingenieria/escenarios.js';
import { resolverComportamiento } from '../src/modelo/comportamiento.js';
import type { ContextoTopologiaFisica } from '../src/fisica/topologia-proyecto.js';
import type { Proyecto } from '../src/modelo/tipos.js';

function contextoDiseno(p: Proyecto, fallas: NonNullable<ContextoTopologiaFisica['fallas']> = []): ContextoTopologiaFisica {
	const conexionesCerradas = new Map<string, readonly (readonly [string,string])[]>();
	for (const d of p.dispositivos) {
		const perfil=resolverComportamiento(d);let pares:readonly {entrada:string;salida:string}[]=[];
		if(perfil?.clase==='proteccion'||perfil?.clase==='contactos-electromagneticos')pares=perfil.polos;
		else if(perfil?.clase==='pasivo')pares=perfil.conexiones;
		if(pares.length)conexionesCerradas.set(d.id,pares.map(x=>[x.entrada,x.salida] as const));
	}
	return { conexionesCerradas, fallas };
}
const fallaSelectividad=[{id:'icc-z1',tipo:'L_N' as const,nodoA:'z1::L',nodoB:'z1::N'}];

test('Gate J 1/10: proyecto sano no produce falsos FAIL',()=>{
	const p=fixtureProyectoSanoV7();const r=ejecutarIngenieria({proyecto:p,contextoFisico:contextoDiseno(p)});
	assert.equal(r.validacion.resumen.fail,0);assert.ok(r.validacion.resumen.pass>0);
});

test('Gate J 2/10: conductor con caída superior al criterio es FAIL con evidencia',()=>{
	const p=fixtureCaidaFueraCriterioV7();const r=ejecutarIngenieria({proyecto:p,contextoFisico:contextoDiseno(p)});
	const issue=r.validacion.resultados.find(x=>x.code==='TS-CABLE-VOLTAGE-DROP');
	assert.equal(issue?.status,'FAIL');assert.ok(issue?.evidence.some(e=>e.codigo==='DELTA_V_PCT'));
});

test('Gate J 3/10: Icc calculada con Icu ausente permanece INDETERMINATE',()=>{
	const p=fixtureProteccionSinCorteV7();const r=ejecutarIngenieria({proyecto:p,contextoFisico:contextoDiseno(p,fallaSelectividad)});
	const cortes=r.validacion.resultados.filter(x=>x.code==='TS-PROT-BREAKING-CAPACITY-DATA');
	assert.ok(cortes.length>=1);assert.ok(cortes.every(x=>x.status==='INDETERMINATE'));
	assert.ok(cortes.some(x=>x.missingData.includes('Icu o Icn configurado')&&x.evidence.some(e=>e.codigo==='ICC')));
});

test('Gate J 4/10: selectividad parcial conserva clasificación física estimada',()=>{
	const p=fixtureSelectividadParcialV7();const r=ejecutarIngenieria({proyecto:p,contextoFisico:contextoDiseno(p,fallaSelectividad)});
	assert.ok(r.fisica.selectividad.some(x=>x.clasificacion==='PARCIAL'));
	assert.ok(r.validacion.resultados.some(x=>x.code==='TS-COORD-SELECTIVITY'&&x.status==='WARNING'));
});

test('Gate J 5/10: PLC DO insuficiente para bobina es incompatibilidad real',()=>{
	const p=fixtureDoBobinaInsuficienteV7();const r=ejecutarIngenieria({proyecto:p,contextoFisico:contextoDiseno(p)});
	assert.equal(r.validacion.resultados.find(x=>x.code==='TS-IO-DO-COIL')?.status,'FAIL');
});

test('Gate J 6/10: 4–20 mA contra 0–10 V falla por unidad/rango explícito',()=>{
	const p=fixtureAnalogicaIncompatibleV7();const r=ejecutarIngenieria({proyecto:p,contextoFisico:contextoDiseno(p)});
	assert.equal(r.validacion.resultados.find(x=>x.code==='TS-ANALOG-COMPATIBILITY')?.status,'FAIL');
});

test('Gate J 7/10: trifásico desbalanceado usa fasores y criterio configurado',()=>{
	const p=fixtureDesbalanceIngenieriaV7();const r=ejecutarIngenieria({proyecto:p,contextoFisico:contextoDiseno(p)});
	assert.ok(r.potencia.balances.some(x=>x.corrienteNeutroA>0&&x.superaCriterio));
	assert.ok(r.validacion.resultados.some(x=>x.code==='TS-PHASE-UNBALANCE'&&x.status==='WARNING'));
});

test('Gate J 8/10: escenario 2.5 vs 4 publica mejora sin mutar BASE',()=>{
	const p=fixtureEscenarioSeccionV7();const antes=JSON.stringify(p);const r=evaluarEscenarios({proyecto:p,
		alternativas:[{id:'A',nombre:'4 mm²',parches:[{tipo:'SECCION_CONDUCTOR',conductorId:'w-fase-carga',seccionMm2:4}]}],contextoFisico:contextoDiseno(p)});
	assert.equal(JSON.stringify(p),antes);assert.equal(r.alternativas[0]!.proyecto.conductores.find(x=>x.id==='w-fase-carga')?.seccion,4);
	assert.ok((r.alternativas[0]!.delta.conductores['w-fase-carga']?.caidaV??0)<0);
});

test('Gate J 9/10: múltiples fuentes se muestran AMBIGUAS sin raíz inventada',()=>{
	const p=fixtureTopologiaAmbiguaV7();const r=ejecutarIngenieria({proyecto:p,contextoFisico:contextoDiseno(p)});
	assert.equal(r.circuitos[0]?.estadoTopologia,'AMBIGUA');assert.equal(r.circuitos[0]?.fuenteId,undefined);
	assert.ok(r.validacion.resultados.some(x=>x.code==='TS-CIRCUIT-AMBIGUOUS'&&x.status==='WARNING'));
});

test('Gate J 10/10: fixture sano mantiene baja tasa de falsos positivos y orden canónico',()=>{
	const p=fixtureProyectoSanoV7();const a=ejecutarIngenieria({proyecto:p,contextoFisico:contextoDiseno(p)});
	const q=structuredClone(p);q.dispositivos.reverse();q.conductores.reverse();
	const b=ejecutarIngenieria({proyecto:q,contextoFisico:contextoDiseno(q)});
	assert.equal(a.validacion.resumen.fail,0);assert.deepEqual(b.validacion,a.validacion);assert.deepEqual(b.circuitos,a.circuitos);
});

test('Gate J stress: cientos de entidades miden discovery, validation, scenario y documentación',()=>{
	const p=fixtureEstresIngenieriaV7(60);const antes=JSON.stringify(p);assert.ok(p.dispositivos.length>200&&p.conductores.length>300);
	const t0=performance.now();const a=ejecutarIngenieria({proyecto:p,contextoFisico:contextoDiseno(p)});const tEngineering=performance.now()-t0;
	const conductor=p.conductores.find(x=>x.id.endsWith('w-fase-carga'))!;
	const t1=performance.now();const escenarios=evaluarEscenarios({proyecto:p,alternativas:[{id:'A',nombre:'Sección 4',parches:[{tipo:'SECCION_CONDUCTOR',conductorId:conductor.id,seccionMm2:4}]}],contextoFisico:contextoDiseno(p)});const tScenario=performance.now()-t1;
	const t2=performance.now();const informe=crearInformeIngenieriaV7({proyecto:p,analisis:a,trazabilidad:{projectId:'stress',revision:1,buildId:'TEST-STRESS',generadoEn:'2026-08-31T00:00:00.000Z'}});const json=informeIngenieriaV7AJson(informe);const tDocs=performance.now()-t2;
	assert.equal(JSON.stringify(p),antes);assert.ok(a.circuitos.length>50&&a.validacion.resultados.length>50);assert.equal(escenarios.alternativas.length,1);assert.ok(json.length>10_000);
	assert.ok(tEngineering<30_000&&tScenario<30_000&&tDocs<30_000,`engineering=${tEngineering} scenario=${tScenario} docs=${tDocs}`);
	console.log(`Gate J stress · ${p.dispositivos.length} dispositivos · ${p.conductores.length} conductores · Engineering ${tEngineering.toFixed(1)} ms · Scenario ${tScenario.toFixed(1)} ms · Docs ${tDocs.toFixed(1)} ms`);
});
