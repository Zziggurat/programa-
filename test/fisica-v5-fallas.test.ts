import assert from 'node:assert/strict';
import test from 'node:test';
import { complejo, magnitud } from '../src/fisica/complejos.js';
import { aplicarFallosTopologia, resolverFalla } from '../src/fisica/fallas.js';
import {
	CURVAS_PROTECCION_GENERICAS, analizarSelectividad, avanzarProteccionFisica, evaluarCurva,
} from '../src/fisica/protecciones.js';
import type { RedFisica } from '../src/fisica/tipos.js';

const red = (zFuente: number, zCable = 0.1): RedFisica => ({
	nodos: [{ id: 'N', referencia: true }, { id: 'L' }, { id: 'X' }],
	fuentes: [{ id: 'red', de: 'L', a: 'N', tensionV: complejo(230), zInternaOhm: complejo(zFuente), origenImpedancia: 'CONFIGURADO' }],
	ramas: [{ id: 'cable', de: 'L', a: 'X', zOhm: complejo(zCable), origen: 'CONFIGURADO' }],
	cargas: [],
});

test('V5 Icc: mayor impedancia de fuente o cable reduce la corriente prospectiva', () => {
	const falla = { id: 'f', tipo: 'L_N' as const, nodoA: 'X', nodoB: 'N' };
	const baja = magnitud(resolverFalla(red(0.05, 0.05), falla).iccA!);
	const fuenteAlta = magnitud(resolverFalla(red(0.5, 0.05), falla).iccA!);
	const cableLargo = magnitud(resolverFalla(red(0.05, 0.5), falla).iccA!);
	assert.ok(baja > fuenteAlta);
	assert.ok(baja > cableLargo);
});

test('V5 Icc: una fuente sin impedancia no produce falsa precision', () => {
	const r = red(0.1); delete r.fuentes[0].zInternaOhm; r.fuentes[0].origenImpedancia = 'NO_MODELADO';
	const f = resolverFalla(r, { id: 'f', tipo: 'L_N', nodoA: 'X', nodoB: 'N' });
	assert.equal(f.iccA, undefined);
	assert.equal(f.origen, 'NO_MODELADO');
	assert.ok(f.diagnosticos.some((d) => d.codigo === 'ICC_NO_DISPONIBLE'));
});

test('V5 fallas: conductor abierto y terminal flojo cambian topologia sin persistir resultados', () => {
	const base = red(0.1);
	const abierta = aplicarFallosTopologia(base, [{ id: 'o', tipo: 'CONDUCTOR_ABIERTO', ramaId: 'cable' }]);
	assert.equal(abierta.ramas.length, 0);
	const flojo = aplicarFallosTopologia(base, [{ id: 'r', tipo: 'RESISTENCIA_ANORMAL', ramaId: 'cable', resistenciaAdicionalOhm: 2 }]);
	assert.equal(flojo.ramas[0].zOhm.re, 2.1);
	assert.equal(base.ramas[0].zOhm.re, 0.1, 'el fallo no muta el diseno');
});

test('V5 curvas: interpolacion logaritmica y region instantanea', () => {
	const termica = evaluarCurva(CURVAS_PROTECCION_GENERICAS.C, 2 * 10, 10);
	assert.equal(termica.region, 'TERMICA');
	assert.ok(termica.tMinS! > 1 && termica.tMaxS! < 3600);
	const instantanea = evaluarCurva(CURVAS_PROTECCION_GENERICAS.C, 120, 10);
	assert.equal(instantanea.region, 'INSTANTANEA');
	assert.equal(instantanea.origen, 'ESTIMADO');
});

test('V5 thermal: iteraciones del solver no duplican delta temporal', () => {
	const evaluacion = { region: 'TERMICA' as const, multiploIn: 2, tMinS: 9, tMaxS: 11,
		origen: 'ESTIMADO' as const, explicacion: 'caso manual' };
	const inicial = { cargaTermica: 0, i2tA2s: 0, disparada: false };
	const una = avanzarProteccionFisica(inicial, evaluacion, 10, 1);
	assert.equal(una.cargaTermica, 0.1);
	// 20 iteraciones numericas siguen desembocando en UNA llamada temporal de 1 s.
	const veinteIteracionesSolver = 20;
	assert.equal(avanzarProteccionFisica(inicial, evaluacion, 10, 1).cargaTermica, una.cargaTermica);
	assert.equal(veinteIteracionesSolver, 20);
});

test('V5 selectividad: explica bandas separadas, solapadas e indeterminadas', () => {
	const lenta = { region: 'TERMICA' as const, multiploIn: 5, tMinS: 1, tMaxS: 3, origen: 'ESTIMADO' as const, explicacion: 'lenta' };
	const rapida = { ...lenta, tMinS: 0.01, tMaxS: 0.1, explicacion: 'rapida' };
	assert.equal(analizarSelectividad(rapida, lenta).clasificacion, 'SELECTIVA');
	assert.equal(analizarSelectividad(lenta, rapida).clasificacion, 'NO_SELECTIVA');
	assert.equal(analizarSelectividad({ ...rapida, tMaxS: 2 }, lenta).clasificacion, 'PARCIAL');
	assert.equal(analizarSelectividad(evaluarCurva(undefined, 10, 10), lenta).clasificacion, 'INDETERMINADA');
});
