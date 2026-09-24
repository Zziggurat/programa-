import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EJEMPLOS } from '../ejemplo/biblioteca.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import { generarBOM } from '../src/motores/documentacion.js';
import {
	planActivacionRepresentaciones, planDesdoblamientoRepresentacion,
	planPartesDesdoblamiento,
} from '../src/motores/crear-representaciones-esquema.js';
import { montarEsquema } from '../src/motores/esquema.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';

function proyectoDosHojas(): Proyecto {
	const p = crearProyecto('Activación M2');
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Hoja 1' }];
	p.gabinete = { ancho: 400, alto: 600, rieles: [], canaletas: [], colocaciones: [] };
	p.dispositivos = [
		{ id: 'm1', tipo: 'motor', bornes: [{ id: 'U' }] },
		{ id: 'km1', tipo: 'contactor', bornes:
			['1/L1', '2/T1', 'A1', 'A2', '13', '14'].map((id) => ({ id })),
			comportamiento: { version: 1, clase: 'contactos-electromagneticos',
				bobina: { entrada: 'A1', retorno: 'A2' },
				polos: [{ entrada: '1/L1', salida: '2/T1' }],
				contactos: [{ entrada: '13', salida: '14', funcion: 'auxiliar', reposo: 'abierto' }],
			},
		},
		{ id: 's1', tipo: 'pulsador', bornes: [{ id: '13' }, { id: '14' }] },
	];
	p.conductores = [
		{ id: 'c-potencia', de: { dispositivoId: 'km1', borneId: '2/T1' },
			a: { dispositivoId: 'm1', borneId: 'U' } },
		{ id: 'c-mando', de: { dispositivoId: 'km1', borneId: 'A1' },
			a: { dispositivoId: 's1', borneId: '13' } },
	];
	return p;
}

function activar(p: Proyecto): void {
	const plan = planActivacionRepresentaciones(p, calcularPotenciales(p));
	assert.equal(plan.ok, true, !plan.ok ? plan.motivo : undefined);
	if (!plan.ok) return;
	p.hojas = plan.valor.hojas;
	p.esquema = { ...p.esquema, representaciones: plan.valor.representaciones };
}

test('activar legacy materializa todas las vistas y hojas estables sin tocar circuito ni proyecto antes de aplicar', () => {
	const p = proyectoDosHojas();
	const antes = JSON.stringify(p);
	const bom = generarBOM(p);
	const legado = montarEsquema(p, calcularPotenciales(p));
	assert.equal(legado.length, 2);
	const plan = planActivacionRepresentaciones(p, calcularPotenciales(p));
	assert.equal(plan.ok, true, !plan.ok ? plan.motivo : undefined);
	if (!plan.ok) return;
	assert.equal(JSON.stringify(p), antes);
	assert.equal(plan.valor.representaciones.length, 3);
	assert.deepEqual(plan.valor.representaciones.map((r) => r.parte.tipo),
		['completa', 'completa', 'completa']);
	assert.deepEqual(plan.valor.foliosVisibles.map((h) => h.numero), [1, 2]);
	assert.equal(plan.valor.foliosVisibles[0].id, 'h1');
	assert.equal(plan.valor.foliosVisibles[0].titulo, 'Hoja 1');
	assert.equal(plan.valor.foliosVisibles[0].tituloLegacy, legado[0].titulo);
	assert.deepEqual(plan.valor.hojas[0], p.hojas[0], 'no se reescriben metadatos de la hoja existente');
	assert.equal(plan.valor.foliosVisibles[1].nueva, true);
	p.hojas = plan.valor.hojas;
	p.esquema = { ...p.esquema, representaciones: plan.valor.representaciones };
	const explicito = montarEsquema(p, calcularPotenciales(p));
	assert.deepEqual(explicito.map((h) => h.id), plan.valor.foliosVisibles.map((h) => h.id));
	assert.deepEqual(explicito.flatMap((h) => h.simbolos.map((s) => s.dispositivoId)).sort(),
		legado.flatMap((h) => h.simbolos.map((s) => s.dispositivoId)).sort());
	assert.equal(explicito.flatMap((h) => h.problemas ?? []).length, 0);
	assert.deepEqual(p.conductores, JSON.parse(antes).conductores);
	assert.deepEqual(generarBOM(p), bom);
	const carga = cargarProyecto(JSON.stringify(p));
	assert.ok(carga.proyecto);
	assert.deepEqual(carga.proyecto.esquema?.representaciones, p.esquema?.representaciones);
});

