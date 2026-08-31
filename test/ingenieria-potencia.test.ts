import assert from 'node:assert/strict';
import test from 'node:test';
import {
	fixtureDesequilibrioV6, fixtureTransformadorV6, fixtureVfdMotorV6,
} from '../ejemplo/fixtures-fisica-v6.js';
import { magnitud } from '../src/fisica/complejos.js';
import { simularFisicaProyecto } from '../src/fisica/topologia-proyecto.js';
import { descubrirCircuitos } from '../src/ingenieria/circuitos.js';
import {
	compararReasignacionFase, REGLA_POTENCIA_Y_BALANCE, resumirPotenciaIngenieria,
} from '../src/ingenieria/potencia.js';
import { validarIngenieria } from '../src/ingenieria/validacion.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { memoriaVacia, simular } from '../src/motores/simulacion.js';

const cerca = (a: number, b: number, tolerancia = 1e-8) =>
	assert.ok(Math.abs(a - b) <= tolerancia * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);

test('potencia V7: balance perfecto, P/Q/S por fase y corriente de neutro salen de fasores V6', () => {
	const p = fixtureDesequilibrioV6([80, 80, 80]);
	const fisica = simularFisicaProyecto(p);
	const r = resumirPotenciaIngenieria({ proyecto: p, fisica });
	assert.equal(r.balances.length, 1);
	const b = r.balances[0]!;
	assert.ok(b.desequilibrioCorrientePct < 1e-7);
	assert.ok(b.corrienteNeutroA < 1e-7);
	assert.deepEqual(b.fases.map((x) => x.fase), ['L1', 'L2', 'L3']);
	assert.ok(b.fases.every((x) => x.pW > 0 && x.sVA >= x.pW && x.corrienteA > 0));
	const sumaFases = b.fases.reduce((s, x) => s + x.pW, 0);
	cerca(r.totalTablero.pW, sumaFases);
});

test('potencia V7: desequilibrio y neutro conservan criterio explícito y validación honesta', () => {
	const p = fixtureDesequilibrioV6();
	const fisica = simularFisicaProyecto(p);
	const r = resumirPotenciaIngenieria({ proyecto: p, fisica }); const b = r.balances[0]!;
	assert.ok(b.desequilibrioCorrientePct > 40);
	assert.ok(b.corrienteNeutroA > 2);
	assert.equal(b.criterioMaxPct, 10); assert.equal(b.superaCriterio, true);
	const validacion = validarIngenieria({ proyecto: p, fisica, reglas: [REGLA_POTENCIA_Y_BALANCE] });
	assert.ok(validacion.resultados.some((x) => x.code === 'TS-PHASE-UNBALANCE' && x.status === 'WARNING'));
	assert.ok(validacion.resultados.some((x) => x.code === 'TS-POWER-EXTERNAL-BOUNDARY' && x.status === 'PASS'));
});

test('potencia V7: pérdidas quedan separadas y reconciliadas sin inventar una categoría', () => {
	const p = fixtureTransformadorV6(); const fisica = simularFisicaProyecto(p);
	const r = resumirPotenciaIngenieria({ proyecto: p, fisica });
	assert.ok(r.perdidas.conductoresW > 0); assert.ok(r.perdidas.transformadoresW > 0);
	assert.ok(r.perdidas.otrasModeladasW >= 0); assert.equal(r.perdidas.variadoresW, 0);
	cerca(r.perdidas.totalModeladoW, r.perdidas.conductoresW + r.perdidas.transformadoresW
		+ r.perdidas.variadoresW + r.perdidas.otrasModeladasW);
});

test('potencia V7: VFD se cuenta en la entrada externa y su motor queda visible sin duplicarse', () => {
	const p = fixtureVfdMotorV6(); const memoria = memoriaVacia();
	const estado = { 's-run': { activo: true }, vfd: { valor: 10 } };
	const inicio = simular(p, estado, undefined, { ahora: 0, memoria });
	const marcha = simular(p, estado, inicio.activos, { ahora: 5000, memoria });
	const r = resumirPotenciaIngenieria({ proyecto: p, fisica: marcha.fisica });
	const externa = marcha.fisica.red.fuentes.get('fuente:red:0')!.potenciaEntregadaVA;
	cerca(r.totalTablero.pW, externa.re); cerca(r.totalTablero.qVar, externa.im);
	const ingenuo = [...marcha.fisica.red.fuentes.values()].reduce((s, x) => s + Math.max(0, x.potenciaEntregadaVA.re), 0);
	assert.ok(ingenuo > r.totalTablero.pW * 1.5, 'la suma ingenua debía duplicar salida VFD');
	const motor = r.porCircuito.find((x) => x.frontera === 'VFD_DOWNSTREAM');
	assert.ok(motor && motor.pW > 0 && !motor.incluidaEnTotalTablero);
	assert.ok(r.perdidas.variadoresW > 0);
	assert.ok(r.porTipoCarga.some((x) => x.tipo === 'motor' && x.frontera === 'VFD_DOWNSTREAM'));
});

