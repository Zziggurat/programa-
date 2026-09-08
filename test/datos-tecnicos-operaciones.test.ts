import assert from 'node:assert/strict';
import test from 'node:test';
import {
	cambiarConfiguracionTecnica, comprobarPreviewTecnico, desvincularProductoTecnico,
	listadoRevisionesProyecto, prepararPreviewTecnico, referenciasDelProyecto,
	validarAdopcionTecnica, vincularProductoTecnico,
} from '../src/datos-tecnicos/operaciones.js';
import { publicarRevision, hashSnapshotTecnico } from '../src/datos-tecnicos/hash.js';
import { resolverProyectoTecnico } from '../src/datos-tecnicos/resolver.js';
import { referenciaTecnica, type RevisionProductoTecnico, type VinculoTecnico } from '../src/datos-tecnicos/tipos.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { fixtureDoBobinaInsuficienteV7 } from '../ejemplo/fixtures-ingenieria-v7.js';
import { criteriosTecnicos, curvaTecnica, datoTecnico, productoTecnico, proyectoConProductoTecnico, tablaTecnica } from './helpers/datos-tecnicos.js';

function congelarProfundo<T>(valor: T): T {
	if (valor && typeof valor === 'object') { Object.values(valor).forEach(congelarProfundo); Object.freeze(valor); }
	return valor;
}
function legacy(): Proyecto { const p = proyectoConProductoTecnico(); delete p.datosTecnicos; return p; }
function vinculo(producto: RevisionProductoTecnico, cambios: Partial<VinculoTecnico> = {}): VinculoTecnico {
	return { entidad: 'DEVICE', entidadId: 'q1', producto: referenciaTecnica(producto), condiciones: { sistema: 'AC', tensionV: 230 },
		decisiones: Object.fromEntries(producto.campos.map(d => [`${d.campo}@${d.canal ?? ''}`, { modo: 'CATALOGO' as const }])), ...cambios };
}
function valor(p: Proyecto, campo = 'proteccion.inA') {
	return resolverProyectoTecnico(p).resoluciones.find(d => d.entidadId === 'q1' && d.campo === campo);
}

test('V8 operaciones: vincular devuelve candidato independiente de BASE y del catálogo congelados', () => {
	const base = congelarProfundo(legacy()), producto = congelarProfundo(productoTecnico());
	const antes = JSON.stringify(base); const p = vincularProductoTecnico(base, vinculo(producto), [producto]);
	assert.equal(JSON.stringify(base), antes); assert.equal(base.datosTecnicos, undefined);
	assert.equal(valor(p)?.dato?.valor, 25);
	assert.notEqual(p.dispositivos, base.dispositivos);
	assert.notEqual(p.datosTecnicos!.revisiones[0], producto);
	p.datosTecnicos!.revisiones[0].nombre = 'Mutación local del candidato';
	assert.notEqual(p.datosTecnicos!.revisiones[0].nombre, producto.nombre);
});

test('V8 operaciones: candidato congela solo dependencias transitivas exactas, no última revisión global', () => {
	const curva = curvaTecnica(); const producto = productoTecnico({ curva: referenciaTecnica(curva) });
	const posterior = publicarRevision({ ...producto, revision: 2, campos: [datoTecnico('proteccion.inA', 32, 'A')] });
	const otra = productoTecnico({ id: 'producto-sin-usar' });
	const p = vincularProductoTecnico(legacy(), vinculo(producto), [otra, posterior, curva, producto]);
	assert.deepEqual(new Set(listadoRevisionesProyecto(p).map(r => r.hash)), new Set([producto.hash, curva.hash]));
	assert.equal(valor(p)?.dato?.valor, 25);
	assert.equal(p.datosTecnicos!.vinculos[0].producto.revision, 1);
});

test('V8 operaciones: dependencia ausente/corrupta y revisión divergente rechazan sin mutar BASE', () => {
	const base = congelarProfundo(legacy()); const antes = JSON.stringify(base);
	const curva = curvaTecnica(), producto = productoTecnico({ curva: referenciaTecnica(curva) });
	assert.throws(() => vincularProductoTecnico(base, vinculo(producto), [producto]), /MISSING/);
	const corrupta = structuredClone(curva); corrupta.puntos[0].maximoS = 100;
	assert.throws(() => vincularProductoTecnico(base, vinculo(producto), [producto, corrupta]), /Integridad/);
	const divergente = publicarRevision({ ...producto, nombre: 'Otro contenido de misma identidad' });
	assert.throws(() => vincularProductoTecnico(base, vinculo(producto), [producto, curva, divergente]), /CONFLICT/);
	assert.equal(JSON.stringify(base), antes);
});

