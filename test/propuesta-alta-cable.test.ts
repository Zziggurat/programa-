import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EJEMPLOS } from '../ejemplo/biblioteca.js';
import { longitudPlanRutaAutomaticaMm } from '../src/modelo/plan-ruta-automatica.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { aplicarPropuestaAltaCable, proponerAltaCable } from '../app/propuesta-alta-cable.js';
import { asignarPlanesAutomaticos, rutasAlternativasDeCable, rutasDeCables } from '../app/escena3d.js';
import { longitudCoincidenteFueraDeBornes3D } from '../app/colisiones-cables.js';

test('CAB-23: la propuesta de alta no modifica el tablero base y es reproducible', () => {
	const base = EJEMPLOS.find((e) => /arranque directo/i.test(e.titulo))!.crear();
	const original = JSON.stringify(base);
	const w4 = base.conductores.find((c) => c.id === 'w4')!;
	const nuevo = { id: 'propuesto', de: { ...w4.de }, a: { ...w4.a }, seccion: 6, color: 'negro' };
	const primera = proponerAltaCable(base, nuevo);
	const segunda = proponerAltaCable(base, nuevo);
	assert.equal(JSON.stringify(base), original, 'ni la captura de planes previos toca BASE');
	assert.deepEqual(primera.documento, segunda.documento);
	assert.equal(primera.documento.conductores.length, base.conductores.length + 1);
	assert.ok(primera.documento.conductores.find((c) => c.id === nuevo.id)?.planRutaAutomatica);
	assert.ok(primera.opciones.length >= 2, 'el caso debe ofrecer una ruta alternativa del mismo motor');
	assert.ok(primera.longitudReferenciaMm > 0 && primera.puntos >= 2);
	assert.equal(primera.longitudReferenciaMm, longitudPlanRutaAutomaticaMm(primera.opciones[0].plan));
	assert.ok(primera.opciones.every((opcion) => opcion.zMinMm <= opcion.zMaxMm));
	assert.equal(primera.planesExistentesFijados, base.conductores.length,
		'la propuesta declara cuántas rutas legacy quedarán fijadas junto con el alta');
	assert.deepEqual(primera.idsPlanesExistentesFijados, base.conductores.map((c) => c.id).sort(),
		'los cambios adicionales se enumeran por ID, sin depender del orden del array');
	assert.ok(base.conductores.every((c) => !c.planRutaAutomatica));
	assert.ok(rutasDeCables(primera.documento).some((r) => r.conductorId === nuevo.id));
	const aceptada = aplicarPropuestaAltaCable(base, primera);
	assert.deepEqual(aceptada, primera.documento);
	assert.notEqual(aceptada, primera.documento, 'aceptar entrega un documento independiente del borrador');
	assert.deepEqual(aplicarPropuestaAltaCable(base, primera), aceptada,
		'repetir la operación sobre la misma base es determinista y no duplica conexiones');
	assert.throws(() => aplicarPropuestaAltaCable(aceptada, primera), /cambió/,
		'una propuesta consumida no puede incorporar dos veces el mismo conductor');
	const otraBase = structuredClone(base);
	otraBase.nombre = 'Cambio mientras se revisa';
	assert.throws(() => aplicarPropuestaAltaCable(otraBase, primera), /cambió/,
		'cualquier cambio de BASE invalida la propuesta ya calculada');
	const segundaRuta = aplicarPropuestaAltaCable(base, primera, 1);
	assert.notDeepEqual(segundaRuta.conductores.find((c) => c.id === nuevo.id)?.planRutaAutomatica?.puntosXYZ,
		aceptada.conductores.find((c) => c.id === nuevo.id)?.planRutaAutomatica?.puntosXYZ);
	assert.deepEqual(rutasDeCables(segundaRuta).find((r) => r.conductorId === nuevo.id)?.puntos,
		primera.opciones[1].plan.puntosXYZ.reduce<{ x: number; y: number; z: number }[]>((puntos, valor, i, serie) => {
			if (i % 3 === 0) puntos.push({ x: valor, y: serie[i + 1], z: serie[i + 2] });
			return puntos;
		}, []), 'la segunda opción aceptada debe ser exactamente la ruta que se dibujará');
	const reabierto = cargarProyecto(JSON.stringify(segundaRuta)).proyecto;
	assert.deepEqual(reabierto.conductores.find((c) => c.id === nuevo.id)?.planRutaAutomatica,
		primera.opciones[1].plan, 'la opción elegida sobrevive a guardar y cargar sin recalcularse');
	assert.throws(() => aplicarPropuestaAltaCable(base, primera, 99), /no pertenece/);
	assert.equal(JSON.stringify(base), original, 'cancelar sigue dejando BASE y el historial intactos');
});

