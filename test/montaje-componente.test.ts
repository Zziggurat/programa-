import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buscarColocacionPlaca, evaluarCompatibilidadMontaje, leerMontajeDeclarado,
	validarMontajeDeclarado } from '../src/componentes/montaje.js';
import { instanciarComponentePersonalizado, validarDefinicionComponente,
	type DefinicionComponentePersonalizado } from '../src/componentes/personalizados.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import type { Gabinete, MontajeComponente } from '../src/modelo/tipos.js';

const dimensiones = { anchoMm: 40, altoMm: 50, fondoMm: 30 };
const definicion = (montaje?: MontajeComponente): DefinicionComponentePersonalizado => ({
	formato: 'tablero-studio-componente', version: 1, id: 'cmp-mecanico', revision: 1,
	nombre: 'Equipo de placa', creadoEn: '2026-09-22T00:00:00.000Z',
	modificadoEn: '2026-09-22T00:00:00.000Z', tipoDispositivo: 'piloto',
	dimensiones, montaje, assetId: `sha256:${'a'.repeat(64)}`, terminales: [],
	comportamiento: { version: 1, clase: 'sin-comportamiento', motivo: 'solo examen mecánico' },
});
const gabinete = (): Gabinete => ({ ancho: 300, alto: 250,
	caja: { ancho: 340, alto: 290, profundidad: 120 }, canaletas: [],
	rieles: [{ id: 'din1', x: 20, y: 100, largo: 250 }], colocaciones: [] });

test('montaje declarado se valida sin inventar anclajes; importación descarta propiedades hostiles', () => {
	const placa: MontajeComponente = { metodo: 'atornillado-placa', anclajes: [
		{ xMm: 5, yMm: 5, diametroMm: 4 }, { xMm: 35, yMm: 45 },
	] };
	assert.deepEqual(validarMontajeDeclarado(placa, dimensiones), []);
	assert.deepEqual(validarDefinicionComponente(definicion(placa)), []);
	assert.deepEqual(leerMontajeDeclarado({ ...placa, externo: 'ignorar', anclajes: [
		{ ...placa.anclajes![0], ruta: 'C:/privado' }, placa.anclajes![1],
	] }, dimensiones), placa);
	assert.match(validarMontajeDeclarado({ ...placa, anclajes: [{ xMm: 60, yMm: 1 }] }, dimensiones).join(' '), /anclaje/);
	assert.match(validarMontajeDeclarado({ metodo: 'puerta' }, dimensiones).join(' '), /método/);
	assert.equal(leerMontajeDeclarado({ metodo: 'puerta' }, dimensiones), undefined);
});

test('una instancia conserva método/anclajes al guardar y reabrir, sin heredar cambios de biblioteca', () => {
	const placa: MontajeComponente = { metodo: 'atornillado-placa', anclajes: [{ xMm: 5, yMm: 5 }] };
	const d = definicion(placa);
	const instancia = instanciarComponentePersonalizado(d, 'p1');
	const fijacionOriginal = structuredClone(placa);
	d.montaje!.anclajes![0].xMm = 12;
	assert.equal(instancia.montajeComponente?.anclajes?.[0].xMm, 5);
	const p = crearProyecto('Fijaciones'); p.dispositivos = [instancia]; p.gabinete = gabinete();
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'General' }];
	const reabierto = cargarProyecto(JSON.stringify(p));
	assert.deepEqual(reabierto.arreglos, []);
	assert.deepEqual(reabierto.proyecto.dispositivos[0].montajeComponente, fijacionOriginal);
	const legacy = instanciarComponentePersonalizado(definicion(), 'p2');
	assert.equal(legacy.montajeComponente, undefined);
});

test('evaluación diferencia no cabe de no evaluable y nunca certifica una fijación', () => {
	const g = gabinete();
	const col = { dispositivoId: 'p1', x: 80, y: 20, ancho: 40, alto: 50 };
	g.colocaciones.push(col);
	assert.equal(evaluarCompatibilidadMontaje(dimensiones, undefined, g, col).estado, 'NO_EVALUABLE');
	assert.equal(evaluarCompatibilidadMontaje(dimensiones,
		{ metodo: 'atornillado-placa' }, g, col).estado, 'NO_EVALUABLE');
	assert.equal(evaluarCompatibilidadMontaje(dimensiones,
		{ metodo: 'atornillado-placa', anclajes: [{ xMm: 5, yMm: 5 }] }, g, col).estado, 'GEOMETRIA_COMPATIBLE');
	assert.equal(evaluarCompatibilidadMontaje(dimensiones,
		{ metodo: 'riel-din' }, g, col).estado, 'NO_CABE');
	const fuera = { ...col, x: 280 };
	assert.match(evaluarCompatibilidadMontaje(dimensiones, undefined, g, fuera).motivos.join(' '), /sale de la placa/);
	const sobreRiel = { ...col, x: 30, y: 90 };
	assert.match(evaluarCompatibilidadMontaje(dimensiones,
		{ metodo: 'atornillado-placa', anclajes: [{ xMm: 5, yMm: 5 }] }, g, sobreRiel).motivos.join(' '), /riel/);
	g.canaletas.push({ id: 'ct1', x: 120, y: 20, largo: 100, orientacion: 'v', ancho: 40, alto: 30 });
	assert.match(evaluarCompatibilidadMontaje(dimensiones,
		{ metodo: 'atornillado-placa', anclajes: [{ xMm: 5, yMm: 5 }] }, g, { ...col, x: 125 }).motivos.join(' '), /canaleta/);
	const profundo = { ...dimensiones, fondoMm: 150 };
	assert.match(evaluarCompatibilidadMontaje(profundo,
		{ metodo: 'riel-din' }, g, { ...col, x: 180, y: 75, rielId: 'din1' }).motivos.join(' '), /profundidad/);
});

test('colocación propuesta de placa evita aparatos, riel y canaleta sin depender del orden de arrays', () => {
	const g = gabinete();
	g.colocaciones.push({ dispositivoId: 'ocupado', x: 0, y: 0, ancho: 55, alto: 70 });
	g.canaletas.push({ id: 'ct1', x: 60, y: 0, largo: 90, orientacion: 'h', ancho: 40, alto: 30 });
	const montaje: MontajeComponente = { metodo: 'atornillado-placa', anclajes: [{ xMm: 5, yMm: 5 }] };
	const primero = buscarColocacionPlaca(dimensiones, montaje, g, 'p1');
	assert.ok(primero);
	assert.equal(evaluarCompatibilidadMontaje(dimensiones, montaje, g, primero).estado, 'GEOMETRIA_COMPATIBLE');
	g.rieles.reverse(); g.canaletas.reverse(); g.colocaciones.reverse();
	assert.deepEqual(buscarColocacionPlaca(dimensiones, montaje, g, 'p1'), primero);
	assert.equal(buscarColocacionPlaca(dimensiones, { metodo: 'riel-din' }, g, 'p1'), undefined);
});
