import assert from 'node:assert/strict';
import test from 'node:test';
import { calcularPlacaMotor } from '../src/fisica/motores.js';
import { fixtureMotorTrifasicoV5 } from '../ejemplo/fixtures-fisica-v5.js';
import { actualizarProteccionesRuntime, memoriaVacia, simular, type EstadoTablero } from '../src/motores/simulacion.js';
import type { ConfiguracionMotorFisico } from '../src/modelo/fisica.js';
import { cargarProyecto } from '../src/modelo/cargar.js';

const placa = (cambios: Partial<ConfiguracionMotorFisico> = {}): ConfiguracionMotorFisico => ({
	potenciaMecanicaNominalW: 5500, tensionNominalV: 400, frecuenciaHz: 50, fases: 3,
	eficiencia: 0.9, factorPotencia: 0.85, rpmNominal: 1450, polos: 4,
	corrienteArranqueMultiplo: 6, tiempoArranqueS: 2, umbralSubtension: 0.85, ...cambios,
});

function fixtureMotor() {
	const p = fixtureMotorTrifasicoV5(); const m = p.dispositivos.find((d) => d.id === 'm1')!;
	m.fisica = { version: 1, motor: placa() };
	return p;
}

test('V6 motor: placa deriva Pin, In, Q, síncronas y slip sin reemplazar In configurada', () => {
	const base = calcularPlacaMotor(placa());
	const menorEta = calcularPlacaMotor(placa({ eficiencia: 0.8 }));
	const menorPf = calcularPlacaMotor(placa({ factorPotencia: 0.7 }));
	const menorV = calcularPlacaMotor(placa({ tensionNominalV: 380 }));
	assert.ok(menorEta.potenciaEntradaNominalW > base.potenciaEntradaNominalW);
	assert.ok(menorPf.corrienteNominalCalculadaA > base.corrienteNominalCalculadaA);
	assert.ok(menorV.corrienteNominalCalculadaA > base.corrienteNominalCalculadaA);
	assert.equal(base.rpmSincronas, 1500);
	assert.ok((base.deslizamiento ?? 0) > 0.03 && (base.deslizamiento ?? 1) < 0.04);
	const declarada = calcularPlacaMotor(placa({ corrienteNominalA: 20 }));
	assert.equal(declarada.corrienteNominalUsadaA, 20);
	assert.ok(declarada.diagnosticos.some((d) => d.codigo === 'CORRIENTE_NOMINAL_INCONSISTENTE'));
	assert.ok(calcularPlacaMotor(placa({ eficiencia: 1.2 })).diagnosticos.some((d) => d.codigo === 'EFICIENCIA_INVALIDA'));
});

test('V6 motor: arranque físico carga la red y avanza una sola vez por Δt', () => {
	const p = fixtureMotor(); const memoria = memoriaVacia(); const estado = { 's-run': { activo: true } };
	const r0 = simular(p, estado, undefined, { ahora: 0, memoria });
	const m0 = r0.fisica.motores.get('m1')!;
	assert.equal(r0.motores[0].estado, 'arrancando');
	assert.ok(m0.corrienteA > m0.corrienteNominalUsadaA * 5.5);
	const r1 = simular(p, estado, r0.activos, { ahora: 1000, memoria });
	const progreso = r1.motores[0].progresoArranque; const rpm = r1.motores[0].rpmEstimada!;
	assert.ok(progreso > 0.49 && progreso < 0.51);
	assert.ok(rpm > 700 && rpm < 750);
	assert.ok(r1.fisica.motores.get('m1')!.corrienteA < m0.corrienteA);
	const repetido = simular(p, estado, r1.activos, { ahora: 1000, memoria });
	assert.equal(repetido.motores[0].progresoArranque, progreso);
	assert.equal(repetido.motores[0].rpmEstimada, rpm);
	const marcha = simular(p, estado, repetido.activos, { ahora: 2000, memoria });
	assert.equal(marcha.motores[0].estado, 'marcha');
	assert.ok(Math.abs(marcha.fisica.motores.get('m1')!.potenciaEntradaW - 5500 / 0.9) / (5500 / 0.9) < 0.04);
});

test('V6 motor: rotor bloqueado produce 0 rpm, corriente elevada y potencia mecánica nula', () => {
	const p = fixtureMotor(); const memoria = memoriaVacia(); const estado: EstadoTablero = {
		's-run': { activo: true }, m1: { fallos: ['motor-bloqueado'] },
	};
	const r = simular(p, estado, undefined, { ahora: 1000, memoria }); const m = r.fisica.motores.get('m1')!;
	assert.equal(r.motores[0].motivoFalla, 'motor-bloqueado');
	assert.equal(m.rpm, 0); assert.equal(m.potenciaMecanicaEstimadaW, 0);
	assert.ok(m.corrienteA > m.corrienteNominalUsadaA * 5.5);
	assert.ok(m.diagnosticos.some((d) => d.codigo === 'ROTOR_BLOQUEADO'));
});

test('V6 motor: corriente física de rotor bloqueado alimenta la protección aguas arriba', () => {
	const p = fixtureMotor(); const memoria = memoriaVacia(); const estado: EstadoTablero = {
		's-run': { activo: true }, m1: { fallos: ['motor-bloqueado'] },
	};
	const r = simular(p, estado, undefined, { ahora: 0, memoria });
	const q = r.fisica.protecciones.get('q1')!;
	assert.ok(q.corrienteA > 50);
	assert.equal(q.evaluacion.region, 'TERMICA');
	const segundos = q.evaluacion.tMaxS!;
	actualizarProteccionesRuntime(p, estado, r, 0, memoria);
	const disparo = actualizarProteccionesRuntime(p, estado, r, segundos * 1000, memoria);
	assert.equal(disparo.estado.q1.disparado, true);
	assert.equal(disparo.eventos[0].causa, 'sobrecarga');
});

test('V6 motor: fase abierta real se detecta desde topología y contacto resistivo concentra pérdidas', () => {
	const p = fixtureMotor(); const memoria = memoriaVacia();
	const abierto: EstadoTablero = { 's-run': { activo: true }, m1: { fallasFisicas: [{
		id: 'fase-abierta', tipo: 'CONDUCTOR_ABIERTO', ramaId: 'conductor:w-k-m2',
	}] } };
	const r = simular(p, abierto, undefined, { ahora: 3000, memoria });
	assert.equal(r.motores[0].motivoFalla, 'perdida-fase');
	assert.ok(r.fisica.motores.get('m1')!.diagnosticos.some((d) => d.codigo === 'PERDIDA_FASE'));
	const resistivo = simular(p, { 's-run': { activo: true }, km1: { fallasFisicas: [{
		id: 'contacto-r', tipo: 'RESISTENCIA_ANORMAL', ramaId: 'interno:km1:1', resistenciaAdicionalOhm: 5,
	}] } }, undefined, { ahora: 3000, memoria: memoriaVacia() });
	assert.ok((resistivo.fisica.red.ramas.get('interno:km1:1')?.perdidaW ?? 0) > 1);
	assert.ok(resistivo.fisica.motores.get('m1')!.tensionV < 400);
});

test('V6 motor: placa persiste pero magnitudes y estado no contaminan el proyecto', () => {
	const p = fixtureMotor(); const texto = JSON.stringify(p); const cargado = cargarProyecto(texto).proyecto;
	assert.equal(cargado.dispositivos.find((d) => d.id === 'm1')?.fisica?.motor?.rpmNominal, 1450);
	assert.doesNotMatch(texto, /potenciaEntradaW|progresoArranque|corrienteNominalCalculadaA/);
});
