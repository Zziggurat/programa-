import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluarAmpacidad, resolverAmpacidadTecnica } from '../src/datos-tecnicos/ampacidad.js';
import { evaluarCondicionesTecnicas } from '../src/datos-tecnicos/condiciones.js';
import { evaluarCoordinacionIbInIz, resolverCriteriosTecnicos } from '../src/datos-tecnicos/criterios.js';
import { evaluarCurvaTecnica, resolverCurvaTecnica } from '../src/datos-tecnicos/curvas.js';
import { indexarRevisiones, publicarRevision } from '../src/datos-tecnicos/hash.js';
import { referenciaTecnica, type ConfiguracionTecnicaProyecto, type InstalacionConductorTecnica,
	type RevisionCriteriosTecnicos, type RevisionCurvaTecnica, type RevisionTablaAmpacidad } from '../src/datos-tecnicos/tipos.js';

const base = { version: 1 as const, canon: 1 as const, catalogo: { id: 'calculos-sinteticos', nombre: 'Fixtures sintéticos' },
	id: 'tabla', revision: 1, hash: '', nombre: 'Cálculo aritmético sintético', estado: 'ACTIVA' as const,
	procedencia: { origen: 'SINTETICO' as const, referencia: 'Oráculos aritméticos de prueba; no tabla normativa' } };

function tabla(): RevisionTablaAmpacidad {
	return publicarRevision({ ...base, tipo: 'AMPACIDAD', politicaSeccion: 'EXACT_ONLY',
		filas: [2.5, 4].map((seccionMm2, n) => ({ material: 'COBRE', aislamiento: 'PVC-sintetico', temperaturaAislamientoC: 70,
			seccionMm2, metodo: 'metodo-prueba', temperaturaBaseC: 30, cargados: 3, agrupamientoBase: 1, izA: [30, 40][n] })),
		factores: [
			{ id: 'ambiente', dimension: 'AMBIENTE', material: 'COBRE', aislamiento: 'PVC-sintetico', metodo: 'metodo-prueba',
				politica: 'EXACT_ONLY', puntos: [{ valor: 30, factor: 1 }, { valor: 40, factor: 0.94 }, { valor: 50, factor: 0.8 }] },
			{ id: 'grupo', dimension: 'AGRUPAMIENTO', material: 'COBRE', aislamiento: 'PVC-sintetico', metodo: 'metodo-prueba',
				politica: 'EXACT_ONLY', puntos: [{ valor: 1, factor: 1 }, { valor: 2, factor: 0.8 }, { valor: 3, factor: 0.7 }] },
		], combinaciones: [['ambiente', 'grupo'], ['ambiente'], ['grupo']] });
}
function instalacion(t: RevisionTablaAmpacidad): InstalacionConductorTecnica {
	return { conductorId: 'c1', tabla: referenciaTecnica(t), material: 'COBRE', aislamiento: 'PVC-sintetico', temperaturaAislamientoC: 70,
		metodo: 'metodo-prueba', temperaturaAmbienteC: 40, cargados: 3, agrupamiento: 2, factores: ['ambiente', 'grupo'] };
}
function config(t = tabla()): ConfiguracionTecnicaProyecto {
	return { version: 1, revisiones: [t], vinculos: [], instalaciones: [instalacion(t)] };
}
function curva(baseCorriente: RevisionCurvaTecnica['base'] = 'MULTIPLOS_IN', interpolacion: RevisionCurvaTecnica['interpolacion'] = 'LOG_LOG'): RevisionCurvaTecnica {
	return publicarRevision({ ...base, id: 'curva', tipo: 'CURVA', base: baseCorriente, unidadTiempo: 's', interpolacion,
		condiciones: { sistema: 'AC', tensionV: [220, 240], frecuenciaHz: 50, polos: 2 },
		puntos: [{ corriente: 1, minimoS: 100, maximoS: 400 }, { corriente: 100, minimoS: 1, maximoS: 4 }] });
}
const condicionesCurva = { sistema: 'AC' as const, tensionV: 230, frecuenciaHz: 50, polos: 2 };
const cerca = (actual: number | undefined, esperado: number) => {
	assert.notEqual(actual, undefined); assert.ok(Math.abs(actual! - esperado) <= 1e-10 * Math.max(1, Math.abs(esperado)), `${actual} ≠ ${esperado}`);
};