test('potencia V7: transformador cuenta primario una vez y expone secundario como frontera interna', () => {
	const p = fixtureTransformadorV6(); const fisica = simularFisicaProyecto(p);
	const r = resumirPotenciaIngenieria({ proyecto: p, fisica });
	const externa = fisica.red.fuentes.get('fuente:red:0')!.potenciaEntregadaVA;
	cerca(r.totalTablero.pW, externa.re);
	const secundario = r.porCircuito.find((x) => x.frontera === 'TRANSFORMER_SECONDARY');
	assert.ok(secundario && secundario.pW > 0 && !secundario.incluidaEnTotalTablero);
	const t = fisica.red.transformadores.get('transformador:t1')!;
	assert.ok(r.totalTablero.pW < externa.re + t.potenciaSalidaVA.re);
});

test('potencia V7: reasignar fase exige marca, es temporal, determinista y no altera el proyecto', () => {
	const p = fixtureDesequilibrioV6(); const circuitos = descubrirCircuitos(p).circuitos;
	const c = circuitos.find((x) => x.cargas.includes('z1'))!;
	p.ingenieria = { version: 1, circuitos: { [c.id]: { version: 1, conductoresReasignablesFase: ['wl1'] } } };
	const antes = JSON.stringify(p);
	const a = compararReasignacionFase({ proyecto: p, circuitoId: c.id, conductorId: 'wl1', nuevaFase: 'L2' });
	const b = compararReasignacionFase({ proyecto: p, circuitoId: c.id, conductorId: 'wl1', nuevaFase: 'L2' });
	assert.equal(a.faseOriginal, 'L1'); assert.equal(a.faseAlternativa, 'L2'); assert.equal(a.proyectoModificado, false);
	assert.notEqual(a.deltaDesequilibrioCorrientePct, 0); assert.deepEqual(a, b); assert.equal(JSON.stringify(p), antes);
	const recargado = cargarProyecto(antes).proyecto;
	assert.deepEqual(recargado.ingenieria?.circuitos?.[c.id]?.conductoresReasignablesFase, ['wl1']);
	assert.deepEqual(compararReasignacionFase({ proyecto: recargado, circuitoId: c.id,
		conductorId: 'wl1', nuevaFase: 'L2' }), a);
	const noMarcado = structuredClone(p); noMarcado.ingenieria!.circuitos![c.id]!.conductoresReasignablesFase = [];
	assert.throws(() => compararReasignacionFase({ proyecto: noMarcado, circuitoId: c.id,
		conductorId: 'wl1', nuevaFase: 'L2' }), /CONDUCTOR_NO_REASIGNABLE/);
});

test('potencia V7: el orden de arrays no cambia agregados ni fronteras', () => {
	const p = fixtureDesequilibrioV6(); const a = resumirPotenciaIngenieria({ proyecto: p, fisica: simularFisicaProyecto(p) });
	const inverso = structuredClone(p); inverso.dispositivos.reverse(); inverso.conductores.reverse();
	const b = resumirPotenciaIngenieria({ proyecto: inverso, fisica: simularFisicaProyecto(inverso) });
	cerca(a.totalTablero.pW, b.totalTablero.pW); cerca(a.totalTablero.qVar, b.totalTablero.qVar);
	cerca(a.balances[0]!.corrienteNeutroA, b.balances[0]!.corrienteNeutroA);
	assert.deepEqual(a.porCircuito.map((x) => [x.circuitoId, x.frontera]), b.porCircuito.map((x) => [x.circuitoId, x.frontera]));
	assert.ok(magnitud(simularFisicaProyecto(p).trifasicos.get('red')!.corrienteNeutroA) > 0);
});