test('V8 operaciones: ejemplos son readonly y la copia de trabajo conserva revisión original', () => {
	const base = proyectoConProductoTecnico(); base.esEjemplo = true;
	assert.throws(() => cambiarConfiguracionTecnica(base, c => { c.vinculos = []; }), /solo lectura/);
	assert.throws(() => desvincularProductoTecnico(base, 'DEVICE', 'q1'), /solo lectura/);
	const copia = structuredClone(base); delete copia.esEjemplo;
	const p = cambiarConfiguracionTecnica(copia, () => {});
	assert.deepEqual(p.datosTecnicos, copia.datosTecnicos); assert.equal(base.esEjemplo, true);
});

test('V8 operaciones: cambio con callback que falla descarta todas las mutaciones de su candidato', () => {
	const base = congelarProfundo(proyectoConProductoTecnico()); const antes = JSON.stringify(base);
	assert.throws(() => cambiarConfiguracionTecnica(base, c => {
		c.vinculos[0].decisiones['proteccion.inA@'] = { modo: 'OVERRIDE', dato: datoTecnico('proteccion.inA', 100, 'A') };
		throw new Error('cancelación simulada antes de persistir');
	}), /cancelación/);
	assert.equal(JSON.stringify(base), antes); assert.equal(valor(base)?.dato?.valor, 25);
});

test('V8 operaciones: adopción rechaza vínculo a entidad/familia inexistente y conserva BASE', () => {
	const base = legacy(), producto = productoTecnico(); const texto = JSON.stringify(base);
	assert.throws(() => vincularProductoTecnico(base, vinculo(producto, { entidadId: 'inexistente' }), [producto]), /MISSING/);
	const motor = productoTecnico({ familia: 'MOTOR', campos: [datoTecnico('motor.corrienteNominalA', 7, 'A')] });
	assert.throws(() => vincularProductoTecnico(base, vinculo(motor), [motor]), /NOT_APPLICABLE/);
	assert.equal(JSON.stringify(base), texto);
});

test('V8 operaciones: override no puede introducir parámetros de otra familia en una protección', () => {
	const base = legacy(), producto = productoTecnico(), v = vinculo(producto);
	v.decisiones['fuente.tensionNominalV@'] = { modo: 'OVERRIDE', dato: datoTecnico('fuente.tensionNominalV', 230, 'V') };
	assert.throws(() => vincularProductoTecnico(base, v, [producto]), /familia|incompatible|CONFLICT|NOT_APPLICABLE/i);
	assert.equal(base.dispositivos[0].fisica?.fuente, undefined);
});

test('V8 operaciones: un canal PLC inexistente no puede adoptarse como dato resuelto silenciosamente', () => {
	const base = fixtureDoBobinaInsuficienteV7(); const plc = base.dispositivos.find(d => d.comportamiento?.clase === 'controlador')!;
	const producto = productoTecnico({ familia: 'PLC', campos: [{ ...datoTecnico('plc.corrienteMaxA', .1, 'A'), canal: 'NO_EXISTE' }] });
	assert.throws(() => vincularProductoTecnico(base, vinculo(producto, { entidadId: plc.id }), [producto]), /canal|borne|MISSING|NOT_APPLICABLE|CONFLICT/i);
});

test('V8 operaciones: conflicto con perfil legacy exige una elección; CATALOGO/CONSERVAR son diferentes', () => {
	const base = legacy(); const producto = productoTecnico({ campos: [datoTecnico('proteccion.inA', 32, 'A')] });
	assert.throws(() => vincularProductoTecnico(base, vinculo(producto, { decisiones: {} }), [producto]), /CONFLICT/);
	const catalogo = vincularProductoTecnico(base, vinculo(producto), [producto]);
	assert.equal(valor(catalogo)?.dato?.valor, 32);
	const conservar = vincularProductoTecnico(base, vinculo(producto, { decisiones: {
		'proteccion.inA@': { modo: 'CONSERVAR', dato: datoTecnico('proteccion.inA', 25, 'A') },
	} }), [producto]);
	assert.equal(valor(conservar)?.dato?.valor, 25); assert.equal(valor(conservar)?.origen, 'CONSERVAR');
	assert.equal(base.dispositivos[0].corrienteNominal, 25);
});

