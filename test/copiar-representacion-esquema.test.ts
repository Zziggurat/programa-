import assert from 'node:assert/strict';
import test from 'node:test';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { identidadParaCopia } from '../src/modelo/identidad-copia.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import { planCopiarAparatoConVista } from '../src/motores/copiar-representacion-esquema.js';
import { montarEsquema } from '../src/motores/esquema.js';
import { hojaASvg } from '../app/esquema-svg.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';

function fixture(): Proyecto {
	const p = crearProyecto('Copia M2');
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Mando' }, { id: 'h2', numero: 2, titulo: 'Auxiliar' }];
	p.gabinete = { ancho: 400, alto: 400, rieles: [], canaletas: [], colocaciones: [
		{ dispositivoId: 'ps', x: 30, y: 40, ancho: 35, alto: 30 },
		{ dispositivoId: 'x1', x: 90, y: 40, ancho: 35, alto: 30 },
	] };
	p.dispositivos = [
		{ id: 'ps', tipo: 'fuente', bornes: [{ id: '+24' }, { id: '0V' }] },
		{ id: 'x1', tipo: 'bornero', bornes: [{ id: '1' }, { id: '2' }] },
	];
	p.conductores = [{ id: 'c1', de: { dispositivoId: 'ps', borneId: '+24' },
		a: { dispositivoId: 'x1', borneId: '1' } }];
	p.esquema = { representaciones: [
		{ id: 'ps-vista', dispositivoId: 'ps', hojaId: 'h1',
			posicion: { columna: 3, fila: 3 }, parte: { tipo: 'completa' } },
		{ id: 'x-vista', dispositivoId: 'x1', hojaId: 'h1',
			posicion: { columna: 7, fila: 5 }, parte: { tipo: 'completa' } },
	] };
	return p;
}

const ids = { dispositivoId: 'ps-copia', vistaId: 'ps-copia-vista' };
const destino = { hojaId: 'h1', columna: 4, fila: 3 };

test('ESQ-05: pegar una vista completa propone un aparato nuevo sin copiar la conexión', () => {
	const p = fixture();
	const antes = JSON.stringify(p);
	const plan = planCopiarAparatoConVista(p, 'ps-vista', destino, ids);
	assert.equal(plan.ok, true);
	if (!plan.ok) return;
	assert.equal(JSON.stringify(p), antes, 'la propuesta no muta el documento');
	assert.equal(plan.origenDispositivoId, 'ps');
	assert.deepEqual(plan.nuevaVista, { id: 'ps-copia-vista', dispositivoId: 'ps-copia',
		hojaId: 'h1', posicion: { columna: 4, fila: 3 }, parte: { tipo: 'completa' } });
	const copia = structuredClone(p.dispositivos[0]); copia.id = plan.nuevoDispositivoId;
	p.dispositivos.push(copia);
	p.esquema!.representaciones!.push(plan.nuevaVista);
	p.gabinete!.colocaciones.push({ dispositivoId: copia.id, x: 140, y: 40, ancho: 35, alto: 30 });
	assert.deepEqual(p.conductores.map((c) => c.id), ['c1']);
	assert.equal(p.conductores.some((c) => c.de.dispositivoId === copia.id || c.a.dispositivoId === copia.id), false);
	const hoja = montarEsquema(p, calcularPotenciales(p)).find((h) => h.id === 'h1');
	assert.equal(hoja?.simbolos.find((s) => s.representacionId === plan.nuevaVista.id)?.pines.size, 2);
	const reabierto = cargarProyecto(JSON.stringify(p));
	assert.deepEqual(reabierto.diagnosticos, []);
	assert.equal(reabierto.proyecto.esquema?.representaciones?.length, 3);
	assert.equal(JSON.stringify(reabierto.proyecto.conductores), JSON.stringify(p.conductores),
		'el codec puede añadir propiedades opcionales undefined, pero no cambia la conexión persistente');
});

test('ESQ-05: duplicar solo la vista del mismo aparato sería ambiguo y se rechaza al leer', () => {
	const p = fixture();
	p.esquema!.representaciones!.push({ ...p.esquema!.representaciones![0], id: 'duplicada',
		posicion: { columna: 4, fila: 3 } });
	const leido = cargarProyecto(JSON.stringify(p));
	assert.ok(leido.diagnosticos.some((d) => /borne estaba dibujado en varias vistas/.test(d.motivo)));
	assert.equal(leido.proyecto.esquema?.representaciones?.some((r) => r.dispositivoId === 'ps'), false);
});

