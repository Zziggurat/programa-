import assert from 'node:assert/strict';
import test from 'node:test';

import { cargarProyecto } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { montarEsquema, resumenPendientesEsquema } from '../src/motores/esquema.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';

function fixture() {
	const p = crearProyecto('Pendientes visibles M2');
	p.gabinete = { ancho: 400, alto: 600, rieles: [], canaletas: [], colocaciones: [] };
	p.hojas = [{ id: 'potencia', numero: 1, titulo: 'Potencia' },
		{ id: 'mando', numero: 2, titulo: 'Mando' }];
	p.dispositivos = [
		{ id: 'q1', tipo: 'disyuntor' as const, designacion: '-Q1', hojaId: 'potencia',
			bornes: [{ id: '1' }, { id: '2' }] },
		{ id: 'x1', tipo: 'bornero' as const, designacion: '-X1', hojaId: 'mando',
			bornes: [{ id: '1' }] },
		{ id: 'foto', tipo: 'otro' as const, imagen: 'data:image/png;base64,AA==',
			bornes: [] },
	];
	p.conductores = [{ id: 'w1', de: { dispositivoId: 'q1', borneId: '2' },
		a: { dispositivoId: 'x1', borneId: '1' }, estadoRutaFisica: 'pendiente' as const }];
	p.esquema = { representaciones: [{ id: 'q1-vista', dispositivoId: 'q1', hojaId: 'potencia',
		posicion: { columna: 2, fila: 2 }, parte: { tipo: 'completa' as const } }] };
	return p;
}

test('M2 muestra aparato eléctrico sin vista en su hoja y conserva conexión sin ancla', () => {
	const p = fixture();
	const antes = JSON.stringify(p);
	const hojas = montarEsquema(p, calcularPotenciales(p));
	assert.equal(JSON.stringify(p), antes, 'diagnosticar no altera modelo ni ruta');
	assert.deepEqual(hojas.map((h) => h.id), ['potencia', 'mando']);
	assert.ok(hojas.find((h) => h.id === 'mando')?.problemas?.some((x) =>
		x.codigo === 'aparato-sin-representacion' && x.dispositivoId === 'x1'
		&& x.mensaje.includes('-X1')));
	assert.ok(!hojas.flatMap((h) => h.problemas ?? []).some((x) =>
		x.codigo === 'aparato-sin-representacion' && (x.dispositivoId === 'q1' || x.dispositivoId === 'foto')),
	'la vista válida y la imagen inerte no generan falso pendiente');
	assert.ok(hojas.some((h) => h.problemas?.some((x) =>
		x.codigo === 'conexion-sin-ancla' && x.conductorId === 'w1')));
	assert.match(resumenPendientesEsquema(hojas.find((h) => h.id === 'mando')!) ?? '',
		/PENDIENTES DE ESQUEMA 1: x1/);
	assert.equal(resumenPendientesEsquema({ problemas: [] }), undefined);
	const idLargo = 'identificador-extremadamente-largo-que-no-debe-volver-ilegible-el-cajetin';
	const resumenLargo = resumenPendientesEsquema({ problemas: [{ codigo: 'aparato-sin-representacion',
		dispositivoId: idLargo, mensaje: 'pendiente' }] });
	assert.ok(resumenLargo?.includes('...') && !resumenLargo.includes(idLargo),
		'la advertencia de papel resume el ID largo; el detalle íntegro sigue en el inspector');
	assert.equal(hojas.flatMap((h) => h.hilos).length, 0, 'no se dibuja una conexión sin dos anclas reales');
});

test('M2 lista vacía y vista inválida no ocultan aparatos; orden y recarga no alteran diagnóstico', () => {
	const a = fixture(), b = fixture();
	a.esquema = { representaciones: [] };
	b.esquema = { representaciones: [{ id: 'x1-invalida', dispositivoId: 'x1',
		hojaId: 'mando', posicion: { columna: 1, fila: 1 },
		parte: { tipo: 'contactos', pares: [{ entrada: 'sin-borne', salida: '1' }] } }] };
	const diagnosticar = (p: typeof a) => montarEsquema(p, calcularPotenciales(p))
		.flatMap((h) => (h.problemas ?? []).filter((x) => x.codigo === 'aparato-sin-representacion')
			.map((x) => x.dispositivoId)).sort();
	assert.deepEqual(diagnosticar(a), ['q1', 'x1']);
	assert.deepEqual(diagnosticar(b), ['q1', 'x1']);
	const ordenInicial = montarEsquema(a, calcularPotenciales(a))
		.flatMap((h) => (h.problemas ?? []).filter((x) => x.codigo === 'aparato-sin-representacion'))
		.map((x) => x.dispositivoId);
	a.dispositivos.reverse(); a.hojas.reverse();
	assert.deepEqual(diagnosticar(a), ['q1', 'x1']);
	assert.deepEqual(montarEsquema(a, calcularPotenciales(a))
		.flatMap((h) => (h.problemas ?? []).filter((x) => x.codigo === 'aparato-sin-representacion'))
		.map((x) => x.dispositivoId), ordenInicial,
	'la secuencia visible de avisos no depende de invertir dispositivos ni hojas');
	const abierto = cargarProyecto(JSON.stringify(a)).proyecto;
	assert.deepEqual(diagnosticar(abierto), ['q1', 'x1']);
	assert.deepEqual(abierto.esquema?.representaciones, []);
});