test('V8 condiciones: todos los límites explícitos deben conocerse y los intervalos estar contenidos', () => {
	assert.equal(evaluarCondicionesTecnicas({ declaradas: { tensionV: [220, 240], sistema: 'AC' }, actuales: { tensionV: 230, sistema: 'AC' } }).estado, 'RESOLVED');
	assert.equal(evaluarCondicionesTecnicas({ declaradas: { tensionV: [220, 240] }, actuales: { tensionV: [225, 235] } }).estado, 'RESOLVED');
	assert.equal(evaluarCondicionesTecnicas({ declaradas: { tensionV: [220, 240] }, actuales: { tensionV: [225, 250] } }).estado, 'NOT_APPLICABLE');
	assert.equal(evaluarCondicionesTecnicas({ declaradas: { tensionV: 230, sistema: 'AC' }, actuales: { tensionV: 230 } }).estado, 'MISSING');
	assert.equal(evaluarCondicionesTecnicas({ declaradas: { tensionV: 230, sistema: 'AC' }, actuales: { sistema: 'DC' } }).estado, 'NOT_APPLICABLE');
	assert.equal(evaluarCondicionesTecnicas({ declaradas: { frecuenciaHz: 0 }, actuales: { frecuenciaHz: 0 } }).estado, 'RESOLVED');
	assert.equal(evaluarCondicionesTecnicas({ declaradas: { tensionV: 230 }, actuales: { tensionV: [240, 220] } }).estado, 'OUT_OF_DOMAIN');
});

test('V8 ampacidad: oráculo sintético independiente 30 × 0,94 × 0,80 = 22,56 A y trazabilidad conservada', () => {
	const t = tabla(), i = instalacion(t); const antes = structuredClone({ t, i });
	const r = evaluarAmpacidad({ tabla: t, instalacion: i, seccionMm2: 2.5 });
	assert.equal(r.estado, 'RESOLVED'); cerca(r.izA, 22.56); assert.equal(r.izBaseA, 30);
	assert.equal(r.procedencia?.origen, 'SINTETICO'); assert.equal(r.referencia?.hash, t.hash);
	assert.equal(r.filasBase[0].temperaturaBaseC, 30); assert.equal(r.condiciones?.temperaturaAmbienteC, 40);
	assert.equal(r.filasBase[0].temperaturaAislamientoC, 70);
	assert.deepEqual(r.factoresAplicados.map(f => f.factor), [0.94, 0.8]);
	assert.match(r.transformaciones.join(' '), /30 × 0.94 × 0.8/); assert.deepEqual({ t, i }, antes);
});

test('V8 ampacidad: condiciones ausentes no usan defaults y ausencia de factor no equivale a 1', () => {
	const t = tabla();
	for (const campo of ['material', 'aislamiento', 'temperaturaAislamientoC', 'metodo', 'temperaturaAmbienteC', 'cargados', 'agrupamiento'] as const) {
		const i = instalacion(t); delete i[campo];
		const r = evaluarAmpacidad({ tabla: t, instalacion: i, seccionMm2: 2.5 });
		assert.equal(r.estado, 'MISSING', campo); assert.ok(r.faltantes.includes(`instalacion.${campo}`)); assert.equal(r.izA, undefined);
	}
	const i = instalacion(t); i.factores = [];
	const falta = evaluarAmpacidad({ tabla: t, instalacion: i, seccionMm2: 2.5 });
	assert.equal(falta.estado, 'MISSING'); assert.deepEqual(falta.faltantes, ['factor:AGRUPAMIENTO', 'factor:AMBIENTE']);
	i.temperaturaAmbienteC = 30; i.agrupamiento = 1;
	const baseSinCorreccion = evaluarAmpacidad({ tabla: t, instalacion: i, seccionMm2: 2.5 });
	assert.equal(baseSinCorreccion.estado, 'RESOLVED'); assert.equal(baseSinCorreccion.izA, 30);
	assert.equal(evaluarAmpacidad({ tabla: t, instalacion: i }).estado, 'MISSING');
});

