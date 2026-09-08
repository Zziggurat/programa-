import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureCaidaTensionV5 } from '../ejemplo/fixtures-fisica-v5.js';
import { publicarRevision } from '../src/datos-tecnicos/hash.js';
import { referenciaTecnica, type DatoTecnico, type RevisionProductoTecnico, type RevisionTablaAmpacidad } from '../src/datos-tecnicos/tipos.js';
import { resolverProyectoTecnico } from '../src/datos-tecnicos/resolver.js';
import { simularFisicaProyecto } from '../src/fisica/topologia-proyecto.js';
import { descubrirCircuitos } from '../src/ingenieria/circuitos.js';
import { evaluarAlternativasSeccion, REGLA_CONDUCTORES } from '../src/ingenieria/conductores.js';
import { REGLA_COMPATIBILIDAD_EQUIPOS } from '../src/ingenieria/compatibilidad.js';
import { validarIngenieria } from '../src/ingenieria/validacion.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import type { Conductor, Proyecto } from '../src/modelo/tipos.js';

const procedencia = { origen: 'SINTETICO' as const, referencia: 'Datos aritméticos de regresión, no tabla normativa ni ficha real' };
const base = { version: 1 as const, canon: 1 as const, catalogo: { id: 'equipos-v8', nombre: 'Regresión sintética' }, id: 'tabla',
	revision: 1, hash: '', nombre: 'Ensayo V8', estado: 'ACTIVA' as const, procedencia };
function tabla(iz = 30, revision = 1): RevisionTablaAmpacidad {
	return publicarRevision({ ...base, revision, tipo: 'AMPACIDAD', politicaSeccion: 'EXACT_ONLY',
		filas: [2.5, 4].map((seccionMm2, i) => ({ material: 'COBRE', aislamiento: 'PVC', temperaturaAislamientoC: 70,
			seccionMm2, metodo: 'prueba', temperaturaBaseC: 30, cargados: 2, agrupamientoBase: 1, izA: iz + i * 10 })),
		factores: [{ id: 'amb', dimension: 'AMBIENTE', material: 'COBRE', aislamiento: 'PVC', metodo: 'prueba', politica: 'EXACT_ONLY',
			puntos: [{ valor: 30, factor: 1 }, { valor: 40, factor: 0.94 }] },
			{ id: 'grupo', dimension: 'AGRUPAMIENTO', material: 'COBRE', aislamiento: 'PVC', metodo: 'prueba', politica: 'EXACT_ONLY',
				puntos: [{ valor: 1, factor: 1 }, { valor: 2, factor: 0.8 }] }], combinaciones: [['amb', 'grupo']] });
}
function circuitoConductor() {
	const p = fixtureCaidaTensionV5(), t = tabla();
	p.dispositivos.find(d => d.id === 'r1')!.corrienteNominal = 22;
	const q = p.dispositivos.find(d => d.id === 'q1')!; q.corrienteNominal = 25; q.fisica!.proteccion!.inA = 25;
	p.datosTecnicos = { version: 1, revisiones: [t], vinculos: [], instalaciones: [{ conductorId: 'w-fase-carga', tabla: referenciaTecnica(t),
		material: 'COBRE', aislamiento: 'PVC', temperaturaAislamientoC: 70, metodo: 'prueba', temperaturaAmbienteC: 40, cargados: 2, agrupamiento: 2, factores: ['amb', 'grupo'] }],
		overridesCriterios: { coordinarIbInIz: { modo: 'VALOR', valor: true }, maxVoltageDropPercent: { modo: 'VALOR', valor: 10 } } };
	return p;
}
const conexiones = new Map([['q1', [['1', '2']] as const]]);
function conductores(p: Proyecto) {
	const tecnica = resolverProyectoTecnico(p), circuitos = descubrirCircuitos(tecnica.proyecto).circuitos;
	return validarIngenieria({ proyecto: tecnica.proyecto, tecnica, circuitos,
		fisica: simularFisicaProyecto(tecnica.proyecto, { conexionesCerradas: conexiones }), reglas: [REGLA_CONDUCTORES] }).resultados
		.filter(r => r.relatedEntities.some(e => e.id === 'w-fase-carga'));
}

