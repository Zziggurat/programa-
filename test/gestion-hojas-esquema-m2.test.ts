import assert from 'node:assert/strict';
import test from 'node:test';

import { cargarProyecto } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import { aplicarGestionHojaEsquema, previsualizarGestionHojaEsquema } from '../src/motores/gestion-hojas-esquema.js';
import { montarEsquema } from '../src/motores/esquema.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';

function proyectoM2(): Proyecto {
	const p = crearProyecto('Folio M2');
	p.gabinete = { ancho: 600, alto: 400, rieles: [], canaletas: [], colocaciones: [] };
	p.hojas = [
		{ id: 'bornes', numero: 3, titulo: 'Bornes' },
		{ id: 'potencia', numero: 1, titulo: 'Potencia', columnas: 10 },
		{ id: 'mando', numero: 2, titulo: 'Mando', columnas: 8 },
	];
	p.dispositivos = [
		{ id: 'x1', tipo: 'bornero', bornes: [{ id: '1' }] },
		{ id: 'x2', tipo: 'bornero', bornes: [{ id: '1' }] },
	];
	p.conductores = [{ id: 'c1', de: { dispositivoId: 'x1', borneId: '1' },
		a: { dispositivoId: 'x2', borneId: '1' } }];
	p.esquema = { representaciones: [
		{ id: 'x1-vista', dispositivoId: 'x1', hojaId: 'potencia',
			posicion: { columna: 8, fila: 2 }, parte: { tipo: 'completa' } },
		{ id: 'x2-vista', dispositivoId: 'x2', hojaId: 'mando',
			posicion: { columna: 3, fila: 4 }, parte: { tipo: 'completa' } },
	] };
	return p;
}

test('crear folio con ID aportado y clase explícita: preview/cancelación, aplicación y roundtrip V2', () => {
	const p = proyectoM2();
	const antes = JSON.stringify(p);
	const plan = previsualizarGestionHojaEsquema(p, { tipo: 'crear', id: 'plc', titulo: '  PLC / E/S  ',
		clase: 'plc-io', columnas: 12 });
	assert.equal(JSON.stringify(p), antes, 'cerrar la previsualización no modifica nada');
	assert.deepEqual(plan.hojasAntes.map((h) => [h.id, h.numero]),
		[['potencia', 1], ['mando', 2], ['bornes', 3]]);
	assert.deepEqual(plan.hojasDespues.map((h) => [h.id, h.numero]),
		[['potencia', 1], ['mando', 2], ['bornes', 3], ['plc', 4]]);
	assert.equal(plan.cambios, 1);
	assert.deepEqual(plan.vistasAfectadas, []);
	// Un preview mutable no es la autoridad de la operación confirmada.
	(plan.hojasDespues as unknown as { titulo: string }[])[3].titulo = 'Manipulación del preview';
	aplicarGestionHojaEsquema(p, plan);
	assert.deepEqual(p.hojas.map((h) => [h.id, h.numero, h.titulo, h.clase, h.columnas]), [
		['potencia', 1, 'Potencia', undefined, 10],
		['mando', 2, 'Mando', undefined, 8],
		['bornes', 3, 'Bornes', undefined, undefined],
		['plc', 4, 'PLC / E/S', 'plc-io', 12],
	]);
	const carga = cargarProyecto(JSON.stringify(p));
	assert.deepEqual(carga.diagnosticos, []);
	assert.deepEqual(carga.proyecto.hojas.map((h) => [h.id, h.clase]),
		p.hojas.map((h) => [h.id, h.clase]));
	assert.deepEqual(carga.proyecto.conductores.map((c) => [c.id, c.de, c.a]),
		p.conductores.map((c) => [c.id, c.de, c.a]));
});