test('V8 ampacidad: material/método inaplicables y temperatura fuera del dominio no producen Iz', () => {
	const t = tabla(); const i = instalacion(t); i.temperaturaAmbienteC = 60;
	const fuera = evaluarAmpacidad({ tabla: t, instalacion: i, seccionMm2: 2.5 });
	assert.equal(fuera.estado, 'OUT_OF_DOMAIN'); assert.equal(fuera.izA, undefined);
	i.temperaturaAmbienteC = 40; i.material = 'ALUMINIO';
	assert.equal(evaluarAmpacidad({ tabla: t, instalacion: i, seccionMm2: 2.5 }).estado, 'NOT_APPLICABLE');
	i.material = 'COBRE'; i.metodo = 'otro';
	assert.equal(evaluarAmpacidad({ tabla: t, instalacion: i, seccionMm2: 2.5 }).estado, 'NOT_APPLICABLE');
});

test('V8 ampacidad: rechaza factor repetido, doble dimensión, combinación no autorizada y base ya corregida', () => {
	const t = tabla(), i = instalacion(t); i.factores.push('ambiente');
	assert.equal(evaluarAmpacidad({ tabla: t, instalacion: i, seccionMm2: 2.5 }).estado, 'CONFLICT');
	const dos = structuredClone(t); dos.factores.push({ ...structuredClone(dos.factores[0]), id: 'ambiente2' });
	const t2 = publicarRevision(dos); const i2 = instalacion(t2); i2.factores = ['ambiente', 'ambiente2'];
	assert.equal(evaluarAmpacidad({ tabla: t2, instalacion: i2, seccionMm2: 2.5 }).estado, 'CONFLICT');
	const noAutorizada = publicarRevision({ ...t, combinaciones: [] });
	assert.equal(evaluarAmpacidad({ tabla: noAutorizada, instalacion: instalacion(noAutorizada), seccionMm2: 2.5 }).estado, 'NOT_APPLICABLE');
	const corregida = structuredClone(t); corregida.factores[0].puntos[0].factor = 0.9;
	const t3 = publicarRevision(corregida);
	assert.equal(evaluarAmpacidad({ tabla: t3, instalacion: instalacion(t3), seccionMm2: 2.5 }).estado, 'CONFLICT');
	const sinAncla = structuredClone(t); sinAncla.factores[0].puntos.shift(); const t4 = publicarRevision(sinAncla);
	assert.equal(evaluarAmpacidad({ tabla: t4, instalacion: instalacion(t4), seccionMm2: 2.5 }).estado, 'MISSING');
});

test('V8 ampacidad: políticas EXACT/STEP/LINEAR de sección con dirección y sin extrapolación', () => {
	for (const [politicaSeccion, esperado] of [['EXACT_ONLY', undefined], ['STEP_LOWER', 30], ['STEP_UPPER', 40], ['LINEAR', 35]] as const) {
		const t = publicarRevision({ ...tabla(), politicaSeccion }); const i = instalacion(t); i.factores = []; i.temperaturaAmbienteC = 30; i.agrupamiento = 1;
		const r = evaluarAmpacidad({ tabla: t, instalacion: i, seccionMm2: 3.25 });
		assert.equal(r.estado, esperado === undefined ? 'OUT_OF_DOMAIN' : 'RESOLVED');
		if (esperado !== undefined) cerca(r.izA, esperado);
		for (const seccionMm2 of [1, 6]) assert.equal(evaluarAmpacidad({ tabla: t, instalacion: i, seccionMm2 }).estado, 'OUT_OF_DOMAIN');
	}
});