test('V8 conductor: Ib22 ≤ Iz22,56 pasa parcialmente pero In25 hace fallar coordinación', () => {
	const p = circuitoConductor(), r = conductores(p), amp = r.find(r => r.code === 'TS-CABLE-AMPACITY')!;
	assert.equal(amp.status, 'PASS'); assert.equal(amp.evidence.find(e => e.codigo === 'IB')?.valor, 22);
	assert.ok(Math.abs(Number(amp.evidence.find(e => e.codigo === 'IZ')?.valor) - 22.56) < 1e-10);
	assert.notEqual(amp.evidence.find(e => e.codigo === 'I_OPERATING')?.valor, 22);
	assert.equal(r.find(r => r.code === 'TS-CABLE-IB-IN-IZ')?.status, 'FAIL');
	assert.ok(amp.evidence.some(e => e.codigo === 'AMPACITY_FACTOR_amb' && e.valor === 0.94));
	assert.ok(amp.evidence.some(e => e.codigo === 'AMPACITY_REFERENCE' && /SINTETICO/.test(e.descripcion)));
});

test('V8 conductor: selección de protección usa el trayecto, no el orden de protecciones', () => {
	const p = circuitoConductor(), q0 = structuredClone(p.dispositivos.find(d => d.id === 'q1')!); q0.id = 'q0';
	q0.corrienteNominal = 63; q0.fisica!.proteccion!.inA = 63; p.dispositivos.push(q0);
	const entrada = p.conductores.find(c => c.id === 'w-fase-entrada')!; entrada.de = { dispositivoId: 'q0', borneId: '2' };
	p.conductores.push({ ...structuredClone(entrada), id: 'w-red-q0', de: { dispositivoId: 'red', borneId: 'L' }, a: { dispositivoId: 'q0', borneId: '1' } });
	const evaluar = (p: Proyecto) => {
		const tecnica = resolverProyectoTecnico(p), circuitos = descubrirCircuitos(p).circuitos;
		for (const c of circuitos) c.protecciones.reverse();
		return REGLA_CONDUCTORES.evaluate({ proyecto: tecnica.proyecto, tecnica, circuitos,
			fisica: simularFisicaProyecto(p, { conexionesCerradas: new Map([...conexiones, ['q0', [['1', '2']] as const]]) }) })
			.find(r => r.code === 'TS-CABLE-IB-IN-IZ' && r.relatedEntities.some(e => e.id === 'w-fase-carga'))!;
	};
	const r = evaluar(p); assert.equal(r.evidence.find(e => e.codigo === 'IN')?.valor, 25);
	assert.ok(r.relatedEntities.some(e => e.id === 'q1')); assert.ok(!r.relatedEntities.some(e => e.id === 'q0'));
	p.dispositivos.reverse(); p.conductores.reverse(); assert.deepEqual(evaluar(p), r);
});

test('V8 conductor: falta Ib no se rescata de corriente operativa y tabla inválida no usa legacy', () => {
	const p = circuitoConductor(); delete p.dispositivos.find(d => d.id === 'r1')!.corrienteNominal;
	assert.equal(conductores(p).find(r => r.code === 'TS-CABLE-AMPACITY')?.status, 'INDETERMINATE');
	p.dispositivos.find(d => d.id === 'r1')!.corrienteNominal = 22;
	p.datosTecnicos!.instalaciones[0].tabla.hash = '0'.repeat(64);
	const circuitoId = descubrirCircuitos(p).circuitos.find(c => c.cargas.includes('r1'))!.id;
	p.ingenieria = { version: 1, circuitos: { [circuitoId]: { version: 1, criterios: { ampacityProfile: {
		nombre: 'Tabla legacy permisiva', fuente: 'No usar', puntos: [{ seccionMm2: 2.5, corrienteMaxA: 999 }] } } } } };
	assert.equal(conductores(p).find(r => r.code === 'TS-CABLE-AMPACITY')?.status, 'INDETERMINATE');
});

test('V8 conductor: alternativa requiere criterio/datos y una revisión peor puede cambiar la recomendación', () => {
	const p = circuitoConductor(), antes = structuredClone(p);
	const evaluar = () => evaluarAlternativasSeccion({ proyecto: p, conductorId: 'w-fase-carga', seccionesMm2: [2.5, 4], contextoFisico: { conexionesCerradas: conexiones } });
	const r = evaluar(); assert.equal(r.alternativas[0].estado, 'FAIL'); assert.equal(r.recomendadaMm2, 4); assert.deepEqual(p, antes);
	delete p.datosTecnicos!.overridesCriterios!.coordinarIbInIz;
	assert.equal(evaluar().recomendadaMm2, undefined);
	p.datosTecnicos!.overridesCriterios!.coordinarIbInIz = { modo: 'VALOR', valor: true };
	const peor = tabla(20, 2); p.datosTecnicos!.revisiones.push(peor); p.datosTecnicos!.instalaciones[0].tabla = referenciaTecnica(peor);
	assert.equal(evaluar().recomendadaMm2, undefined); assert.equal(evaluar().alternativas[1].estado, 'FAIL');
});

