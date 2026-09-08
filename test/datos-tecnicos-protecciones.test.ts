import assert from 'node:assert/strict';
import test from 'node:test';
import { publicarRevision } from '../src/datos-tecnicos/hash.js';
import { resolverProyectoTecnico } from '../src/datos-tecnicos/resolver.js';
import { referenciaTecnica, type RevisionProductoTecnico } from '../src/datos-tecnicos/tipos.js';
import { simularFisicaProyecto, type ContextoTopologiaFisica } from '../src/fisica/topologia-proyecto.js';
import { analizarProspectivaProtecciones } from '../src/ingenieria/prospectiva.js';
import { REGLA_PROTECCIONES } from '../src/ingenieria/protecciones.js';
import { validarIngenieria } from '../src/ingenieria/validacion.js';
import type { CircuitoIngenieria } from '../src/ingenieria/circuitos.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import type { Proyecto } from '../src/modelo/tipos.js';

function fixture(): Proyecto {
	return { formato: 'tablero-studio', version: 1, nombre: 'Prospectiva sintética V8', hojas: [],
		gabinete: { ancho: 300, alto: 300, rieles: [], canaletas: [], colocaciones: [] },
		dispositivos: [
			{ id: 'red', tipo: 'otro', bornes: [{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' }],
				fisica: { version: 1, fuente: { sistema: 'AC_MONOFASICA', tensionNominalV: 230, frecuenciaHz: 50,
					referencia: 'N', fases: [{ borne: 'L', fase: 'L' }], rOhm: 0.2, xOhm: 0 } } },
			{ id: 'q1', tipo: 'disyuntor', corrienteNominal: 16, bornes: [{ id: '1', tipo: 'L' }, { id: '2', tipo: 'L' }],
				comportamiento: { version: 1, clase: 'proteccion', funcion: 'termomagnetico', rearmable: true,
					polos: [{ entrada: '1', salida: '2' }], contactos: [] },
				fisica: { version: 1, proteccion: { inA: 16, capacidadCorte: { icuKA: 1, icnKA: 0.5, icsKA: 0.25 } } } },
		], conductores: [{ id: 'w1', de: { dispositivoId: 'red', borneId: 'L' }, a: { dispositivoId: 'q1', borneId: '1' },
			seccion: 2.5, fisica: { material: 'COBRE', longitudManualM: 10, temperaturaC: 20, xOhmPorKm: 0 } }],
		datosTecnicos: { version: 1, revisiones: [], vinculos: [], instalaciones: [],
			overridesCriterios: { capacidadCorte: { modo: 'VALOR', valor: 'Icu' } },
			prospectiva: [{ proteccionId: 'q1', de: { dispositivoId: 'q1', borneId: '2' },
				a: { dispositivoId: 'red', borneId: 'N' }, tipo: 'L_N' }] },
	};
}
const contexto = (): ContextoTopologiaFisica => ({ conexionesCerradas: new Map([['q1', [['1', '2']]]]) });
const circuito: CircuitoIngenieria = { id: 'c1', nombre: 'Punto sintético', tipo: 'ALIMENTACION', estadoTopologia: 'INEQUIVOCA',
	fuenteId: 'red', fuentes: ['red'], protecciones: ['q1'], maniobra: [], conductores: ['w1'], cargas: [],
	senalesRelacionadas: [], equipos: ['red', 'q1'], subcircuitos: [], ambiguedades: [], trayectos: [] };
function evaluar(p: Proyecto, ctx = contexto()) {
	const tecnica = resolverProyectoTecnico(p), prospectiva = analizarProspectivaProtecciones(tecnica.proyecto, ctx);
	const r = validarIngenieria({ proyecto: tecnica.proyecto, tecnica, prospectiva, circuitos: [circuito],
		fisica: simularFisicaProyecto(tecnica.proyecto, ctx), reglas: [REGLA_PROTECCIONES] });
	return r.resultados.find(x => x.code.startsWith('TS-PROT-BREAKING-CAPACITY'))!;
}
function vincular(p: Proyecto): RevisionProductoTecnico {
	const procedencia = { origen: 'SINTETICO' as const, referencia: 'Oráculo de regresión, no ficha comercial' };
	const revision = publicarRevision<RevisionProductoTecnico>({ version: 1, canon: 1, tipo: 'PRODUCTO',
		catalogo: { id: 'prueba', nombre: 'Sintético' }, id: 'q', revision: 1, hash: '', nombre: 'Protección sintética',
		estado: 'ACTIVA', procedencia, familia: 'PROTECCION', variante: 'AC 230 V 1P',
		campos: [['proteccion.Icu', 1], ['proteccion.Icn', 0.5], ['proteccion.Ics', 0.25]].map(([campo, valor]) => ({
			campo: campo as 'proteccion.Icu', valor: valor as number, unidad: 'kA', naturaleza: 'NOMINAL', procedencia,
			condiciones: { sistema: 'AC', tensionV: 230, frecuenciaHz: 50, polos: 1 },
		})) });
	p.datosTecnicos!.revisiones = [revision];
	p.datosTecnicos!.vinculos = [{ entidad: 'DEVICE', entidadId: 'q1', producto: referenciaTecnica(revision),
		condiciones: { sistema: 'AC', tensionV: 230, frecuenciaHz: 50, polos: 1 }, decisiones: {} }];
	return revision;
}

test('V8 prospectiva: red real y oráculo independiente de Thevenin; el snapshot operativo no contiene la falla', () => {
	const p = fixture(), ctx = contexto(), antes = structuredClone({ p, ctx });
	const operativo = simularFisicaProyecto(p, ctx), r = analizarProspectivaProtecciones(p, ctx).get('q1')!;
	assert.equal(r.estado, 'RESUELTO');
	// 230 V / (Rfuente + rho*L/S + Rcontacto estimada + Rfalla declarada por el modelo).
	const esperado = 230 / (0.2 + 1.7241e-8 * 10 / 2.5e-6 + 1e-6 + 0.001);
	assert.ok(Math.abs(r.iccA! - esperado) < 1e-5, `${r.iccA} ≠ ${esperado}`);
	assert.equal(r.origen, 'ESTIMADO'); assert.match(r.limitaciones.join(' '), /contactos estimados/);
	assert.equal(operativo.fallas.length, 0); assert.ok(operativo.protecciones.get('q1')!.corrienteA < 1e-6);
	assert.deepEqual({ p, ctx }, antes);
});

test('V8 cobertura: Ics suprimida no invalida Icu seleccionada ni el calibre independiente', () => {
	const p = fixture(); vincular(p);
	p.datosTecnicos!.vinculos[0].decisiones['proteccion.Ics@'] = { modo: 'SIN_HERENCIA', motivo: 'No usado en esta revisión' };
	p.dispositivos.push({ id: 'carga', tipo: 'otro', bornes: [], corrienteNominal: 2 });
	const tecnica = resolverProyectoTecnico(p), prospectiva = analizarProspectivaProtecciones(tecnica.proyecto, contexto());
	const resultados = validarIngenieria({ proyecto: tecnica.proyecto, tecnica, prospectiva,
		circuitos: [{ ...circuito, cargas: ['carga'] }], fisica: simularFisicaProyecto(tecnica.proyecto, contexto()), reglas: [REGLA_PROTECCIONES] }).resultados;
	assert.equal(resultados.find(r => r.code === 'TS-PROT-RATING')?.status, 'PASS');
	assert.equal(resultados.find(r => r.code === 'TS-PROT-BREAKING-CAPACITY')?.status, 'PASS');
	assert.equal(tecnica.resoluciones.find(r => r.campo === 'proteccion.Ics')?.estado, 'NOT_APPLICABLE');
});

test('V8 calibre: una carga sin corriente de diseño no desaparece de una suma parcialmente conocida', () => {
	const p = fixture();
	p.dispositivos.push({ id: 'conocida', tipo: 'otro', bornes: [], corrienteNominal: 2 }, { id: 'desconocida', tipo: 'otro', bornes: [] });
	const evaluarCalibre = () => validarIngenieria({ proyecto: p, circuitos: [{ ...circuito, cargas: ['conocida', 'desconocida'] }], reglas: [REGLA_PROTECCIONES] }).resultados.find(r => r.code.startsWith('TS-PROT-RATING'))!;
	assert.equal(evaluarCalibre().status, 'INDETERMINATE');
	p.dispositivos.find(d => d.id === 'desconocida')!.corrienteNominal = 0;
	assert.equal(evaluarCalibre().status, 'PASS', 'cero declarado no equivale a ausencia');
});

test('V8 corte: Icu, Icn e Ics son criterios diferentes, no fallbacks', () => {
	const p = fixture();
	assert.equal(evaluar(p).status, 'PASS');
	for (const valor of ['Icn', 'Ics'] as const) {
		p.datosTecnicos!.overridesCriterios!.capacidadCorte = { modo: 'VALOR', valor };
		const r = evaluar(p); assert.equal(r.status, 'FAIL'); assert.equal(r.criterion?.valor, valor);
	}
	delete p.dispositivos[1].fisica!.proteccion!.capacidadCorte!.icsKA;
	const falta = evaluar(p); assert.equal(falta.status, 'INDETERMINATE');
	assert.ok(falta.evidence.some(e => e.codigo === 'Icu' && e.valor === 1));
	assert.ok(falta.evidence.some(e => e.codigo === 'ICC')); assert.match(falta.missingData.join(' '), /Ics aplicable/);
});

test('V8 corte: capacidad conocida permanece visible cuando falta impedancia de red', () => {
	const p = fixture(); delete p.dispositivos[0].fisica!.fuente!.rOhm;
	const prospectiva = analizarProspectivaProtecciones(p, contexto()).get('q1')!;
	assert.equal(prospectiva.estado, 'DATOS_RED'); assert.equal(prospectiva.iccA, undefined);
	const r = evaluar(p); assert.equal(r.status, 'INDETERMINATE');
	assert.ok(r.evidence.some(e => e.codigo === 'Icu' && e.valor === 1));
	assert.ok(r.evidence.some(e => e.codigo === 'Icn' && e.valor === 0.5));
	assert.ok(!r.evidence.some(e => e.codigo === 'ICC'));
});

test('V8 corte: no se valida un valor sin contexto técnico aplicable o con retorno falso', () => {
	const p = fixture(); vincular(p); assert.equal(evaluar(p).status, 'PASS');
	p.datosTecnicos!.vinculos[0].condiciones.tensionV = 400;
	const incompatible = evaluar(p); assert.equal(incompatible.status, 'INDETERMINATE');
	assert.ok(incompatible.evidence.some(e => e.codigo === 'Icu_RESOLUTION' && e.valor === 'NOT_APPLICABLE'));
	assert.ok(!incompatible.evidence.some(e => e.codigo === 'Icu'));
	p.datosTecnicos!.vinculos[0].condiciones.tensionV = 230; delete p.datosTecnicos!.vinculos[0].condiciones.polos;
	assert.equal(evaluar(p).status, 'INDETERMINATE');
	p.dispositivos[0].bornes[1].tipo = 'control';
	assert.equal(analizarProspectivaProtecciones(p, contexto()).get('q1')?.estado, 'TOPOLOGIA');
});

test('V8 corte: hash inválido o revisión ausente nunca rescatan capacidades legacy', () => {
	for (const modo of ['hash', 'ausente'] as const) {
		const p = fixture(); vincular(p);
		if (modo === 'hash') p.datosTecnicos!.revisiones[0].nombre = 'alterado';
		else p.datosTecnicos!.revisiones = [];
		const r = evaluar(p); assert.equal(r.status, 'INDETERMINATE');
		assert.ok(!r.evidence.some(e => e.codigo === 'Icu')); assert.ok(r.missingData.length > 1);
	}
});

test('V8 corte: procedencia, hash, criterio y valores conocidos se conservan independientemente', () => {
	const p = fixture(), revision = vincular(p); delete p.datosTecnicos!.prospectiva;
	const r = evaluar(p); assert.equal(r.status, 'INDETERMINATE');
	assert.ok(r.evidence.some(e => e.codigo === 'Icu' && /SINTETICO/.test(e.descripcion)));
	assert.ok(r.evidence.some(e => e.codigo === 'Icu_REFERENCE' && String(e.valor).includes(revision.hash)));
	assert.match(r.missingData.join(' '), /SIN_ENSAYO/);
});

test('V8 corte: criterio ausente, desactivado y no aplica no se transforman en PASS', () => {
	const p = fixture(); delete p.datosTecnicos!.overridesCriterios;
	assert.equal(evaluar(p).status, 'INDETERMINATE');
	for (const modo of ['DESACTIVADO', 'NO_APLICA'] as const) {
		p.datosTecnicos!.overridesCriterios = { capacidadCorte: { modo, motivo: `Decisión explícita ${modo}` } };
		const r = evaluar(p); assert.equal(r.status, 'NOT_APPLICABLE'); assert.match(r.description, new RegExp(modo));
		assert.ok(r.evidence.some(e => e.codigo === 'Icu'));
	}
});

test('V8 corte: override de circuito decide el campo sin alterar el criterio del proyecto', () => {
	const p = fixture(); p.datosTecnicos!.criteriosCircuito = { c1: { overrides: { capacidadCorte: { modo: 'VALOR', valor: 'Ics' } } } };
	const r = evaluar(p); assert.equal(r.status, 'FAIL'); assert.equal(r.criterion?.valor, 'Ics');
	assert.deepEqual(p.datosTecnicos!.overridesCriterios!.capacidadCorte, { modo: 'VALOR', valor: 'Icu' });
});

test('V8 prospectiva: no supone aparatos cerrados ni inventa el punto ausente', () => {
	const p = fixture(); const abierto = analizarProspectivaProtecciones(p).get('q1')!;
	assert.equal(abierto.estado, 'TOPOLOGIA'); assert.equal(abierto.iccA, undefined);
	delete p.datosTecnicos!.prospectiva;
	assert.equal(analizarProspectivaProtecciones(p, contexto()).get('q1')?.estado, 'SIN_ENSAYO');
});

test('V8 prospectiva: resistencia de cable desconocida no equivale a cable ideal para corte', () => {
	const p = fixture(); delete p.conductores[0].fisica!.longitudManualM;
	const r = analizarProspectivaProtecciones(p, contexto()).get('q1')!;
	assert.equal(r.estado, 'DATOS_RED'); assert.equal(r.iccA, undefined);
});

test('V8 prospectiva: fallo runtime no contamina el ensayo de diseño', () => {
	const p = fixture(), ctx = contexto();
	ctx.fallas = [{ id: 'operativo', tipo: 'CONDUCTOR_ABIERTO', ramaId: 'conductor:w1' }];
	assert.deepEqual(analizarProspectivaProtecciones(p, ctx), analizarProspectivaProtecciones(p, contexto()));
	assert.equal(ctx.fallas[0].id, 'operativo');
});

test('V8 prospectiva: impedancia técnica de fuente ausente no recupera el dato legacy', () => {
	const p = fixture(), ref = vincular(p);
	p.datosTecnicos!.vinculos.push({ entidad: 'DEVICE', entidadId: 'red', producto: { ...referenciaTecnica(ref), id: 'fuente-ausente' }, condiciones: {}, decisiones: {} });
	const r = analizarProspectivaProtecciones(p, contexto()).get('q1')!;
	assert.equal(r.estado, 'DATOS_RED'); assert.equal(r.iccA, undefined); assert.match(r.motivos.join(' '), /legacy/);
});

test('V8 prospectiva: no asigna toda la Icc a una protección puenteada aunque el primer camino la atraviese', () => {
	const p = fixture();
	for (let i = 0; i < 3; i++) p.dispositivos.push({ id: `x${i}`, tipo: 'bornero', bornes: [{ id: 'L', tipo: 'L' }] });
	const puntos = [{ dispositivoId: 'red', borneId: 'L' }, ...[0, 1, 2].map(i => ({ dispositivoId: `x${i}`, borneId: 'L' })), { dispositivoId: 'q1', borneId: '2' }];
	for (let i = 0; i < 4; i++) p.conductores.push({ ...structuredClone(p.conductores[0]), id: `bypass${i}`, de: puntos[i], a: puntos[i + 1] });
	const r = analizarProspectivaProtecciones(p, contexto()).get('q1')!;
	assert.equal(r.estado, 'TOPOLOGIA'); assert.equal(r.iccA, undefined); assert.match(r.motivos.join(' '), /no atraviesa/);
});

test('V8 prospectiva: PE real necesita retorno físico explícito y GND por nombre no lo sustituye', () => {
	const p = fixture(); p.dispositivos[0].bornes.push({ id: 'PE', tipo: 'PE' });
	p.datosTecnicos!.prospectiva![0].tipo = 'L_PE'; p.datosTecnicos!.prospectiva![0].a.borneId = 'PE';
	assert.equal(analizarProspectivaProtecciones(p, contexto()).get('q1')?.estado, 'TOPOLOGIA');
	p.dispositivos[0].fisica!.fuente!.referenciaPe = 'PE';
	assert.equal(analizarProspectivaProtecciones(p, contexto()).get('q1')?.estado, 'RESUELTO');
	p.dispositivos[0].bornes[2].tipo = 'control';
	assert.equal(analizarProspectivaProtecciones(p, contexto()).get('q1')?.estado, 'TOPOLOGIA');
});

test('V8 prospectiva: puntos duplicados son conflicto; trifásica y acoplamiento no se fingen modelados', () => {
	const p = fixture(), e = p.datosTecnicos!.prospectiva![0];
	p.datosTecnicos!.prospectiva!.push(structuredClone(e));
	assert.equal(analizarProspectivaProtecciones(p, contexto()).get('q1')?.estado, 'CONFLICTO');
	p.datosTecnicos!.prospectiva = [e]; e.tipo = 'TRIFASICA';
	assert.equal(analizarProspectivaProtecciones(p, contexto()).get('q1')?.estado, 'NO_SOPORTADO');
	e.tipo = 'L_N'; p.dispositivos[0].fisica!.transformador = { primarioV: 230, secundarioV: 24, primarioTerminales: ['L', 'N'] };
	assert.equal(analizarProspectivaProtecciones(p, contexto()).get('q1')?.estado, 'NO_SOPORTADO');
});

test('V8 prospectiva: guardar/cargar, orden e imagen no cambian la resolución eléctrica', () => {
	const p = fixture(); vincular(p); const esperado = evaluar(p), prospectiva = analizarProspectivaProtecciones(p, contexto());
	const cargado = cargarProyecto(JSON.stringify(p)).proyecto;
	assert.deepEqual(evaluar(cargado), esperado); assert.deepEqual(analizarProspectivaProtecciones(cargado, contexto()), prospectiva);
	const invertido = structuredClone(p); invertido.dispositivos.reverse(); invertido.conductores.reverse();
	assert.deepEqual(evaluar(invertido), esperado); assert.deepEqual(analizarProspectivaProtecciones(invertido, contexto()), prospectiva);
	p.dispositivos[1].tipo = 'otro';
	assert.deepEqual(evaluar(p), esperado); assert.deepEqual(analizarProspectivaProtecciones(p, contexto()), prospectiva);
});
