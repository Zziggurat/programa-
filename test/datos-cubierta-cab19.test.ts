import assert from 'node:assert/strict';
import test from 'node:test';
import { EJEMPLOS } from '../ejemplo/biblioteca.js';
import { asignarPlanesAutomaticos, invalidarCacheRuteo, prepararAsignacionPlanesAutomaticos,
	radioDeCable, rutasDeCables } from '../app/escena3d.js';
import { areaConductorAisladoMm2, areaExteriorConductorMm2 } from '../src/motores/electrico.js';
import { idsDePlanesObsoletos } from '../src/modelo/dependencias-ruta.js';
import { ArchivoInvalido, cargarProyecto } from '../src/modelo/cargar.js';
import { revisarTablero } from '../src/motores/revision.js';
import { rutearConductores } from '../src/motores/ruteo.js';

test('CAB-19: diámetro exterior y radio mínimo se conservan, sin derivarlos de la sección', () => {
	const p = EJEMPLOS.find((e) => /arranque directo/i.test(e.titulo))!.crear();
	p.version = 4;
	const colocados = new Set(p.gabinete?.colocaciones.map((x) => x.dispositivoId));
	const c = p.conductores.find((x) => colocados.has(x.de.dispositivoId)
		&& colocados.has(x.a.dispositivoId))!;
	delete c.trazado;
	c.rutaFisica = { version: 2, modo: 'MANUAL', marco: 'PLACA', geometria: 'ARCO_CIRCULAR',
		radioMm: 8, nodos: [{ id: 'n1', x: 150, y: 180, z: 30 }] };
	c.fisica = { diametroExteriorMm: 6, radioMinimoCurvaturaMm: 10 };
	const avisos = revisarTablero(p).hallazgos.filter((h) => h.regla === 'R18-radio-manual-inferior');
	assert.deepEqual(avisos.map((h) => h.conductorId), [c.id]);
	const restaurado = cargarProyecto(JSON.stringify(p)).proyecto;
	const copia = restaurado.conductores.find((x) => x.id === c.id)!;
	assert.equal(copia.fisica?.diametroExteriorMm, 6);
	assert.equal(copia.fisica?.radioMinimoCurvaturaMm, 10);
	assert.equal(revisarTablero(restaurado).hallazgos.filter((h) => h.regla === 'R18-radio-manual-inferior').length, 1);
	assert.equal(c.seccion, copia.seccion, 'los datos de cubierta no alteran la sección');
	c.rutaFisica.radioMm = 12;
	assert.equal(revisarTablero(p).hallazgos.filter((h) => h.regla === 'R18-radio-manual-inferior').length, 0,
		'la comparación solo detecta un radio nominal menor; no certifica los demás codos');
});

test('CAB-19: datos de cubierta hostiles no se sustituyen por una estimación', () => {
	const p = EJEMPLOS.find((e) => /arranque directo/i.test(e.titulo))!.crear();
	p.version = 4;
	p.conductores[0].fisica = { diametroExteriorMm: 6, radioMinimoCurvaturaMm: 10 };
	for (const [campo, valor] of [
		['diametroExteriorMm', 0], ['diametroExteriorMm', 201], ['diametroExteriorMm', '6'],
		['radioMinimoCurvaturaMm', -1], ['radioMinimoCurvaturaMm', 5001],
	] as const) {
		const hostil = structuredClone(p);
		(hostil.conductores[0].fisica as unknown as Record<string, unknown>)[campo] = valor;
		assert.throws(() => cargarProyecto(JSON.stringify(hostil)), ArchivoInvalido, `${campo}=${valor}`);
	}
});

test('CAB-19: diámetro declarado cambia tubo e índice provisional, e invalida solo su plan V4', () => {
	const p = EJEMPLOS.find((e) => /arranque directo/i.test(e.titulo))!.crear();
	p.version = 4;
	const c = p.conductores.find((x) => x.id === 'w4')!;
	assert.equal(asignarPlanesAutomaticos(p, prepararAsignacionPlanesAutomaticos(p, new Set([c.id]))), 1);
	assert.equal(idsDePlanesObsoletos(p).includes(c.id), false);
	const anterior = rutearConductores(p);
	const usadas = anterior.rutas.find((r) => r.conductorId === c.id)!.canaletasUsadas;
	assert.ok(usadas.length > 0);
	const radioLegacy = radioDeCable(c.seccion);
	const areaLegacy = areaConductorAisladoMm2(c.seccion ?? 1.5);
	c.fisica = { diametroExteriorMm: 6 };
	assert.equal(radioDeCable(c.seccion, c.fisica.diametroExteriorMm), 3);
	assert.notEqual(radioLegacy, 3);
	assert.deepEqual(idsDePlanesObsoletos(p), [c.id], 'no se dibuja el plan con un grosor cambiado');
	const nuevo = rutearConductores(p);
	for (const id of usadas) {
		const viejo = anterior.ocupaciones.find((o) => o.canaletaId === id)!;
		const actual = nuevo.ocupaciones.find((o) => o.canaletaId === id)!;
		assert.ok(Math.abs(actual.seccionOcupadaMm2 - viejo.seccionOcupadaMm2
			- (areaExteriorConductorMm2(6) - areaLegacy)) < 1e-8);
		assert.equal(actual.diametrosDeclarados, (viejo.diametrosDeclarados ?? 0) + 1);
		assert.equal(actual.diametrosEstimados, (viejo.diametrosEstimados ?? 0) - 1);
	}
});

test('CAB-19: editar diámetro invalida la caché de malla/ruteo sin cambiar la identidad', () => {
	const p = EJEMPLOS.find((e) => /arranque directo/i.test(e.titulo))!.crear();
	const c = p.conductores.find((x) => x.id === 'w4')!;
	invalidarCacheRuteo();
	const previo = rutasDeCables(p).find((r) => r.conductorId === c.id)!;
	c.fisica = { diametroExteriorMm: 6 };
	const siguiente = rutasDeCables(p).find((r) => r.conductorId === c.id)!;
	assert.notEqual(previo, siguiente, 'una caché vieja no puede esconder el diámetro nuevo');
	assert.equal(siguiente.radio, 3);
	assert.equal(c.id, 'w4');
});
