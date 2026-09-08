import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { factorUnidad } from '../src/datos-tecnicos/campos.js';
import {
	contenidoCanonicoRevision, crearPaqueteTecnico, congelarSubconjunto, hashSnapshotTecnico,
	jsonCanonico, leerPaqueteTecnico, leerPaqueteTecnicoAsync, publicarRevision, sha256Texto, verificarRevision,
} from '../src/datos-tecnicos/hash.js';
import {
	DatosTecnicosInvalidos, LIMITES_TECNICOS, inspeccionarDatosNoConfiables,
	parsearJsonTecnico, validarDato, validarRevisionTecnica,
} from '../src/datos-tecnicos/schema.js';
import { referenciaTecnica } from '../src/datos-tecnicos/tipos.js';
import { resolverProyectoTecnico } from '../src/datos-tecnicos/resolver.js';
import { criteriosTecnicos, curvaTecnica, datoTecnico, productoTecnico, proyectoConProductoTecnico, tablaTecnica } from './helpers/datos-tecnicos.js';

test('V8 import cooperativo conserva idéntica validación y permite cancelar entre lotes', async () => {
	const paquete = crearPaqueteTecnico(Array.from({ length: 201 }, (_, i) => productoTecnico({ id: `p${i}` })));
	const texto = JSON.stringify(paquete);
	assert.deepEqual(await leerPaqueteTecnicoAsync(texto), leerPaqueteTecnico(texto));
	const aborto = new AbortController(); let lotes = 0;
	await assert.rejects(leerPaqueteTecnicoAsync(texto, { signal: aborto.signal, progreso: () => { lotes++; aborto.abort(); } }), /cancelada/);
	assert.equal(lotes, 1);
	paquete.revisiones[200].nombre = 'Hash adulterado';
	await assert.rejects(leerPaqueteTecnicoAsync(JSON.stringify(paquete)), /Integridad/);
});

test('V8 divisores de placa inválidos se rechazan, sin convertir cero en undefined', () => {
	for (const campo of ['motor.eficiencia', 'motor.factorPotencia', 'motor.tensionNominalV', 'vfd.eficiencia', 'transformador.primarioV', 'conductor.seccionMm2'] as const)
		assert.throws(() => validarDato(datoTecnico(campo, 0, campo.includes('V') ? 'V' : campo.includes('seccion') ? 'mm2' : '1')), /positivo/);
	assert.doesNotThrow(() => validarDato(datoTecnico('fuente.rOhm', 0, 'ohm')));
});

