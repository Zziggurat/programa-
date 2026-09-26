import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EJEMPLOS } from '../ejemplo/biblioteca.js';
import { aplicarPropuestaAltaCable, proponerAltaCable } from '../app/propuesta-alta-cable.js';
import { rutasDeCables } from '../app/escena3d.js';

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
	assert.ok(primera.longitudReferenciaMm > 0 && primera.puntos >= 2);
	assert.equal(primera.planesExistentesFijados, base.conductores.length,
		'la propuesta declara cuántas rutas legacy quedarán fijadas junto con el alta');
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
