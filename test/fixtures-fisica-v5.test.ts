import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureCaidaTensionV5, fixtureMotorTrifasicoV5, fixtureSelectividadV5 } from '../ejemplo/fixtures-fisica-v5.js';
import { fixtureInstrumentacionV3 } from '../ejemplo/fixtures-simulacion-v3.js';
import { faseDeg, magnitud } from '../src/fisica/complejos.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { simular } from '../src/motores/simulacion.js';

const cerca = (actual: number, esperado: number, tolerancia = 1e-3) =>
	assert.ok(Math.abs(actual - esperado) <= tolerancia * Math.max(1, Math.abs(esperado)), `${actual} != ${esperado}`);

test('fixture V5 caida: publica corriente, caida, perdidas y balance calculables', () => {
	const r = simular(fixtureCaidaTensionV5());
	assert.equal(r.fisica.activo, true);
	assert.equal(r.fisica.red.metricas.convergio, true);
	assert.ok(r.fisica.conductores.get('w-fase-carga')!.corrienteA > 9);
	assert.ok(r.fisica.conductores.get('w-fase-carga')!.caidaV > 0.5);
	assert.ok(r.fisica.red.potenciaPerdidasW > 10);
	assert.ok(Math.abs(r.fisica.red.metricas.errorBalanceW) < 0.1);
});

test('fixture V5 caida: ajustes runtime cambian tendencias sin mutar el diseno persistente', () => {
	const p = fixtureCaidaTensionV5();
	const normal = simular(p).fisica.conductores.get('w-fase-carga')!;
	const largo = simular(p, { '@fisica:w-fase-carga': { ajustesFisicos: { longitudM: 40 } } })
		.fisica.conductores.get('w-fase-carga')!;
	const grueso = simular(p, { '@fisica:w-fase-carga': { ajustesFisicos: { seccionMm2: 5 } } })
		.fisica.conductores.get('w-fase-carga')!;
	assert.ok(largo.rOhm > normal.rOhm && largo.caidaV > normal.caidaV);
	assert.ok(grueso.rOhm < normal.rOhm && grueso.caidaV < normal.caidaV);
	assert.equal(largo.origenLongitud, 'INYECTADO');
	assert.equal(grueso.origenSeccion, 'INYECTADO');
	assert.equal(p.conductores.find((c) => c.id === 'w-fase-carga')!.fisica?.longitudManualM, 20);
	assert.equal(p.conductores.find((c) => c.id === 'w-fase-carga')!.seccion, 2.5);
});

test('fixture V5 trifasico: el contactor funcional gobierna una carga PQ fisica balanceada', () => {
	const p = fixtureMotorTrifasicoV5();
	const abierto = simular(p);
	assert.equal(abierto.fisica.red.cargas.get('carga:m1:0')!.origen, 'NO_MODELADO');
	const r = simular(p, { 's-run': { activo: true } });
	assert.ok(r.activos.has('km1'));
	const fases = ['red::L1', 'red::L2', 'red::L3'];
	const angulos = fases.map((id) => faseDeg(r.fisica.red.nodos.get(id)!.tensionV!));
	cerca(angulos[0], 0, 0.01); cerca(angulos[1], -120); cerca(angulos[2], 120);
	const cargas = [0, 1, 2].map((i) => r.fisica.red.cargas.get(`carga:m1:${i}`)!);
	for (const carga of cargas) assert.ok(magnitud(carga.corrienteA) > 8);
	const pW = cargas.reduce((s, c) => s + c.potenciaVA.re, 0);
	const qVar = cargas.reduce((s, c) => s + c.potenciaVA.im, 0);
	assert.ok(pW > 5_300 && pW < 5_600);
	assert.ok(qVar > 2_500 && qVar < 2_800);
	cerca(pW / Math.hypot(pW, qVar), 0.9, 0.01);
});

