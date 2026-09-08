import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const modulo = pathToFileURL(resolve(import.meta.dirname, '../../qa/lib/presupuestos-v8.mjs')).href;

test('QA V8 separa presupuesto total y supervisor, conservando histórico', async () => {
    const { presupuestoV8, presupuestoSupervisor } = await import(modulo);
    for (const [suite, minutos] of [['catalogo', 12], ['importacion', 12], ['ingenieria', 18]] as const) {
        const nombre = `datos-tecnicos-${suite}`;
        assert.equal(presupuestoV8(nombre), minutos * 60_000);
        assert.equal(presupuestoSupervisor(nombre), (minutos + 2) * 60_000);
    }
    for (const nombre of ['correcciones', 'cables-fusion', 'constructor']) {
        assert.equal(presupuestoV8(nombre), undefined);
        assert.equal(presupuestoSupervisor(nombre), 720_000);
    }
});
test('QA supervisor respeta override explícito y rechaza límites inválidos', async () => {
    const { presupuestoSupervisor } = await import(modulo);
    assert.equal(presupuestoSupervisor('datos-tecnicos-ingenieria', '1000'), 1000);
    for (const valor of ['NaN', 'Infinity', '0', '-1', '999', '']) {
        assert.throws(() => presupuestoSupervisor('datos-tecnicos-ingenieria', valor));
    }
});
test('QA progreso registra número, duración acumulada e intervalo sin cambiar checks', async () => {
    const { crearRelojProgreso } = await import(modulo);
    let tiempo = 100;
    const registrar = crearRelojProgreso(() => tiempo);
    tiempo = 2100;
    assert.equal(registrar(1), '[#1; +2.0s; tramo 2.0s]');
    tiempo = 7600;
    assert.equal(registrar(2), '[#2; +7.5s; tramo 5.5s]');
});
