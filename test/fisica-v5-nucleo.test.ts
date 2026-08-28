import assert from 'node:assert/strict';
import test from 'node:test';
import { resolverSistemaComplejo } from '../src/fisica/algebra.js';
import {
	casiIgual, complejo, conjugado, dividir, faseDeg, magnitud, multiplicar, sumar,
} from '../src/fisica/complejos.js';
import { calcularConductorFisico } from '../src/fisica/conductores.js';
import { leerFisicaConductor, leerFisicaDispositivo } from '../src/modelo/fisica.js';

const cerca = (actual: number, esperado: number, tol = 1e-9) =>
	assert.ok(Math.abs(actual - esperado) <= tol * Math.max(1, Math.abs(esperado)), `${actual} != ${esperado}`);

test('V5 complejos: suma, producto, division, conjugado, magnitud y fase', () => {
	assert.deepEqual(sumar(complejo(1, 2), complejo(3, -1)), complejo(4, 1));
	assert.deepEqual(multiplicar(complejo(1, 2), complejo(3, -1)), complejo(5, 5));
	assert.ok(casiIgual(dividir(complejo(1, 2), complejo(3, -1)), complejo(0.1, 0.7)));
	assert.deepEqual(conjugado(complejo(1, 2)), complejo(1, -2));
	cerca(magnitud(complejo(3, 4)), 5);
	cerca(faseDeg(complejo(0, 2)), 90);
});

test('V5 algebra: resuelve un sistema complejo conocido', () => {
	// x + y = 3+j; 2x-y = 0+j2 => x=1+j, y=2
	const [x, y] = resolverSistemaComplejo(
		[[complejo(1), complejo(1)], [complejo(2), complejo(-1)]],
		[complejo(3, 1), complejo(0, 2)],
	);
	assert.ok(casiIgual(x, complejo(1, 1)));
	assert.ok(casiIgual(y, complejo(2, 0)));
});

test('V5 conductor: longitud, seccion y temperatura respetan invariantes', () => {
	const base = calcularConductorFisico({ seccionMm2: 2.5, longitud: { metros: 10, origen: 'CONFIGURADO' } });
	const largo = calcularConductorFisico({ seccionMm2: 2.5, longitud: { metros: 20, origen: 'CONFIGURADO' } });
	const grueso = calcularConductorFisico({ seccionMm2: 5, longitud: { metros: 10, origen: 'CONFIGURADO' } });
	const caliente = calcularConductorFisico({
		seccionMm2: 2.5, longitud: { metros: 10, origen: 'CONFIGURADO' }, config: { temperaturaC: 70 },
	});
	cerca(largo.rOhm, base.rOhm * 2);
	cerca(grueso.rOhm, base.rOhm / 2);
	assert.ok(caliente.rOhm > base.rOhm);
	assert.equal(base.origenReactancia, 'NO_MODELADO');
});

test('V5 conductor: cobre, aluminio, reactancia y longitud cero son explicitos', () => {
	const cu = calcularConductorFisico({ seccionMm2: 2.5, longitud: { metros: 10, origen: 'CALCULADO' } });
	const al = calcularConductorFisico({
		seccionMm2: 2.5, longitud: { metros: 10, origen: 'CALCULADO' }, config: { material: 'ALUMINIO', xOhmPorKm: 0.08 },
	});
	assert.ok(al.rOhm > cu.rOhm);
	cerca(al.xOhm, 0.0008);
	const cero = calcularConductorFisico({ seccionMm2: 2.5, longitud: { metros: 0, origen: 'NO_MODELADO' } });
	assert.deepEqual(cero.zOhm, complejo(0, 0));
});

test('V5 conductor: rechaza seccion invalida y numeros no finitos', () => {
	for (const seccionMm2 of [0, -1, NaN, Infinity]) {
		assert.throws(() => calcularConductorFisico({ seccionMm2, longitud: { metros: 1, origen: 'CONFIGURADO' } }));
	}
	assert.throws(() => calcularConductorFisico({ seccionMm2: 1.5, longitud: { metros: NaN, origen: 'CONFIGURADO' } }));
});

test('V5 persistencia: la lista blanca acepta perfiles fisicos validos y rechaza basura', () => {
	assert.deepEqual(leerFisicaConductor({ material: 'COBRE', longitudManualM: 12, temperaturaC: 40 }),
		{ material: 'COBRE', longitudManualM: 12, temperaturaC: 40, xOhmPorKm: undefined, materialPersonalizado: undefined });
	assert.equal(leerFisicaConductor({ material: 'PERSONALIZADO', rho20OhmM: 'cobre' }), undefined);
	const fisica = leerFisicaDispositivo({ version: 1, fuente: {
		sistema: 'AC_MONOFASICA', tensionNominalV: 230, referencia: 'N', fases: [{ borne: 'L', fase: 'L' }], rOhm: 0.1,
	} });
	assert.equal(fisica?.fuente?.tensionNominalV, 230);
	assert.equal(leerFisicaDispositivo({ version: 2, fuente: {} }), undefined);
});