test('V8 ampacidad: factores interpolados autorizados y STEP no extrapolan', () => {
	for (const [politica, esperado] of [['EXACT_ONLY', undefined], ['STEP_LOWER', 30], ['STEP_UPPER', 28.2], ['LINEAR', 29.1]] as const) {
		const borrador = tabla(); borrador.factores[0].politica = politica; const t = publicarRevision(borrador);
		const i = instalacion(t); i.factores = ['ambiente']; i.agrupamiento = 1; i.temperaturaAmbienteC = 35;
		const r = evaluarAmpacidad({ tabla: t, instalacion: i, seccionMm2: 2.5 });
		assert.equal(r.estado, esperado === undefined ? 'OUT_OF_DOMAIN' : 'RESOLVED');
		if (esperado !== undefined) cerca(r.izA, esperado);
		i.temperaturaAmbienteC = 60; assert.equal(evaluarAmpacidad({ tabla: t, instalacion: i, seccionMm2: 2.5 }).estado, 'OUT_OF_DOMAIN');
	}
});

test('V8 ampacidad: filas/revisiones reordenadas y roundtrip no cambian resultado; hash inexacto bloquea', () => {
	const c = config(); const esperado = resolverAmpacidadTecnica(c, 'c1', 2.5);
	const t = c.revisiones[0] as RevisionTablaAmpacidad; t.filas.reverse(); t.factores.reverse(); t.combinaciones.reverse();
	c.instalaciones[0].factores.reverse(); const r = resolverAmpacidadTecnica(JSON.parse(JSON.stringify(c)), 'c1', 2.5);
	assert.equal(r.estado, 'RESOLVED'); assert.equal(r.izA, esperado.izA); assert.deepEqual(r.filasBase, esperado.filasBase);
	assert.deepEqual(r.factoresAplicados, esperado.factoresAplicados);
	c.instalaciones[0].tabla.hash = `sha256:${'1'.repeat(64)}`;
	assert.equal(resolverAmpacidadTecnica(c, 'c1', 2.5).estado, 'CONFLICT');
	c.revisiones = []; assert.equal(resolverAmpacidadTecnica(c, 'c1', 2.5).estado, 'MISSING');
	assert.equal(resolverAmpacidadTecnica(undefined, 'c1', 2.5).condiciones, undefined);
});

test('V8 ampacidad: bases ambiguas no dependen del orden y revisión alterada no se adopta', () => {
	const t = tabla(); t.filas.push({ ...t.filas[0], izA: 31 }); const ambiguo = publicarRevision(t);
	assert.equal(evaluarAmpacidad({ tabla: ambiguo, instalacion: instalacion(ambiguo), seccionMm2: 2.5 }).estado, 'CONFLICT');
	const corrupta = tabla(); corrupta.filas[0].izA = 900;
	assert.equal(evaluarAmpacidad({ tabla: corrupta, instalacion: instalacion(corrupta), seccionMm2: 2.5 }).estado, 'CONFLICT');
});

test('V8 curvas: múltiplos In, LOG_LOG y banda tienen oráculo independiente', () => {
	const c = curva(); const r = evaluarCurvaTecnica({ curva: c, corrienteA: 100, inA: 10, condiciones: condicionesCurva });
	assert.equal(r.estado, 'RESOLVED'); assert.equal(r.coordenada, 10); cerca(r.minimoS, 10); cerca(r.maximoS, 40);
	assert.equal(r.procedencia?.origen, 'SINTETICO'); assert.equal(r.referencia?.hash, c.hash);
	assert.equal(r.puntosUsados.length, 2); assert.match(r.transformaciones.join(' '), /LOG_LOG/);
	const absoluta = curva('AMPERIOS');
	const a = evaluarCurvaTecnica({ curva: absoluta, corrienteA: 10, condiciones: condicionesCurva });
	assert.equal(a.estado, 'RESOLVED'); cerca(a.minimoS, 10); cerca(a.maximoS, 40);
});