test('fixture V5 selectividad: la falla usa Z real y explica ambas protecciones', () => {
	const p = fixtureSelectividadV5();
	const r = simular(p, { z1: { fallasFisicas: [{ id: 'cc-z1', tipo: 'L_N', nodoA: 'z1::L', nodoB: 'z1::N' }] } });
	const falla = r.fisica.fallas[0];
	assert.ok(falla.iccA && magnitud(falla.iccA) > 100);
	assert.equal(falla.origen, 'CALCULADO');
	assert.ok(r.fisica.protecciones.get('q1')!.fallas.includes('cc-z1'));
	assert.ok(r.fisica.protecciones.get('q2')!.fallas.includes('cc-z1'));
	assert.equal(r.fisica.selectividad.length, 1);
	assert.match(r.fisica.selectividad[0].explicacion, /ventana|bandas|proteccion/i);
	const tierra = simular(fixtureSelectividadV5(), { z1: { fallasFisicas: [{
		id: 'cc-pe-z1', tipo: 'L_PE', nodoA: 'z1::L', nodoB: 'z1::PE',
	}] } });
	assert.ok(tierra.fisica.fallas[0].iccA && magnitud(tierra.fisica.fallas[0].iccA!) > 100);
	assert.ok(tierra.fisica.red.ramas.has('referencia-pe:red'));
});

test('fixture V3 reutilizado: el lazo 4-20 publica carga fisica y conserva 12 mA a 50 C', () => {
	const r = simular(fixtureInstrumentacionV3(), { tt1: { valor: 50 } });
	const ai = r.entradasAnalogicas.find((entrada) => entrada.dispositivoId === 'plc1' && entrada.borne === 'AI1')!;
	assert.equal(ai.senal.calidad, 'normal');
	cerca(ai.senal.valorElectrico!, 12, 1e-4);
	assert.equal(ai.fisica?.tipo, '4_20_MA');
	assert.equal(ai.fisica?.burdenOhm, 250);
	assert.ok((ai.fisica?.resistenciaCableOhm ?? 0) > 0);
});

test('fixture V3 reutilizado: aumentar burden por UI runtime rompe compliance sin mutar el proyecto', () => {
	const p = fixtureInstrumentacionV3();
	const r = simular(p, { tt1: { valor: 100 }, '@fisica:analog:plc1': { ajustesAnalogicos: { burdenOhm: 1000 } } });
	const ai = r.entradasAnalogicas.find((entrada) => entrada.dispositivoId === 'plc1' && entrada.borne === 'AI1')!;
	assert.equal(ai.senal.calidad, 'compliance-insuficiente');
	assert.ok((ai.senal.valorElectrico ?? 20) < 20);
	assert.equal(p.dispositivos.find((d) => d.id === 'plc1')!.fisica?.analogica?.burdenOhm, 250);
});

test('V5 persistencia: configuracion fisica sobrevive guardar/cargar y los resultados runtime no se serializan', () => {
	const original = fixtureSelectividadV5();
	const texto = JSON.stringify(original);
	assert.doesNotMatch(texto, /iccA|potenciaFuentesW|tensionTerminalV/);
	const cargado = cargarProyecto(texto).proyecto;
	assert.equal(cargado.dispositivos.find((d) => d.id === 'red')!.fisica?.fuente?.rOhm, 0.5);
	assert.equal(cargado.dispositivos.find((d) => d.id === 'red')!.fisica?.fuente?.referenciaPe, 'PE');
	assert.equal(cargado.dispositivos.find((d) => d.id === 'red')!.fisica?.fuente?.sistema, 'AC_MONOFASICA');
	assert.equal(cargado.conductores.find((c) => c.id === 'w-q1-q2')!.fisica?.material, 'COBRE');
	assert.equal(cargado.conductores.find((c) => c.id === 'w-q1-q2')!.fisica?.longitudManualM, 10);
	const r = simular(cargado);
	assert.equal(r.fisica.red.metricas.convergio, true);
});

test('V5 componente personalizado: imagen no cambia conductor, carga ni proteccion fisicos', () => {
	const nativo = fixtureCaidaTensionV5();
	const importado = fixtureCaidaTensionV5();
	for (const d of importado.dispositivos) if (d.id === 'q1' || d.id === 'r1') {
		d.tipo = 'otro'; d.imagen = 'asset://sha256/imagen-no-ejecutable';
	}
	const a = simular(nativo); const b = simular(importado);
	cerca(a.fisica.conductores.get('w-fase-carga')!.corrienteA, b.fisica.conductores.get('w-fase-carga')!.corrienteA);
	cerca(a.fisica.red.cargas.get('carga:r1:0')!.potenciaVA.re, b.fisica.red.cargas.get('carga:r1:0')!.potenciaVA.re);
	assert.equal(b.fisica.protecciones.get('q1')!.evaluacion.region, a.fisica.protecciones.get('q1')!.evaluacion.region);
});
