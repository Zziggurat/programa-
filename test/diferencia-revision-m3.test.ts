import assert from 'node:assert/strict';
import test from 'node:test';
import { compararRevisiones, compararRevisionesProyecto } from '../src/motores/diferencia-revision.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import { referenciaTecnica } from '../src/datos-tecnicos/tipos.js';
import { productoTecnico, tablaTecnica } from './helpers/datos-tecnicos.js';

function fixture(): Proyecto {
	const p = crearProyecto('DOC-03');
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Mando' }];
	p.gabinete = { ancho: 600, alto: 800,
		canaletas: [{ id: 'c1', x: 10, y: 50, largo: 420, orientacion: 'h', ancho: 40, alto: 40 }],
		rieles: [{ id: 'r1', x: 10, y: 100, largo: 400 }],
		colocaciones: [{ dispositivoId: 'q1', x: 20, y: 100, ancho: 40, alto: 80 },
			{ dispositivoId: 'x1', x: 150, y: 100, ancho: 40, alto: 80 },
			{ dispositivoId: 'm1', x: 300, y: 100, ancho: 70, alto: 90 }] };
	p.dispositivos = [
		{ id: 'q1', tipo: 'disyuntor', designacion: '-Q1', corrienteNominal: 25,
			bornes: [{ id: '1', tipo: 'L' }, { id: '2', tipo: 'L' }] },
		{ id: 'x1', tipo: 'bornero', designacion: '-X1',
			bornes: [{ id: '1', tipo: 'L' }, { id: '2', tipo: 'L' }] },
		{ id: 'm1', tipo: 'motor', designacion: '-M1',
			bornes: [{ id: 'U', tipo: 'L' }] },
	];
	p.conductores = [
		{ id: 'w1', de: { dispositivoId: 'q1', borneId: '2' },
			a: { dispositivoId: 'x1', borneId: '1' }, seccion: 2.5,
			trazado: [{ x: 70, y: 120 }, { x: 110, y: 120 }] },
		{ id: 'w2', de: { dispositivoId: 'x1', borneId: '2' },
			a: { dispositivoId: 'm1', borneId: 'U' }, seccion: 2.5 },
	];
	return p;
}

const categorias = (a: Proyecto, b: Proyecto) =>
	compararRevisiones(a, b).cambios.map((c) => `${c.categoria}:${c.entidadId}:${c.tipo}`);

test('DOC-03: invertir arrays y orientación de extremos no crea cambios falsos', () => {
	const base = fixture(), reordenada = structuredClone(base);
	reordenada.dispositivos.reverse();
	reordenada.dispositivos.forEach((d) => d.bornes.reverse());
	reordenada.conductores.reverse();
	reordenada.gabinete!.colocaciones.reverse();
	reordenada.gabinete!.canaletas.reverse();
	reordenada.gabinete!.rieles.reverse();
	const cable = reordenada.conductores.find((c) => c.id === 'w1')!;
	[cable.de, cable.a] = [cable.a, cable.de];
	assert.deepEqual(compararRevisiones(base, reordenada).cambios, []);
	assert.equal(compararRevisiones(base, reordenada).limitaciones.length, 1,
		'la ruta AUTO no pasa a ser verificada por no encontrar diferencias');
});

test('DOC-03: identifica altas/bajas de aparatos y conexiones por ID, no por índice', () => {
	const a = fixture(), b = structuredClone(a);
	b.dispositivos = b.dispositivos.filter((d) => d.id !== 'm1');
	b.dispositivos.push({ id: 'm2', tipo: 'motor', bornes: [{ id: 'U', tipo: 'L' }] });
	b.conductores = b.conductores.filter((c) => c.id !== 'w2');
	b.conductores.push({ id: 'w3', de: { dispositivoId: 'x1', borneId: '2' },
		a: { dispositivoId: 'm2', borneId: 'U' } });
	const r = categorias(a, b);
	assert.ok(r.includes('APARATO:m1:ELIMINADO'));
	assert.ok(r.includes('APARATO:m2:AGREGADO'));
	assert.ok(r.includes('CONEXION:w2:ELIMINADO'));
	assert.ok(r.includes('CONEXION:w3:AGREGADO'));
});

