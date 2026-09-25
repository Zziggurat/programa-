import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cargarProyecto } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import { referenciaTecnica } from '../src/datos-tecnicos/tipos.js';
import {
	aplicarEliminacionDispositivos, planificarEliminacionDispositivos,
} from '../src/motores/eliminar-dispositivos.js';
import { productoTecnico, tablaTecnica } from './helpers/datos-tecnicos.js';

function fixture(): Proyecto {
	const p = crearProyecto('M2 borrado eléctrico');
	p.hojas = [{ id: 'potencia', numero: 1, titulo: 'Potencia' },
		{ id: 'mando', numero: 2, titulo: 'Mando' },
		{ id: 'sin-cambios', numero: 3, titulo: 'Reserva' }];
	p.dispositivos = [
		{ id: 'km1', tipo: 'contactor', designacion: '-KM1',
			bornes: ['1/L1', '2/T1', 'A1', 'A2'].map((id) => ({ id })),
			comportamiento: { version: 1, clase: 'contactos-electromagneticos',
				bobina: { entrada: 'A1', retorno: 'A2' },
				polos: [{ entrada: '1/L1', salida: '2/T1' }], contactos: [] } },
		{ id: 'q1', tipo: 'disyuntor', designacion: '-Q1',
			bornes: [{ id: '1' }, { id: '2' }] },
		{ id: 'x1', tipo: 'bornero', designacion: '-X1', bornes: [{ id: '1' }] },
		{ id: 'aux', tipo: 'otro', designacion: '-KAUX',
			bornes: [{ id: '13' }, { id: '14' }],
			rol: { tipo: 'esclavo', maestroId: 'km1', contacto: 'NA' } },
	];
	p.conductores = [
		{ id: 'w1', de: { dispositivoId: 'km1', borneId: 'A1' },
			a: { dispositivoId: 'x1', borneId: '1' }, estadoRutaFisica: 'pendiente' },
		{ id: 'w2', de: { dispositivoId: 'q1', borneId: '2' },
			a: { dispositivoId: 'km1', borneId: '1/L1' },
			trazado: [{ x: 20, y: 20, z: 4 }] },
		{ id: 'w3', de: { dispositivoId: 'q1', borneId: '1' },
			a: { dispositivoId: 'x1', borneId: '1' },
			trazado: [{ x: 44, y: 36, z: 5 }], seccion: 2.5 },
	];
	p.esquema = { representaciones: [
		{ id: 'v-bobina', dispositivoId: 'km1', hojaId: 'mando',
			posicion: { columna: 2, fila: 2 }, parte: { tipo: 'bobina' } },
		{ id: 'v-polo', dispositivoId: 'km1', hojaId: 'potencia',
			posicion: { columna: 2, fila: 2 }, parte: { tipo: 'contactos',
				pares: [{ entrada: '1/L1', salida: '2/T1' }] } },
		{ id: 'v-q1', dispositivoId: 'q1', hojaId: 'potencia',
			posicion: { columna: 1, fila: 2 }, parte: { tipo: 'completa' } },
		{ id: 'v-x1', dispositivoId: 'x1', hojaId: 'mando',
			posicion: { columna: 4, fila: 2 }, parte: { tipo: 'completa' } },
		{ id: 'v-aux', dispositivoId: 'aux', hojaId: 'mando',
			posicion: { columna: 5, fila: 2 }, parte: { tipo: 'completa' } },
	] };
	p.gabinete = { ancho: 500, alto: 600, canaletas: [], rieles: [], colocaciones: [
		{ dispositivoId: 'km1', x: 20, y: 40, ancho: 50, alto: 60 },
		{ dispositivoId: 'q1', x: 100, y: 40, ancho: 50, alto: 60 },
		{ dispositivoId: 'x1', x: 200, y: 40, ancho: 50, alto: 60 },
	] };
	const producto = productoTecnico(), tabla = tablaTecnica();
	p.datosTecnicos = { version: 1, revisiones: [producto, tabla],
		vinculos: [
			{ entidad: 'DEVICE', entidadId: 'km1', producto: referenciaTecnica(producto), decisiones: {}, condiciones: {} },
			{ entidad: 'DEVICE', entidadId: 'q1', producto: referenciaTecnica(producto), decisiones: {}, condiciones: {} },
			{ entidad: 'CONDUCTOR', entidadId: 'w1', producto: referenciaTecnica(producto), decisiones: {}, condiciones: {} },
			{ entidad: 'CONDUCTOR', entidadId: 'w3', producto: referenciaTecnica(producto), decisiones: {}, condiciones: {} },
		],
		instalaciones: [
			{ conductorId: 'w1', tabla: referenciaTecnica(tabla), factores: [] },
			{ conductorId: 'w3', tabla: referenciaTecnica(tabla), factores: [] },
		],
		prospectiva: [
			{ proteccionId: 'q1', de: { dispositivoId: 'km1', borneId: 'A1' },
				a: { dispositivoId: 'x1', borneId: '1' }, tipo: 'L_N' },
			{ proteccionId: 'q1', de: { dispositivoId: 'q1', borneId: '1' },
				a: { dispositivoId: 'x1', borneId: '1' }, tipo: 'L_N' },
		],
	};
	p.ingenieria = { version: 1, circuitos: {
		'c-a': { version: 1, conductoresReasignablesFase: ['w1', 'w3'] },
	}, disenoAsistido: { version: 1, decisiones: [{ version: 1, id: 'historia-km1', solicitudId: 's',
		planId: 'plan', hashBase: 'h', circuitoId: 'c-a', cambios: [
			{ tipo: 'PROTECCION', dispositivoId: 'km1', referencia: {
				...referenciaTecnica(producto), tipo: 'PRODUCTO' } },
		] }] } };
	return p;
}