test('V8 curvas: LINEAR, EXACT_ONLY y extremos sin clamp/extrapolación', () => {
	const lineal = evaluarCurvaTecnica({ curva: curva('AMPERIOS', 'LINEAR'), corrienteA: 50.5, condiciones: condicionesCurva });
	cerca(lineal.minimoS, 50.5); cerca(lineal.maximoS, 202);
	const exacta = curva('AMPERIOS', 'EXACT_ONLY');
	assert.equal(evaluarCurvaTecnica({ curva: exacta, corrienteA: 50.5, condiciones: condicionesCurva }).estado, 'OUT_OF_DOMAIN');
	for (const corrienteA of [1, 100]) assert.equal(evaluarCurvaTecnica({ curva: exacta, corrienteA, condiciones: condicionesCurva }).estado, 'RESOLVED');
	for (const interpolacion of ['EXACT_ONLY', 'LINEAR', 'LOG_LOG'] as const) for (const corrienteA of [0.1, 101]) {
		const r = evaluarCurvaTecnica({ curva: curva('AMPERIOS', interpolacion), corrienteA, condiciones: condicionesCurva });
		assert.equal(r.estado, 'OUT_OF_DOMAIN'); assert.equal(r.minimoS, undefined); assert.equal(r.maximoS, undefined);
	}
});

test('V8 curvas: falta In/condición y tensión/sistema incompatibles quedan separados', () => {
	const c = curva();
	assert.equal(evaluarCurvaTecnica({ curva: c, corrienteA: 10, condiciones: condicionesCurva }).estado, 'MISSING');
	assert.equal(evaluarCurvaTecnica({ curva: c, corrienteA: 10, inA: 0, condiciones: condicionesCurva }).estado, 'OUT_OF_DOMAIN');
	assert.equal(evaluarCurvaTecnica({ curva: c, corrienteA: 10, inA: 10, condiciones: {} }).estado, 'MISSING');
	assert.equal(evaluarCurvaTecnica({ curva: c, corrienteA: 10, inA: 10, condiciones: { ...condicionesCurva, sistema: 'DC' } }).estado, 'NOT_APPLICABLE');
	assert.equal(evaluarCurvaTecnica({ curva: c, corrienteA: 10, inA: 10, condiciones: { ...condicionesCurva, tensionV: 400 } }).estado, 'NOT_APPLICABLE');
	const alterada = structuredClone(c); alterada.puntos[0].minimoS = 999;
	assert.equal(evaluarCurvaTecnica({ curva: alterada, corrienteA: 10, inA: 10, condiciones: condicionesCurva }).estado, 'CONFLICT');
});

test('V8 curvas: revisión/hash fijados y retirada advertida, sin sustituir latest', () => {
	const c1 = curva(); const c2 = publicarRevision({ ...c1, revision: 2, puntos: c1.puntos.map(p => ({ ...p, minimoS: p.minimoS * 2, maximoS: p.maximoS * 2 })) });
	const entrada = { corrienteA: 100, inA: 10, condiciones: condicionesCurva };
	cerca(resolverCurvaTecnica(referenciaTecnica(c1), [c2, c1], entrada).minimoS, 10);
	cerca(resolverCurvaTecnica(referenciaTecnica(c2), [c1, c2], entrada).minimoS, 20);
	assert.equal(resolverCurvaTecnica(referenciaTecnica(c1), [c2], entrada).estado, 'MISSING');
	assert.equal(resolverCurvaTecnica({ ...referenciaTecnica(c1), hash: c2.hash }, [c1], entrada).estado, 'CONFLICT');
	const retirada = publicarRevision({ ...c1, revision: 3, estado: 'RETIRADA' });
	assert.equal(resolverCurvaTecnica(referenciaTecnica(retirada), [retirada], entrada).advertencias.length, 1);
});

