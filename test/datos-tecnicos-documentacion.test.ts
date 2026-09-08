import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureDatosTecnicosV8 } from '../ejemplo/datos-tecnicos-v8.js';
import { fixtureProyectoSanoV7 } from '../ejemplo/fixtures-ingenieria-v7.js';
import { ejecutarIngenieria } from '../src/ingenieria/engine.js';
import { crearInformeIngenieriaV7, datosTecnicosIngenieriaACsv, informeIngenieriaV7AHtml, informeIngenieriaV7AJson } from '../src/ingenieria/documentacion.js';
import { publicarRevision } from '../src/datos-tecnicos/hash.js';
import { referenciaTecnica } from '../src/datos-tecnicos/tipos.js';

const trazabilidad = { projectId:'p-v8',revision:7,snapshotId:'s-v8',buildId:'TEST-V8',generadoEn:'2026-09-07T12:00:00.000Z' };
const analizar = (p: ReturnType<typeof fixtureDatosTecnicosV8>) => ejecutarIngenieria({ proyecto:p,contextoFisico:{conexionesCerradas:new Map([['q1',[['1','2'] as const]]])} });

test('V8 informe usa datos efectivos, manifest, factores y criterios sin mutar ni persistir resultados',()=>{
	const p=fixtureDatosTecnicosV8(), antes=JSON.stringify(p),a=analizar(p);
	const i=crearInformeIngenieriaV7({proyecto:p,analisis:a,trazabilidad});
	assert.equal(i.protecciones.find(q=>q.dispositivoId==='q1')?.capacidadCorte?.icuKA,6);
	assert.match(i.datosTecnicos!.manifestHash!,/^sha256:[a-f0-9]{64}$/);
	assert.ok(Math.abs(i.datosTecnicos!.ampacidad[0].izA!-22.56)<1e-12);
	assert.equal(i.datosTecnicos!.ampacidad[0].procedencia?.origen,'SINTETICO');
	assert.equal(i.datosTecnicos!.resoluciones.find(d=>d.campo==='proteccion.Icu')?.dato?.procedencia.origen,'SINTETICO');
	assert.ok(i.datosTecnicos!.criterios.some(c=>c.parametros.capacidadCorte.decision?.modo==='VALOR'));
	assert.equal(JSON.stringify(p),antes); assert.equal(Object.hasOwn(p.datosTecnicos!,'resoluciones'),false);
	const html=informeIngenieriaV7AHtml(i);
	assert.ok(html.includes('>22.56<')); assert.ok(!html.includes('22.560000000000002'));
	assert.match(html,/Condiciones de instalación completas/); assert.match(html,/<colgroup>/);
	i.datosTecnicos!.resoluciones[0].dato!.valor=0.000000123456;
	assert.ok(informeIngenieriaV7AHtml(i).includes('1.23456e-7'), 'formato no convierte una magnitud pequeña en cero');
});

test('V8 informe reproducible con fecha explícita, metadata y orden de catálogo independiente',()=>{
	const p=fixtureDatosTecnicosV8();const generar=()=>informeIngenieriaV7AJson(crearInformeIngenieriaV7({proyecto:p,analisis:analizar(p),trazabilidad}));
	const a=generar(); assert.equal(generar(),a);
	p.datosTecnicos!.revisiones.reverse();assert.equal(generar(),a);
});

test('V8 informe HTML offline y CSV real conservan escaping, BOM y defensa fórmula',()=>{
	const p=fixtureDatosTecnicosV8();const old=p.datosTecnicos!.revisiones.find(r=>r.tipo==='PRODUCTO')!;
	if(old.tipo!=='PRODUCTO')throw new Error('Fixture inválido');
	const malicioso=publicarRevision({...old,nombre:'<script>alert(1)</script>',campos:old.campos.map(d=>({...d,procedencia:{origen:'SINTETICO' as const,referencia:'=HYPERLINK("javascript:alert(1)") <img src=x onerror=alert(1)>'}}))});
	p.datosTecnicos!.revisiones=p.datosTecnicos!.revisiones.map(r=>r.hash===old.hash?malicioso:r);p.datosTecnicos!.vinculos[0].producto=referenciaTecnica(malicioso);
	const i=crearInformeIngenieriaV7({proyecto:p,analisis:analizar(p),trazabilidad}),html=informeIngenieriaV7AHtml(i),csv=datosTecnicosIngenieriaACsv(i);
	assert.match(html,/Datos técnicos V8/);assert.match(html,/Ampacidad e instalación/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img src=x/);
	assert.doesNotMatch(html,/<script\b|<link[^>]+https?:|<img[^>]+https?:/i);
	assert.equal(csv.charCodeAt(0),0xfeff);assert.match(csv,/'=HYPERLINK/);assert.match(csv,/SINTETICO/);assert.match(csv,/sha256:/);
});

test('V7 sin catálogo no materializa bloque técnico ni cambia el contrato del informe',()=>{
	const p=fixtureProyectoSanoV7();const i=crearInformeIngenieriaV7({proyecto:p,analisis:analizar(p),trazabilidad});
	assert.equal(Object.hasOwn(i,'datosTecnicos'),false);assert.equal(i.version,1);assert.match(informeIngenieriaV7AHtml(i),/Informe de Ingeniería V7/);
});