test('V8 conductor: coordinar desactivado o no aplica no se convierte en cumplimiento', () => {
	for (const modo of ['DESACTIVADO', 'NO_APLICA'] as const) {
		const p = circuitoConductor(); p.datosTecnicos!.overridesCriterios!.coordinarIbInIz = { modo, motivo: 'Decisión de ensayo' };
		assert.equal(conductores(p).find(r => r.code === 'TS-CABLE-IB-IN-IZ')?.status, 'NOT_APPLICABLE');
	}
});

test('V8 conductor: caída desactivada conserva NOT_APPLICABLE, pero ausencia impide recomendar', () => {
	const p = circuitoConductor(); p.datosTecnicos!.overridesCriterios!.maxVoltageDropPercent = { modo: 'DESACTIVADO', motivo: 'No se solicita esta comprobación' };
	assert.equal(conductores(p).find(r => r.code === 'TS-CABLE-VOLTAGE-DROP-CRITERION')?.status, 'NOT_APPLICABLE');
	delete p.datosTecnicos!.overridesCriterios!.maxVoltageDropPercent;
	const r = evaluarAlternativasSeccion({ proyecto: p, conductorId: 'w-fase-carga', seccionesMm2: [4], contextoFisico: { conexionesCerradas: conexiones } });
	assert.equal(r.recomendadaMm2, undefined); assert.equal(r.alternativas[0].estado, 'INDETERMINATE');
});

test('V8 conductor: protección técnica sin resolver no rescata In antiguo para coordinar', () => {
	const p = circuitoConductor(); p.datosTecnicos!.vinculos.push({ entidad: 'DEVICE', entidadId: 'q1', condiciones: {}, decisiones: {},
		producto: { tipo: 'PRODUCTO', catalogoId: 'ausente', id: 'q', revision: 1, hash: '0'.repeat(64) } });
	assert.equal(conductores(p).find(r => r.code === 'TS-CABLE-IB-IN-IZ')?.status, 'INDETERMINATE');
});

const cable = (id: string, de: [string, string], a: [string, string]): Conductor => ({ id, de: { dispositivoId: de[0], borneId: de[1] },
	a: { dispositivoId: a[0], borneId: a[1] }, seccion: 1, fisica: { material: 'COBRE', longitudManualM: 1 } });
function producto(id: string, familia: RevisionProductoTecnico['familia'], campos: DatoTecnico[], gruposSalidas?: RevisionProductoTecnico['gruposSalidas']): RevisionProductoTecnico {
	return publicarRevision({ ...base, id, tipo: 'PRODUCTO', familia, variante: 'Sintética', campos, ...(gruposSalidas ? { gruposSalidas } : {}) });
}
const d = (campo: DatoTecnico['campo'], valor: DatoTecnico['valor'], unidad: string, canal?: string): DatoTecnico => ({
	campo, valor, unidad, naturaleza: Array.isArray(valor) ? 'INTERVALO' : 'NOMINAL', procedencia, ...(canal ? { canal } : {}) });
