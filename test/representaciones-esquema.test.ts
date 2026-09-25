import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ArchivoInvalido, cargarProyecto } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import type { Proyecto, RepresentacionEsquema } from '../src/modelo/tipos.js';
import { montarEsquema } from '../src/motores/esquema.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';

const abrir = (p: unknown) => cargarProyecto(JSON.stringify(p));

function proyectoBase(): Proyecto {
	const p = crearProyecto('M2 representaciones');
	p.gabinete = { ancho: 400, alto: 600, rieles: [], canaletas: [], colocaciones: [] };
	p.hojas = [
		{ id: 'potencia', numero: 1, titulo: 'Potencia' },
		{ id: 'mando', numero: 2, titulo: 'Mando' },
	];
	p.dispositivos = [
		{
			id: 'km1', tipo: 'contactor', designacion: '-KM1',
			bornes: ['1/L1', '2/T1', '3/L2', '4/T2', 'A1', 'A2', '13', '14'].map((id) => ({ id })),
			comportamiento: {
				version: 1, clase: 'contactos-electromagneticos',
				bobina: { entrada: 'A1', retorno: 'A2' },
				polos: [{ entrada: '1/L1', salida: '2/T1' }, { entrada: '3/L2', salida: '4/T2' }],
				contactos: [{ entrada: '13', salida: '14', reposo: 'abierto', funcion: 'auxiliar' }],
			},
		},
		{ id: 'x1', tipo: 'bornero', bornes: [{ id: '1' }] },
	];
	p.conductores = [{ id: 'c1', de: { dispositivoId: 'km1', borneId: 'A1' },
		a: { dispositivoId: 'x1', borneId: '1' } }];
	return p;
}

function vistas(): RepresentacionEsquema[] {
	return [
		{ id: 'vista-bobina', dispositivoId: 'km1', hojaId: 'mando',
			posicion: { columna: 3, fila: 2 }, parte: { tipo: 'bobina' } },
		{ id: 'vista-polos', dispositivoId: 'km1', hojaId: 'potencia',
			posicion: { columna: 4, fila: 3 }, parte: { tipo: 'contactos', pares: [
				{ entrada: '1/L1', salida: '2/T1' }, { entrada: '3/L2', salida: '4/T2' },
			] } },
		{ id: 'vista-aux', dispositivoId: 'km1', hojaId: 'mando',
			posicion: { columna: 5, fila: 4 }, parte: { tipo: 'contactos', pares: [
				{ entrada: '13', salida: '14' },
			] } },
	];
}

function abrirVistas(bruto: unknown): ReturnType<typeof cargarProyecto> {
	const p = proyectoBase() as unknown as Record<string, unknown>;
	p.esquema = { representaciones: bruto };
	return abrir(p);
}

test('ausencia legacy y lista vacía explícita sobreviven a guardar y reabrir', () => {
	const legacy = proyectoBase();
	legacy.esquema = { columnasPorHoja: 6, titulos: { 1: 'Plano anterior' } };
	const cargaLegacy = abrir(legacy);
	assert.equal(cargaLegacy.proyecto.esquema?.representaciones, undefined);
	assert.equal(cargaLegacy.proyecto.esquema?.titulos?.['1'], 'Plano anterior');
	assert.equal(abrir(cargaLegacy.proyecto).proyecto.esquema?.representaciones, undefined);

	const vacio = proyectoBase();
	vacio.esquema = { representaciones: [] };
	const cargaVacia = abrir(vacio);
	assert.deepEqual(cargaVacia.proyecto.esquema?.representaciones, []);
	assert.deepEqual(abrir(cargaVacia.proyecto).proyecto.esquema?.representaciones, []);
	assert.deepEqual(cargaVacia.diagnosticos, []);
});

test('M2 vacío conserva cero folios para que la UI pueda crear el primero', () => {
	const p = proyectoBase();
	p.hojas = [];
	p.esquema = { representaciones: [] };
	const carga = abrir(p);
	assert.deepEqual(carga.proyecto.hojas, []);
	assert.deepEqual(carga.proyecto.esquema?.representaciones, []);
	assert.deepEqual(carga.diagnosticos, []);
	assert.deepEqual(abrir(carga.proyecto).proyecto.hojas, []);
	assert.deepEqual(montarEsquema(carga.proyecto, calcularPotenciales(carga.proyecto)), []);
	const conVista = proyectoBase();
	conVista.hojas = [];
	conVista.esquema = { representaciones: vistas() };
	assert.throws(() => abrir(conVista), ArchivoInvalido);
});

