import assert from 'node:assert/strict';
import test from 'node:test';

import { leerCarcasaParametrica, validarCarcasaParametrica } from '../src/componentes/carcasa.js';
import { instanciarComponentePersonalizado, actualizarDefinicionComponente,
	crearPaqueteProyecto, leerPaqueteProyecto,
	type DefinicionComponentePersonalizado } from '../src/componentes/personalizados.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import * as THREE from 'three';
import { construirAparato3D } from '../app/dispositivos3d.js';

const definicion = (): DefinicionComponentePersonalizado => ({
	formato: 'tablero-studio-componente', version: 1, id: 'envolvente-propia', revision: 1,
	nombre: 'Envolvente declarada', creadoEn: '2026-09-22T00:00:00.000Z',
	modificadoEn: '2026-09-22T00:00:00.000Z', tipoDispositivo: 'otro',
	dimensiones: { anchoMm: 70, altoMm: 90, fondoMm: 45 },
	assetId: `sha256:${'1'.repeat(64)}`, terminales: [],
	comportamiento: { version: 1, clase: 'sin-comportamiento', motivo: 'documental' },
	carcasa: { plantilla: 'caja-industrial', acabado: 'gris-claro' },
});

test('una carcasa declarada se lee sin inferir función eléctrica', () => {
	const entrada = { plantilla: 'modulo-din', acabado: 'grafito' };
	assert.deepEqual(validarCarcasaParametrica(entrada), []);
	assert.deepEqual(leerCarcasaParametrica(entrada), entrada);
	assert.notEqual(leerCarcasaParametrica(entrada), entrada);
	assert.equal(leerCarcasaParametrica(undefined), undefined);
});

test('plantillas y acabados desconocidos o parámetros hostiles no entran al modelo', () => {
	for (const valor of [null, [], { plantilla: 'motor', acabado: 'grafito' },
		{ plantilla: 'modulo-din', acabado: '<script>' },
		{ plantilla: 'modulo-din', acabado: 'grafito', src: 'file:///privado' }]) {
		assert.ok(validarCarcasaParametrica(valor).length > 0);
		assert.equal(leerCarcasaParametrica(valor), undefined);
	}
});

test('la carcasa visual se fotografía por revisión y persiste sin afectar el perfil', () => {
	const original = definicion();
	const instancia = instanciarComponentePersonalizado(original, 'd1');
	const nueva = actualizarDefinicionComponente(original,
		{ carcasa: { plantilla: 'modulo-din', acabado: 'negro' } }, '2026-09-23T00:00:00.000Z');
	const instanciaNueva = instanciarComponentePersonalizado(nueva, 'd2');
	assert.deepEqual(instancia.carcasaPersonalizada, original.carcasa);
	assert.deepEqual(instanciaNueva.carcasaPersonalizada, nueva.carcasa);
	assert.notDeepEqual(instancia.carcasaPersonalizada, instanciaNueva.carcasaPersonalizada);
	assert.deepEqual(instancia.comportamiento, instanciaNueva.comportamiento);
	assert.deepEqual(instancia.bornes, instanciaNueva.bornes);
	const p = crearProyecto('Carcasas');
	p.gabinete = { ancho: 400, alto: 600, rieles: [], canaletas: [], colocaciones: [] };
	p.dispositivos = [instancia, instanciaNueva];
	const r = cargarProyecto(JSON.stringify(p));
	assert.deepEqual(r.diagnosticos, []);
	assert.deepEqual(r.proyecto.dispositivos.map((d) => d.carcasaPersonalizada),
		[original.carcasa, nueva.carcasa]);
	assert.deepEqual(r.proyecto.dispositivos.map((d) => d.comportamiento),
		[original.comportamiento, original.comportamiento]);
});

test('el cargador no convierte una carcasa hostil en geometría ni semántica', () => {
	const p = crearProyecto('Apariencia hostil');
	p.gabinete = { ancho: 400, alto: 600, rieles: [], canaletas: [], colocaciones: [] };
	p.dispositivos = [instanciarComponentePersonalizado(definicion(), 'd1')];
	(p.dispositivos[0] as unknown as Record<string, unknown>).carcasaPersonalizada =
		{ plantilla: 'otro', acabado: 'rojo', archivo: 'file:///secreto' };
	const r = cargarProyecto(JSON.stringify(p));
	assert.equal(r.proyecto.dispositivos[0].carcasaPersonalizada, undefined);
	assert.deepEqual(r.proyecto.dispositivos[0].comportamiento, definicion().comportamiento);
	assert.ok(r.diagnosticos.some((d) => d.ruta === 'dispositivos[d1].carcasaPersonalizada'));
});

test('el render paramétrico usa dimensiones declaradas y no mueve anclas u/v', () => {
	const ImagenAnterior = globalThis.Image;
	(globalThis as unknown as { Image: unknown }).Image = class { src = ''; onload?: () => void; };
	try {
		const d = instanciarComponentePersonalizado(definicion(), 'd1',
			{ imagenResuelta: 'data:image/png;base64,AQID' });
		d.bornes = [{ id: 'A1', u: 0.25, v: 0.75 }];
		const col = { dispositivoId: 'd1', x: 0, y: 0, ancho: 70, alto: 90 };
		const { grupo, profundidad } = construirAparato3D(d, col);
		const cuerpo = grupo.children.find((o) => o.userData.plantillaCarcasa === 'caja-industrial');
		assert.ok(cuerpo, 'la plantilla visual se construyó');
		const bounds = new THREE.Box3().setFromObject(cuerpo);
		assert.ok(Math.abs((bounds.max.x - bounds.min.x) - 70) < 0.02);
		assert.ok(Math.abs((bounds.max.y - bounds.min.y) - 90) < 0.02);
		assert.ok(Math.abs((bounds.max.z - bounds.min.z) - 45) < 0.02);
		const pin = grupo.children.find((o) => o.userData.pinBorneId === 'A1');
		assert.ok(pin);
		assert.equal(pin.position.x, -17.5);
		assert.equal(pin.position.y, -22.5);
		assert.equal(pin.position.z, profundidad + 0.5);
		const plano = grupo.children.find((o) => o.userData.esPlanoImagen);
		assert.ok(plano, 'la foto sigue siendo una referencia visual independiente');
	} finally {
		(globalThis as unknown as { Image: unknown }).Image = ImagenAnterior;
	}
});

test('el paquete de proyecto V4 transporta carcasa/instancia y V3 no la descarta', () => {
	const d = definicion();
	const p = crearProyecto('Carcasa portable');
	p.hojas = [{ id: 'principal', numero: 1, titulo: 'Esquema' }];
	p.gabinete = { ancho: 400, alto: 600, rieles: [], canaletas: [], colocaciones: [] };
	p.dispositivos = [instanciarComponentePersonalizado(d, 'd1')];
	const assets = [{ id: d.assetId, mime: 'image/png' as const, base64: 'AQID' }];
	assert.throws(() => crearPaqueteProyecto(p, assets, [d], 3), /requiere el paquete de proyecto V4/);
	const portable = crearPaqueteProyecto(p, assets, [d], 4);
	assert.equal(portable.version, 4);
	const leido = leerPaqueteProyecto(JSON.stringify(portable));
	assert.deepEqual(leido.componentes[0].carcasa, d.carcasa);
	assert.deepEqual(leido.proyecto.dispositivos[0].carcasaPersonalizada, d.carcasa);
	assert.deepEqual(leido.proyecto.dispositivos[0].comportamiento, d.comportamiento);
});
