import assert from 'node:assert/strict';
import test from 'node:test';
import { presentarEstadoDocumento, type EstadoDocumentoVisible } from '../app/estado-documento.js';

const base: EstadoDocumentoVisible = {
	nombre: 'Tablero A', id: 'proyecto-a', revision: 7,
	ejemplo: false, recuperacion: false, fase: 'guardado', puedeReintentar: true,
};

test('el estado guardado comunica identidad y última revisión durable', () => {
	const estado = presentarEstadoDocumento(base);
	assert.equal(estado.chip, 'r7 · Guardado local');
	assert.match(estado.detalle, /Tablero A · ID proyecto-a · revisión local r7/);
	assert.equal(estado.aviso, undefined);
	assert.equal(estado.accion, undefined);
});

test('un cambio pendiente conserva la revisión confirmada y nunca se rotula como guardado', () => {
	const estado = presentarEstadoDocumento({ ...base, fase: 'guardando' });
	assert.equal(estado.chip, 'r7 · Guardando…');
	assert.equal(estado.tono, 'pendiente');
	assert.match(estado.detalle, /pendientes de confirmación/);
});

test('la fase sucia no se presenta como una revisión confirmada', () => {
	const estado = presentarEstadoDocumento({ ...base, fase: 'sucio' });
	assert.equal(estado.chip, 'r7 · Cambios pendientes');
	assert.equal(estado.tono, 'pendiente');
	assert.match(estado.detalle, /aún no tienen una revisión local confirmada/);
});

test('el error de IndexedDB sigue visible y ofrece reintento sin prometer una exportación obsoleta', () => {
	const estado = presentarEstadoDocumento({ ...base, fase: 'fallo', motivo: 'Espacio agotado' });
	assert.equal(estado.accion, 'reintentar');
	assert.equal(estado.tono, 'error');
	assert.match(estado.aviso!, /No se guardaron los últimos cambios/);
	assert.match(estado.aviso!, /Espacio agotado/);
	assert.doesNotMatch(estado.aviso!, /Archivo → Guardar/);
});

test('el error legacy sin gestor da una salida de archivo y no ofrece reintento imposible', () => {
	const estado = presentarEstadoDocumento({ ...base, revision: undefined, fase: 'fallo', puedeReintentar: false });
	assert.equal(estado.accion, undefined);
	assert.match(estado.aviso!, /Archivo → Guardar/);
});

test('la recuperación bloqueante tiene prioridad sobre una señal previa de guardado', () => {
	const estado = presentarEstadoDocumento({ ...base, recuperacion: true });
	assert.equal(estado.chip, 'r7 · Recuperación');
	assert.equal(estado.accion, 'recuperar');
	assert.match(estado.aviso!, /restaura una versión válida/);
});

test('la recuperación legacy no promete abrir una biblioteca que no existe', () => {
	const estado = presentarEstadoDocumento({ ...base, recuperacion: true, puedeReintentar: false });
	assert.equal(estado.accion, undefined);
	assert.match(estado.aviso!, /diálogo de recuperación/);
	assert.doesNotMatch(estado.aviso!, /Mis tableros/);
});

test('un ejemplo es de solo lectura y no hereda el error ni la revisión del tablero anterior', () => {
	const estado = presentarEstadoDocumento({ ...base, nombre: 'Ejemplo', ejemplo: true, fase: 'fallo' });
	assert.equal(estado.chip, 'Ejemplo · solo lectura');
	assert.equal(estado.aviso, undefined);
	assert.doesNotMatch(estado.detalle, /proyecto-a|r7/);
});
