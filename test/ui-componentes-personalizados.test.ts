import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
	erroresLimitesTerminales, filtrarComponentesBiblioteca, mensajeErrorGuardado, prepararEditorVigente,
	terminalesDesdeEditor, terminalesParaEditor,
} from '../app/ui-componentes-personalizados.js';
import { leerComponentePortatil, leerComponentePortatilDesdeArchivo } from '../src/componentes/portatil.js';
import { instanciarComponentePersonalizado, validarSemanticaTerminales } from '../src/componentes/personalizados.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { verificarProyecto } from '../src/motores/drc.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';
import { tensionDeBorne } from '../src/motores/tensiones.js';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7xQAAAAASUVORK5CYII=';
const ASSET_ID = `sha256:${createHash('sha256').update(Buffer.from(PNG_BASE64, 'base64')).digest('hex')}`;
const leerArchivo = (bruto: unknown) => leerComponentePortatil(JSON.stringify(bruto));
const archivo = () => ({
	formato: 'tablero-studio-componente-portatil', version: 1,
	definicion: {
		formato: 'tablero-studio-componente', version: 1, id: 'cmp-1', revision: 3,
		nombre: 'Piloto importado', creadoEn: '2026-08-23T10:00:00.000Z', modificadoEn: '2026-08-23T11:00:00.000Z',
		tipoDispositivo: 'piloto', dimensiones: { anchoMm: 22, altoMm: 30, fondoMm: 40 },
		assetId: ASSET_ID,
		terminales: [
			{ id: 'alimentacion', tipo: 'L', u: 0.2, v: 0.8,
				maxConductores: 2, seccionMaxMm2: 2.5, campoDesconocido: 'no persistir' },
			{ id: 'retorno', tipo: 'N', u: 0.8, v: 0.8 },
		],
		comportamiento: {
			version: 1, clase: 'carga', alimentacion: { fases: ['alimentacion'], retornos: ['retorno'], fasesMinimas: 1 }, efecto: 'luz',
		},
		parametros: { tensionV: 24, potenciaW: 1, secreto: 'no persistir' },
		campoDesconocido: 'no persistir',
	},
	asset: { id: ASSET_ID, mime: 'image/png', base64: PNG_BASE64 },
});

test('el importador individual reconstruye por lista blanca antes de persistir', async () => {
	const leido = await leerArchivo(archivo());
	assert.equal(leido.definicion.comportamiento.clase, 'carga');
	assert.equal(leido.definicion.parametros?.tensionV, 24);
	assert.equal('campoDesconocido' in leido.definicion, false);
	assert.equal('campoDesconocido' in leido.definicion.terminales[0], false);
	assert.equal(leido.definicion.terminales[0].maxConductores, 2);
	assert.equal(leido.definicion.terminales[0].seccionMaxMm2, 2.5);
	assert.equal(leido.definicion.terminales[1].maxConductores, undefined,
		'ausencia del límite no debe transformarse en un valor inventado');
	assert.equal('secreto' in leido.definicion.parametros!, false);
});

test('importar → editar → guardar revisión → exportar conserva los límites por borne', async () => {
	const definicion = (await leerArchivo(archivo())).definicion;
	const editados = terminalesParaEditor(definicion);
	assert.equal(editados[0].rol, 'carga-fase');
	assert.equal(editados[0].maxConductores, 2);
	assert.equal(editados[0].seccionMaxMm2, 2.5);
	editados[0].maxConductores = 3;
	editados[0].seccionMaxMm2 = 4;
	assert.deepEqual(erroresLimitesTerminales(editados), []);
	const guardados = terminalesDesdeEditor(editados);
	assert.equal(guardados[0].maxConductores, 3);
	assert.equal(guardados[0].seccionMaxMm2, 4);
	assert.equal('maxConductores' in guardados[1], false);
	assert.equal('seccionMaxMm2' in guardados[1], false);
	const reexportado = archivo();
	reexportado.definicion.terminales = guardados as typeof reexportado.definicion.terminales;
	const vuelta = (await leerArchivo(reexportado)).definicion;
	assert.equal(vuelta.terminales[0].maxConductores, 3);
	assert.equal(vuelta.terminales[0].seccionMaxMm2, 4);
});

