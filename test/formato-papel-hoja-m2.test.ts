import assert from 'node:assert/strict';
import test from 'node:test';

import { ArchivoInvalido, cargarProyecto } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import { aplicarGestionHojaEsquema, previsualizarGestionHojaEsquema } from '../src/motores/gestion-hojas-esquema.js';
import { HOJA_A2, HOJA_A3, montarEsquema } from '../src/motores/esquema.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';

function proyectoM2(): Proyecto {
	const p = crearProyecto('Papel por folio');
	p.gabinete = { ancho: 600, alto: 400, rieles: [], canaletas: [], colocaciones: [] };
	p.hojas = [
		{ id: 'fuerza', numero: 1, titulo: 'Fuerza' },
		{ id: 'control', numero: 2, titulo: 'Control' },
	];
	p.dispositivos = [
		{ id: 'x1', tipo: 'bornero', bornes: [{ id: '1' }] },
		{ id: 'x2', tipo: 'bornero', bornes: [{ id: '1' }] },
	];
	p.conductores = [{ id: 'w1', de: { dispositivoId: 'x1', borneId: '1' },
		a: { dispositivoId: 'x2', borneId: '1' } }];
	p.esquema = { representaciones: [
		{ id: 'vista-x1', dispositivoId: 'x1', hojaId: 'fuerza',
			posicion: { columna: 8, fila: 6 }, parte: { tipo: 'completa' } },
		{ id: 'vista-x2', dispositivoId: 'x2', hojaId: 'control',
			posicion: { columna: 2, fila: 2 }, parte: { tipo: 'completa' } },
	] };
	return p;
}

test('A2 declarado vive en el proyecto, el preview y el roundtrip sin tocar el grafo', () => {
	const p = proyectoM2();
	const antes = JSON.stringify(p);
	const plan = previsualizarGestionHojaEsquema(p,
		{ tipo: 'editar', id: 'fuerza', formatoPapel: 'A2' });
	assert.equal(JSON.stringify(p), antes);
	assert.equal(plan.hojasAntes[0].formatoPapel, 'A3');
	assert.equal(plan.hojasAntes[0].formatoPapelDeclarado, undefined);
	assert.equal(plan.hojasDespues[0].formatoPapel, 'A2');
	assert.equal(plan.hojasDespues[0].formatoPapelDeclarado, 'A2');
	assert.equal(plan.cambios, 1);
	assert.deepEqual(plan.vistasAfectadas.map((r) => r.id), ['vista-x1']);
	aplicarGestionHojaEsquema(p, plan);
	assert.equal(p.hojas[0].formatoPapel, 'A2');
	assert.equal(JSON.stringify(p.conductores), JSON.stringify(proyectoM2().conductores));
	assert.equal(JSON.stringify(p.esquema?.representaciones), JSON.stringify(proyectoM2().esquema?.representaciones));
	const leido = cargarProyecto(JSON.stringify(p));
	assert.deepEqual(leido.diagnosticos, []);
	assert.equal(leido.proyecto.hojas[0].formatoPapel, 'A2');
	assert.equal(Object.hasOwn(leido.proyecto.hojas[1], 'formatoPapel'), false);
	assert.deepEqual(montarEsquema(leido.proyecto, calcularPotenciales(leido.proyecto))
		.map((h) => [h.id, h.anchoMm, h.altoMm]),
		[['fuerza', 594, 420], ['control', 420, 297]]);
});

test('crear, declarar A3 explícito y restaurar herencia son decisiones persistentes distintas', () => {
	const p = proyectoM2();
	const nuevo = previsualizarGestionHojaEsquema(p,
		{ tipo: 'crear', id: 'anexo', titulo: 'Anexo', formatoPapel: 'A2' });
	aplicarGestionHojaEsquema(p, nuevo);
	assert.equal(p.hojas.find((h) => h.id === 'anexo')?.formatoPapel, 'A2');
	const declarar = previsualizarGestionHojaEsquema(p,
		{ tipo: 'editar', id: 'control', formatoPapel: 'A3' });
	assert.equal(declarar.cambios, 1, 'declarar A3 no es el mismo estado que heredar A3');
	assert.equal(declarar.hojasDespues.find((h) => h.id === 'control')?.formatoPapel, 'A3');
	assert.equal(declarar.hojasDespues.find((h) => h.id === 'control')?.formatoPapelDeclarado, 'A3');
	aplicarGestionHojaEsquema(p, declarar);
	const mantener = previsualizarGestionHojaEsquema(p,
		{ tipo: 'editar', id: 'control', formatoPapel: undefined });
	assert.equal(mantener.cambios, 0);
	const restaurar = previsualizarGestionHojaEsquema(p,
		{ tipo: 'editar', id: 'control', formatoPapel: null });
	assert.equal(restaurar.cambios, 1);
	assert.equal(restaurar.hojasDespues.find((h) => h.id === 'control')?.formatoPapel, 'A3');
	assert.equal(restaurar.hojasDespues.find((h) => h.id === 'control')?.formatoPapelDeclarado, undefined);
	aplicarGestionHojaEsquema(p, restaurar);
	assert.equal(Object.hasOwn(p.hojas.find((h) => h.id === 'control')!, 'formatoPapel'), false);
	assert.equal(cargarProyecto(JSON.stringify(p)).proyecto.hojas.find((h) => h.id === 'anexo')?.formatoPapel, 'A2');
});

