import assert from 'node:assert/strict';
import test from 'node:test';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { adoptarRutasCalculadas, firmaRuteo, invalidarCacheRuteo, rutasDeCables,
	rutasVigentes } from '../app/escena3d.js';

test('M0/R1: solo se publican rutas de la misma firma y se conserva el recorrido exacto', () => {
	const p = crearProyecto('Ruteo en segundo plano');
	p.gabinete = { ancho: 400, alto: 400, rieles: [], canaletas: [], colocaciones: [
		{ dispositivoId: 'ps', x: 30, y: 40, ancho: 35, alto: 30 },
		{ dispositivoId: 'x1', x: 90, y: 40, ancho: 35, alto: 30 },
	] };
	p.dispositivos = [
		{ id: 'ps', tipo: 'fuente', bornes: [{ id: '+24' }, { id: '0V' }] },
		{ id: 'x1', tipo: 'bornero', bornes: [{ id: '1' }, { id: '2' }] },
	];
	p.conductores = [{ id: 'c1', de: { dispositivoId: 'ps', borneId: '+24' },
		a: { dispositivoId: 'x1', borneId: '1' } }];
	invalidarCacheRuteo();
	const firma = firmaRuteo(p);
	const rutas = structuredClone(rutasDeCables(p));
	assert.equal(rutas.length, 1);
	p.gabinete.colocaciones[1].x += 15;
	assert.notEqual(firmaRuteo(p), firma);
	assert.equal(adoptarRutasCalculadas(p, firma, rutas), false);
	assert.notDeepEqual(rutasDeCables(p), rutas, 'la colocación modificada no usa una respuesta vieja');
	p.gabinete.colocaciones[1].x -= 15;
	invalidarCacheRuteo();
	assert.equal(adoptarRutasCalculadas(p, firma, rutas), true);
	assert.deepEqual(rutasVigentes(), rutas);
	assert.equal(adoptarRutasCalculadas(p, firma, [...rutas, rutas[0]]), false,
		'IDs duplicados no pueden convertirse en geometría vigente');
	assert.equal(adoptarRutasCalculadas(p, firma, [{ ...rutas[0], radio: Number.NaN }]), false,
		'una geometría inválida no puede poblar la caché');
	invalidarCacheRuteo();
});

test('M0/R1: mover un pin de imagen invalida una respuesta asíncrona anterior', () => {
	const p = crearProyecto('Pin editable');
	p.gabinete = { ancho: 400, alto: 400, rieles: [], canaletas: [], colocaciones: [
		{ dispositivoId: 'img', x: 30, y: 40, ancho: 80, alto: 60 },
		{ dispositivoId: 'x1', x: 190, y: 40, ancho: 35, alto: 30 },
	] };
	p.dispositivos = [
		{ id: 'img', tipo: 'bornero', imagen: 'data:image/png;base64,AA==',
			bornes: [{ id: 'A', u: 0.2, v: 0.2 }] },
		{ id: 'x1', tipo: 'bornero', bornes: [{ id: '1' }] },
	];
	p.conductores = [{ id: 'c1', de: { dispositivoId: 'img', borneId: 'A' },
		a: { dispositivoId: 'x1', borneId: '1' } }];
	invalidarCacheRuteo();
	const firma = firmaRuteo(p);
	const rutas = structuredClone(rutasDeCables(p));
	p.dispositivos[0].bornes[0].u = 0.8;
	assert.notEqual(firmaRuteo(p), firma);
	assert.equal(adoptarRutasCalculadas(p, firma, rutas), false);
	assert.notDeepEqual(rutasDeCables(p), rutas);
	invalidarCacheRuteo();
});
