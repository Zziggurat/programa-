/**
 * Tests de la apertura de archivos de proyecto.
 *
 * Un archivo a medio descargar, uno de otra aplicación o uno guardado con una versión más nueva
 * del programa tienen que dar un motivo entendible, no una pantalla en blanco. Y un archivo con
 * basura recuperable (un cable colgando, una colocación fantasma) tiene que abrirse limpio y
 * decir qué se arregló.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ArchivoInvalido, VERSION_FORMATO, cargarProyecto } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { Proyecto } from '../src/modelo/tipos.js';

/** Proyecto mínimo pero válido, tal como lo escribe el programa. */
function bueno(): Proyecto {
	const p = crearProyecto('Tablero de prueba');
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Hoja 1' }];
	p.gabinete = { ancho: 600, alto: 800, rieles: [], canaletas: [], colocaciones: [] };
	p.dispositivos = [{ id: 'q1', tipo: 'disyuntor', designacion: '-Q1', bornes: [{ id: '1', tipo: 'L' }] }];
	p.gabinete.colocaciones = [{ dispositivoId: 'q1', x: 20, y: 20, ancho: 18, alto: 85 }];
	return p;
}

const abrir = (p: unknown): ReturnType<typeof cargarProyecto> => cargarProyecto(JSON.stringify(p));

test('un proyecto bien formado se abre sin arreglos', () => {
	const r = abrir(bueno());
	assert.equal(r.arreglos.length, 0);
	assert.equal(r.proyecto.nombre, 'Tablero de prueba');
	assert.equal(r.proyecto.dispositivos.length, 1);
	assert.equal(r.proyecto.gabinete!.ancho, 600);
});

test('un JSON roto da un motivo, no una excepción cualquiera', () => {
	assert.throws(() => cargarProyecto('{"formato":"tablero-'), (e: Error) => {
		assert.ok(e instanceof ArchivoInvalido);
		assert.match(e.message, /JSON/i);
		return true;
	});
});

test('un archivo de otra aplicación se rechaza por su nombre', () => {
	assert.throws(() => abrir({ version: 1, gabinete: { ancho: 600, alto: 800 } }),
		(e: Error) => e instanceof ArchivoInvalido && /TableroStudio/.test(e.message));
});

test('un proyecto de una versión más nueva pide actualizar el programa', () => {
	const p = { ...bueno(), version: VERSION_FORMATO + 1 };
	assert.throws(() => abrir(p), (e: Error) => e instanceof ArchivoInvalido && /Actualiza/i.test(e.message));
});

test('sin gabinete no hay proyecto que abrir', () => {
	const p = bueno();
	delete (p as Partial<Proyecto>).gabinete;
	assert.throws(() => abrir(p), (e: Error) => e instanceof ArchivoInvalido && /gabinete/i.test(e.message));
});

test('un gabinete sin medidas válidas se rechaza en vez de abrir un armario de 0 mm', () => {
	const p = bueno();
	p.gabinete!.ancho = 0;
	assert.throws(() => abrir(p), (e: Error) => e instanceof ArchivoInvalido && /medidas/i.test(e.message));
});

test('un cable que apunta a un aparato inexistente se quita y se cuenta', () => {
	const p = bueno();
	p.conductores = [
		{ id: 'c1', de: { dispositivoId: 'q1', borneId: '1' }, a: { dispositivoId: 'fantasma', borneId: '2' } },
	];
	const r = abrir(p);
	assert.equal(r.proyecto.conductores.length, 0);
	assert.ok(r.arreglos.some((a) => /cable/i.test(a)), r.arreglos.join(' | '));
});

test('una colocación sin aparato deja de ocupar sitio en la placa', () => {
	const p = bueno();
	p.gabinete!.colocaciones.push({ dispositivoId: 'no-existe', x: 200, y: 20, ancho: 18, alto: 85 });
	const r = abrir(p);
	assert.equal(r.proyecto.gabinete!.colocaciones.length, 1);
	assert.ok(r.arreglos.some((a) => /colocaci/i.test(a)), r.arreglos.join(' | '));
});

test('los aparatos sin id o sin tipo y los duplicados se descartan', () => {
	const p = bueno() as unknown as Record<string, unknown>;
	p.dispositivos = [
		{ id: 'q1', tipo: 'disyuntor', bornes: [] },
		{ id: 'q1', tipo: 'disyuntor', bornes: [] },  // duplicado
		{ tipo: 'rele', bornes: [] },                 // sin id
		{ id: 'x9', bornes: [] },                     // sin tipo
	];
	const r = cargarProyecto(JSON.stringify(p));
	assert.equal(r.proyecto.dispositivos.length, 1);
	assert.ok(r.arreglos.some((a) => /aparato/i.test(a)), r.arreglos.join(' | '));
});

test('una lista corrupta no revienta la apertura: se vacía y se dice', () => {
	const p = bueno() as unknown as Record<string, unknown>;
	p.conductores = 'esto no es una lista';
	const r = cargarProyecto(JSON.stringify(p));
	assert.deepEqual(r.proyecto.conductores, []);
	assert.ok(r.arreglos.length > 0);
});

test('un proyecto sin hojas recibe una para que el esquema tenga dónde dibujarse', () => {
	const p = bueno();
	p.hojas = [];
	const r = abrir(p);
	assert.equal(r.proyecto.hojas.length, 1);
	assert.ok(r.arreglos.some((a) => /hoja/i.test(a)), r.arreglos.join(' | '));
});

test('un proyecto sin nombre no sale anónimo', () => {
	const p = bueno();
	p.nombre = '   ';
	assert.equal(abrir(p).proyecto.nombre, 'Tablero sin nombre');
});

test('los datos administrativos y las opciones sobreviven a la ida y vuelta', () => {
	const p = bueno();
	p.datos = { cliente: 'Minera Los Andes', revision: 'B' };
	p.opciones = { iccPresuntaKA: 10, montajeGabinete: 'empotrado' };
	const r = abrir(p);
	assert.equal(r.proyecto.datos!.cliente, 'Minera Los Andes');
	assert.equal(r.proyecto.opciones!.iccPresuntaKA, 10);
	assert.equal(r.proyecto.opciones!.montajeGabinete, 'empotrado');
});

test('el archivo abierto queda marcado con la versión de formato de este programa', () => {
	assert.equal(abrir(bueno()).proyecto.version, VERSION_FORMATO);
});