test('tres vistas de un aparato conservan IDs, hojas, pares y circuito en ida y vuelta', () => {
	const p = proyectoBase();
	p.esquema = { representaciones: vistas() };
	const antes = JSON.stringify(p);
	const carga = abrir(p);
	assert.equal(JSON.stringify(p), antes, 'abrir no muta el proyecto de origen');
	assert.deepEqual(carga.diagnosticos, []);
	assert.deepEqual(carga.proyecto.esquema?.representaciones, vistas());
	assert.deepEqual(abrir(carga.proyecto).proyecto.esquema?.representaciones, vistas());
	assert.equal(carga.proyecto.dispositivos.filter((d) => d.id === 'km1').length, 1);
	assert.equal(JSON.stringify(carga.proyecto.conductores), JSON.stringify(p.conductores));
});

test('resolver por IDs no depende del orden de hojas, bornes, perfil o vistas', () => {
	const p = proyectoBase();
	p.hojas.reverse();
	p.dispositivos[0].bornes.reverse();
	const perfil = p.dispositivos[0].comportamiento;
	if (perfil?.clase !== 'contactos-electromagneticos') throw new Error('fixture sin perfil');
	perfil.polos.reverse();
	const invertidas = vistas().reverse();
	p.esquema = { representaciones: invertidas };
	const r = abrir(p);
	assert.deepEqual(r.diagnosticos, []);
	assert.deepEqual(r.proyecto.esquema?.representaciones, invertidas,
		'el cargador conserva el orden de dibujo sin depender de índices eléctricos');
});

test('campo presente hostil queda explícitamente vacío y declara la reparación', () => {
	for (const bruto of [null, 'bobina', { longitudMm: 999 }]) {
		const r = abrirVistas(bruto);
		assert.deepEqual(r.proyecto.esquema?.representaciones, []);
		assert.ok(r.diagnosticos.some((d) => d.ruta === 'esquema.representaciones'));
		assert.ok(r.arreglos.length > 0);
	}
});

test('entradas hostiles y referencias inexistentes no atraviesan el lector', () => {
	const buena = vistas()[0];
	const malas: unknown[] = [
		null,
		{ ...buena, id: '   ' },
		{ ...buena, dispositivoId: 'no-existe' },
		{ ...buena, hojaId: 'no-existe' },
		{ ...buena, posicion: { columna: '3', fila: 2 } },
		{ ...buena, posicion: { columna: Infinity, fila: 2 } },
		{ ...buena, longitudMm: 1000 },
		{ ...buena, parte: { tipo: 'unión', conductorId: 'c1' } },
	];
	const r = abrirVistas([...malas, buena]);
	assert.deepEqual(r.proyecto.esquema?.representaciones, [buena]);
	assert.equal(r.diagnosticos.filter((d) => d.ruta.startsWith('esquema.representaciones[')).length,
		malas.length);
	assert.ok(r.arreglos.length > 0, 'las pérdidas congelan el guardado automático');
});

test('pares deben existir como bornes y como funciones declaradas, sin índice ni duplicados', () => {
	const base = vistas()[1];
	const conPares = (pares: unknown) => ({ ...base, parte: { tipo: 'contactos', pares } });
	for (const mala of [
		conPares([{ entrada: '1/L1', salida: 'FANTASMA' }]),
		conPares([{ entrada: 'A1', salida: 'A2' }]),
		conPares([{ entrada: '2/T1', salida: '1/L1' }]),
		conPares([{ entrada: '1/L1', salida: '2/T1' }, { entrada: '1/L1', salida: '2/T1' }]),
		conPares([]),
		conPares('1/L1→2/T1'),
	]) {
		const r = abrirVistas([mala]);
		assert.deepEqual(r.proyecto.esquema?.representaciones, []);
		assert.equal(r.diagnosticos[0]?.ruta, 'esquema.representaciones[0]');
	}
	const sinPerfil = proyectoBase();
	sinPerfil.dispositivos[0].comportamiento = undefined;
	sinPerfil.esquema = { representaciones: [vistas()[0]] };
	const legado = abrir(sinPerfil);
	assert.deepEqual(legado.proyecto.esquema?.representaciones, [vistas()[0]],
		'los bornes IEC legacy resuelven la bobina sin persistir un perfil artificial');
	sinPerfil.dispositivos[0].bornes = sinPerfil.dispositivos[0].bornes.filter((b) => b.id !== 'A2');
	const sinBorne = abrir(sinPerfil);
	assert.deepEqual(sinBorne.proyecto.esquema?.representaciones, []);
	assert.match(sinBorne.diagnosticos[0]?.motivo ?? '', /bobina/);
});