test('editar título, clase y columnas no desplaza vistas; reducción incompatible se bloquea atómicamente', () => {
	const p = proyectoM2();
	const antes = JSON.stringify(p);
	assert.throws(() => previsualizarGestionHojaEsquema(p,
		{ tipo: 'editar', id: 'potencia', columnas: 7 }), /x1-vista/);
	assert.equal(JSON.stringify(p), antes);
	const plan = previsualizarGestionHojaEsquema(p, { tipo: 'editar', id: 'potencia',
		titulo: 'Fuerza principal', clase: 'potencia', columnas: 9 });
	assert.deepEqual(plan.vistasAfectadas.map((r) => r.id), ['x1-vista']);
	aplicarGestionHojaEsquema(p, plan);
	assert.deepEqual(p.hojas.find((h) => h.id === 'potencia'),
		{ id: 'potencia', numero: 1, titulo: 'Fuerza principal', clase: 'potencia', columnas: 9 });
	assert.equal(p.esquema?.representaciones?.[0].posicion.columna, 8);
	const limpiar = previsualizarGestionHojaEsquema(p, { tipo: 'editar', id: 'potencia', clase: null });
	aplicarGestionHojaEsquema(p, limpiar);
	assert.equal(p.hojas.find((h) => h.id === 'potencia')?.clase, undefined,
		'una hoja no clasificada no se infiere de su título');
	const fijarColumnas = previsualizarGestionHojaEsquema(p,
		{ tipo: 'editar', id: 'bornes', columnas: 10 });
	assert.equal(fijarColumnas.cambios, 1,
		'igual valor visible puede fijar una decisión persistente antes implícita');
	aplicarGestionHojaEsquema(p, fijarColumnas);
	assert.equal(p.hojas.find((h) => h.id === 'bornes')?.columnas, 10);
});

test('columnas null restaura herencia sin confundir valor efectivo con override persistido', () => {
	const p = proyectoM2();
	p.esquema!.columnasPorHoja = 10;
	const fijar = previsualizarGestionHojaEsquema(p, { tipo: 'editar', id: 'bornes', columnas: 10 });
	aplicarGestionHojaEsquema(p, fijar);
	assert.equal(previsualizarGestionHojaEsquema(p,
		{ tipo: 'editar', id: 'bornes', columnas: undefined }).cambios, 0,
		'undefined no toca las columnas explícitas');
	const antes = JSON.stringify(p);
	const restaurar = previsualizarGestionHojaEsquema(p, { tipo: 'editar', id: 'bornes', columnas: null });
	assert.equal(JSON.stringify(p), antes, 'la previsualización no borra el override');
	assert.equal(restaurar.cambios, 1, 'eliminar el override cambia el documento aunque el valor visible coincida');
	assert.equal(restaurar.hojasAntes.find((h) => h.id === 'bornes')?.columnasDeclaradas, 10);
	assert.equal(restaurar.hojasDespues.find((h) => h.id === 'bornes')?.columnasDeclaradas, undefined);
	assert.equal(restaurar.hojasDespues.find((h) => h.id === 'bornes')?.columnas, 10);
	aplicarGestionHojaEsquema(p, restaurar);
	assert.equal(Object.hasOwn(p.hojas.find((h) => h.id === 'bornes')!, 'columnas'), false);
	p.esquema!.columnasPorHoja = 12;
	const reabierto = cargarProyecto(JSON.stringify(p)).proyecto;
	const preview = previsualizarGestionHojaEsquema(reabierto,
		{ tipo: 'editar', id: 'bornes', columnas: undefined });
	assert.equal(preview.hojasAntes.find((h) => h.id === 'bornes')?.columnas, 12,
		'el folio sin override sigue el valor global tras guardar y cargar');
});

test('restaurar herencia bloquea una vista fuera del nuevo ancho y no muta el proyecto', () => {
	const p = proyectoM2();
	p.esquema!.columnasPorHoja = 6;
	const antes = JSON.stringify(p);
	assert.throws(() => previsualizarGestionHojaEsquema(p,
		{ tipo: 'editar', id: 'potencia', columnas: null }), /herencia de 6 columnas.*x1-vista/);
	assert.equal(JSON.stringify(p), antes);
	const valido = previsualizarGestionHojaEsquema(p, { tipo: 'editar', id: 'mando', columnas: null });
	assert.equal(valido.hojasDespues.find((h) => h.id === 'mando')?.columnas, 6);
	aplicarGestionHojaEsquema(p, valido);
	assert.equal(Object.hasOwn(p.hojas.find((h) => h.id === 'mando')!, 'columnas'), false);
	assert.equal(p.esquema?.representaciones?.find((r) => r.id === 'x2-vista')?.posicion.columna, 3);
});