test('V8 operaciones: nueva revisión mantiene override existente hasta eliminación explícita', () => {
	const base = proyectoConProductoTecnico();
	base.datosTecnicos!.vinculos[0].decisiones['proteccion.inA@'] = { modo: 'OVERRIDE', dato: datoTecnico('proteccion.inA', 16, 'A') };
	const primera = base.datosTecnicos!.revisiones[0] as RevisionProductoTecnico;
	const segunda = publicarRevision({ ...primera, revision: 2, campos: [datoTecnico('proteccion.inA', 40, 'A')] });
	const v = structuredClone(base.datosTecnicos!.vinculos[0]); v.producto = referenciaTecnica(segunda);
	const candidato = vincularProductoTecnico(base, v, [segunda]);
	assert.equal(valor(candidato)?.dato?.valor, 16); assert.equal(valor(candidato)?.origen, 'OVERRIDE');
	assert.ok(prepararPreviewTecnico(base, candidato).cambios.find(c => c.campo === 'proteccion.inA@')!.overridePreservado);
	const eliminar = structuredClone(v); eliminar.decisiones['proteccion.inA@'] = { modo: 'CATALOGO' };
	const sinOverride = vincularProductoTecnico(candidato, eliminar, [segunda]);
	assert.equal(valor(sinOverride)?.dato?.valor, 40); assert.equal(valor(sinOverride)?.origen, 'CATALOGO');
	assert.equal(valor(base)?.dato?.valor, 16);
});

test('V8 operaciones: campo retirado de ficha no borra override ni supresión del proyecto al actualizar', () => {
	for (const modo of ['OVERRIDE', 'SIN_HERENCIA'] as const) {
		const base = proyectoConProductoTecnico();
		base.datosTecnicos!.vinculos[0].decisiones['proteccion.Icu@'] = modo === 'OVERRIDE'
			? { modo, dato: datoTecnico('proteccion.Icu', 8, 'kA') } : { modo, motivo: 'No heredar capacidad no corroborada' };
		const primera = base.datosTecnicos!.revisiones[0] as RevisionProductoTecnico;
		const segunda = publicarRevision({ ...primera, revision: 2, campos: [datoTecnico('proteccion.inA', 32, 'A')] });
		const candidato = vincularProductoTecnico(base, vinculo(segunda), [segunda]);
		assert.deepEqual(candidato.datosTecnicos!.vinculos[0].decisiones['proteccion.Icu@'], base.datosTecnicos!.vinculos[0].decisiones['proteccion.Icu@']);
		if (modo === 'OVERRIDE') assert.equal(valor(candidato, 'proteccion.Icu')?.dato?.valor, 8);
		else assert.equal(valor(candidato, 'proteccion.Icu')?.estado, 'NOT_APPLICABLE');
	}
});

test('V8 operaciones: suprimir herencia elimina dato efectivo, no persiste una magnitud ficticia', () => {
	const base = proyectoConProductoTecnico(); const v = structuredClone(base.datosTecnicos!.vinculos[0]);
	v.decisiones['proteccion.inA@'] = { modo: 'SIN_HERENCIA', motivo: 'Calibre pendiente de corroborar' };
	const candidato = vincularProductoTecnico(base, v, []); const r = resolverProyectoTecnico(candidato);
	assert.equal(valor(candidato)?.estado, 'NOT_APPLICABLE'); assert.equal(valor(candidato)?.dato, undefined);
	assert.equal(r.proyecto.dispositivos[0].corrienteNominal, undefined);
	assert.equal(base.dispositivos[0].corrienteNominal, 25);
});

test('V8 operaciones: preview inicial compara dato legacy real, no un antes ausente', () => {
	const base = legacy(), producto = productoTecnico({ campos: [datoTecnico('proteccion.inA', 32, 'A')] });
	const p = vincularProductoTecnico(base, vinculo(producto), [producto]);
	const preview = prepararPreviewTecnico(base, p); const cambio = preview.cambios.find(c => c.campo === 'proteccion.inA@')!;
	assert.equal((cambio.antes as { dato?: { valor?: unknown } } | undefined)?.dato?.valor, 25);
	assert.equal((cambio.despues as { dato?: { valor?: unknown } }).dato?.valor, 32);
});

test('V8 operaciones: cancelar preview no modifica BASE y candidato queda aislado de posteriores ediciones', () => {
	const base = congelarProfundo(legacy()), producto = productoTecnico();
	const candidato = vincularProductoTecnico(base, vinculo(producto), [producto]);
	const texto = JSON.stringify(base); const preview = prepararPreviewTecnico(base, candidato);
	candidato.nombre = 'Después de preview'; candidato.datosTecnicos!.vinculos = [];
	assert.notEqual(preview.candidato.nombre, candidato.nombre); assert.equal(preview.candidato.datosTecnicos!.vinculos.length, 1);
	assert.equal(preview.hashBase, hashSnapshotTecnico(base));
	assert.doesNotThrow(() => comprobarPreviewTecnico(base, preview));
	assert.equal(JSON.stringify(base), texto); assert.equal(base.datosTecnicos, undefined);
});