test('activación bloquea ambiguos y respeta [] explícito sin fabricar símbolos', () => {
	const p = proyectoDosHojas();
	p.dispositivos[1].bornes.push({ id: 'A1' });
	const ambiguo = planActivacionRepresentaciones(p, calcularPotenciales(p));
	assert.equal(ambiguo.ok, false);
	assert.match(!ambiguo.ok ? ambiguo.motivo : '', /bornes repetidos/);
	p.dispositivos[1].bornes.pop();
	p.esquema = { representaciones: [] };
	const vacio = planActivacionRepresentaciones(p, calcularPotenciales(p));
	assert.equal(vacio.ok, false);
	assert.equal(p.esquema.representaciones?.length, 0);
});

test('activar no descarta una hoja persistente adicional sin dibujo legacy', () => {
	const p = proyectoDosHojas();
	p.hojas[0].titulo = 'Folio persistente';
	p.hojas[0].columnas = 8;
	p.hojas.push({ id: 'anexo', numero: 9, titulo: 'Anexo existente', columnas: 12 });
	const plan = planActivacionRepresentaciones(p, calcularPotenciales(p));
	assert.equal(plan.ok, true, !plan.ok ? plan.motivo : undefined);
	if (!plan.ok) return;
	assert.equal(plan.valor.hojasConservadasSinDibujo, 1);
	assert.deepEqual(plan.valor.hojas.find((h) => h.id === 'anexo'),
		{ id: 'anexo', numero: 9, titulo: 'Anexo existente', columnas: 12 });
	assert.deepEqual(plan.valor.hojas.find((h) => h.id === 'h1'), p.hojas[0]);
	assert.equal(plan.valor.foliosVisibles[0].columnas, 8);
	assert.equal(plan.valor.foliosVisibles[0].columnasLegacy, 10);
	assert.equal(plan.valor.representaciones.length, 3);
	assert.ok(plan.valor.representaciones.every((r) => r.hojaId !== 'anexo'));
});

test('activación no estrecha una hoja existente ni recorta un símbolo legacy', () => {
	const p = proyectoDosHojas();
	p.hojas[0].columnas = 4;
	p.dispositivos[0].esquema = { columna: 9, fila: 3 };
	const antes = JSON.stringify(p);
	const plan = planActivacionRepresentaciones(p, calcularPotenciales(p));
	assert.equal(plan.ok, false);
	assert.match(!plan.ok ? plan.motivo : '', /no cabría/);
	assert.equal(JSON.stringify(p), antes);
});

test('desdoblar reemplaza una completa por bobina/polos/aux en dos hojas sin duplicar identidad ni cables', () => {
	const p = proyectoDosHojas();
	activar(p);
	const origen = p.esquema!.representaciones!.find((r) => r.dispositivoId === 'km1')!;
	const partes = planPartesDesdoblamiento(p, origen.id);
	assert.equal(partes.ok, true, !partes.ok ? partes.motivo : undefined);
	if (!partes.ok) return;
	assert.deepEqual(partes.valor.partes.map((parte) => parte.funcion), ['bobina', 'polos', 'auxiliares']);
	const antes = JSON.stringify(p);
	const bom = generarBOM(p);
	const desdoblar = planDesdoblamientoRepresentacion(p, origen.id, {
		bobina: { hojaId: p.hojas[1].id, columna: 4, fila: 5 },
		polos: { hojaId: p.hojas[0].id, columna: 4, fila: 3 },
		auxiliares: { hojaId: p.hojas[1].id, columna: 6, fila: 3 },
	});
	assert.equal(desdoblar.ok, true, !desdoblar.ok ? desdoblar.motivo : undefined);
	if (!desdoblar.ok) return;
	assert.equal(JSON.stringify(p), antes);
	const lista = p.esquema!.representaciones!;
	lista.splice(lista.indexOf(origen), 1, ...desdoblar.valor);
	const hojas = montarEsquema(p, calcularPotenciales(p));
	assert.equal(hojas.flatMap((h) => h.simbolos).filter((s) => s.dispositivoId === 'km1').length, 3);
	assert.equal(hojas.flatMap((h) => h.problemas ?? []).length, 0);
	assert.equal(p.dispositivos.filter((d) => d.id === 'km1').length, 1);
	assert.equal(p.conductores.length, 2);
	assert.deepEqual(generarBOM(p), bom);
	assert.deepEqual(cargarProyecto(JSON.stringify(p)).proyecto.esquema?.representaciones, lista);
});