function perfilCriterios(revision = 1): RevisionCriteriosTecnicos {
	return publicarRevision({ ...base, id: 'criterios', revision, tipo: 'CRITERIOS', ambitoDeclarado: 'Ensayo interno sintético',
		parametros: { maxVoltageDropPercent: { modo: 'VALOR', valor: 3 }, maxLossW: { modo: 'VALOR', valor: 100 },
			capacidadCorte: { modo: 'VALOR', valor: 'Icu' }, coordinarIbInIz: { modo: 'VALOR', valor: true } } });
}

test('V8 criterios: precedencia parcial proyecto/circuito conserva undefined y cero con trazas', () => {
	const p = perfilCriterios(); const circuito = publicarRevision({ ...perfilCriterios(2), parametros: { maxLossW: { modo: 'VALOR' as const, valor: 25 } } });
	const c = config(); c.revisiones.push(p, circuito); c.criterios = referenciaTecnica(p);
	c.overridesCriterios = { maxLossW: { modo: 'VALOR', valor: 50 }, maxVoltageDropPercent: undefined };
	c.criteriosCircuito = { 'circuito-1': { perfil: referenciaTecnica(circuito), overrides: { maxVoltageDropPercent: { modo: 'VALOR', valor: 0 }, maxLossW: undefined } } };
	const antes = structuredClone(c); const r = resolverCriteriosTecnicos(c, 'circuito-1', { maxVoltageDropPercent: 5, maxLossPercent: 2 });
	assert.deepEqual(r.parametros.maxVoltageDropPercent.decision, { modo: 'VALOR', valor: 0 });
	assert.deepEqual(r.parametros.maxLossW.decision, { modo: 'VALOR', valor: 25 });
	assert.deepEqual(r.parametros.maxLossPercent.decision, { modo: 'VALOR', valor: 2 });
	assert.deepEqual(r.parametros.maxLossW.ruta.map(p => p.origen), ['PERFIL_PROYECTO', 'OVERRIDE_PROYECTO', 'PERFIL_CIRCUITO']);
	assert.equal(r.parametros.maxLossW.referencia?.hash, circuito.hash); assert.equal(r.parametros.maxLossW.procedencia?.origen, 'SINTETICO');
	assert.deepEqual(c, antes);
	const roundtrip = JSON.parse(JSON.stringify(c)) as ConfiguracionTecnicaProyecto;
	assert.deepEqual(resolverCriteriosTecnicos(roundtrip, 'circuito-1', { maxVoltageDropPercent: 5, maxLossPercent: 2 }), r);
});

test('V8 criterios: desactivado, no aplicable, booleano false y ausencia conservan significados', () => {
	const p = perfilCriterios(), c = config(); c.revisiones.push(p); c.criterios = referenciaTecnica(p);
	c.overridesCriterios = { maxLossW: { modo: 'DESACTIVADO', motivo: 'No se evalúa en este alcance' },
		maxVoltageDropPercent: { modo: 'NO_APLICA', motivo: 'Circuito de ensayo sin suministro' } };
	const r = resolverCriteriosTecnicos(c);
	assert.equal(r.parametros.maxLossW.estado, 'NOT_APPLICABLE'); assert.equal(r.parametros.maxLossW.decision?.modo, 'DESACTIVADO');
	assert.equal(r.parametros.maxVoltageDropPercent.decision?.modo, 'NO_APLICA'); assert.equal(r.parametros.maxLossPercent.estado, 'MISSING');
	c.overridesCriterios.coordinarIbInIz = { modo: 'VALOR', valor: false };
	const deshabilitado = resolverCriteriosTecnicos(c).parametros.coordinarIbInIz;
	assert.equal(deshabilitado.estado, 'RESOLVED');
	assert.equal(evaluarCoordinacionIbInIz({ criterio: deshabilitado }).estado, 'NOT_APPLICABLE');
	delete c.overridesCriterios.maxLossW;
	assert.deepEqual(resolverCriteriosTecnicos(c).parametros.maxLossW.decision, { modo: 'VALOR', valor: 100 });
});

