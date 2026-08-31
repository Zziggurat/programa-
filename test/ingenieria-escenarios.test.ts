import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureCaidaTensionV5, fixtureSelectividadV5 } from '../ejemplo/fixtures-fisica-v5.js';
import { fixtureDesequilibrioV6 } from '../ejemplo/fixtures-fisica-v6.js';
import { descubrirCircuitos } from '../src/ingenieria/circuitos.js';
import { REGLA_CONDUCTORES } from '../src/ingenieria/conductores.js';
import {
	aplicarEscenarioTransaccional, evaluarEscenarios, proyectarEscenario, serializarEscenario,
	type DefinicionEscenarioIngenieria,
} from '../src/ingenieria/escenarios.js';
import { REGLA_POTENCIA_Y_BALANCE } from '../src/ingenieria/potencia.js';
import { REGLA_PROTECCIONES } from '../src/ingenieria/protecciones.js';

const conexiones = new Map([['q1', [['1', '2']] as const]]);

function proyectoCaida() {
	const p = fixtureCaidaTensionV5(); const circuito = descubrirCircuitos(p).circuitos.find((x) => x.cargas.includes('r1'))!;
	p.ingenieria = { version: 1, circuitos: { [circuito.id]: { version: 1, criterios: {
		maxVoltageDropPercent: 0.5, maxLossW: 20,
		ampacityProfile: { nombre: 'Tabla focal', fuente: 'Gate G', puntos: [
			{ seccionMm2: 2.5, corrienteMaxA: 20 }, { seccionMm2: 4, corrienteMaxA: 25 },
		] },
	} } } };
	return { p, circuito };
}

test('Gate G: 2.5 → 4 mm² compara magnitudes/issues sin mutar la base', () => {
	const { p } = proyectoCaida(); const antes = JSON.stringify(p);
	const escenario: DefinicionEscenarioIngenieria = { id: 'sec-4', nombre: 'Cable 4 mm²',
		parches: [{ tipo: 'SECCION_CONDUCTOR', conductorId: 'w-fase-carga', seccionMm2: 4 }] };
	const r = evaluarEscenarios({ proyecto: p, alternativas: [escenario], contextoFisico: { conexionesCerradas: conexiones },
		reglas: [REGLA_CONDUCTORES] });
	const a = r.alternativas[0]!;
	assert.equal(JSON.stringify(p), antes); assert.equal(a.proyecto.conductores.find((x) => x.id === 'w-fase-carga')?.seccion, 4);
	assert.equal(p.conductores.find((x) => x.id === 'w-fase-carga')?.seccion, 2.5);
	assert.ok(a.delta.conductores['w-fase-carga']!.caidaV < 0);
	assert.ok(a.delta.conductores['w-fase-carga']!.perdidaW < 0);
	assert.ok(a.delta.issuesResueltos.some((x) => x.includes('TS-CABLE-VOLTAGE-DROP')));
});

test('Gate G: C16 → C20 es un overlay de protección explícito y conserva evidencia', () => {
	const { p } = proyectoCaida();
	const r = evaluarEscenarios({ proyecto: p, alternativas: [{ id: 'c20', nombre: 'Q1 C20',
		parches: [{ tipo: 'PROTECCION', dispositivoId: 'q1', inA: 20, curva: 'C' }] }],
		contextoFisico: { conexionesCerradas: conexiones }, reglas: [REGLA_PROTECCIONES] });
	const a = r.alternativas[0]!;
	assert.equal(p.dispositivos.find((d) => d.id === 'q1')!.fisica!.proteccion!.inA, 16);
	assert.equal(a.proyecto.dispositivos.find((d) => d.id === 'q1')!.fisica!.proteccion!.inA, 20);
	assert.ok(a.analisis.validacion.resultados.some((x) => x.evidence.some((e) => e.codigo === 'IN' && e.valor === 20)));
	assert.equal(a.delta.protecciones.q1?.inA, 4);
});

test('Gate G: sección alternativa publica delta de Icc y selectividad desde PhysicsEngine', () => {
	const p = fixtureSelectividadV5();
	const contexto = { conexionesCerradas: new Map([
		['q1', [['1', '2']] as const], ['q2', [['1', '2']] as const],
	]), fallas: [{ id: 'icc-z1', tipo: 'L_N' as const, nodoA: 'z1::L', nodoB: 'z1::N' }] };
	const r = evaluarEscenarios({ proyecto: p, alternativas: [{ id: 'icc-4', nombre: 'Último tramo 4 mm²',
		parches: [{ tipo: 'SECCION_CONDUCTOR', conductorId: 'w-q2-z1', seccionMm2: 4 }] }],
		contextoFisico: contexto, reglas: [REGLA_PROTECCIONES] });
	const a = r.alternativas[0]!;
	assert.ok((r.base.indicadores.iccMaxA ?? 0) > 0); assert.ok((a.delta.iccMaxA ?? 0) > 0);
	assert.ok(r.base.indicadores.selectividad.length > 0);
	assert.ok(Array.isArray(a.delta.selectividadNueva) && Array.isArray(a.delta.selectividadResuelta));
});

