import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fixtureFallosIndustriales } from '../ejemplo/fixtures-simulacion-v2.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import type { Dispositivo, Proyecto, RepresentacionEsquema } from '../src/modelo/tipos.js';
import { generarBOM } from '../src/motores/documentacion.js';
import { montarEsquema, posicionesEnEsquema } from '../src/motores/esquema.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';

function vistasKm1(): RepresentacionEsquema[] {
	return [
		{ id: 'km1-polos', dispositivoId: 'km1', hojaId: 'potencia',
			posicion: { columna: 4, fila: 3 }, parte: { tipo: 'contactos', pares: [
				{ entrada: '1/L1', salida: '2/T1' }, { entrada: '3/L2', salida: '4/T2' },
				{ entrada: '5/L3', salida: '6/T3' },
			] } },
		{ id: 'km1-bobina', dispositivoId: 'km1', hojaId: 'mando',
			posicion: { columna: 3, fila: 5 }, parte: { tipo: 'bobina' } },
		{ id: 'km1-aux', dispositivoId: 'km1', hojaId: 'mando',
			posicion: { columna: 6, fila: 3 }, parte: { tipo: 'contactos', pares: [
				{ entrada: '13', salida: '14' },
			] } },
	];
}

function dosHojas(p: Proyecto): void {
	p.hojas = [
		{ id: 'potencia', numero: 1, titulo: 'Fuerza' },
		{ id: 'mando', numero: 2, titulo: 'Maniobra' },
	];
}

const montar = (p: Proyecto) => montarEsquema(p, calcularPotenciales(p));

test('M2 explícito: bobina, polos y auxiliar comparten un único km1 en hojas estables', () => {
	const p = fixtureFallosIndustriales();
	dosHojas(p);
	p.esquema = { representaciones: vistasKm1() };
	const antes = JSON.stringify(p);
	const bomAntes = generarBOM(p);
	const hojas = montar(p);
	assert.deepEqual(hojas.map((h) => [h.id, h.numero, h.titulo]),
		[['potencia', 1, 'Fuerza'], ['mando', 2, 'Maniobra']]);
	const vistas = hojas.flatMap((h) => h.simbolos.map((s) => ({ hojaId: h.id, simbolo: s })));
	assert.deepEqual(vistas.map(({ simbolo }) => simbolo.representacionId),
		['km1-polos', 'km1-bobina', 'km1-aux']);
	assert.ok(vistas.every(({ simbolo }) => simbolo.dispositivoId === 'km1'));
	assert.deepEqual([...vistas[0].simbolo.pines.keys()],
		['1/L1', '2/T1', '3/L2', '4/T2', '5/L3', '6/T3']);
	assert.deepEqual([...vistas[1].simbolo.pines.keys()], ['A1', 'A2']);
	assert.deepEqual([...vistas[2].simbolo.pines.keys()], ['13', '14']);
	assert.equal(p.dispositivos.filter((d) => d.id === 'km1').length, 1);
	assert.equal(JSON.stringify(p), antes, 'montar no crea ni mueve cables o aparatos');
	assert.deepEqual(generarBOM(p), bomAntes);
	assert.equal(posicionesEnEsquema(hojas).get('km1'), '2.3', 'el índice usa la bobina como posición primaria');
	const refBobina = hojas.flatMap((h) => h.referencias).filter((r) => r.tipo === 'bobina');
	assert.deepEqual(refBobina.map((r) => r.representacionId), ['km1-polos', 'km1-aux']);
	assert.ok(refBobina.every((r) => r.texto === 'bobina /2.3'));
});

function proyectoCableado(): Proyecto {
	const fuente = fixtureFallosIndustriales();
	const km1 = fuente.dispositivos.find((d) => d.id === 'km1') as Dispositivo;
	const p = crearProyecto('Rutas gráficas M2');
	dosHojas(p);
	p.gabinete = { ancho: 400, alto: 600, rieles: [], canaletas: [], colocaciones: [] };
	p.dispositivos = [
		structuredClone(km1),
		{ id: 'xp', tipo: 'bornero', bornes: [{ id: 'X1' }, { id: 'X2' }] },
		{ id: 'xm', tipo: 'bornero', bornes: [{ id: 'X1' }] },
	];
	p.conductores = [
		{ id: 'c-potencia', de: { dispositivoId: 'km1', borneId: '1/L1' },
			a: { dispositivoId: 'xp', borneId: 'X1' } },
		{ id: 'c-mando', de: { dispositivoId: 'km1', borneId: 'A1' },
			a: { dispositivoId: 'xm', borneId: 'X1' } },
		{ id: 'c-entre-hojas', de: { dispositivoId: 'km1', borneId: '13' },
			a: { dispositivoId: 'xp', borneId: 'X2' } },
	];
	p.esquema = { representaciones: [
		...vistasKm1(),
		{ id: 'xp-completo', dispositivoId: 'xp', hojaId: 'potencia',
			posicion: { columna: 7, fila: 4 }, parte: { tipo: 'completa' } },
		{ id: 'xm-completo', dispositivoId: 'xm', hojaId: 'mando',
			posicion: { columna: 7, fila: 4 }, parte: { tipo: 'completa' } },
	] };
	return p;
}