test('mover reordena por número estable con independencia del array y actualiza referencias entre hojas', () => {
	const p = proyectoM2();
	const inverso = structuredClone(p);
	inverso.hojas.reverse();
	inverso.esquema!.representaciones!.reverse();
	const solicitud = { tipo: 'mover', id: 'mando', direccion: 'subir' } as const;
	const plan = previsualizarGestionHojaEsquema(p, solicitud);
	const planInverso = previsualizarGestionHojaEsquema(inverso, solicitud);
	assert.deepEqual(plan.hojasDespues, planInverso.hojasDespues);
	assert.deepEqual(plan.vistasAfectadas.map((r) => r.id), ['x2-vista', 'x1-vista']);
	const vistas = JSON.stringify(p.esquema!.representaciones);
	const conductores = JSON.stringify(p.conductores);
	aplicarGestionHojaEsquema(p, plan);
	assert.deepEqual(p.hojas.map((h) => [h.id, h.numero]),
		[['mando', 1], ['potencia', 2], ['bornes', 3]]);
	assert.equal(JSON.stringify(p.esquema!.representaciones), vistas);
	assert.equal(JSON.stringify(p.conductores), conductores);
	const hojas = montarEsquema(p, calcularPotenciales(p));
	assert.deepEqual(hojas.map((h) => [h.id, h.numero]),
		[['mando', 1], ['potencia', 2], ['bornes', 3]]);
	assert.equal(hojas.flatMap((h) => h.referencias).filter((r) => r.tipo === 'enlace').length, 2);
	assert.ok(hojas.find((h) => h.id === 'mando')?.referencias.some((r) => r.texto.includes('/2.')));
	assert.ok(hojas.find((h) => h.id === 'potencia')?.referencias.some((r) => r.texto.includes('/1.')));
	const restaurado = cargarProyecto(JSON.stringify(p)).proyecto;
	assert.deepEqual(restaurado.hojas.map((h) => [h.id, h.numero]), p.hojas.map((h) => [h.id, h.numero]));
});

test('eliminar solo folio vacío renumera sin tocar vínculos; vistas, referencia legacy y último folio bloquean', () => {
	const p = proyectoM2();
	const antes = JSON.stringify(p);
	assert.throws(() => previsualizarGestionHojaEsquema(p,
		{ tipo: 'eliminar', id: 'mando' }), /vistas o referencias/);
	p.dispositivos[0].hojaId = 'bornes';
	assert.throws(() => previsualizarGestionHojaEsquema(p,
		{ tipo: 'eliminar', id: 'bornes' }), /vistas o referencias/);
	delete p.dispositivos[0].hojaId;
	assert.equal(JSON.stringify(p), antes);
	const plan = previsualizarGestionHojaEsquema(p, { tipo: 'eliminar', id: 'bornes' });
	assert.deepEqual(plan.hojasDespues.map((h) => [h.id, h.numero]), [['potencia', 1], ['mando', 2]]);
	aplicarGestionHojaEsquema(p, plan);
	assert.deepEqual(p.hojas.map((h) => [h.id, h.numero]), [['potencia', 1], ['mando', 2]]);
	assert.equal(p.esquema!.representaciones!.length, 2);
	const soloUno = proyectoM2();
	soloUno.hojas = [{ id: 'unica', numero: 1, titulo: 'Única' }];
	soloUno.esquema = { representaciones: [] };
	assert.throws(() => previsualizarGestionHojaEsquema(soloUno,
		{ tipo: 'eliminar', id: 'unica' }), /al menos una hoja/);
});

