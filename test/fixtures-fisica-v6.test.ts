import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import {
	fixtureDesequilibrioV6, fixtureDiferencialV6, fixtureEstresFisicaV6,
	fixtureMotorPlacaV6, fixtureTransformadorV6, fixtureVfdMotorV6,
} from '../ejemplo/fixtures-fisica-v6.js';
import { magnitud } from '../src/fisica/complejos.js';
import { simularFisicaProyecto } from '../src/fisica/topologia-proyecto.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import { actualizarProteccionesRuntime, memoriaVacia, simular, type EstadoTablero } from '../src/motores/simulacion.js';

const recargar = (p: Proyecto): Proyecto => cargarProyecto(JSON.stringify(p)).proyecto;
const cerca = (a: number, b: number, tolerancia = 1e-8) =>
	assert.ok(Math.abs(a - b) <= tolerancia * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);

test('fixtures V6: son proyectos persistentes pequeños, válidos y con propósito explícito', () => {
	const fixtures = [fixtureDiferencialV6(), fixtureTransformadorV6(), fixtureMotorPlacaV6(),
		fixtureVfdMotorV6(), fixtureDesequilibrioV6()];
	assert.deepEqual(fixtures.map((p) => p.nombre), [
		'Fixture V6 — diferencial y fuga PE', 'Fixture V6 — transformador bajo carga',
		'Fixture V6 — motor desde placa y diagnóstico', 'Fixture V6 — VFD y motor',
		'Fixture V6 — neutro y desequilibrio',
	]);
	for (const p of fixtures) {
		const q = recargar(p);
		assert.equal(q.nombre, p.nombre);
		assert.equal(q.dispositivos.length, p.dispositivos.length);
		assert.equal(q.conductores.length, p.conductores.length);
		assert.ok(q.dispositivos.length <= 6, `${p.nombre} dejó de ser un fixture pequeño`);
		assert.doesNotMatch(JSON.stringify(p), /diagnosticoIndustrial|corrienteResidualA|potenciaEntradaW|rpmEstimada/);
	}
});

test('fixture V6 diferencial: normal, fuga, disparo y red despejada salen del circuito', () => {
	const p = recargar(fixtureDiferencialV6()); const memoria = memoriaVacia();
	const normal = simular(p, {}, undefined, { ahora: 0, memoria });
	const q0 = normal.fisica.protecciones.get('qf1')!;
	assert.equal(q0.estadoResidual, 'NORMAL'); assert.ok((q0.corrienteResidualA ?? Infinity) < 1e-6);
	const estado: EstadoTablero = { z1: { fallasFisicas: [{ id: 'cc:z1:lpe', tipo: 'L_PE',
		nodoA: 'z1::L', nodoB: 'z1::PE', zFallaOhm: { re: 1000, im: 0 } }] } };
	const fuga = simular(p, estado, normal.activos, { ahora: 1000, memoria });
	assert.ok((fuga.fisica.protecciones.get('qf1')?.corrienteResidualA ?? 0) > 0.03);
	const paso = actualizarProteccionesRuntime(p, estado, fuga, 1000, memoria);
	assert.deepEqual(paso.eventos.map((e) => e.causa), ['fuga-tierra']);
	const despejada = simular(p, paso.estado, fuga.activos, { ahora: 1000, memoria });
	assert.ok((despejada.fisica.protecciones.get('qf1')?.corrienteA ?? Infinity) < 1e-9);
});

test('fixture V6 transformador: carga secundaria se refleja y el orden no cambia el resultado', () => {
	const p = recargar(fixtureTransformadorV6()); const a = simularFisicaProyecto(p);
	const t = a.red.transformadores.get('transformador:t1')!;
	assert.ok(magnitud(t.corrientePrimariaA) > 0.09 && magnitud(t.corrienteSecundariaA) > 0.9);
	assert.ok(magnitud(t.tensionSecundariaV) < 23 && (t.regulacionPct ?? 0) > 0);
	assert.ok(t.potenciaEntradaVA.re >= t.potenciaSalidaVA.re && t.perdidaCobreW >= 0);
	const inverso = structuredClone(p); inverso.dispositivos.reverse(); inverso.conductores.reverse();
	const b = simularFisicaProyecto(inverso).red.transformadores.get('transformador:t1')!;
	cerca(magnitud(t.corrientePrimariaA), magnitud(b.corrientePrimariaA));
	cerca(magnitud(t.tensionSecundariaV), magnitud(b.tensionSecundariaV));
});

