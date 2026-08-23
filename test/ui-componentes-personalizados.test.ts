import { test } from 'node:test';
import assert from 'node:assert/strict';

import { leerArchivoComponentePortatil } from '../app/ui-componentes-personalizados.js';

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