test('lado y conexión requerida sobreviven importación individual, edición, revisión y exportación', async () => {
	const paquete = archivo();
	Object.assign(paquete.definicion, {
		tipoDispositivo: 'fuente',
		terminales: [
			{ id: 'ENTRADA', rotulo: '1/L1', tipo: 'L', u: 0.2, v: 0.1, lado: 'primario', obligatorio: true },
			{ id: 'NEUTRO', tipo: 'N', u: 0.8, v: 0.1, lado: 'primario', obligatorio: true },
			{ id: 'SALIDA', tipo: 'control', u: 0.2, v: 0.9, lado: 'secundario+', obligatorio: true },
			{ id: 'COMUN', tipo: 'control', u: 0.8, v: 0.9, lado: 'secundario-', obligatorio: false },
		],
		comportamiento: {
			version: 1, clase: 'fuente', primario: { entradas: ['ENTRADA'], retornos: ['NEUTRO'] },
			salidas: [{ borne: 'SALIDA', papel: 'fase', tensionV: 24 },
				{ borne: 'COMUN', papel: 'retorno', tensionV: 24 }],
		},
		parametros: { tensionV: 220 },
	});
	const importado = await leerArchivo(paquete);
	const editados = terminalesParaEditor(importado.definicion);
	assert.equal(editados[2].lado, 'secundario+');
	assert.equal(editados[0].rotulo, '1/L1', 'la UI no debe confundir el ID eléctrico con la serigrafía');
	assert.equal(editados[2].obligatorio, true);
	assert.equal(editados[3].obligatorio, false, 'no declarado y no obligatorio deben distinguirse');
	const terminales = terminalesDesdeEditor(editados);
	const vuelta = (await leerArchivo({ ...importado,
		definicion: { ...importado.definicion, revision: 4, terminales } })).definicion;
	assert.deepEqual(vuelta.terminales.map(({ lado, obligatorio }) => [lado, obligatorio]), [
		['primario', true], ['primario', true], ['secundario+', true], ['secundario-', false],
	]);
	assert.equal(vuelta.terminales[0].rotulo, '1/L1');
	assert.equal(vuelta.terminales[0].id, 'ENTRADA');
	const dispositivo = instanciarComponentePersonalizado(vuelta, 'fuente-propia');
	assert.equal(tensionDeBorne(dispositivo, dispositivo.bornes[0]), 220);
	assert.equal(tensionDeBorne(dispositivo, dispositivo.bornes[2]), 24,
		'el ID SALIDA no permite inferir el secundario: debe mandar lado explícito');
	const proyecto = crearProyecto('Metadatos del borne');
	proyecto.dispositivos = [dispositivo];
	const drc = verificarProyecto(proyecto, calcularPotenciales(proyecto));
	const faltantes = drc.filter((h) => h.regla === 'R2-borne-sin-conectar');
	assert.equal(faltantes.length, 3);
	assert.ok(faltantes.some((h) => h.mensaje.includes('SALIDA')));
	assert.ok(faltantes.every((h) => !h.mensaje.includes('COMUN')));
});

test('lado/obligatorio hostiles se rechazan, no se descartan ni se reinterpretan', async () => {
	for (const valor of ['secundario', 'PE', '', null, 1, { lado: 'primario' }]) {
		const paquete = archivo();
		(paquete.definicion.terminales[0] as Record<string, unknown>).lado = valor;
		assert.match(validarSemanticaTerminales([{ id: 'alimentacion', lado: valor }]).join(' '), /lado de fuente/);
		await assert.rejects(leerArchivo(paquete), /lado de fuente/);
	}
	for (const valor of ['true', 1, null, { obligatorio: true }]) {
		const paquete = archivo();
		(paquete.definicion.terminales[0] as Record<string, unknown>).obligatorio = valor;
		assert.match(validarSemanticaTerminales([{ id: 'alimentacion', obligatorio: valor }]).join(' '), /obligatorio/);
		await assert.rejects(leerArchivo(paquete), /obligatorio/);
	}
});

test('límites inválidos dan error visible; el importador nunca los descarta silenciosamente', async () => {
	for (const valor of [0, 1.5, -1, Number.MAX_SAFE_INTEGER + 1, 'dos', null, Number.NaN, Infinity]) {
		const paquete = archivo();
		(paquete.definicion.terminales[0] as Record<string, unknown>).maxConductores = valor;
		assert.match(erroresLimitesTerminales([{ id: 'alimentacion', maxConductores: valor }]).join(' '), /máximo de conductores/);
		await assert.rejects(leerArchivo(paquete), /máximo de conductores/);
	}
	for (const valor of [0, -1, '2.5', null, Number.NaN, Infinity]) {
		const paquete = archivo();
		(paquete.definicion.terminales[0] as Record<string, unknown>).seccionMaxMm2 = valor;
		assert.match(erroresLimitesTerminales([{ id: 'alimentacion', seccionMaxMm2: valor }]).join(' '), /sección máxima/);
		await assert.rejects(leerArchivo(paquete), /sección máxima/);
	}
	assert.deepEqual(erroresLimitesTerminales([{ id: 'A1', maxConductores: 1, seccionMaxMm2: 0.5 },
		{ id: 'A2', maxConductores: 17, seccionMaxMm2: 1001 }]), []);
});