test('desdoblamiento rechaza cobertura incompleta, común compartido y casilla ocupada sin mutar', () => {
	const p = proyectoDosHojas();
	activar(p);
	const origen = p.esquema!.representaciones!.find((r) => r.dispositivoId === 'km1')!;
	const antes = JSON.stringify(p);
	const coincidente = planDesdoblamientoRepresentacion(p, origen.id, {
		bobina: { hojaId: origen.hojaId, columna: 4, fila: 3 },
		polos: { hojaId: origen.hojaId, columna: 4, fila: 3 },
		auxiliares: { hojaId: origen.hojaId, columna: 6, fila: 3 },
	});
	assert.equal(coincidente.ok, false);
	assert.match(!coincidente.ok ? coincidente.motivo : '', /ya tiene otra vista/);
	assert.equal(JSON.stringify(p), antes);
	p.dispositivos[1].bornes.push({ id: 'extra' });
	const extra = planPartesDesdoblamiento(p, origen.id);
	assert.equal(extra.ok, false);
	assert.match(!extra.ok ? extra.motivo : '', /no cubre los bornes/);
	p.dispositivos[1].bornes.pop();
	const perfil = p.dispositivos[1].comportamiento;
	if (perfil?.clase !== 'contactos-electromagneticos') throw new Error('perfil fixture');
	perfil.contactos.push({ entrada: '13', salida: 'A2', funcion: 'auxiliar', reposo: 'abierto' });
	const compartido = planPartesDesdoblamiento(p, origen.id);
	assert.equal(compartido.ok, false);
	assert.match(!compartido.ok ? compartido.motivo : '', /duplicaría anclajes/);
});

test('KM1 del arranque directo legacy se desdobla y reabre sin persistir perfil artificial', () => {
	const p = EJEMPLOS.find((e) => e.id === 'arranque-directo')!.crear();
	const km1 = p.dispositivos.find((d) => d.id === 'km1')!;
	assert.equal(km1.comportamiento, undefined);
	const bom = generarBOM(p);
	const cables = p.conductores.map((c) => c.id);
	const activacion = planActivacionRepresentaciones(p, calcularPotenciales(p));
	assert.equal(activacion.ok, true, !activacion.ok ? activacion.motivo : undefined);
	if (!activacion.ok) return;
	p.hojas = activacion.valor.hojas;
	p.esquema = { ...p.esquema, representaciones: activacion.valor.representaciones };
	const origen = p.esquema.representaciones!.find((r) => r.dispositivoId === 'km1')!;
	const partes = planPartesDesdoblamiento(p, origen.id);
	assert.equal(partes.ok, true, !partes.ok ? partes.motivo : undefined);
	if (!partes.ok) return;
	assert.deepEqual(partes.valor.partes.map((item) => item.funcion), ['bobina', 'polos', 'auxiliares']);
	const huecos = [
		{ hojaId: p.hojas[1].id, columna: 9, fila: 6 },
		{ hojaId: p.hojas[0].id, columna: 9, fila: 6 },
		{ hojaId: p.hojas[1].id, columna: 10, fila: 6 },
	];
	const plan = planDesdoblamientoRepresentacion(p, origen.id,
		{ bobina: huecos[0], polos: huecos[1], auxiliares: huecos[2] });
	assert.equal(plan.ok, true, !plan.ok ? plan.motivo : undefined);
	if (!plan.ok) return;
	const lista = p.esquema.representaciones!;
	lista.splice(lista.indexOf(origen), 1, ...plan.valor);
	const montado = montarEsquema(p, calcularPotenciales(p));
	assert.equal(montado.flatMap((h) => h.simbolos).filter((s) => s.dispositivoId === 'km1').length, 3);
	assert.equal(montado.flatMap((h) => h.problemas ?? []).filter((x) => x.dispositivoId === 'km1').length, 0);
	assert.deepEqual(generarBOM(p), bom);
	assert.deepEqual(p.conductores.map((c) => c.id), cables);
	const reabierto = cargarProyecto(JSON.stringify(p)).proyecto;
	assert.equal(reabierto.dispositivos.find((d) => d.id === 'km1')?.comportamiento, undefined);
	assert.equal(reabierto.esquema?.representaciones?.filter((r) => r.dispositivoId === 'km1').length, 3);
	assert.equal(montarEsquema(reabierto, calcularPotenciales(reabierto)).flatMap((h) => h.simbolos)
		.filter((s) => s.dispositivoId === 'km1').length, 3);
});
