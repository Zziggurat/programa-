import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureDatosTecnicosV8 } from '../ejemplo/datos-tecnicos-v8.js';
import { ejecutarIngenieria } from '../src/ingenieria/engine.js';
import { contextoNominalProteccion } from '../src/ingenieria/contexto-proteccion.js';
import { simularFisicaProyecto } from '../src/fisica/topologia-proyecto.js';

const analizar = (p: ReturnType<typeof fixtureDatosTecnicosV8>) => ejecutarIngenieria({proyecto:p,contextoFisico:{conexionesCerradas:new Map([['q1',[['1','2'] as const]]])}}).validacion.resultados;
const corte = (p: ReturnType<typeof fixtureDatosTecnicosV8>) => analizar(p).find(r=>r.code.startsWith('TS-PROT-BREAKING-CAPACITY'))!;

test('V8 capacidad 230 V no se aprueba en red 400 V aunque el vínculo siga declarando 230',()=>{
	const p=fixtureDatosTecnicosV8(); assert.equal(corte(p).status,'PASS');
	p.dispositivos.find(d=>d.id==='red')!.fisica!.fuente!.tensionNominalV=400;
	const antes=JSON.stringify(p),r=corte(p);
	assert.equal(r.status,'INDETERMINATE'); assert.ok(r.evidence.some(e=>e.codigo==='Icu_NETWORK_CONTEXT'&&e.valor==='NOT_APPLICABLE'));
	assert.ok(!r.evidence.some(e=>e.codigo==='Icu')); assert.equal(JSON.stringify(p),antes);
	p.dispositivos.reverse();p.conductores.reverse();assert.deepEqual(corte(p),r);
});

test('V8 condición AC no se acredita por texto del vínculo ante fuente DC',()=>{
	const p=fixtureDatosTecnicosV8(),red=p.dispositivos.find(d=>d.id==='red')!;
	red.fisica!.fuente!.sistema='DC';red.fisica!.fuente!.fases[0].fase='POSITIVO';
	const r=corte(p);assert.equal(r.status,'INDETERMINATE');
	assert.ok(r.evidence.some(e=>e.codigo==='Icu_NETWORK_CONTEXT'&&e.descripcion.includes('DC no coincide con AC')));
});

test('V8 contexto nominal distingue un polo fase-neutro de varios polos entre fases',()=>{
	const p=fixtureDatosTecnicosV8(),red=p.dispositivos.find(d=>d.id==='red')!,q=p.dispositivos.find(d=>d.id==='q1')!;
	red.fisica!.fuente={...red.fisica!.fuente!,sistema:'AC_TRIFASICA',tensionNominalV:400,fases:[{borne:'L',fase:'L1'},{borne:'L2',fase:'L2'}]};
	red.bornes.push({id:'L2',tipo:'L'});
	let fisica=simularFisicaProyecto(p),c=contextoNominalProteccion(p,q,fisica);
	assert.ok(Math.abs(Number(c.condiciones.tensionV)-400/Math.sqrt(3))<1e-9);
	assert.equal(c.condiciones.polos,1);
	assert.equal(q.comportamiento?.clase,'proteccion');if(q.comportamiento?.clase!=='proteccion')throw Error('fixture');
	q.comportamiento.polos.push({entrada:'3',salida:'4'});q.bornes.push({id:'3',tipo:'L'},{id:'4',tipo:'L'});
	p.conductores.push({id:'fase2',de:{dispositivoId:'red',borneId:'L2'},a:{dispositivoId:'q1',borneId:'3'},seccion:4,fisica:{longitudManualM:1,material:'COBRE'}});
	fisica=simularFisicaProyecto(p);c=contextoNominalProteccion(p,q,fisica);
	assert.ok(Math.abs(Number(c.condiciones.tensionV)-400)<1e-9);assert.equal(c.condiciones.polos,2);
	red.fisica!.fuente!.fases.reverse();p.conductores.reverse();
	assert.deepEqual(contextoNominalProteccion(p,q,simularFisicaProyecto(p)),c);
});

test('V8 contexto eléctrico ausente no recupera condiciones nominales del vínculo',()=>{
	const p=fixtureDatosTecnicosV8(),q=p.dispositivos.find(d=>d.id==='q1')!;
	const c=contextoNominalProteccion(p,q,undefined);
	assert.equal(c.condiciones.tensionV,undefined);assert.equal(c.condiciones.sistema,undefined);assert.ok(c.motivos.length);
});

test('V8 protección común suma cargas monofásicas únicas, no aprueba cada rama por separado',()=>{
	const p=fixtureDatosTecnicosV8(),r=p.dispositivos.find(d=>d.id==='r1')!;
	r.corrienteNominal=15;const otra=structuredClone(r);otra.id='r2';p.dispositivos.push(otra);
	for(const w of p.conductores.filter(w=>w.de.dispositivoId==='r1'||w.a.dispositivoId==='r1')) {
		const copia=structuredClone(w);copia.id+='-r2';
		if(copia.de.dispositivoId==='r1')copia.de.dispositivoId='r2';
		if(copia.a.dispositivoId==='r1')copia.a.dispositivoId='r2';p.conductores.push(copia);
	}
	const calificar=()=>analizar(p).filter(r=>r.code.startsWith('TS-PROT-RATING'));
	assert.ok(calificar().length===2&&calificar().every(r=>r.status==='FAIL'&&r.evidence.some(e=>e.codigo==='I_DESIGN'&&e.valor===30)));
	p.dispositivos.reverse();p.conductores.reverse();assert.ok(calificar().every(r=>r.status==='FAIL'));
	otra.corrienteNominal=5;assert.ok(calificar().every(r=>r.status==='PASS'));
	delete otra.corrienteNominal;assert.ok(calificar().every(r=>r.status==='INDETERMINATE'));
	otra.corrienteNominal=15;p.dispositivos.find(d=>d.id==='red')!.fisica!.fuente!.sistema='AC_TRIFASICA';
	assert.ok(calificar().every(r=>r.status==='INDETERMINATE'), 'no suma fases distintas como si fueran una sola');
});