test('archivo individual mayor que 64 MiB se rechaza antes de leer JSON', async () => {
	let lecturas = 0;
	await assert.rejects(leerComponentePortatilDesdeArchivo({
		size: 64 * 1024 * 1024 + 1,
		text: async () => { lecturas++; return JSON.stringify(archivo()); },
	}), /64 MiB/);
	assert.equal(lecturas, 0);
	const valido = await leerComponentePortatilDesdeArchivo(new Blob([JSON.stringify(archivo())]));
	assert.equal(valido.definicion.terminales[0].seccionMaxMm2, 2.5);
});

test('el importador individual rechaza MIME y comportamiento no admitidos', async () => {
	const mime = archivo(); mime.asset.mime = 'image/svg+xml';
	await assert.rejects(leerArchivo(mime), /MIME|Asset portátil/);
	const perfil = archivo(); perfil.definicion.comportamiento = { version: 1, clase: 'inventado' } as never;
	await assert.rejects(leerArchivo(perfil), /comportamiento.*no es válido/i);
});

test('Mis Componentes busca sin alterar identidades y filtra por familia', async () => {
	const piloto = (await leerArchivo(archivo())).definicion;
	const contactor = { ...piloto, id: 'cmp-2', nombre: 'Contactor de línea', fabricante: 'Fábrica Ñ',
		referencia: 'KM-42', tipoDispositivo: 'contactor' as const };
	const componentes = [piloto, contactor];
	assert.deepEqual(filtrarComponentesBiblioteca(componentes, 'fabrica').map((d) => d.id), ['cmp-2']);
	assert.deepEqual(filtrarComponentesBiblioteca(componentes, 'KM-42').map((d) => d.id), ['cmp-2']);
	assert.deepEqual(filtrarComponentesBiblioteca(componentes, 'piloto').map((d) => d.id), ['cmp-1']);
	assert.deepEqual(filtrarComponentesBiblioteca(componentes, '', 'contactor').map((d) => d.id), ['cmp-2']);
	assert.equal(componentes[0].nombre, 'Piloto importado');
});

test('una imagen ausente no publica otra edición ni descarta el borrador actual', async () => {
	const borrador = { nombre: 'Trabajo sin guardar' };
	let editor = borrador;
	await assert.rejects(prepararEditorVigente(
		async () => { throw new Error('Asset ausente'); }, () => true,
		(valor) => { editor = valor; },
	), /Asset ausente/);
	assert.equal(editor, borrador);
});

test('la última solicitud de edición prevalece aunque las imágenes terminen fuera de orden', async () => {
	let completarPrimera!: (url: string) => void;
	let completarSegunda!: (url: string) => void;
	const primera = new Promise<string>((resolve) => { completarPrimera = resolve; });
	const segunda = new Promise<string>((resolve) => { completarSegunda = resolve; });
	let turno = 0;
	let editor = 'borrador';
	const turnoPrimera = ++turno;
	const abrirPrimera = prepararEditorVigente(() => primera, () => turnoPrimera === turno,
		(url) => { editor = url; });
	const turnoSegunda = ++turno;
	const abrirSegunda = prepararEditorVigente(() => segunda, () => turnoSegunda === turno,
		(url) => { editor = url; });
	completarSegunda('componente-b');
	assert.equal(await abrirSegunda, true);
	completarPrimera('componente-a');
	assert.equal(await abrirPrimera, false);
	assert.equal(editor, 'componente-b');
});

test('un fallo al refrescar tras persistir no se comunica como fallo de guardado', () => {
	const error = new Error('IndexedDB temporalmente inaccesible');
	assert.match(mensajeErrorGuardado(error, false), /^No se pudo guardar:/);
	assert.match(mensajeErrorGuardado(error, true), /^El componente se guardó, pero no se pudo actualizar/);
	assert.doesNotMatch(mensajeErrorGuardado(error, true), /^No se pudo guardar:/);
});