test('IDs repetidos y bornes en dos vistas se rechazan sin ganar por posición de archivo', () => {
	const [bobina, polos, auxiliar] = vistas();
	const idRepetido = { ...polos, id: bobina.id };
	for (const lista of [[bobina, idRepetido, auxiliar], [auxiliar, idRepetido, bobina]]) {
		const r = abrirVistas(lista);
		assert.deepEqual(r.proyecto.esquema?.representaciones?.map((v) => v.id), [auxiliar.id]);
		assert.equal(r.diagnosticos.filter((d) => /ID gráfico estaba repetido/.test(d.motivo)).length, 2);
	}
	const otroPolo = { ...polos, id: 'vista-polos-2', hojaId: 'mando' };
	for (const lista of [[bobina, polos, otroPolo], [otroPolo, polos, bobina]]) {
		const r = abrirVistas(lista);
		assert.deepEqual(r.proyecto.esquema?.representaciones?.map((v) => v.id), [bobina.id]);
		assert.equal(r.diagnosticos.filter((d) => /borne estaba dibujado/.test(d.motivo)).length, 2);
	}
});

test('un ID de hoja M2 duplicado impide importar sin perder sus vistas', () => {
	const p = proyectoBase();
	p.hojas.push({ id: 'mando', numero: 3, titulo: 'Duplicada' });
	p.esquema = { representaciones: [vistas()[0], vistas()[1]] };
	for (const hojas of [p.hojas, [...p.hojas].reverse()]) {
		p.hojas = hojas;
		assert.throws(() => abrir(p), (e: Error) => e instanceof ArchivoInvalido
			&& /ID de hoja repetido/i.test(e.message));
	}
});

test('un número de hoja M2 duplicado impide referencias cruzadas ambiguas', () => {
	const p = proyectoBase();
	p.hojas[1].numero = p.hojas[0].numero;
	p.esquema = { representaciones: vistas() };
	assert.throws(() => abrir(p), (e: Error) => e instanceof ArchivoInvalido
		&& /número de hoja repetido/i.test(e.message));
});

test('identidad M2 inválida nunca se repara eligiendo una hoja por orden', () => {
	for (const [campo, valor] of [
		['id', ' mando '], ['id', 'mando\u0000'], ['id', ''],
		['numero', '2'], ['numero', 0], ['numero', 2.5],
	] as const) {
		const p = proyectoBase();
		(p.hojas[1] as unknown as Record<string, unknown>)[campo] = valor;
		p.esquema = { representaciones: vistas() };
		assert.throws(() => abrir(p), (e: Error) => e instanceof ArchivoInvalido
			&& /hoja.*M2|esquema M2/.test(e.message), `${campo}=${JSON.stringify(valor)}`);
	}
	const p = proyectoBase() as unknown as Record<string, unknown>;
	p.esquema = { representaciones: null }; // campo presente corrupto: no es legacy implícito
	p.hojas = [{ id: 'potencia', numero: 1, titulo: 'Potencia' },
		{ id: 'potencia', numero: 2, titulo: 'Otro folio' }];
	assert.throws(() => abrir(p), ArchivoInvalido);
});

test('metadatos editoriales M2 corruptos se declaran sin descartar vistas', () => {
	const p = proyectoBase() as unknown as Record<string, unknown>;
	p.esquema = { representaciones: vistas() };
	p.hojas = [{ id: 'potencia', numero: 1, titulo: 'Potencia' },
		{ id: 'mando', numero: 2, titulo: { texto: 'falso' }, clase: 'otro', columnas: 'diez' }];
	const r = abrir(p);
	assert.deepEqual(r.proyecto.esquema?.representaciones?.map((v) => v.id),
		['vista-bobina', 'vista-polos', 'vista-aux']);
	assert.deepEqual(r.proyecto.hojas[1], { id: 'mando', numero: 2, titulo: 'Hoja 2' });
	assert.deepEqual(r.diagnosticos.map((d) => d.ruta).sort(),
		['hojas[1].clase', 'hojas[1].columnas', 'hojas[1].titulo']);
});

test('un contacto con común compartido no puede sobrescribir su anclaje gráfico', () => {
	const p = proyectoBase();
	const perfil = p.dispositivos[0].comportamiento;
	if (perfil?.clase !== 'contactos-electromagneticos') throw new Error('fixture sin perfil');
	perfil.contactos.push({ entrada: '13', salida: 'A1', reposo: 'cerrado', funcion: 'auxiliar' });
	const auxiliar = vistas()[2];
	if (auxiliar.parte.tipo !== 'contactos') throw new Error('fixture sin contactos');
	p.esquema = { representaciones: [{ ...auxiliar, parte: { tipo: 'contactos', pares: [
		...auxiliar.parte.pares, { entrada: '13', salida: 'A1' },
	] } }] };
	const r = abrir(p);
	assert.deepEqual(r.proyecto.esquema?.representaciones, []);
	assert.match(r.diagnosticos[0]?.motivo ?? '', /borne compartido/);
});

// El oráculo de montaje de corte 2 está activo en esquema-representaciones.test.ts.