test('ESQ-05: destino, caja, IDs, ejemplo y origen parcial se validan antes de mutar', () => {
	const p = fixture();
	const probar = (documento: Proyecto, origen = 'ps-vista', lugar = destino,
		identidades = ids) => planCopiarAparatoConVista(documento, origen, lugar, identidades);
	assert.equal(probar(p).ok, true);
	assert.equal(probar(p, 'ps-vista', { ...destino, columna: 3, fila: 3 }).ok, false);
	assert.equal(probar(p, 'ps-vista', { ...destino, columna: 0 }).ok, false);
	assert.equal(probar(p, 'ps-vista', { ...destino, columna: 7, fila: 5 }).ok, false);
	assert.equal(probar(p, 'ps-vista', destino, { ...ids, dispositivoId: 'ps' }).ok, false);
	assert.equal(probar({ ...p, esEjemplo: true }).ok, false);
	const parcial = fixture();
	parcial.esquema!.representaciones![0] = { ...parcial.esquema!.representaciones![0], parte: { tipo: 'bobina' } };
	assert.equal(probar(parcial).ok, false);
	const sinColocacion = fixture(); sinColocacion.gabinete!.colocaciones.shift();
	assert.equal(probar(sinColocacion).ok, false);
	const puerta = fixture(); puerta.gabinete!.colocaciones[0].montaje = 'puerta';
	assert.match((probar(puerta) as { motivo: string }).motivo, /puerta/);
});

test('ESQ-05: invertir arrays no cambia la propuesta ni su ubicación', () => {
	const p = fixture();
	const invertido = fixture();
	invertido.hojas.reverse(); invertido.dispositivos.reverse();
	invertido.gabinete!.colocaciones.reverse(); invertido.esquema!.representaciones!.reverse();
	assert.deepEqual(planCopiarAparatoConVista(p, 'ps-vista', destino, ids),
		planCopiarAparatoConVista(invertido, 'ps-vista', destino, ids));
});

test('ESQ-05: copiar una vista girada conserva la orientación, no las conexiones', () => {
	const p = fixture();
	p.esquema!.representaciones![0].giro = 180;
	const plan = planCopiarAparatoConVista(p, 'ps-vista', destino, ids);
	assert.equal(plan.ok, true);
	if (!plan.ok) return;
	assert.equal(plan.nuevaVista.giro, 180);
	assert.deepEqual(p.conductores.map((c) => c.id), ['c1']);
});

function fixtureDesdoblado(): Proyecto {
	const p = fixture();
	p.dispositivos[0] = {
		id: 'km1', tipo: 'contactor', designacion: '-KM1',
		bornes: ['1/L1', '2/T1', '3/L2', '4/T2', 'A1', 'A2', '13', '14'].map((id) => ({ id })),
		comportamiento: { version: 1, clase: 'contactos-electromagneticos',
			bobina: { entrada: 'A1', retorno: 'A2' },
			polos: [{ entrada: '1/L1', salida: '2/T1' }, { entrada: '3/L2', salida: '4/T2' }],
			contactos: [{ entrada: '13', salida: '14', reposo: 'abierto', funcion: 'auxiliar' }],
		},
	};
	p.gabinete!.colocaciones[0].dispositivoId = 'km1';
	p.conductores[0].de = { dispositivoId: 'km1', borneId: 'A1' };
	p.esquema!.representaciones = [
		{ id: 'bobina', dispositivoId: 'km1', hojaId: 'h1',
			posicion: { columna: 3, fila: 2 }, parte: { tipo: 'bobina' } },
		{ id: 'polos', dispositivoId: 'km1', hojaId: 'h2',
			posicion: { columna: 4, fila: 3 }, parte: { tipo: 'contactos', pares: [
				{ entrada: '1/L1', salida: '2/T1' }, { entrada: '3/L2', salida: '4/T2' },
			] } },
		{ id: 'auxiliar', dispositivoId: 'km1', hojaId: 'h1',
			posicion: { columna: 5, fila: 4 }, parte: { tipo: 'contactos', pares: [
				{ entrada: '13', salida: '14' },
			] } },
		{ id: 'x-vista', dispositivoId: 'x1', hojaId: 'h1',
			posicion: { columna: 7, fila: 5 }, parte: { tipo: 'completa' } },
	];
	return p;
}

const idsGrupo = { dispositivoId: 'km2', vistaId: 'bobina-nueva', otrasVistas: [
	{ origenVistaId: 'polos', nuevaVistaId: 'polos-nuevos' },
	{ origenVistaId: 'auxiliar', nuevaVistaId: 'auxiliar-nueva' },
] };