test('DOC-03: editar la identificación de un aparato con el mismo ID no desaparece del informe', () => {
	const a = fixture(), b = structuredClone(a);
	b.dispositivos[0].designacion = '-Q2';
	b.dispositivos[0].descripcion = 'Protección del motor';
	const r = compararRevisionesProyecto(a, b).cambios;
	assert.ok(r.some((c) => c.categoria === 'APARATO' && c.entidadId === 'q1'
		&& c.campo === 'identificacion' && c.despues.includes('-Q2')));
});

test('DOC-03: conexión, sección, protección y ruta declarada son diferencias separadas', () => {
	const a = fixture(), b = structuredClone(a);
	b.conductores[0].a = { dispositivoId: 'x1', borneId: '2' };
	b.conductores[0].seccion = 4;
	b.conductores[0].trazado![1].y = 150;
	b.dispositivos[0].corrienteNominal = 32;
	b.dispositivos[0].curvaDisparo = 'C';
	const r = compararRevisionesProyecto(a, b).cambios;
	assert.ok(r.some((c) => c.categoria === 'CONEXION' && c.entidadId === 'w1' && c.campo === 'extremos'));
	assert.ok(r.some((c) => c.categoria === 'SECCION' && c.entidadId === 'w1'));
	assert.ok(r.some((c) => c.categoria === 'PROTECCION' && c.entidadId === 'q1'));
	assert.ok(r.some((c) => c.categoria === 'RUTA' && c.entidadId === 'w1' && c.campo === 'trazadoDeclarado'));
	assert.equal(a.conductores[0].trazado![1].y, 120, 'el comparador no modifica BASE');
});

test('DOC-03: perfil de protección personalizado no depende del tipo visual', () => {
	const a = fixture(), b = structuredClone(a);
	const q = b.dispositivos.find((d) => d.id === 'q1')!;
	q.tipo = 'otro';
	q.comportamiento = { version: 1, clase: 'proteccion', funcion: 'termico',
		polos: [{ entrada: '1', salida: '2' }], contactos: [], rearmable: true };
	q.fisica = { version: 1, proteccion: { inA: 21 } };
	const r = compararRevisionesProyecto(a, b).cambios;
	assert.ok(r.some((c) => c.categoria === 'APARATO' && c.entidadId === 'q1'));
	assert.ok(r.some((c) => c.categoria === 'PROTECCION' && c.entidadId === 'q1'));
});

test('DOC-03: polos/contactos de protección son conjuntos, no orden de inserción', () => {
	const a = fixture(), b = structuredClone(a);
	a.dispositivos[0].comportamiento = { version: 1, clase: 'proteccion', rearmable: true,
		polos: [{ entrada: '1', salida: '2' }, { entrada: '3', salida: '4' }],
		contactos: [] };
	b.dispositivos[0].comportamiento = structuredClone(a.dispositivos[0].comportamiento);
	if (b.dispositivos[0].comportamiento?.clase === 'proteccion')
		b.dispositivos[0].comportamiento.polos.reverse();
	assert.deepEqual(compararRevisiones(a, b).cambios, []);
});

