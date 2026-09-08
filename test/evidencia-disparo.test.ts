import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureSelectividadV5 } from '../ejemplo/fixtures-fisica-v5.js';
import { simularFisicaProyecto } from '../src/fisica/topologia-proyecto.js';
import { conservarEvidenciaDisparo } from '../src/fisica/evidencia-disparo.js';
import type { FallaFisicaRuntime } from '../src/fisica/fallas.js';

test('Evidencia prospectiva despejada sobrevive ticks posteriores sin volver a alimentar la red',()=>{
	const p=fixtureSelectividadV5(),antes=JSON.stringify(p);
	const falla:FallaFisicaRuntime={id:'ensayo',tipo:'L_N',nodoA:'z1::L',nodoB:'z1::N'};
	const cerrado=new Map([['q1',[['1','2'] as const]],['q2',[['1','2'] as const]]]);
	const abierto=new Map([['q1',[['1','2'] as const]]]);
	const resolver=(abre:boolean,fallas: FallaFisicaRuntime[]=[falla])=>simularFisicaProyecto(p,{conexionesCerradas:abre?abierto:cerrado,fallas});
	const evento=resolver(false),posterior=resolver(true);
	assert.ok(Math.hypot(evento.fallas[0].iccA!.re,evento.fallas[0].iccA!.im)>100);
	conservarEvidenciaDisparo(evento,posterior,true);
	assert.equal(posterior.fallas[0].despejada,true);assert.equal(posterior.selectividad.length,1);
	let previo=posterior;
	for(let tick=0;tick<20;tick++) {
		const actual=resolver(true),red=actual.red,medicion=actual.medicion;
		conservarEvidenciaDisparo(previo,actual);
		assert.deepEqual(actual.fallas,posterior.fallas);assert.deepEqual(actual.selectividad,posterior.selectividad);
		assert.equal(actual.red,red);assert.equal(actual.medicion,medicion);
		assert.ok(actual.conductores.get('w-q2-z1')!.corrienteA<1e-6);
		previo=actual;
	}
	const reactivado=resolver(false);conservarEvidenciaDisparo(previo,reactivado);
	assert.notEqual(reactivado.fallas[0].despejada,true);
	const quitado=resolver(true,[]);conservarEvidenciaDisparo(previo,quitado);assert.equal(quitado.fallas.length,0);assert.equal(quitado.selectividad.length,0);
	const cambiado=resolver(true,[{...falla,nodoB:'red::N'}]);conservarEvidenciaDisparo(previo,cambiado);assert.notEqual(cambiado.fallas[0].despejada,true);
	assert.equal(JSON.stringify(p),antes);
});