test('V8 SHA-256 coincide con Node y WebCrypto en padding, múltiples bloques y UTF-8', async () => {
	const textos = ['', 'abc', 'ñáéíóú °C ⏚ 🧰', '\ud800', ...[1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 1024, 65536].map(n => 'x'.repeat(n))];
	for (const texto of textos) {
		const bytes = new TextEncoder().encode(texto);
		const esperadoNode = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
		const esperadoWeb = `sha256:${Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex')}`;
		assert.equal(sha256Texto(texto), esperadoNode, `Node, ${bytes.length} bytes`);
		assert.equal(sha256Texto(texto), esperadoWeb, `WebCrypto, ${bytes.length} bytes`);
	}
	assert.equal(sha256Texto('abc'), 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('V8 canon ordena claves por UTF-16, conserva listas y no materializa undefined', () => {
	const entrada = { z: undefined, b: false, a: { z: 2, a: 'ñ' }, list: [3, 1, null], zero: -0 };
	assert.equal(jsonCanonico(entrada), '{"a":{"a":"ñ","z":2},"b":false,"list":[3,1,null],"zero":0}');
	assert.notEqual(jsonCanonico([1, 2]), jsonCanonico([2, 1]));
	assert.equal(jsonCanonico({ 'é': 1, z: 2, A: 3 }), '{"A":3,"z":2,"é":1}');
	assert.equal(hashSnapshotTecnico({ b: 2, a: 1 }), hashSnapshotTecnico({ a: 1, b: 2 }));
	assert.throws(() => jsonCanonico(NaN), DatosTecnicosInvalidos);
	assert.throws(() => jsonCanonico(undefined), DatosTecnicosInvalidos);
});

test('V8 publicar no muta borrador y el hash se verifica con oráculo externo', () => {
	const r = productoTecnico(); const borrador = structuredClone(r); borrador.campos[0].valor = 9;
	const antes = structuredClone(borrador); const publicada = publicarRevision(borrador);
	assert.deepEqual(borrador, antes);
	assert.notEqual(publicada.hash, r.hash);
	const esperado = `sha256:${createHash('sha256').update(contenidoCanonicoRevision(publicada), 'utf8').digest('hex')}`;
	assert.equal(publicada.hash, esperado);
	assert.doesNotThrow(() => verificarRevision(publicada));
	publicada.campos[0].valor = 10;
	assert.throws(() => verificarRevision(publicada), /Integridad/);
});

test('V8 campos, filas y combinaciones son conjuntos: reordenar no modifica el hash', () => {
	const p = productoTecnico(); const invertido = structuredClone(p); invertido.campos.reverse();
	assert.equal(publicarRevision(invertido).hash, p.hash);
	const t = tablaTecnica(); const reordenado = structuredClone(t);
	reordenado.filas.reverse(); reordenado.factores.reverse(); reordenado.combinaciones[0].reverse();
	assert.equal(publicarRevision(reordenado).hash, t.hash);
	assert.deepEqual(t, tablaTecnica(), 'canon no modifica la entrada');
});

test('V8 puntos de curva y factores conservan orden técnico y rechazan dominio invertido', () => {
	const c = curvaTecnica(); const inversa = structuredClone(c); inversa.puntos.reverse();
	assert.notEqual(contenidoCanonicoRevision(inversa), contenidoCanonicoRevision(c));
	assert.throws(() => publicarRevision(inversa), /orden|dominio/i);
	const t = tablaTecnica(); t.factores[0].puntos.reverse();
	assert.throws(() => publicarRevision(t), /desordenado|dominio/i);
});

test('V8 grupos PLC y canales son conjuntos identificados, no índices de array', () => {
	const plc = productoTecnico({ familia: 'PLC', campos: [{ ...datoTecnico('plc.corrienteMaxA', .5, 'A'), canal: 'Q1' }],
		gruposSalidas: [
			{ id: 'g2', canales: ['Q2', 'Q1'], corrienteMaxA: 1, condiciones: {} },
			{ id: 'g1', canales: ['Q3'], corrienteMaxA: 1, condiciones: {} },
		] });
	const copia = structuredClone(plc); copia.gruposSalidas!.reverse(); copia.gruposSalidas![1].canales.reverse();
	assert.equal(publicarRevision(copia).hash, plc.hash);
});

test('V8 revisiones, condiciones y procedencia forman parte de la identidad de contenido', () => {
	const r = productoTecnico();
	for (const alterar of [
		(x: typeof r) => { x.revision++; },
		(x: typeof r) => { x.campos[0].condiciones!.tensionV = 400; },
		(x: typeof r) => { x.campos[0].procedencia.origen = 'USUARIO'; },
		(x: typeof r) => { x.estado = 'RETIRADA'; },
	]) { const copia = structuredClone(r); alterar(copia); assert.notEqual(publicarRevision(copia).hash, r.hash); }
});

test('V8 un manifiesto equivalente no depende del orden de claves JSON de sus referencias', () => {
	const paquete = crearPaqueteTecnico([productoTecnico()]);
	paquete.manifiesto.referencias = paquete.manifiesto.referencias.map(r => ({ hash: r.hash, revision: r.revision, id: r.id, catalogoId: r.catalogoId, tipo: r.tipo }));
	assert.doesNotThrow(() => leerPaqueteTecnico(JSON.stringify(paquete)));
});

test('V8 duplicar dato/condición con distinto orden de claves se rechaza como ambigüedad', () => {
	const r = productoTecnico();
	r.campos.push({ ...structuredClone(r.campos[0]), valor: 99, condiciones: { tensionV: 230, sistema: 'AC' } });
	assert.throws(() => publicarRevision(r), /duplicado|ambigu/i);
});

test('V8 capacidades distintas por AC/DC se preservan y no son un duplicado', () => {
	const r = productoTecnico(); r.campos.push({ ...structuredClone(r.campos[0]), valor: 3, condiciones: { sistema: 'DC', tensionV: 230 } });
	assert.doesNotThrow(() => publicarRevision(r));
});

test('V8 unidades se convierten por dimensión, con cero y límites conservados', () => {
	assert.equal(factorUnidad('A', 'kA'), .001);
	assert.equal(factorUnidad('mA', 'A'), .001);
	assert.equal(factorUnidad('kW', 'W'), 1000);
	assert.equal(factorUnidad('%', '1'), .01);
	assert.equal(factorUnidad('V', 'A'), undefined);
	assert.doesNotThrow(() => validarDato(datoTecnico('proteccion.Icu', 6000, 'A')));
	assert.doesNotThrow(() => validarDato(datoTecnico('motor.eficiencia', 94, '%')));
	assert.doesNotThrow(() => validarDato(datoTecnico('proteccion.inA', 0, 'A')));
	assert.throws(() => validarDato(datoTecnico('motor.eficiencia', 101, '%')));
	assert.throws(() => validarDato(datoTecnico('proteccion.Icu', 6, 'V')));
	assert.throws(() => validarDato(datoTecnico('proteccion.Icu', false, 'kA')));
});

test('V8 schema rechaza versiones futuras, enums y campos arbitrarios sin reinterpretación', () => {
	const r = productoTecnico();
	for (const dato of [{ ...r, version: 2 }, { ...r, canon: 2 }, { ...r, familia: 'MAGIA' }, { ...r, ejecutar: 'alert(1)' }]) {
		assert.throws(() => validarRevisionTecnica(dato), DatosTecnicosInvalidos);
	}
	const paquete = crearPaqueteTecnico([r]);
	assert.throws(() => leerPaqueteTecnico(JSON.stringify({ ...paquete, version: 2 })), DatosTecnicosInvalidos);
	assert.throws(() => validarDato({ ...datoTecnico(), campo: 'constructor' }), DatosTecnicosInvalidos);
});

test('V8 no acepta auto-certificación dentro de un paquete o su procedencia', () => {
	const r = productoTecnico(); const paquete = crearPaqueteTecnico([r]);
	assert.throws(() => leerPaqueteTecnico(JSON.stringify({ ...paquete, revisionesHumanas: [{ hash: r.hash, estado: 'REVISADO' }] })), /desconocido/);
	assert.throws(() => validarRevisionTecnica({ ...r, procedencia: { ...r.procedencia, verificado: true } }), /desconocido/);
	const importado = leerPaqueteTecnico(JSON.stringify(paquete));
	assert.equal(importado.revisiones[0].procedencia.origen, 'SINTETICO');
	assert.equal('verificado' in importado.revisiones[0].procedencia, false);
});

test('V8 referencias de documentos rechazan rutas privadas y URLs ejecutables/credenciales', () => {
	for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///C:/privado.pdf', 'https://user:pass@example.com/ficha']) {
		const r = productoTecnico(); r.procedencia.url = url;
		assert.throws(() => publicarRevision(r), /URL/);
	}
	for (const documento of ['C:\\Usuarios\\secreto.pdf', '\\\\servidor\\privado.pdf', '/home/privado.pdf', 'file:///tmp/privado.pdf']) {
		const r = productoTecnico(); r.procedencia.documento = documento;
		assert.throws(() => publicarRevision(r), /privadas/);
	}
	assert.doesNotThrow(() => productoTecnico({ procedencia: { origen: 'DOCUMENTAL', referencia: 'Referencia declarada', url: 'https://example.com/ficha' } }));
});

test('V8 espacios iniciales no ocultan rutas privadas y validar no altera el contenido firmado', () => {
	const rutas = ['C:/Usuarios/privado.pdf', 'C:\\Usuarios\\privado.pdf', '\\\\servidor\\privado.pdf', '/home/privado.pdf', 'file:///tmp/privado.pdf'];
	for (const prefijo of [' ', '\t', '\n', ' \t\r\n']) for (const ruta of rutas) {
		for (const campo of ['referencia', 'documento'] as const) {
			const r = productoTecnico(); const valor = `${prefijo}${ruta}`;
			r.procedencia[campo] = valor;
			assert.throws(() => publicarRevision(r), /rutas privadas/, `${campo}: ${JSON.stringify(valor)}`);
			assert.equal(r.procedencia[campo], valor, 'rechazar no normaliza el objeto recibido');
		}
	}
	const referencia = ' \tManual de ensayo, sección 4\n';
	const documento = '\nFicha pública de ensayo 2026 ';
	const r = productoTecnico({ procedencia: { origen: 'DOCUMENTAL', referencia, documento } });
	const original = structuredClone(r);
	verificarRevision(r);
	const cargado = leerPaqueteTecnico(JSON.stringify(crearPaqueteTecnico([r]))).revisiones[0];
	assert.deepEqual(r, original, 'validación no modifica los datos ni su hash');
	assert.equal(cargado.procedencia.referencia, referencia);
	assert.equal(cargado.procedencia.documento, documento);
	assert.equal(cargado.hash, original.hash, 'roundtrip conserva el contenido firmado exacto');
});

test('V8 input hostil rechaza prototype pollution, objetos no JSON y números no finitos', () => {
	for (const clave of ['__proto__', 'constructor', 'prototype']) {
		assert.throws(() => parsearJsonTecnico(`{"contenido":{"${clave}":{"polluted":true}}}`), /clave peligrosa/);
	}
	assert.equal((Object.prototype as { polluted?: unknown }).polluted, undefined);
	assert.throws(() => parsearJsonTecnico('{"valor":1e999}'), /no finito/);
	for (const valor of [NaN, Infinity, -Infinity, () => 1, new Date(), Symbol('x'), 1n]) {
		assert.throws(() => inspeccionarDatosNoConfiables({ valor }), DatosTecnicosInvalidos);
	}
	assert.throws(() => parsearJsonTecnico('{incompleto'), /JSON inválido/);
});

test('V8 límites de texto/profundidad/colección se aplican antes de adoptar datos', () => {
	assert.throws(() => parsearJsonTecnico(' '.repeat(LIMITES_TECNICOS.caracteres + 1)), /límite/);
	assert.throws(() => parsearJsonTecnico(JSON.stringify(Array(LIMITES_TECNICOS.coleccion + 1).fill(0))), /colección/);
	let anidado: unknown = 0;
	for (let i = 0; i < LIMITES_TECNICOS.profundidad + 2; i++) anidado = { siguiente: anidado };
	assert.throws(() => parsearJsonTecnico(JSON.stringify(anidado)), /estructura excesiva/);
	assert.throws(() => inspeccionarDatosNoConfiables({ texto: 'x'.repeat(100001) }), /cadena excesiva/);
});

test('V8 bandas de curva inválidas y dominio duplicado nunca se publican', () => {
	for (const alterar of [
		(c: ReturnType<typeof curvaTecnica>) => { c.puntos[0].minimoS = 30; },
		(c: ReturnType<typeof curvaTecnica>) => { c.puntos[1].corriente = 1; },
		(c: ReturnType<typeof curvaTecnica>) => { c.puntos[0].minimoS = 0; },
		(c: ReturnType<typeof curvaTecnica>) => { c.puntos[0].corriente = Infinity; },
	]) { const c = curvaTecnica(); alterar(c); assert.throws(() => publicarRevision(c), DatosTecnicosInvalidos); }
});

test('V8 factores rechazan doble corrección, dependencia ausente y dominio invertido', () => {
	const doble = tablaTecnica(); doble.combinaciones = [['temperatura', 'temperatura']];
	assert.throws(() => publicarRevision(doble), /doble corrección/);
	const faltante = tablaTecnica(); faltante.combinaciones = [['inexistente']];
	assert.throws(() => publicarRevision(faltante), /referencia ausente/);
	const invalida = tablaTecnica(); invalida.factores[0].puntos[0].factor = -1;
	assert.throws(() => publicarRevision(invalida), DatosTecnicosInvalidos);
});

test('V8 criterios diferencian cero, false, desactivación y no aplicabilidad', () => {
	assert.doesNotThrow(() => criteriosTecnicos({ parametros: {
		maxLossW: { modo: 'VALOR', valor: 0 }, coordinarIbInIz: { modo: 'VALOR', valor: false },
		maxLossPercent: { modo: 'DESACTIVADO', motivo: 'Sin criterio contratado' },
		maxUnbalancePercent: { modo: 'NO_APLICA', motivo: 'Circuito monofásico' },
	} }));
	const criterio = criteriosTecnicos();
	(criterio.parametros as Record<string, unknown>).expresion = { modo: 'VALOR', valor: 'new Function()' };
	assert.throws(() => publicarRevision(criterio), /no soportado/);
});

test('V8 cierre transitivo congela exactamente producto y curva y detecta faltantes/hash distinto', () => {
	const curva = curvaTecnica(); const producto = productoTecnico({ curva: referenciaTecnica(curva) });
	const ajeno = productoTecnico({ id: 'ajeno' });
	const congelado = congelarSubconjunto([referenciaTecnica(producto)], [ajeno, producto, curva]);
	assert.deepEqual(congelado.map(r => r.id).sort(), [curva.id, producto.id].sort());
	assert.throws(() => congelarSubconjunto([referenciaTecnica(producto)], [producto]), /MISSING/);
	assert.throws(() => congelarSubconjunto([{ ...referenciaTecnica(producto), hash: `sha256:${'f'.repeat(64)}` }], [producto, curva]), /MISSING/);
	producto.nombre = 'Cambio posterior'; assert.equal(congelado.find(r => r.id === producto.id)!.nombre, 'Fixture producto-prueba');
});

test('V8 paquete confirma hashes de revisión/manifiesto y conserva fuente sintética tras roundtrip', () => {
	const paquete = crearPaqueteTecnico([productoTecnico(), tablaTecnica(), criteriosTecnicos()]);
	assert.deepEqual(leerPaqueteTecnico(JSON.stringify(paquete)), paquete);
	const corrupto = structuredClone(paquete); corrupto.revisiones[0].nombre = 'Manipulado';
	assert.throws(() => leerPaqueteTecnico(JSON.stringify(corrupto)), /Integridad/);
	const manifest = structuredClone(paquete); manifest.manifiesto.hash = `sha256:${'f'.repeat(64)}`;
	assert.throws(() => leerPaqueteTecnico(JSON.stringify(manifest)), /Integridad/);
	assert.equal(leerPaqueteTecnico(JSON.stringify(paquete)).revisiones.every(r => r.procedencia.origen === 'SINTETICO'), true);
});

test('V8 resolver bloquea revisión corrupta y hash de vínculo equivocado sin mutar el diseño', () => {
	for (const modo of ['CONTENIDO', 'VINCULO'] as const) {
		const p = proyectoConProductoTecnico();
		if (modo === 'CONTENIDO') p.datosTecnicos!.revisiones[0].nombre = 'Revisión adulterada';
		else p.datosTecnicos!.vinculos[0].producto.hash = `sha256:${'f'.repeat(64)}`;
		const antes = structuredClone(p);
		const resultado = resolverProyectoTecnico(p);
		assert.equal(resultado.resoluciones.some(r => r.estado === 'RESOLVED'), false);
		assert.equal(resultado.problemas.length, 1);
		assert.equal(resultado.problemas[0].estado, modo === 'CONTENIDO' ? 'CONFLICT' : 'MISSING');
		assert.deepEqual(p, antes);
	}
});

test('V8 resolver no convierte override de unidad incompatible en RESOLVED con NaN', () => {
	const p = proyectoConProductoTecnico();
	p.datosTecnicos!.vinculos[0].decisiones['proteccion.Icu@'] = {
		modo: 'OVERRIDE', dato: datoTecnico('proteccion.Icu', 6, 'V'),
	};
	const antes = structuredClone(p);
	const resultado = resolverProyectoTecnico(p);
	const icu = resultado.resoluciones.find(r => r.clave === 'proteccion.Icu@');
	assert.notEqual(icu?.estado, 'RESOLVED', 'una unidad inválida no produce una capacidad utilizable');
	assert.equal(resultado.problemas.length > 0 || icu?.estado === 'CONFLICT', true);
	assert.deepEqual(p, antes);
});

test('V8 resolver no usa revisión inválida de una entidad para bloquear otra independiente válida', () => {
	const p = proyectoConProductoTecnico();
	const otro = productoTecnico({ id: 'producto-corrupto' }); otro.nombre = 'Contenido alterado';
	p.datosTecnicos!.revisiones.push(otro);
	p.dispositivos.push({ ...structuredClone(p.dispositivos[0]), id: 'q2' });
	p.datosTecnicos!.vinculos.push({ ...structuredClone(p.datosTecnicos!.vinculos[0]), entidadId: 'q2', producto: referenciaTecnica(otro) });
	const resultado = resolverProyectoTecnico(p);
	assert.equal(resultado.resoluciones.some(r => r.entidadId === 'q1' && r.campo === 'proteccion.Icu' && r.estado === 'RESOLVED'), true);
	assert.equal(resultado.problemas.some(r => r.entidadId === 'q2' && r.estado === 'CONFLICT'), true);
});

test('V8 condiciones de tensión/frecuencia negativas no pueden publicarse como rango técnico', () => {
	for (const condiciones of [{ tensionV: -230 }, { frecuenciaHz: -50 }, { tensionV: [-400, -230] as [number, number] }]) {
		const p = productoTecnico(); p.campos[0].condiciones = condiciones;
		assert.throws(() => publicarRevision(p), DatosTecnicosInvalidos);
	}
	const p = productoTecnico(); p.campos[0].condiciones = { temperaturaC: [-20, 40] };
	assert.doesNotThrow(() => publicarRevision(p), 'temperatura negativa sí es admisible');
});

test('V8 grupos PLC duplicados y canales repetidos no crean ambigüedad de capacidad', () => {
	const grupos = [
		{ id: 'grupo', canales: ['Q1'], corrienteMaxA: 1, condiciones: {} },
		{ id: 'grupo', canales: ['Q1'], corrienteMaxA: 20, condiciones: {} },
	];
	assert.throws(() => productoTecnico({ familia: 'PLC', campos: [], gruposSalidas: grupos }), DatosTecnicosInvalidos);
	assert.throws(() => productoTecnico({ familia: 'PLC', campos: [], gruposSalidas: [{ ...grupos[0], canales: ['Q1', 'Q1'] }] }), DatosTecnicosInvalidos);
});