test('DOC-03: datos técnicos y criterios congelados se comparan sin depender del orden', () => {
	const a = fixture(), b = structuredClone(a);
	const producto = productoTecnico(), tabla = tablaTecnica();
	a.datosTecnicos = { version: 1, revisiones: [producto, tabla],
		vinculos: [{ entidad: 'DEVICE', entidadId: 'q1', producto: referenciaTecnica(producto),
			decisiones: {}, condiciones: {} }],
		instalaciones: [{ conductorId: 'w1', tabla: referenciaTecnica(tabla), factores: [] }] };
	a.ingenieria = { version: 1,
		circuitos: { 'c-motor': { version: 1, conductoresReasignablesFase: ['w1', 'w2'] } },
		disenoAsistido: { version: 1, decisiones: [{ version: 1, id: 'd1', solicitudId: 's1',
			planId: 'p1', hashBase: 'h', circuitoId: 'c-motor', cambios: [
				{ tipo: 'SECCION', conductorId: 'w1', seccionMm2: 4 },
				{ tipo: 'SECCION', conductorId: 'w2', seccionMm2: 6 },
			] }] } };
	b.datosTecnicos = structuredClone(a.datosTecnicos);
	b.ingenieria = structuredClone(a.ingenieria);
	b.datosTecnicos.revisiones.reverse();
	const reordenado = b.datosTecnicos.revisiones.find((r) => r.tipo === 'PRODUCTO');
	if (reordenado?.tipo === 'PRODUCTO') reordenado.campos.reverse();
	b.ingenieria.circuitos!['c-motor'].conductoresReasignablesFase!.reverse();
	b.ingenieria.disenoAsistido!.decisiones[0].cambios.reverse();
	assert.deepEqual(compararRevisiones(a, b).cambios, []);
	const actualizado = productoTecnico({ revision: 2 });
	b.datosTecnicos.revisiones = [tabla, actualizado];
	b.datosTecnicos.vinculos[0].producto = referenciaTecnica(actualizado);
	b.datosTecnicos.instalaciones[0].metodo = 'A1';
	b.datosTecnicos.criteriosCircuito = { 'c-motor': { overrides: {
		maxVoltageDropPercent: { modo: 'VALOR', valor: 3 } } } };
	b.ingenieria = { version: 1, criterios: { maxLossW: 30 } };
	const r = compararRevisionesProyecto(a, b).cambios;
	assert.ok(r.some((c) => c.categoria === 'DATOS_TECNICOS' && c.campo === 'revisionCongelada'));
	assert.ok(r.some((c) => c.categoria === 'DATOS_TECNICOS' && c.campo === 'vinculo'));
	assert.ok(r.some((c) => c.categoria === 'DATOS_TECNICOS' && c.campo === 'instalacion'));
	assert.ok(r.some((c) => c.categoria === 'CRITERIO' && c.campo === 'circuitoTecnico'));
	assert.ok(r.some((c) => c.categoria === 'CRITERIO' && c.campo === 'ingenieria'));
});

test('DOC-03: AUTO no se convierte en una diferencia física inventada al mover canaleta', () => {
	const a = fixture(), b = structuredClone(a);
	b.gabinete!.canaletas[0].y += 15;
	const r = compararRevisiones(a, b);
	assert.equal(r.cambios.filter((c) => c.categoria === 'RUTA').length, 0);
	assert.ok(r.limitaciones.some((x) => x.includes('Cambió el contexto físico')));
	assert.deepEqual(compararRevisionesProyecto(a, b).rutasNoEvaluables,
		[{ conductorId: 'w2', motivo: 'CONTEXTO_FISICO_CAMBIO' }]);
});

test('DOC-03: pendiente y ruta manual sobreviven roundtrip y cambian de forma explícita', () => {
	const a = fixture(), b = structuredClone(a);
	b.conductores[0].estadoRutaFisica = 'pendiente';
	delete b.conductores[0].trazado;
	const reabierto = cargarProyecto(JSON.stringify(b)).proyecto;
	const r = compararRevisiones(a, reabierto);
	assert.ok(r.cambios.some((c) => c.categoria === 'RUTA' && c.entidadId === 'w1'));
	assert.ok(r.limitaciones.length > 0, 'el otro conductor AUTO conserva su límite honesto');
});

test('DOC-03: rechaza identidades duplicadas en vez de ocultar cambios', () => {
	const a = fixture(), b = structuredClone(a);
	b.conductores.push(structuredClone(b.conductores[0]));
	assert.throws(() => compararRevisiones(a, b), /conductor duplicado/);
});