function circuitoIo() {
	const p = crearProyecto('Grupos PLC sintéticos'); p.gabinete = { ancho: 300, alto: 300, rieles: [], canaletas: [], colocaciones: [] };
	p.dispositivos = [{ id: 'plc', tipo: 'plc', bornes: ['+', '-', 'Q1', 'Q2'].map(id => ({ id, tipo: 'control' })),
		comportamiento: { version: 1, clase: 'controlador', alimentacion: { entradas: ['+'], retornos: ['-'] }, salidasAnalogicas: [],
			salidasDigitales: ['Q1', 'Q2'].map(borne => ({ borne, comun: '+', electrica: { tensionV: 24, sistema: 'DC', tipoSalida: 'PNP', corrienteMaxA: 0.1 } })) } },
		...[1, 2].map(n => ({ id: `km${n}`, tipo: 'contactor' as const, bornes: ['A1', 'A2'].map(id => ({ id, tipo: 'control' as const })),
			comportamiento: { version: 1 as const, clase: 'contactos-electromagneticos' as const,
				bobina: { entrada: 'A1', retorno: 'A2', electrica: { tensionNominalV: 24, sistema: 'DC' as const, corrienteA: 0.08 } }, polos: [], contactos: [] } }))];
	p.conductores = [1, 2].map(n => cable(`w${n}`, ['plc', `Q${n}`], [`km${n}`, 'A1']));
	const plc = producto('plc', 'PLC', ['Q1', 'Q2'].flatMap(canal => [d('plc.corrienteMaxA', 0.1, 'A', canal),
		d('plc.corrienteLlamadaMaxA', 0.3, 'A', canal), d('plc.tipoCarga', 'INDUCTIVA', '1', canal)]),
		[{ id: 'G1', canales: ['Q1', 'Q2'], corrienteMaxA: 0.15, corrienteLlamadaMaxA: 0.45, condiciones: { sistema: 'DC', tensionV: 24 } }]);
	const bobina = producto('bobina', 'BOBINA', [d('bobina.corrienteA', 0.08, 'A'), d('bobina.corrienteLlamadaA', 0.2, 'A'), d('bobina.tensionRangoV', [20, 28], 'V')]);
	p.datosTecnicos = { version: 1, revisiones: [plc, bobina], instalaciones: [], vinculos: [
		{ entidad: 'DEVICE', entidadId: 'plc', producto: referenciaTecnica(plc), condiciones: { sistema: 'DC', tensionV: 24 }, decisiones: {} },
		...[1, 2].map(n => ({ entidad: 'DEVICE' as const, entidadId: `km${n}`, producto: referenciaTecnica(bobina), condiciones: {}, decisiones: {} }))] };
	return p;
}
const io = (p: Proyecto) => validarIngenieria({ proyecto: p, reglas: [REGLA_COMPATIBILIDAD_EQUIPOS] }).resultados;
const regla = (p: Proyecto, code: string) => io(p).find(r => r.code === code)!;

test('V8 IO: canales sanos pueden exceder grupo 0,08+0,08=0,16 A; llamada se evalúa por separado', () => {
	const p = circuitoIo(); assert.ok(io(p).filter(r => r.code === 'TS-IO-DO-CHANNEL-LOAD').every(r => r.status === 'PASS'));
	const grupo = regla(p, 'TS-IO-DO-GROUP-LOAD'); assert.equal(grupo.status, 'FAIL');
	assert.equal(grupo.evidence.find(e => e.codigo === 'IO_KNOWN_SUM')?.valor, 0.16);
	assert.equal(regla(p, 'TS-IO-DO-GROUP-INRUSH').status, 'PASS');
	assert.equal(regla(p, 'TS-IO-DO-GROUP-INRUSH').evidence.find(e => e.codigo === 'IO_KNOWN_SUM')?.valor, 0.4);
	assert.ok(io(p).filter(r => r.code === 'TS-IO-DO-CHANNEL-INRUSH').every(r => r.status === 'PASS'));
});

test('V8 IO: llamada desconocida no es cero, pero suma parcial que excede demuestra FAIL', () => {
	const p = circuitoIo(); p.datosTecnicos!.vinculos.find(v => v.entidadId === 'km2')!.decisiones['bobina.corrienteLlamadaA@'] = { modo: 'SIN_HERENCIA', motivo: 'Dato no conocido' };
	assert.equal(regla(p, 'TS-IO-DO-GROUP-INRUSH').status, 'INDETERMINATE');
	p.datosTecnicos!.vinculos.find(v => v.entidadId === 'km1')!.decisiones['bobina.corrienteLlamadaA@'] = { modo: 'OVERRIDE', dato: d('bobina.corrienteLlamadaA', 0.5, 'A') };
	assert.equal(regla(p, 'TS-IO-DO-GROUP-INRUSH').status, 'FAIL');
});

test('V8 IO: llamada suma varias cargas por canal sin duplicarlas por cables paralelos', () => {
	const p = circuitoIo(); p.conductores[1].de.borneId = 'Q1';
	p.conductores.push({ ...structuredClone(p.conductores[0]), id: 'duplicado' });
	const llamada = regla(p, 'TS-IO-DO-CHANNEL-INRUSH'); assert.equal(llamada.status, 'FAIL');
	assert.equal(llamada.evidence.find(e => e.codigo === 'IO_KNOWN_SUM')?.valor, 0.4);
	assert.equal(regla(p, 'TS-IO-DO-GROUP-LOAD').evidence.find(e => e.codigo === 'IO_KNOWN_SUM')?.valor, 0.16);
});

