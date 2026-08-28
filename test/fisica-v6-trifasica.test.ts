import assert from 'node:assert/strict';
import test from 'node:test';
import type { Proyecto } from '../src/modelo/tipos.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { magnitud, polar } from '../src/fisica/complejos.js';
import { simularFisicaProyecto } from '../src/fisica/topologia-proyecto.js';
import { analizarTrifasico, componentesSimetricas } from '../src/fisica/trifasica.js';

function fixtureTrifasico(resistencias: [number, number, number] = [100, 100, 100]): Proyecto {
	const cargas = resistencias.map((r, i) => ({ id: `z${i + 1}`, tipo: 'resistencia' as const,
		bornes: [{ id: 'L', tipo: 'L' as const }, { id: 'N', tipo: 'N' as const }],
		fisica: { version: 1 as const, carga: { modelo: 'CONSTANT_Z' as const, terminales: ['L', 'N'] as [string, string], rOhm: r } } }));
	return {
		formato: 'tablero-studio', version: 1, nombre: 'Fixture V6 — neutro y desequilibrio', hojas: [],
		gabinete: { ancho: 500, alto: 400, rieles: [], canaletas: [], colocaciones: [] },
		dispositivos: [
			{ id: 'red', tipo: 'otro', bornes: [
				{ id: 'L1', tipo: 'L' }, { id: 'L2', tipo: 'L' }, { id: 'L3', tipo: 'L' }, { id: 'N', tipo: 'N' },
			],
				fisica: { version: 1, fuente: { sistema: 'AC_TRIFASICA', tensionNominalV: 400, frecuenciaHz: 50,
					referencia: 'N', fases: [
						{ borne: 'L1', fase: 'L1' }, { borne: 'L2', fase: 'L2' }, { borne: 'L3', fase: 'L3' },
					], rOhm: 0.2, xOhm: 0, umbralDesequilibrioPct: 10 } } },
			{ id: 'bus-n', tipo: 'bornero', bornes: ['N0', 'N1', 'N2', 'N3'].map((id) => ({ id, tipo: 'N' as const })),
				puentesInternos: [['N0', 'N1'], ['N0', 'N2'], ['N0', 'N3']] },
			...cargas,
		],
		conductores: [
			{ id: 'wn', de: { dispositivoId: 'red', borneId: 'N' }, a: { dispositivoId: 'bus-n', borneId: 'N0' }, seccion: 2.5, fisica: { longitudManualM: 1 } },
			...cargas.flatMap((_, i) => [
				{ id: `wl${i + 1}`, de: { dispositivoId: 'red', borneId: `L${i + 1}` }, a: { dispositivoId: `z${i + 1}`, borneId: 'L' }, seccion: 2.5, fisica: { longitudManualM: 1 } },
				{ id: `wr${i + 1}`, de: { dispositivoId: `z${i + 1}`, borneId: 'N' }, a: { dispositivoId: 'bus-n', borneId: `N${i + 1}` }, seccion: 2.5, fisica: { longitudManualM: 1 } },
			]),
		],
	};
}

test('V6 trifásica: Fortescue y suma fasorial tienen resultados matemáticos exactos', () => {
	const positiva = [polar(10, 0), polar(10, -2 * Math.PI / 3), polar(10, 2 * Math.PI / 3)] as const;
	const c = componentesSimetricas(positiva);
	assert.ok(magnitud(c.cero) < 1e-10); assert.ok(magnitud(c.negativa) < 1e-10);
	assert.ok(Math.abs(magnitud(c.positiva) - 10) < 1e-10);
	const cero = componentesSimetricas([polar(4, 0), polar(4, 0), polar(4, 0)]);
	assert.ok(Math.abs(magnitud(cero.cero) - 4) < 1e-10);
	const a = analizarTrifasico('s', [...positiva], [polar(5, 0), polar(2, 0), polar(1, 0)]);
	assert.ok(Math.abs(a.corrienteNeutroA.re + 8) < 1e-10);
	assert.equal(a.metrica, 'MAX_DESVIACION_MEDIA');
});

test('V6 trifásica: carga balanceada produce IN y secuencias negativa/cero casi nulas', () => {
	const r = simularFisicaProyecto(fixtureTrifasico()); const a = r.trifasicos.get('red')!;
	assert.ok(magnitud(a.corrienteNeutroA) < 1e-6);
	assert.ok(a.desequilibrioCorrientePct < 1e-6);
	assert.ok(magnitud(a.componentesCorriente.negativa) < 1e-6);
	assert.ok(magnitud(a.componentesCorriente.cero) < 1e-6);
	assert.ok(Math.abs(r.red.metricas.errorBalanceW) < 0.1);
	assert.ok(r.red.metricas.residuoKclA < 1e-6);
});

test('V6 trifásica: cargas L-N independientes publican corrientes e IN desbalanceadas', () => {
	const recargado = cargarProyecto(JSON.stringify(fixtureTrifasico([40, 80, 160]))).proyecto;
	const r = simularFisicaProyecto(recargado); const a = r.trifasicos.get('red')!;
	assert.ok(a.desequilibrioCorrientePct > 40);
	assert.ok(magnitud(a.corrienteNeutroA) > 2);
	assert.equal(a.superaUmbral, true);
	assert.equal(a.umbralDesequilibrioPct, 10);
});

test('V6 trifásica: NEUTRO_ABIERTO desplaza el potencial de la estrella sin tensiones hardcodeadas', () => {
	const p = fixtureTrifasico([40, 80, 160]);
	const normal = simularFisicaProyecto(p);
	const abierto = simularFisicaProyecto(p, { fallas: [{ id: 'n-open', tipo: 'NEUTRO_ABIERTO', ramaId: 'conductor:wn' }] });
	const vn = [0, 1, 2].map((i) => magnitud(normal.red.cargas.get(`carga:z${i + 1}:0`)!.tensionV));
	const va = [0, 1, 2].map((i) => magnitud(abierto.red.cargas.get(`carga:z${i + 1}:0`)!.tensionV));
	assert.ok(Math.max(...vn) - Math.min(...vn) < 1);
	assert.ok(Math.max(...va) - Math.min(...va) > 100);
	assert.ok(abierto.fallas.some((f) => f.tipo === 'NEUTRO_ABIERTO' && f.origen === 'INYECTADO'));
	assert.ok(Math.abs(abierto.red.metricas.errorBalanceW) < 0.1);
});

test('V6 trifásica: fase abierta y orden de arrays no esconden desequilibrio ni cambian magnitudes', () => {
	const p = fixtureTrifasico([40, 80, 160]);
	const base = simularFisicaProyecto(p).trifasicos.get('red')!;
	const faseAbierta = simularFisicaProyecto(p, { fallas: [{ id: 'l2-open', tipo: 'CONDUCTOR_ABIERTO', ramaId: 'conductor:wl2' }] })
		.trifasicos.get('red')!;
	assert.ok(faseAbierta.desequilibrioCorrientePct > base.desequilibrioCorrientePct);
	const inverso = structuredClone(p); inverso.dispositivos.reverse(); inverso.conductores.reverse();
	inverso.dispositivos.find((d) => d.id === 'red')!.fisica!.fuente!.fases.reverse();
	const otro = simularFisicaProyecto(inverso).trifasicos.get('red')!;
	assert.ok(Math.abs(magnitud(base.corrienteNeutroA) - magnitud(otro.corrienteNeutroA)) < 1e-8);
	assert.ok(Math.abs(base.desequilibrioCorrientePct - otro.desequilibrioCorrientePct) < 1e-8);
});