test('V8 operaciones: cualquier edición BASE pertinente invalida preview sin adoptar el candidato', () => {
	const mutaciones: ((p: Proyecto) => void)[] = [
		p => { p.nombre = 'Otro documento'; }, p => { p.dispositivos[0].corrienteNominal = 99; },
		p => { p.gabinete!.ancho += 10; }, p => { p.dispositivos[0].bornes[0].id = 'BORNE_DISTINTO'; },
	];
	for (const mutar of mutaciones) {
		const base = legacy(), producto = productoTecnico();
		const preview = prepararPreviewTecnico(base, vincularProductoTecnico(base, vinculo(producto), [producto]));
		mutar(base); assert.throws(() => comprobarPreviewTecnico(base, preview), /STALE_RESULT/);
		assert.equal(base.datosTecnicos, undefined);
	}
});

test('V8 operaciones: candidato alterado después del preview se rechaza aunque su nuevo dato sea válido', () => {
	const base = legacy(), producto = productoTecnico();
	const preview = prepararPreviewTecnico(base, vincularProductoTecnico(base, vinculo(producto), [producto]));
	preview.candidato.datosTecnicos!.vinculos[0].decisiones['proteccion.inA@'] = { modo: 'OVERRIDE', dato: datoTecnico('proteccion.inA', 125, 'A') };
	assert.throws(() => comprobarPreviewTecnico(base, preview), /STALE_RESULT|candidato|preview/i);
});

test('V8 operaciones: desvincular limpia solo dependencias huérfanas y preview explica retorno al legacy', () => {
	const base = proyectoConProductoTecnico(productoTecnico({ campos: [datoTecnico('proteccion.inA', 32, 'A')] }));
	const criterios = criteriosTecnicos(); base.datosTecnicos!.revisiones.push(criterios); base.datosTecnicos!.criterios = referenciaTecnica(criterios);
	const p = desvincularProductoTecnico(base, 'DEVICE', 'q1');
	assert.equal(p.datosTecnicos!.vinculos.length, 0); assert.deepEqual(listadoRevisionesProyecto(p), [referenciaTecnica(criterios)]);
	assert.equal(resolverProyectoTecnico(p).proyecto.dispositivos[0].corrienteNominal, 25);
	const cambio = prepararPreviewTecnico(base, p).cambios.find(c => c.campo === 'proteccion.inA@')!;
	assert.equal((cambio.antes as { dato?: { valor?: unknown } }).dato?.valor, 32);
	assert.equal((cambio.despues as { dato?: { valor?: unknown } } | undefined)?.dato?.valor, 25);
});

test('V8 rescate explícito permite desvincular una ficha corrupta sin usarla ni borrar el proyecto', () => {
	const base = proyectoConProductoTecnico(productoTecnico());
	base.datosTecnicos!.revisiones[0].nombre = 'Contenido alterado';
	assert.ok(resolverProyectoTecnico(base).problemas.length);
	const rescatado = desvincularProductoTecnico(base, 'DEVICE', 'q1');
	assert.equal(rescatado.datosTecnicos!.revisiones.length, 0);
	assert.equal(rescatado.dispositivos.length, base.dispositivos.length);
	assert.equal(base.datosTecnicos!.vinculos.length, 1);
});

test('V8 operaciones: borrar biblioteca global no afecta candidato/proyecto congelado ni roundtrip', () => {
	const producto = productoTecnico(), global = [producto];
	const p = vincularProductoTecnico(legacy(), vinculo(producto), global);
	global.splice(0); producto.campos[0].valor = 100;
	assert.doesNotThrow(() => validarAdopcionTecnica(p));
	const q = cargarProyecto(JSON.stringify(p)).proyecto;
	assert.equal(valor(q)?.dato?.valor, 25); assert.equal(valor(q, 'proteccion.Icu')?.dato?.valor, 6);
	assert.deepEqual(listadoRevisionesProyecto(q), listadoRevisionesProyecto(p));
});

test('V8 operaciones: criterios por circuito y tabla de cable congelan dependencias sin copiar catálogo', () => {
	const base = legacy(); base.conductores = [{ id: 'w1', de: { dispositivoId: 'q1', borneId: '1' }, a: { dispositivoId: 'q1', borneId: '2' }, seccion: 4 }];
	const criterios = criteriosTecnicos(), tabla = tablaTecnica();
	const p = cambiarConfiguracionTecnica(base, c => {
		c.criteriosCircuito = { c1: { perfil: referenciaTecnica(criterios), overrides: {} } };
		c.instalaciones = [{ conductorId: 'w1', tabla: referenciaTecnica(tabla), factores: [] }];
	}, [criterios, tabla, productoTecnico()]);
	assert.equal(referenciasDelProyecto(p.datosTecnicos!).length, 2);
	assert.equal(p.datosTecnicos!.revisiones.length, 2);
	assert.equal(base.datosTecnicos, undefined);
});