test('cada conductor físico produce un hilo o dos referencias de hoja, nunca dos cables', () => {
	const p = proyectoCableado();
	const antes = JSON.stringify(p.conductores);
	const hojas = montar(p);
	assert.deepEqual(hojas.flatMap((h) => h.hilos.map((x) => x.conductorId)).sort(),
		['c-mando', 'c-potencia']);
	const enlaces = hojas.flatMap((h) => h.referencias.filter((r) => r.tipo === 'enlace'));
	assert.equal(enlaces.length, 2);
	assert.ok(enlaces.every((r) => r.conductorId === 'c-entre-hojas'));
	assert.ok(enlaces.some((r) => /\/1\.7/.test(r.texto)));
	assert.ok(enlaces.some((r) => /\/2\.6/.test(r.texto)));
	assert.equal(JSON.stringify(p.conductores), antes);
	assert.ok(p.conductores.every((c) => c.fisica?.longitudManualM === undefined),
		'el trazo de papel no inventa una longitud física');
});

test('guardar/reabrir y reordenar hojas no cambia sus IDs ni el destino de los pines', () => {
	const p = proyectoCableado();
	const primer = montar(p);
	const cargado = cargarProyecto(JSON.stringify(p));
	assert.deepEqual(cargado.diagnosticos, []);
	assert.deepEqual(montar(cargado.proyecto).map((h) => h.id), primer.map((h) => h.id));
	assert.deepEqual(montar(cargado.proyecto).flatMap((h) => h.hilos.map((x) => x.conductorId)).sort(),
		['c-mando', 'c-potencia']);
	cargado.proyecto.hojas = [
		{ id: 'mando', numero: 1, titulo: 'Maniobra primero' },
		{ id: 'potencia', numero: 2, titulo: 'Fuerza después' },
	];
	const reordenado = montar(cargado.proyecto);
	assert.deepEqual(reordenado.map((h) => h.id), ['mando', 'potencia']);
	assert.equal(reordenado.find((h) => h.id === 'mando')?.simbolos.find((s) => s.parte === 'bobina')?.representacionId,
		'km1-bobina');
	assert.equal(posicionesEnEsquema(reordenado).get('km1'), '1.3');
	assert.deepEqual(reordenado.flatMap((h) => h.hilos.map((x) => x.conductorId)).sort(),
		['c-mando', 'c-potencia']);
});

test('[] no resucita símbolos ni cables; undefined conserva el motor legacy', () => {
	const p = proyectoCableado();
	p.esquema = { representaciones: [] };
	const vacio = montar(p);
	assert.deepEqual(vacio.map((h) => h.id), ['potencia', 'mando']);
	assert.ok(vacio.every((h) => h.simbolos.length === 0 && h.hilos.length === 0));
	assert.equal(vacio.flatMap((h) => h.problemas ?? []).filter((x) => x.codigo === 'conexion-sin-ancla').length,
		p.conductores.length, 'los cables no desaparecen del diagnóstico por borrar sus vistas');
	p.esquema = undefined;
	const legacy = montar(p);
	assert.ok(legacy.flatMap((h) => h.simbolos).length > 0);
	assert.ok(legacy.every((h) => /^esq\d+$/.test(h.id)), 'se preservan los IDs generados legacy');
});

test('un borne ambiguo en memoria no se asigna al azar a un conductor', () => {
	const p = proyectoCableado();
	p.esquema!.representaciones!.push({
		id: 'bobina-duplicada', dispositivoId: 'km1', hojaId: 'potencia',
		posicion: { columna: 8, fila: 3 }, parte: { tipo: 'bobina' },
	});
	const hojas = montar(p);
	assert.ok(!hojas.flatMap((h) => h.hilos).some((h) => h.conductorId === 'c-mando'));
	assert.ok(hojas.flatMap((h) => h.hilos).some((h) => h.conductorId === 'c-potencia'));
	assert.ok(hojas.some((h) => h.problemas?.some((x) => x.codigo === 'conexion-sin-ancla'
		&& x.conductorId === 'c-mando')));
});

test('posición fuera de hoja se advierte sin cambiar el proyecto persistente', () => {
	const p = proyectoCableado();
	const bobina = p.esquema!.representaciones!.find((r) => r.id === 'km1-bobina')!;
	bobina.posicion = { columna: 30, fila: 12 };
	const antes = JSON.stringify(p);
	const hojas = montar(p);
	const mando = hojas.find((h) => h.id === 'mando')!;
	assert.equal(mando.simbolos.find((s) => s.representacionId === 'km1-bobina')?.columna, 10);
	assert.ok(mando.problemas?.some((x) => x.codigo === 'posicion-fuera-de-hoja'
		&& x.representacionId === 'km1-bobina'));
	assert.ok(mando.referencias.some((x) => x.tipo === 'aviso' && /30\.12/.test(x.texto)));
	assert.equal(JSON.stringify(p), antes);
});

test('común compartido en memoria no pisa un pin y queda como vista pendiente', () => {
	const p = proyectoCableado();
	const km1 = p.dispositivos.find((d) => d.id === 'km1')!;
	const perfil = km1.comportamiento;
	if (perfil?.clase !== 'contactos-electromagneticos') throw new Error('fixture sin perfil');
	perfil.contactos.push({ entrada: '13', salida: 'A1', reposo: 'cerrado', funcion: 'auxiliar' });
	const aux = p.esquema!.representaciones!.find((r) => r.id === 'km1-aux')!;
	if (aux.parte.tipo !== 'contactos') throw new Error('fixture sin contactos');
	aux.parte.pares.push({ entrada: '13', salida: 'A1' });
	const hojas = montar(p);
	const mando = hojas.find((h) => h.id === 'mando')!;
	assert.ok(!mando.simbolos.some((s) => s.representacionId === 'km1-aux'));
	assert.ok(mando.problemas?.some((x) => x.codigo === 'representacion-invalida'
		&& x.representacionId === 'km1-aux'));
	assert.ok(hojas.some((h) => h.problemas?.some((x) => x.codigo === 'conexion-sin-ancla'
		&& x.conductorId === 'c-entre-hojas')));
});