test('borrar un folio intermedio y mover con números dispersos compacta 1..N solo en la acción estructural', () => {
	const p = proyectoM2();
	p.hojas.find((h) => h.id === 'mando')!.numero = 4;
	p.hojas.find((h) => h.id === 'bornes')!.numero = 7;
	const editar = previsualizarGestionHojaEsquema(p, { tipo: 'editar', id: 'bornes', titulo: 'Terminales' });
	assert.deepEqual(editar.hojasDespues.map((h) => h.numero), [1, 4, 7],
		'editar metadatos no normaliza números legados de forma implícita');
	const borrar = previsualizarGestionHojaEsquema(p, { tipo: 'eliminar', id: 'bornes' });
	assert.deepEqual(borrar.hojasDespues.map((h) => h.numero), [1, 2]);
	assert.deepEqual(borrar.vistasAfectadas.map((r) => r.id), ['x2-vista']);
	aplicarGestionHojaEsquema(p, borrar);
	assert.deepEqual(p.hojas.map((h) => h.numero), [1, 2]);
});

test('plan envejecido o fabricado no muta; solo importan hojas, vistas y referencias relevantes', () => {
	const p = proyectoM2();
	const plan = previsualizarGestionHojaEsquema(p, { tipo: 'editar', id: 'mando', titulo: 'Nueva maniobra' });
	p.esquema!.representaciones![0].posicion.columna = 7;
	const despuesDelCambio = JSON.stringify(p);
	assert.throws(() => aplicarGestionHojaEsquema(p, plan), /cambiaron durante/);
	assert.equal(JSON.stringify(p), despuesDelCambio);
	assert.throws(() => aplicarGestionHojaEsquema(p, { ...plan }), /cambiaron durante/,
		'un objeto que copia el preview no posee el origen privado');
	const vigente = previsualizarGestionHojaEsquema(p, { tipo: 'editar', id: 'mando', titulo: 'Nueva maniobra' });
	p.conductores.push({ id: 'c2', de: { dispositivoId: 'x1', borneId: '1' },
		a: { dispositivoId: 'x2', borneId: '1' } });
	aplicarGestionHojaEsquema(p, vigente);
	assert.equal(p.hojas.find((h) => h.id === 'mando')?.titulo, 'Nueva maniobra',
		'un cambio eléctrico ajeno no obliga a rehacer el preview del registro de hojas');
});

test('ambigüedades del loader aún no validado se bloquean sin elegir por orden de array', () => {
	const p = proyectoM2();
	p.hojas.push({ id: 'potencia', numero: 4, titulo: 'Duplicado' });
	assert.throws(() => previsualizarGestionHojaEsquema(p,
		{ tipo: 'mover', id: 'potencia', direccion: 'bajar' }), /IDs o números.*duplicados/);
	p.hojas.pop();
	p.hojas[0].numero = 2;
	assert.throws(() => previsualizarGestionHojaEsquema(p,
		{ tipo: 'mover', id: 'potencia', direccion: 'bajar' }), /IDs o números.*duplicados/);
	p.hojas[0].numero = 3;
	p.hojas[0].columnas = 500;
	assert.throws(() => previsualizarGestionHojaEsquema(p,
		{ tipo: 'editar', id: 'mando', titulo: 'Nuevo' }), /columnas inválidos/);
	delete p.hojas[0].columnas;
	p.hojas[0].clase = 'otra' as never;
	assert.throws(() => previsualizarGestionHojaEsquema(p,
		{ tipo: 'editar', id: 'mando', titulo: 'Nuevo' }), /clase o columnas inválidos/);
	p.hojas[0].clase = undefined;
	p.esquema!.representaciones![0].hojaId = 'inexistente';
	assert.throws(() => previsualizarGestionHojaEsquema(p,
		{ tipo: 'editar', id: 'mando', titulo: 'Nuevo' }), /vistas duplicadas o referidas/);
	const legacy = proyectoM2();
	legacy.esquema = undefined;
	assert.throws(() => previsualizarGestionHojaEsquema(legacy,
		{ tipo: 'crear', id: 'h4', titulo: 'Nueva' }), /Activa primero las vistas M2/);
	const ejemplo = proyectoM2();
	ejemplo.esEjemplo = true;
	assert.throws(() => previsualizarGestionHojaEsquema(ejemplo,
		{ tipo: 'crear', id: 'h4', titulo: 'Nueva' }), /solo lectura/);
});