test('formato inválido M2 se rechaza; legacy lo diagnostica sin falsear su esquema', () => {
	const p = proyectoM2();
	const antes = JSON.stringify(p);
	assert.throws(() => previsualizarGestionHojaEsquema(p,
		{ tipo: 'editar', id: 'fuerza', formatoPapel: 'A0' as never }), /A3 o A2/);
	assert.equal(JSON.stringify(p), antes);
	p.hojas[0].formatoPapel = 'A0' as never;
	assert.throws(() => cargarProyecto(JSON.stringify(p)),
		(error: unknown) => error instanceof ArchivoInvalido && /formato de papel inválido/.test(error.message));
	assert.throws(() => previsualizarGestionHojaEsquema(p,
		{ tipo: 'editar', id: 'control', titulo: 'Otra' }), /papel inválido/);
	const legacy = structuredClone(p);
	legacy.esquema = undefined;
	const reparado = cargarProyecto(JSON.stringify(legacy));
	assert.ok(reparado.diagnosticos.some((d) => d.ruta === 'hojas[0].formatoPapel'));
	assert.equal(reparado.proyecto.hojas[0].formatoPapel, undefined);
});

test('cada folio usa sus propias coordenadas de papel para rejilla, símbolos y enlaces', () => {
	const p = proyectoM2();
	p.hojas[0].formatoPapel = 'A2';
	const [a2, a3] = montarEsquema(p, calcularPotenciales(p));
	const soloA3 = proyectoM2();
	const [fuerzaA3] = montarEsquema(soloA3, calcularPotenciales(soloA3));
	assert.deepEqual([a2.anchoMm, a2.altoMm], [HOJA_A2.ancho, HOJA_A2.alto]);
	assert.deepEqual([a3.anchoMm, a3.altoMm], [HOJA_A3.ancho, HOJA_A3.alto]);
	const a2x = a2.simbolos[0].x + a2.simbolos[0].ancho / 2;
	const fuerzaA3x = fuerzaA3.simbolos[0].x + fuerzaA3.simbolos[0].ancho / 2;
	assert.ok(a2x > fuerzaA3x, 'la misma columna debe desplazarse con el ancho de su papel');
	assert.ok(a2.simbolos[0].y > fuerzaA3.simbolos[0].y,
		'la banda de filas debe usar el alto de cada hoja, no un A3 global');
	assert.equal(a2.referencias.filter((r) => r.tipo === 'enlace').length, 1);
	assert.equal(a3.referencias.filter((r) => r.tipo === 'enlace').length, 1);
	assert.ok(a2.referencias[0].p.y > fuerzaA3.referencias[0].p.y,
		'la referencia entre folios también usa el alto de su hoja');
	const pHeredado = proyectoM2();
	const heredado = montarEsquema(pHeredado, calcularPotenciales(pHeredado),
		{ hoja: { ancho: 500, alto: 350 } });
	assert.deepEqual(heredado.map((h) => [h.anchoMm, h.altoMm]), [[500, 350], [500, 350]],
		'la ausencia sigue honrando la opción de papel usada por clientes legacy');
	pHeredado.hojas[0].formatoPapel = 'A3';
	const conOverride = montarEsquema(pHeredado, calcularPotenciales(pHeredado),
		{ hoja: { ancho: 500, alto: 350 } });
	assert.deepEqual(conOverride.map((h) => [h.anchoMm, h.altoMm]), [[420, 297], [500, 350]],
		'el A3 explícito prevalece sobre la opción global, y la hoja heredada no cambia');
});

test('el formato de folio y su geometría no dependen del orden de arrays', () => {
	const p = proyectoM2();
	p.hojas[0].formatoPapel = 'A2';
	const inverso = structuredClone(p);
	inverso.hojas.reverse();
	inverso.esquema!.representaciones!.reverse();
	inverso.dispositivos.reverse();
	inverso.conductores.reverse();
	const normal = montarEsquema(p, calcularPotenciales(p));
	const alReves = montarEsquema(inverso, calcularPotenciales(inverso));
	assert.deepEqual(normal.map((h) => [h.id, h.anchoMm, h.altoMm,
		h.simbolos.map((s) => [s.representacionId, s.x, s.y])]),
		alReves.map((h) => [h.id, h.anchoMm, h.altoMm,
			h.simbolos.map((s) => [s.representacionId, s.x, s.y])]));
});