test('Gate G: L1 → L2 usa fasores, conserva base y publica deltas de balance', () => {
	const p = fixtureDesequilibrioV6(); const antes = JSON.stringify(p);
	const r = evaluarEscenarios({ proyecto: p, alternativas: [{ id: 'fase-l2', nombre: 'Mover Z1 a L2',
		parches: [{ tipo: 'ASIGNACION_FASE', conductorId: 'wl1', fuenteId: 'red', fase: 'L2' }] }],
		reglas: [REGLA_POTENCIA_Y_BALANCE] });
	const a = r.alternativas[0]!;
	assert.equal(JSON.stringify(p), antes);
	assert.notEqual(a.delta.desequilibrioMaxPct, 0); assert.notEqual(a.delta.corrienteNeutroMaxA, 0);
	assert.equal(a.proyecto.conductores.find((x) => x.id === 'wl1')!.de.borneId, 'L2');
});

test('Gate G: BASE/A/B se ordenan y serializan de manera reproducible', () => {
	const { p, circuito } = proyectoCaida();
	const a: DefinicionEscenarioIngenieria = { id: 'a', nombre: 'A', parches: [
		{ tipo: 'CRITERIO_CAIDA', circuitoId: circuito.id, maxVoltageDropPercent: 1 },
		{ tipo: 'SECCION_CONDUCTOR', conductorId: 'w-fase-carga', seccionMm2: 4 },
	] };
	const aInvertido = { ...a, parches: [...a.parches].reverse() };
	assert.equal(serializarEscenario(a), serializarEscenario(aInvertido));
	const r1 = evaluarEscenarios({ proyecto: p, alternativas: [
		{ id: 'b', nombre: 'B', parches: [{ tipo: 'CARGA', dispositivoId: 'r1', cambios: { rOhm: 30 } }] }, a,
	], contextoFisico: { conexionesCerradas: conexiones }, reglas: [REGLA_CONDUCTORES] });
	const r2 = evaluarEscenarios({ proyecto: p, alternativas: [aInvertido,
		{ id: 'b', nombre: 'B', parches: [{ tipo: 'CARGA', dispositivoId: 'r1', cambios: { rOhm: 30 } }] },
	], contextoFisico: { conexionesCerradas: conexiones }, reglas: [REGLA_CONDUCTORES] });
	assert.deepEqual(r1.alternativas.map((x) => [x.escenario.id, x.serializacion, x.indicadores]),
		r2.alternativas.map((x) => [x.escenario.id, x.serializacion, x.indicadores]));
	assert.ok(r1.alternativas.find((x) => x.escenario.id === 'b')!.delta.conductores['w-fase-carga']!.corrienteA < 0);
});

test('Gate G: aplicar requiere decisión y persistencia; un fallo conserva la base', async () => {
	const { p } = proyectoCaida(); const antes = JSON.stringify(p);
	const escenario: DefinicionEscenarioIngenieria = { id: 'aplicar', nombre: 'Aplicar 4 mm²',
		parches: [{ tipo: 'SECCION_CONDUCTOR', conductorId: 'w-fase-carga', seccionMm2: 4 }] };
	let guardado: string | undefined;
	const aplicado = await aplicarEscenarioTransaccional({ proyecto: p, escenario, persistir(candidato) { guardado = JSON.stringify(candidato); } });
	assert.equal(aplicado.conductores.find((x) => x.id === 'w-fase-carga')?.seccion, 4); assert.equal(guardado, JSON.stringify(aplicado));
	assert.equal(JSON.stringify(p), antes);
	await assert.rejects(aplicarEscenarioTransaccional({ proyecto: p, escenario, persistir() { throw new Error('ALMACENAMIENTO_CAIDO'); } }), /ALMACENAMIENTO_CAIDO/);
	assert.equal(JSON.stringify(p), antes);
});

test('Gate G: rechaza overlays conflictivos y valores inválidos antes de analizar', () => {
	const { p } = proyectoCaida();
	assert.throws(() => proyectarEscenario(p, [
		{ tipo: 'SECCION_CONDUCTOR', conductorId: 'w-fase-carga', seccionMm2: 4 },
		{ tipo: 'SECCION_CONDUCTOR', conductorId: 'w-fase-carga', seccionMm2: 6 },
	]), /PARCHES_ESCENARIO_CONFLICTIVOS/);
	assert.throws(() => proyectarEscenario(p, [{ tipo: 'SECCION_CONDUCTOR', conductorId: 'w-fase-carga', seccionMm2: 0 }]), /VALOR_ESCENARIO_INVALIDO/);
});