test('fixture V6 motor: placa gobierna arranque, rotor bloqueado y causa causal observable', () => {
	const p = recargar(fixtureMotorPlacaV6()); const memoria = memoriaVacia();
	const estado: EstadoTablero = { 's-run': { activo: true } };
	const inicio = simular(p, estado, undefined, { ahora: 0, memoria });
	const marcha = simular(p, estado, inicio.activos, { ahora: 2000, memoria });
	assert.equal(marcha.motores[0]?.estado, 'marcha'); assert.equal(marcha.fisica.motores.get('m1')?.rpm, 1450);
	const bloqueado = simular(p, { ...estado, m1: { fallos: ['motor-bloqueado'] } }, marcha.activos,
		{ ahora: 3000, memoria });
	assert.equal(bloqueado.motores[0]?.motivoFalla, 'motor-bloqueado');
	assert.ok((bloqueado.fisica.motores.get('m1')?.corrienteA ?? 0) > 50);
	const raiz = bloqueado.diagnosticoIndustrial.hallazgos.find((h) => h.codigo === 'ROTOR_BLOQUEADO');
	assert.equal(raiz?.clasificacion, 'ROOT_CAUSE');
	assert.ok(raiz?.evidencias.some((e) => e.codigo === 'I_SOBRE_IN'));
});

test('fixture V6 VFD: referencia, balance, motor y FAULT físico permanecen acoplados', () => {
	const p = recargar(fixtureVfdMotorV6()); const memoria = memoriaVacia();
	const estado: EstadoTablero = { 's-run': { activo: true }, vfd: { valor: 10 } };
	const inicio = simular(p, estado, undefined, { ahora: 0, memoria });
	const marcha = simular(p, estado, inicio.activos, { ahora: 5000, memoria });
	const vfd = marcha.fisica.variadores.get('vfd')!;
	assert.equal(marcha.variadores[0]?.frecuenciaHz, 50);
	assert.ok(vfd.tensionSalidaV > 399 && vfd.potenciaEntradaW >= vfd.potenciaSalidaW);
	assert.equal(marcha.fisica.motores.get('m1')?.rpm, 1450);
	const falla = simular(p, { ...estado, m1: { fallos: ['motor-bloqueado'] } }, marcha.activos,
		{ ahora: 6000, memoria });
	assert.equal(falla.variadores[0]?.estado, 'falla');
	assert.equal(falla.variadores[0]?.motivoFalla, 'sobrecarga');
	assert.equal(falla.fisica.variadores.get('vfd')?.potenciaSalidaW, 0);
});

test('fixture V6 trifásico: IN, desequilibrio y neutro abierto son finitos y deterministas', () => {
	const p = recargar(fixtureDesequilibrioV6()); const normal = simularFisicaProyecto(p);
	const t = normal.trifasicos.get('red')!;
	assert.ok(t.desequilibrioCorrientePct > 40 && magnitud(t.corrienteNeutroA) > 2);
	const abierto = simularFisicaProyecto(p, { fallas: [{ id: 'n-open', tipo: 'NEUTRO_ABIERTO', ramaId: 'conductor:wn' }] });
	const tensiones = [1, 2, 3].map((i) => magnitud(abierto.red.cargas.get(`carga:z${i}:0`)!.tensionV));
	assert.ok(Math.max(...tensiones) - Math.min(...tensiones) > 100);
	assert.ok(tensiones.every(Number.isFinite));
	const inverso = structuredClone(p); inverso.dispositivos.reverse(); inverso.conductores.reverse();
	const otro = simularFisicaProyecto(inverso).trifasicos.get('red')!;
	cerca(t.desequilibrioCorrientePct, otro.desequilibrioCorrientePct);
	cerca(magnitud(t.corrienteNeutroA), magnitud(otro.corrienteNeutroA));
});

test('fixture V6 estrés: varios subsistemas convergen sin NaN/Infinity ni explosión temporal', () => {
	const p = fixtureEstresFisicaV6(); const inicio = performance.now(); const r = simular(p, {
		'c3-s-run': { activo: true }, 'c4-s-run': { activo: true }, 'c4-vfd': { valor: 10 },
	}, undefined, { ahora: 3000, memoria: memoriaVacia() });
	const duracionMs = performance.now() - inicio;
	/* PE sin unión local y bornes analógicos sin uso son islas declaradas, no divergencia numérica. */
	assert.ok(r.fisica.red.diagnosticos.every((d) => d.codigo === 'ISLA_FLOTANTE'));
	assert.ok(r.fisica.red.metricas.residuoKclA < 1e-5);
	assert.ok(Number.isFinite(r.fisica.red.metricas.errorBalanceW));
	assert.ok(Number.isFinite(r.fisica.red.metricas.residuoKclA));
	assert.ok([...r.fisica.red.nodos.values()].every((x) => x.tensionV === undefined
		|| Number.isFinite(x.tensionV.re) && Number.isFinite(x.tensionV.im)));
	assert.ok([...r.fisica.red.ramas.values()].every((x) => Number.isFinite(x.corrienteA.re) && Number.isFinite(x.corrienteA.im)));
	assert.ok(r.fisica.motores.size >= 2 && r.fisica.variadores.size === 1 && r.fisica.trifasicos.size >= 2);
	assert.ok(duracionMs < 3000, `el stress focal tardó ${duracionMs.toFixed(1)} ms`);
});