test('ESQ-04 planifica impacto multivista/multihoja sin mutar al cancelar', () => {
	const p = fixture(), antes = JSON.stringify(p);
	const plan = planificarEliminacionDispositivos(p, ['km1']);
	assert.equal(JSON.stringify(p), antes);
	assert.deepEqual(plan.ids, ['km1']);
	assert.deepEqual(plan.conductores.map((c) => c.id), ['w1', 'w2']);
	assert.equal(plan.conductores[0].rutaPendiente, true);
	assert.deepEqual(plan.representaciones.map((r) => r.id), ['v-bobina', 'v-polo']);
	assert.deepEqual(plan.hojasAfectadas.map((h) => h.id), ['potencia', 'mando']);
	assert.deepEqual(plan.vinculosTecnicos.map((v) => `${v.entidad}:${v.entidadId}`),
		['CONDUCTOR:w1', 'DEVICE:km1']);
	assert.deepEqual(plan.instalacionesTecnicas.map((i) => i.conductorId), ['w1']);
	assert.deepEqual(plan.prospectivasTecnicas.map((x) => x.indice), [0]);
	assert.deepEqual(plan.rolesDependientes, [{ dispositivoId: 'aux', maestroId: 'km1' }]);
	assert.deepEqual(plan.metadatosCircuitoAfectados[0].conductoresReasignables, ['w1']);
	assert.deepEqual(plan.decisionesHistoricasAfectadas, ['historia-km1']);
	assert.equal(JSON.stringify(p), antes, 'mostrar y cancelar el plan no crea mutación');
});

test('ESQ-04 aplica un único borrado eléctrico sin tocar otra conexión, rutas ni revisiones compartidas', () => {
	const p = fixture();
	const cableAjeno = structuredClone(p.conductores.find((c) => c.id === 'w3'));
	const revisiones = p.datosTecnicos!.revisiones;
	aplicarEliminacionDispositivos(p, planificarEliminacionDispositivos(p, ['km1']));
	assert.deepEqual(p.dispositivos.map((d) => d.id), ['q1', 'x1', 'aux']);
	assert.equal(p.dispositivos.find((d) => d.id === 'aux')?.rol, undefined);
	assert.deepEqual(p.conductores.map((c) => c.id), ['w3']);
	assert.deepEqual(p.conductores[0], cableAjeno);
	assert.deepEqual(p.esquema?.representaciones?.map((r) => r.id), ['v-q1', 'v-x1', 'v-aux']);
	assert.deepEqual(p.hojas.map((h) => h.id), ['potencia', 'mando', 'sin-cambios']);
	assert.deepEqual(p.gabinete?.colocaciones.map((c) => c.dispositivoId), ['q1', 'x1']);
	assert.deepEqual(p.datosTecnicos?.vinculos.map((v) => `${v.entidad}:${v.entidadId}`),
		['DEVICE:q1', 'CONDUCTOR:w3']);
	assert.deepEqual(p.datosTecnicos?.instalaciones.map((i) => i.conductorId), ['w3']);
	assert.equal(p.datosTecnicos?.prospectiva?.length, 1);
	assert.equal(p.datosTecnicos?.revisiones, revisiones, 'las revisiones técnicas compartidas permanecen');
	assert.deepEqual(p.ingenieria?.circuitos?.['c-a'].conductoresReasignablesFase, ['w3']);
	assert.equal(p.ingenieria?.disenoAsistido?.decisiones.length, 1,
		'las decisiones V9 son historial y no se eliminan silenciosamente');
});