test('ESQ-05: copiar desde bobina crea un aparato y todas sus vistas sin duplicar bornes', () => {
	const p = fixtureDesdoblado();
	const antes = JSON.stringify(p);
	const plan = planCopiarAparatoConVista(p, 'bobina', { hojaId: 'h1', columna: 6, fila: 2 }, idsGrupo);
	assert.equal(plan.ok, true);
	if (!plan.ok) return;
	assert.equal(JSON.stringify(p), antes, 'el preview no modifica el proyecto');
	assert.equal(plan.nuevasVistas.length, 3);
	assert.deepEqual(plan.nuevasVistas.map((r) => [r.id, r.hojaId, r.posicion.columna, r.posicion.fila]), [
		['bobina-nueva', 'h1', 6, 2], ['auxiliar-nueva', 'h1', 8, 4], ['polos-nuevos', 'h2', 7, 3],
	]);
	p.dispositivos.push({ ...structuredClone(p.dispositivos[0]), id: plan.nuevoDispositivoId,
		...identidadParaCopia(p.dispositivos[0], p.dispositivos) });
	p.gabinete!.colocaciones.push({ ...p.gabinete!.colocaciones[0], dispositivoId: plan.nuevoDispositivoId,
		x: 160 });
	p.esquema!.representaciones!.push(...plan.nuevasVistas);
	assert.equal(p.conductores.length, 1, 'no se copiaron cables como efecto lateral');
	const hojas = montarEsquema(p, calcularPotenciales(p));
	const montadas = hojas.flatMap((h) => h.simbolos)
		.filter((s) => s.dispositivoId === plan.nuevoDispositivoId);
	assert.equal(montadas.length, 3);
	assert.ok(montadas.every((s) => s.designacion === '-KM2'));
	assert.ok(hojas.filter((h) => h.simbolos.some((s) => s.dispositivoId === plan.nuevoDispositivoId))
		.every((h) => hojaASvg(h).includes('-KM2')), 'ambos SVG salen de las vistas del mismo aparato');
	assert.deepEqual([...new Set(montadas.flatMap((s) => [...s.pines.keys()]))].sort(),
		p.dispositivos[0].bornes.map((b) => b.id).sort());
	const reabierto = cargarProyecto(JSON.stringify(p));
	assert.deepEqual(reabierto.diagnosticos, []);
	assert.equal(reabierto.proyecto.esquema?.representaciones?.filter((r) => r.dispositivoId === 'km2').length, 3);
	assert.equal(reabierto.proyecto.conductores.length, 1);
});

test('ESQ-05: el grupo desdoblado se pega por IDs, no por orden de arrays', () => {
	const p = fixtureDesdoblado();
	const invertido = structuredClone(p);
	invertido.hojas.reverse(); invertido.dispositivos.reverse();
	invertido.esquema!.representaciones!.reverse(); invertido.gabinete!.colocaciones.reverse();
	const destino = { hojaId: 'h1', columna: 6, fila: 2 };
	assert.deepEqual(planCopiarAparatoConVista(p, 'bobina', destino, idsGrupo),
		planCopiarAparatoConVista(invertido, 'bobina', destino,
			{ ...idsGrupo, otrasVistas: [...idsGrupo.otrasVistas].reverse() }));
	const desdePolos = planCopiarAparatoConVista(p, 'polos', { hojaId: 'h2', columna: 7, fila: 3 },
		{ dispositivoId: 'km2', vistaId: 'polos-nuevos', otrasVistas: [
			{ origenVistaId: 'bobina', nuevaVistaId: 'bobina-nueva' },
			{ origenVistaId: 'auxiliar', nuevaVistaId: 'auxiliar-nueva' },
		] });
	assert.equal(desdePolos.ok, true, 'el ancla puede ser un contacto, no solo la bobina');
	if (desdePolos.ok) assert.deepEqual(desdePolos.nuevasVistas.map((r) => [r.hojaId, r.posicion.columna]),
		[['h2', 7], ['h1', 8], ['h1', 6]]);
});

test('ESQ-05: el grupo rechaza folios cambiados, casillas ocupadas e IDs incompletos', () => {
	const p = fixtureDesdoblado();
	const proponer = (destino: { hojaId: string; columna: number; fila: number },
		ids = idsGrupo) => planCopiarAparatoConVista(p, 'bobina', destino, ids);
	const antes = JSON.stringify(p);
	assert.match((proponer({ hojaId: 'h2', columna: 6, fila: 2 }) as { motivo: string }).motivo, /conserva los folios/);
	assert.equal(proponer({ hojaId: 'h1', columna: 9, fila: 2 }).ok, false,
		'la vista auxiliar saldría de la rejilla');
	assert.equal(proponer({ hojaId: 'h1', columna: 5, fila: 3 }).ok, false,
		'la vista auxiliar caería en la casilla ocupada por X1');
	assert.equal(proponer({ hojaId: 'h1', columna: 6, fila: 2 },
		{ ...idsGrupo, otrasVistas: [idsGrupo.otrasVistas[0]] }).ok, false);
	assert.equal(proponer({ hojaId: 'h1', columna: 6, fila: 2 },
		{ ...idsGrupo, otrasVistas: idsGrupo.otrasVistas.map((v) => ({ ...v, nuevaVistaId: 'duplicada' })) }).ok, false);
	assert.equal(JSON.stringify(p), antes, 'los rechazos no generan aparatos ni capturas');
});

test('ESQ-05: una vista funcional aislada no se presenta como copia completa', () => {
	const p = fixtureDesdoblado();
	p.esquema!.representaciones = p.esquema!.representaciones!.filter((r) => r.id !== 'polos' && r.id !== 'auxiliar');
	const plan = planCopiarAparatoConVista(p, 'bobina', { hojaId: 'h1', columna: 6, fila: 2 },
		{ dispositivoId: 'km2', vistaId: 'bobina-nueva' });
	assert.equal(plan.ok, false);
	if (!plan.ok) assert.match(plan.motivo, /funcional aislada/);
});