test('V8 IO: grupo con consumo sostenido desconocido no aprueba una suma parcial', () => {
	const p = circuitoIo(); p.datosTecnicos!.vinculos.find(v => v.entidadId === 'km2')!.decisiones['bobina.corrienteA@'] = { modo: 'SIN_HERENCIA', motivo: 'Sin consumo verificado' };
	const grupo = regla(p, 'TS-IO-DO-GROUP-LOAD'); assert.equal(grupo.status, 'INDETERMINATE');
	assert.equal(grupo.evidence.find(e => e.codigo === 'IO_KNOWN_SUM')?.valor, 0.08);
	p.datosTecnicos!.vinculos.find(v => v.entidadId === 'km1')!.decisiones['bobina.corrienteA@'] = { modo: 'OVERRIDE', dato: d('bobina.corrienteA', 0.2, 'A') };
	assert.equal(regla(p, 'TS-IO-DO-GROUP-LOAD').status, 'FAIL');
});

test('V8 IO: referencia PLC rota no deja canales verdes desde perfil legacy', () => {
	const p = circuitoIo(); p.datosTecnicos!.vinculos[0].producto.hash = '0'.repeat(64);
	assert.ok(io(p).filter(r => r.code === 'TS-IO-DO-CHANNEL-LOAD').every(r => r.status === 'INDETERMINATE'));
	assert.ok(io(p).filter(r => r.code === 'TS-IO-DO-COIL').every(r => r.status === 'INDETERMINATE'));
});

test('V8 IO: grupo exige condiciones y hash exacto; revisión nueva puede empeorar llamada', () => {
	const p = circuitoIo(); p.datosTecnicos!.vinculos[0].condiciones.tensionV = 230;
	assert.equal(regla(p, 'TS-IO-DO-GROUP-LOAD').status, 'INDETERMINATE');
	p.datosTecnicos!.vinculos[0].condiciones.tensionV = 24;
	const vieja = p.datosTecnicos!.revisiones[0] as RevisionProductoTecnico;
	const nueva = publicarRevision({ ...structuredClone(vieja), revision: 2, gruposSalidas: [{ ...vieja.gruposSalidas![0], corrienteLlamadaMaxA: 0.35 }] });
	p.datosTecnicos!.revisiones.push(nueva); assert.equal(regla(p, 'TS-IO-DO-GROUP-INRUSH').status, 'PASS');
	p.datosTecnicos!.vinculos[0].producto = referenciaTecnica(nueva); assert.equal(regla(p, 'TS-IO-DO-GROUP-INRUSH').status, 'FAIL');
	p.datosTecnicos!.vinculos[0].producto.hash = '0'.repeat(64);
	assert.equal(regla(p, 'TS-IO-DO-GROUP-DATA').status, 'INDETERMINATE');
});

test('V8 IO: canales identificados, roundtrip/reordenamiento y tipo visual no alteran grupos', () => {
	const p = circuitoIo(), esperado = io(p); const q = cargarProyecto(JSON.stringify(p)).proyecto;
	assert.deepEqual(io(q), esperado); p.dispositivos.reverse(); p.conductores.reverse(); p.datosTecnicos!.revisiones.reverse();
	const perfil = p.dispositivos.find(d => d.id === 'plc')!.comportamiento!;
	assert.equal(perfil.clase, 'controlador'); if (perfil.clase === 'controlador') perfil.salidasDigitales.reverse();
	for (const d of p.dispositivos) d.tipo = 'otro'; assert.deepEqual(io(p), esperado);
});

test('V8 IO: bobina usa rango explícito y rechaza salida clasificada solo para carga resistiva', () => {
	const p = circuitoIo(); const plc = p.dispositivos[0].comportamiento!; if (plc.clase !== 'controlador') throw new Error('Fixture');
	plc.salidasDigitales[0].electrica!.tensionV = 26;
	assert.equal(regla(p, 'TS-IO-DO-COIL').status, 'PASS');
	plc.salidasDigitales[0].electrica!.tensionV = 29;
	assert.ok(io(p).some(r => r.code === 'TS-IO-DO-COIL' && r.status === 'FAIL'));
	plc.salidasDigitales[0].electrica!.tensionV = 24;
	p.datosTecnicos!.vinculos[0].decisiones['plc.tipoCarga@Q1'] = { modo: 'OVERRIDE', dato: d('plc.tipoCarga', 'RESISTIVA', '1', 'Q1') };
	assert.ok(io(p).some(r => r.code === 'TS-IO-DO-COIL' && r.status === 'FAIL'));
});

