import assert from 'node:assert/strict';
import test from 'node:test';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { EJEMPLOS } from '../ejemplo/biblioteca.js';
import { proyectoParaRuteo } from '../app/proyecto-ruteo.js';
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

test('M0/R1: el mensaje mínimo reproduce rutas principales y la puerta', () => {
	const puerta = EJEMPLOS.find((e) => e.id === 'fixture-puerta');
	assert.ok(puerta);
	for (const ejemplo of [...EJEMPLOS.slice(0, 5), puerta]) {
		const proyecto = ejemplo.crear();
		const mensaje = structuredClone(proyectoParaRuteo(proyecto));
		assert.equal(firmaRuteo(mensaje), firmaRuteo(proyecto), ejemplo.titulo);
		invalidarCacheRuteo();
		const rutasOriginales = structuredClone(rutasDeCables(proyecto));
		invalidarCacheRuteo();
		assert.deepEqual(rutasDeCables(mensaje), rutasOriginales, ejemplo.titulo);
	}
	invalidarCacheRuteo();
});

test('M0/R1: una fotografía grande no se copia al Worker ni altera el pin personalizado', () => {
	const p = crearProyecto('Fotografía local');
	p.gabinete = { ancho: 400, alto: 400, rieles: [], canaletas: [], colocaciones: [
		{ dispositivoId: 'img', x: 30, y: 40, ancho: 80, alto: 60 },
		{ dispositivoId: 'x1', x: 190, y: 40, ancho: 35, alto: 30 },
	] };
	p.dispositivos = [
		{ id: 'img', tipo: 'bornero', imagen: `data:image/png;base64,${'A'.repeat(4_000_000)}`,
			componentePersonalizado: { definicionId: 'plantilla-1', revision: 2 }, profundidad: 19,
			bornes: [{ id: 'A', u: 0.8, v: 0.2 }] },
		{ id: 'x1', tipo: 'bornero', bornes: [{ id: '1' }] },
	];
	p.conductores = [{ id: 'c1', de: { dispositivoId: 'img', borneId: 'A' },
		a: { dispositivoId: 'x1', borneId: '1' } }];
	const mensaje = proyectoParaRuteo(p);
	assert.ok(JSON.stringify(mensaje).length < JSON.stringify(p).length / 100);
	assert.equal(firmaRuteo(mensaje), firmaRuteo(p));
	invalidarCacheRuteo();
	const ruta = structuredClone(rutasDeCables(p));
	invalidarCacheRuteo();
	assert.deepEqual(rutasDeCables(structuredClone(mensaje)), ruta);
	assert.equal(p.dispositivos[0].imagen?.length, 4_000_022, 'el documento de usuario no se modifica');
	invalidarCacheRuteo();
});
