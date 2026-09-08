#!/usr/bin/env node
/**
 * Stress reproducible V8 (solo datos SINTÉTICOS, sin navegador ni almacenamiento de proyectos).
 * Requiere compilar primero: node node_modules/typescript/bin/tsc
 * Ejecutar: node herramientas/medir-datos-tecnicos.mjs
 * Opciones: --sizes=100,1000,10000 --bindings=300 --samples=5 --output=<ruta-EXTERNA.json>
 *
 * La biblioteca completa se mide al importar/seleccionar; el proyecto/runtime recibe únicamente
 * su subconjunto fijado. No confundir parseo JSON con validación de hashes ni medir el resolver
 * con el mismo output cacheado como si fuera una evaluación fría. P95 usa nearest-rank: con cinco
 * muestras es el máximo observado, NO una garantía de latencia poblacional.
 */
import assert from 'node:assert/strict';
import { open } from 'node:fs/promises';
import { tmpdir, cpus } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import {
	publicarRevision, crearPaqueteTecnico, leerPaqueteTecnico, congelarSubconjunto, sha256Texto,
} from '../dist/src/datos-tecnicos/hash.js';
import { resolverProyectoTecnico } from '../dist/src/datos-tecnicos/resolver.js';
import { referenciaTecnica } from '../dist/src/datos-tecnicos/tipos.js';
import { crearProyecto } from '../dist/src/modelo/proyecto.js';