test('ESQ-04 conserva ausencia legacy frente a lista vacía explícita', () => {
	for (const esquema of [undefined, { representaciones: [] }]) {
		const p = fixture();
		p.esquema = esquema;
		aplicarEliminacionDispositivos(p, planificarEliminacionDispositivos(p, ['km1']));
		assert.deepEqual(p.esquema, esquema);
	}
});

test('ESQ-04 revalida proyecto, versión y solo lectura antes de mutar', () => {
	const a = fixture(), b = fixture();
	const plan = planificarEliminacionDispositivos(a, ['km1']);
	const antesB = JSON.stringify(b);
	assert.throws(() => aplicarEliminacionDispositivos(b, plan), /cambió durante/);
	assert.equal(JSON.stringify(b), antesB);
	a.nombre = 'Editado durante el diálogo';
	const antesA = JSON.stringify(a);
	assert.throws(() => aplicarEliminacionDispositivos(a, plan), /cambió durante/);
	assert.equal(JSON.stringify(a), antesA);
	const ejemplo = fixture(); ejemplo.esEjemplo = true;
	const antesEjemplo = JSON.stringify(ejemplo);
	assert.throws(() => aplicarEliminacionDispositivos(ejemplo,
		planificarEliminacionDispositivos(ejemplo, ['km1'])), /solo lectura/);
	assert.equal(JSON.stringify(ejemplo), antesEjemplo);
});

test('ESQ-04 el preview no decide qué cable borrar y los IDs ambiguos se rechazan', () => {
	const p = fixture();
	const plan = planificarEliminacionDispositivos(p, ['km1']);
	(plan.conductores as unknown as { id: string }[]).splice(0);
	aplicarEliminacionDispositivos(p, plan);
	assert.deepEqual(p.conductores.map((c) => c.id), ['w3'],
		'se usa la conectividad validada, no una lista mutable mostrada en pantalla');
	const ambiguo = fixture();
	ambiguo.conductores.push(structuredClone(ambiguo.conductores[0]));
	const antes = JSON.stringify(ambiguo);
	assert.throws(() => planificarEliminacionDispositivos(ambiguo, ['km1']), /IDs.*repetidos/);
	assert.equal(JSON.stringify(ambiguo), antes);
});

test('ESQ-04 aplica selección múltiple independientemente del orden de IDs o arrays', () => {
	const a = fixture(), b = fixture();
	b.dispositivos.reverse(); b.conductores.reverse(); b.esquema!.representaciones!.reverse();
	const pa = planificarEliminacionDispositivos(a, ['km1', 'q1']);
	const pb = planificarEliminacionDispositivos(b, ['q1', 'km1']);
	assert.deepEqual(pa.ids, pb.ids);
	assert.deepEqual(pa.conductores.map((c) => c.id), pb.conductores.map((c) => c.id));
	assert.deepEqual(pa.representaciones.map((r) => r.id), pb.representaciones.map((r) => r.id));
	aplicarEliminacionDispositivos(a, pa); aplicarEliminacionDispositivos(b, pb);
	assert.deepEqual(a.dispositivos.map((d) => d.id).sort(), b.dispositivos.map((d) => d.id).sort());
	assert.deepEqual(a.conductores.map((c) => c.id).sort(), b.conductores.map((c) => c.id).sort());
	assert.deepEqual(a.esquema?.representaciones?.map((r) => r.id).sort(),
		b.esquema?.representaciones?.map((r) => r.id).sort());
});

test('ESQ-04 el Proyecto saneado reabre sin vistas o vínculos directos huérfanos', () => {
	const p = fixture();
	aplicarEliminacionDispositivos(p, planificarEliminacionDispositivos(p, ['km1']));
	const abierto = cargarProyecto(JSON.stringify(p));
	assert.deepEqual(abierto.proyecto.dispositivos.map((d) => d.id), ['q1', 'x1', 'aux']);
	assert.deepEqual(abierto.proyecto.esquema?.representaciones?.map((r) => r.id),
		['v-q1', 'v-x1', 'v-aux']);
	assert.deepEqual(abierto.proyecto.conductores.map((c) => c.id), ['w3']);
	assert.deepEqual(abierto.diagnosticos, [], 'la recarga no necesitó reparar referencias eliminadas');
});
