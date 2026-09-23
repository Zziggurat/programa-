import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const modulo = pathToFileURL(resolve(import.meta.dirname, '../../qa/lib/ejemplo-documento.mjs')).href;
const componente = (id: string) => ({ id, tipo: 'contactor' });
const cable = (id: string) => ({ id, de: { dispositivoId: 'km', borneId: 'A1' },
	a: { dispositivoId: 'red', borneId: 'L1' } });
const ejemplo = () => ({ formato: 'tablero-studio', version: 1, nombre: 'Ejemplo', esEjemplo: true,
	hojas: [], dispositivos: [componente('km')], conductores: [cable('w1')] });

test('QA rechaza un ejemplo vacío o sin el aparato y conductor necesarios', async () => {
	const { verificarProyectoEjemplo } = await import(modulo);
	assert.throws(() => verificarProyectoEjemplo({ dispositivos: [], conductores: [] }), /al menos 1 aparatos/);
	assert.throws(() => verificarProyectoEjemplo(ejemplo(), { dispositivosMin: 0, conductoresMin: 0 }),
		/precondición positiva/);
	assert.throws(() => verificarProyectoEjemplo(ejemplo(), { dispositivoIds: ['km'], conductorIds: ['w2'] }),
		/falta el conductor w2/);
	assert.doesNotThrow(() => verificarProyectoEjemplo(ejemplo(), {
		dispositivoIds: ['km'], conductorIds: ['w1'],
	}));
});

test('QA no acepta un toast como prueba de identidad y contenido persistidos', async () => {
	const { verificarCopiaEjemplo } = await import(modulo);
	const origen = ejemplo();
	const copia = { ...origen, nombre: 'Copia de Ejemplo', esEjemplo: undefined };
	const persistido = { id: 'nuevo', nombre: copia.nombre, proyecto: copia };
	const datos = { anterior: { id: 'anterior' }, ejemplo: origen, copia, persistido,
		registrados: [{ id: 'nuevo', nombre: copia.nombre }], requisitos: { conductorIds: ['w1'] } };
	assert.doesNotThrow(() => verificarCopiaEjemplo(datos));
	assert.throws(() => verificarCopiaEjemplo({ ...datos, persistido: { ...persistido, id: 'anterior' } }),
		/identidad documental nueva/);
	assert.throws(() => verificarCopiaEjemplo({ ...datos, registrados: [] }), /no figura en el repositorio/);
	assert.throws(() => verificarCopiaEjemplo({ ...datos, persistido: {
		...persistido, proyecto: { ...copia, conductores: [] },
	} }), /documento persistido perdió contenido/);
});
