import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	filtrarComponentesBiblioteca, leerArchivoComponentePortatil, mensajeErrorGuardado, prepararEditorVigente,
} from '../app/ui-componentes-personalizados.js';

const archivo = () => ({
	formato: 'tablero-studio-componente-portatil', version: 1,
	definicion: {
		formato: 'tablero-studio-componente', version: 1, id: 'cmp-1', revision: 3,
		nombre: 'Piloto importado', creadoEn: '2026-08-23T10:00:00.000Z', modificadoEn: '2026-08-23T11:00:00.000Z',
		tipoDispositivo: 'piloto', dimensiones: { anchoMm: 22, altoMm: 30, fondoMm: 40 },
		assetId: `sha256:${'d'.repeat(64)}`,
		terminales: [
			{ id: 'alimentacion', tipo: 'L', u: 0.2, v: 0.8, campoDesconocido: 'no persistir' },
			{ id: 'retorno', tipo: 'N', u: 0.8, v: 0.8 },
		],
		comportamiento: {
			version: 1, clase: 'carga', alimentacion: { fases: ['alimentacion'], retornos: ['retorno'], fasesMinimas: 1 }, efecto: 'luz',
		},
		parametros: { tensionV: 24, potenciaW: 1, secreto: 'no persistir' },
		campoDesconocido: 'no persistir',
	},
	asset: { id: `sha256:${'d'.repeat(64)}`, mime: 'image/png', base64: 'AQID' },
});

test('el importador individual reconstruye por lista blanca antes de persistir', () => {
	const leido = leerArchivoComponentePortatil(archivo());
	assert.equal(leido.definicion.comportamiento.clase, 'carga');
	assert.equal(leido.definicion.parametros?.tensionV, 24);
	assert.equal('campoDesconocido' in leido.definicion, false);
	assert.equal('campoDesconocido' in leido.definicion.terminales[0], false);
	assert.equal('secreto' in leido.definicion.parametros!, false);
});

test('el importador individual rechaza MIME y comportamiento no admitidos', () => {
	const mime = archivo(); mime.asset.mime = 'image/svg+xml';
	assert.throws(() => leerArchivoComponentePortatil(mime), /MIME no admitido/);
	const perfil = archivo(); perfil.definicion.comportamiento = { version: 1, clase: 'inventado' } as never;
	assert.throws(() => leerArchivoComponentePortatil(perfil), /comportamiento.*no es válido/i);
});

test('Mis Componentes busca sin alterar identidades y filtra por familia', () => {
	const piloto = leerArchivoComponentePortatil(archivo()).definicion;
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