const raizRepo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const opciones = new Map();
for (const arg of process.argv.slice(2)) {
	const match = /^--(sizes|bindings|samples|output)=(.+)$/.exec(arg);
	if (!match || opciones.has(match[1])) throw new Error(`Opción desconocida/duplicada: ${arg}`);
	opciones.set(match[1], match[2]);
}
const entero = (texto, min, max, nombre) => {
	const n = Number(texto);
	if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${nombre}: entero entre ${min} y ${max}`);
	return n;
};
const tamanos = (opciones.get('sizes') ?? '100,1000,10000').split(',').map(x => entero(x, 1, 12000, 'sizes'));
if (new Set(tamanos).size !== tamanos.length) throw new Error('sizes no admite tamaños duplicados');
const cantidadVinculos = entero(opciones.get('bindings') ?? 300, 1, 2000, 'bindings');
const muestras = entero(opciones.get('samples') ?? 5, 3, 50, 'samples');
const destino = resolve(opciones.get('output') ?? resolve(tmpdir(), `tablerostudio-v8-stress-${Date.now()}.json`));
const relativo = relative(raizRepo, destino);
if (!relativo || (!isAbsolute(relativo) && relativo !== '..' && !relativo.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))) {
	throw new Error('El informe debe guardarse FUERA del repositorio para no generar artefactos versionados.');
}

const procedencia = { origen: 'SINTETICO', referencia: 'Stress aritmético V8, sin fabricante ni valor normativo' };
const medir = (operacion, verificar) => {
	const valores = [];
	for (let i = 0; i < muestras; i++) {
		const inicio = performance.now(); const valor = operacion(); valores.push(performance.now() - inicio);
		verificar?.(valor);
	}
	const ordenados = [...valores].sort((a, b) => a - b);
	const percentil = p => ordenados[Math.max(0, Math.ceil(p * ordenados.length) - 1)];
	return { muestras, p50Ms: percentil(.5), p95Ms: percentil(.95), minMs: ordenados[0], maxMs: ordenados.at(-1), muestrasMs: valores };
};
function crearProducto(i) {
	return publicarRevision({ version: 1, canon: 1, catalogo: { id: 'stress-v8', nombre: 'Stress SINTÉTICO V8' },
		id: `producto-${i}`, revision: 1, hash: '', nombre: `Protección sintética ${i}`, estado: 'ACTIVA', procedencia,
		tipo: 'PRODUCTO', familia: 'PROTECCION', variante: 'AC 230 V, dato sintético', campos: [
			{ campo: 'proteccion.inA', valor: 25 + i % 5, unidad: 'A', naturaleza: 'NOMINAL', procedencia },
			{ campo: 'proteccion.Icu', valor: 6, unidad: 'kA', naturaleza: 'NOMINAL', condiciones: { sistema: 'AC', tensionV: 230 }, procedencia },
		] });
}
function crearProyectoVinculado(productos, congeladas) {
	const p = crearProyecto('Stress SINTÉTICO V8 — 300 vínculos independientes');
	p.dispositivos = Array.from({ length: cantidadVinculos }, (_, i) => ({ id: `q${i}`, tipo: 'disyuntor', corrienteNominal: 25,
		bornes: [{ id: '1', tipo: 'L' }, { id: '2', tipo: 'L' }] }));
	p.datosTecnicos = { version: 1, revisiones: congeladas, instalaciones: [],
		vinculos: p.dispositivos.map((d, i) => ({ entidad: 'DEVICE', entidadId: d.id,
			producto: referenciaTecnica(productos[i % productos.length]), condiciones: { sistema: 'AC', tensionV: 230 },
			decisiones: { 'proteccion.inA@': { modo: 'CATALOGO' }, 'proteccion.Icu@': { modo: 'CATALOGO' } } })) };
	return p;
}

const comienzo = performance.now();
const informe = {
	formato: 'tablerostudio-stress-datos-tecnicos-v8', version: 1, fecha: new Date().toISOString(),
	entorno: { node: process.version, plataforma: process.platform, arquitectura: process.arch,
		cpu: cpus()[0]?.model, cpusLogicas: cpus().length },
	metodologia: { muestras, tamanos, vinculos: cantidadVinculos, percentil: 'nearest-rank',
		advertencia: 'Muestra local sintética; no certifica latencias ni hardware. RSS/heap son lecturas, no máximos de profiler.',
		resolverFrio: 'Recibe diseño sin marca de proyección; valida y construye snapshot nuevo en cada muestra.',
		resolverReutilizado: 'Medición separada del mismo snapshot ya efectivo usado entre ticks.',
		parseo: 'JSON.parse y leerPaqueteTecnico (estructura, unidades, dependencias y hashes) se miden por separado.',
		persistencia: 'Solo se escribe este informe externo, nunca IndexedDB ni almacenamiento de proyectos.' },
	casos: [], fallos: [], totalMs: 0,
};
try {
	for (const cantidad of tamanos) {
		console.log(`V8 stress: ${cantidad} productos, ${cantidadVinculos} vínculos, ${muestras} muestras.`);
		const casoInicio = performance.now(); const memoriaInicial = process.memoryUsage();
		const productos = Array.from({ length: cantidad }, (_, i) => crearProducto(i));
		const construccionMs = performance.now() - casoInicio;
		const paquete = crearPaqueteTecnico(productos), texto = JSON.stringify(paquete);
		const referencias = Array.from({ length: cantidadVinculos }, (_, i) => referenciaTecnica(productos[i % cantidad]));
		const congeladas = congelarSubconjunto(referencias, productos);
		assert.equal(congeladas.length, Math.min(cantidadVinculos, cantidad));
		const proyecto = crearProyectoVinculado(productos, congeladas), textoProyecto = JSON.stringify(proyecto);
		const caso = { productos: cantidad, vinculos: cantidadVinculos, revisionesCongeladas: congeladas.length,
			construccionMs, bytesCatalogoUtf8: Buffer.byteLength(texto), caracteresCatalogo: texto.length,
			bytesProyectoUtf8: Buffer.byteLength(textoProyecto), metricas: {} };
		caso.metricas.hashTexto = medir(() => sha256Texto(texto), hash => assert.match(hash, /^sha256:[a-f0-9]{64}$/));
		caso.metricas.parseoJson = medir(() => JSON.parse(texto), p => assert.equal(p.revisiones.length, cantidad));
		caso.metricas.parseoValidacionIntegridad = medir(() => leerPaqueteTecnico(texto), p => assert.equal(p.revisiones.length, cantidad));
		console.log(`  Import/validación p95 ${caso.metricas.parseoValidacionIntegridad.p95Ms.toFixed(1)} ms.`);
		caso.metricas.congelarSubconjunto = medir(() => congelarSubconjunto(referencias, productos), rs => assert.equal(rs.length, congeladas.length));
		const verificarResolucion = r => {
			assert.equal(r.problemas.length, 0); assert.equal(r.resoluciones.length, cantidadVinculos * 2);
			assert.equal(r.resoluciones.filter(d => d.estado === 'RESOLVED').length, cantidadVinculos * 2);
			assert.notEqual(r.proyecto, proyecto);
			for (let i = 0; i < cantidadVinculos; i++) assert.equal(r.proyecto.dispositivos[i].corrienteNominal, 25 + i % cantidad % 5);
		};
		caso.metricas.resolverProyectoFrio = medir(() => resolverProyectoTecnico(proyecto), verificarResolucion);
		const efectivo = resolverProyectoTecnico(proyecto);
		caso.metricas.reutilizarSnapshot = medir(() => resolverProyectoTecnico(efectivo.proyecto), r => assert.equal(r, efectivo));
		assert.equal(JSON.stringify(proyecto), textoProyecto, 'resolver no puede mutar el diseño');
		const memoriaFinal = process.memoryUsage();
		caso.memoria = { heapAntesBytes: memoriaInicial.heapUsed, heapDespuesBytes: memoriaFinal.heapUsed,
			rssAntesBytes: memoriaInicial.rss, rssDespuesBytes: memoriaFinal.rss };
		caso.totalMs = performance.now() - casoInicio; informe.casos.push(caso);
		console.log(`  Proyecto ${caso.bytesProyectoUtf8} B; resolver frío p50/p95 ${caso.metricas.resolverProyectoFrio.p50Ms.toFixed(1)}/${caso.metricas.resolverProyectoFrio.p95Ms.toFixed(1)} ms; ${caso.totalMs.toFixed(0)} ms total.`);
	}
} catch (error) {
	informe.fallos.push(error instanceof Error ? { nombre: error.name, mensaje: error.message, stack: error.stack } : { mensaje: String(error) });
	process.exitCode = 1; console.error(error);
} finally {
	informe.totalMs = performance.now() - comienzo;
	try {
		const archivo = await open(destino, 'wx');
		try { await archivo.writeFile(`${JSON.stringify(informe, null, 2)}\n`, 'utf8'); } finally { await archivo.close(); }
		console.log(`Informe externo: ${destino}`);
	} catch (error) { process.exitCode = 1; console.error('No se pudo escribir el informe externo (no se sobrescriben archivos):', error); }
	console.log(`Resultado: ${informe.casos.length}/${tamanos.length} tamaños, ${informe.fallos.length} fallos; ${(informe.totalMs / 1000).toFixed(2)} s.`);
}