test('V8 criterios: referencia ausente o corrupta no hace fallback silencioso al valor legacy', () => {
	const p = perfilCriterios(), c = config(); c.criterios = referenciaTecnica(p);
	assert.equal(resolverCriteriosTecnicos(c, undefined, { maxLossW: 10 }).parametros.maxLossW.estado, 'MISSING');
	c.revisiones.push(p); c.criterios.hash = `sha256:${'f'.repeat(64)}`;
	assert.equal(resolverCriteriosTecnicos(c).parametros.maxLossW.estado, 'CONFLICT');
	c.overridesCriterios = { maxLossW: { modo: 'VALOR', valor: 15 } };
	const override = resolverCriteriosTecnicos(c).parametros.maxLossW;
	assert.equal(override.estado, 'RESOLVED'); assert.equal(override.ruta[0].estado, 'CONFLICT');
	assert.deepEqual(override.decision, { modo: 'VALOR', valor: 15 });
});

test('V8 criterios: revisiones por proyecto permanecen independientes y revisión nueva puede empeorar', () => {
	const p1 = perfilCriterios(), p2 = publicarRevision({ ...p1, revision: 2, parametros: { ...p1.parametros, maxLossW: { modo: 'VALOR' as const, valor: 5 } } });
	const a = config(), b = config(); a.revisiones.push(p1, p2); b.revisiones.push(p2, p1);
	a.criterios = referenciaTecnica(p1); b.criterios = referenciaTecnica(p2);
	assert.deepEqual(resolverCriteriosTecnicos(a).parametros.maxLossW.decision, { modo: 'VALOR', valor: 100 });
	assert.deepEqual(resolverCriteriosTecnicos(b).parametros.maxLossW.decision, { modo: 'VALOR', valor: 5 });
	const aSinCambios = JSON.stringify(a); resolverCriteriosTecnicos(b); assert.equal(JSON.stringify(a), aSinCambios);
});

test('V8 coordinación: Ib=22 ≤ Iz=22,56 no aprueba Ib≤In≤Iz con In=25', () => {
	const p = perfilCriterios(), c = config(); c.revisiones.push(p); c.criterios = referenciaTecnica(p);
	const criterio = resolverCriteriosTecnicos(c).parametros.coordinarIbInIz;
	const r = evaluarCoordinacionIbInIz({ criterio, ibA: 22, inA: 25, izA: 22.56 });
	assert.ok(22 <= 22.56); assert.equal(r.estado, 'FAIL');
	assert.equal(evaluarCoordinacionIbInIz({ criterio, ibA: 20, inA: 22, izA: 22.56 }).estado, 'PASS');
	assert.equal(evaluarCoordinacionIbInIz({ criterio, ibA: 22, inA: 25 }).estado, 'INDETERMINATE');
	assert.equal(evaluarCoordinacionIbInIz({ criterio: resolverCriteriosTecnicos().parametros.coordinarIbInIz, ibA: 22, inA: 25, izA: 22.56 }).estado, 'INDETERMINATE');
});

test('V8 cálculos: índice compartido conserva resultados y sigue verificando hash de revisión elegida', () => {
	const t = tabla(), p = perfilCriterios(), c = config(t), cv = curva(); c.revisiones.push(p, cv); c.criterios = referenciaTecnica(p);
	const indice = indexarRevisiones(c.revisiones); const entrada = { corrienteA: 100, inA: 10, condiciones: condicionesCurva };
	assert.deepEqual(resolverAmpacidadTecnica(c, 'c1', 2.5, indice), resolverAmpacidadTecnica(c, 'c1', 2.5));
	assert.deepEqual(resolverCurvaTecnica(referenciaTecnica(cv), c.revisiones, entrada, indice), resolverCurvaTecnica(referenciaTecnica(cv), c.revisiones, entrada));
	assert.deepEqual(resolverCriteriosTecnicos(c, undefined, undefined, indice), resolverCriteriosTecnicos(c));
	t.filas[0].izA = 999;
	assert.equal(resolverAmpacidadTecnica(c, 'c1', 2.5, indice).estado, 'CONFLICT');
});