test('V8 IO: bobina AC compara frecuencia explícita, no deriva corriente de potencia', () => {
	const p = circuitoIo(); const plc = p.dispositivos[0].comportamiento!; if (plc.clase !== 'controlador') throw new Error('Fixture');
	for (const s of plc.salidasDigitales) s.electrica!.sistema = 'AC';
	for (const dispositivo of p.dispositivos.slice(1)) {
		const b = dispositivo.comportamiento!; if (b.clase !== 'contactos-electromagneticos') throw new Error('Fixture');
		b.bobina.electrica!.sistema = 'AC'; b.bobina.electrica!.frecuenciaHz = 50;
	}
	p.datosTecnicos!.vinculos[0].condiciones.frecuenciaHz = 60;
	assert.ok(io(p).filter(r => r.code === 'TS-IO-DO-COIL').every(r => r.status === 'FAIL'));
	delete p.datosTecnicos!.vinculos[0].condiciones.frecuenciaHz;
	assert.ok(io(p).filter(r => r.code === 'TS-IO-DO-COIL').every(r => r.status === 'INDETERMINATE'));
});

function analogico() {
	const p = crearProyecto('Entrada analógica con dos fuentes');
	p.dispositivos = [{ id: 'tx', tipo: 'sensor', bornes: ['+', 'S', 'C'].map(id => ({ id, tipo: 'control' })),
		comportamiento: { version: 1, clase: 'sensor', contactos: [], alimentacion: { entrada: '+', retorno: 'C' },
			transmisor: { modoConexion: '3-hilos', modoSalida: 'activa', salida: { borne: 'S', comun: 'C', unidad: 'V', rango: [0, 10] },
				variable: { magnitud: 'presion', unidad: 'bar', minimo: 0, maximo: 10 } } }, fisica: { version: 1, analogica: { resistenciaSalidaOhm: 1 } } },
		{ id: 'plc', tipo: 'plc', bornes: ['+', '-', 'AI', 'C'].map(id => ({ id, tipo: 'control' })),
			comportamiento: { version: 1, clase: 'controlador', alimentacion: { entradas: ['+'], retornos: ['-'] }, salidasDigitales: [], salidasAnalogicas: [],
				entradasAnalogicas: [{ borne: 'AI', comun: 'C', unidad: 'V', rango: [0, 10], modoEntrada: 'pasiva',
					variable: { magnitud: 'presion', unidad: 'bar', minimo: 0, maximo: 10 } }] }, fisica: { version: 1, analogica: { burdenOhm: 100000 } } }];
	p.conductores = [cable('s', ['tx', 'S'], ['plc', 'AI']), cable('c', ['tx', 'C'], ['plc', 'C'])]; return p;
}

test('V8 analógica: resistencia de cable ausente no se trata como cero para 0–10 V', () => {
	const p = analogico(); assert.equal(regla(p, 'TS-ANALOG-COMPATIBILITY').status, 'PASS');
	delete p.conductores[0].fisica!.longitudManualM;
	const r = regla(p, 'TS-ANALOG-COMPATIBILITY'); assert.equal(r.status, 'INDETERMINATE');
	assert.match(r.missingData.join(' '), /resistencia\/longitud/);
});

test('V8 analógica: dos fuentes nunca producen verde por elegir array[0]', () => {
	const p = analogico(), segunda = structuredClone(p.dispositivos[0]); segunda.id = 'tx2'; p.dispositivos.push(segunda);
	p.conductores.push(cable('s2', ['tx2', 'S'], ['plc', 'AI']), cable('c2', ['tx2', 'C'], ['plc', 'C']));
	const r = regla(p, 'TS-ANALOG-SOURCES-AMBIGUOUS'); assert.equal(r.status, 'INDETERMINATE');
	assert.ok(!io(p).some(r => r.code === 'TS-ANALOG-COMPATIBILITY'));
	p.dispositivos.reverse(); p.conductores.reverse(); assert.deepEqual(regla(p, 'TS-ANALOG-SOURCES-AMBIGUOUS'), r);
});