test('CAB-23: las altas densas avisan del contacto sin alterar rutas aceptadas', () => {
	let base = EJEMPLOS.find((e) => /arranque directo/i.test(e.titulo))!.crear();
	const w4 = base.conductores.find((c) => c.id === 'w4')!;
	let totalAvisos = 0;
	for (let i = 0; i < 4; i++) {
		const anterior = JSON.stringify(base);
		const rutasAnteriores = new Map(rutasDeCables(base).map((r) => [r.conductorId, r.puntos]));
		const propuesta = proponerAltaCable(base, {
			id: `paralelo-${i + 1}`, de: { ...w4.de }, a: { ...w4.a }, seccion: 2.5,
		});
		assert.equal(JSON.stringify(base), anterior);
		const actuales = new Map(rutasDeCables(propuesta.documento).map((r) => [r.conductorId, r.puntos]));
		for (const [id, puntos] of rutasAnteriores) assert.deepEqual(actuales.get(id), puntos);
		totalAvisos += propuesta.contactos;
		base = propuesta.documento;
	}
	assert.ok(totalAvisos > 0, 'el preview no silencia los contactos que ya detecta la geometría');
});

test('CAB-23: otra opción del mismo router es físicamente distinta y no redistribuye planes', () => {
	const base = EJEMPLOS.find((e) => /arranque directo/i.test(e.titulo))!.crear();
	assert.equal(asignarPlanesAutomaticos(base), base.conductores.length);
	const planes = new Map(base.conductores.map((c) => [c.id, JSON.stringify(c.planRutaAutomatica)]));
	const w4 = base.conductores.find((c) => c.id === 'w4')!;
	base.conductores.push({ id: 'alternativo', de: { ...w4.de }, a: { ...w4.a }, seccion: 6 });
	const propuestas = rutasAlternativasDeCable(base, 'alternativo', 2);
	assert.equal(propuestas.length, 2, 'el fixture debe ofrecer dos geometrías reales');
	assert.deepEqual(propuestas[0].puntos, rutasDeCables(base).find((r) => r.conductorId === 'alternativo')?.puntos);
	assert.notDeepEqual(propuestas[1].puntos, propuestas[0].puntos);
	assert.ok(propuestas.every((r) => r.puntos.length >= 2));
	const trazo = (indice: number) => ({ id: `opcion-${indice}`, radio: propuestas[indice].radio,
		puntos: propuestas[indice].puntos, bornes: ['origen', 'destino'] as [string, string],
		extremos: [propuestas[indice].de, propuestas[indice].a] as [typeof propuestas[number]['de'], typeof propuestas[number]['a']] });
	assert.ok(longitudCoincidenteFueraDeBornes3D(trazo(0), trazo(1)) < 20,
		'la segunda opción no debe ser la primera ruta con otra discretización');
	assert.ok(base.conductores.filter((c) => c.id !== 'alternativo')
		.every((c) => JSON.stringify(c.planRutaAutomatica) === planes.get(c.id)));
	const invertido = structuredClone(base);
	invertido.conductores.reverse();
	assert.deepEqual(rutasAlternativasDeCable(invertido, 'alternativo', 2)
		.map((r) => r.puntos), propuestas.map((r) => r.puntos));
	assert.throws(() => rutasAlternativasDeCable(base, 'w4', 2), /no admite/,
		'un plan aceptado no es candidato para cambiar de carril en una nueva alta');
});
