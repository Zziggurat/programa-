import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const modulo = pathToFileURL(resolve(import.meta.dirname, '../../qa/lib/entorno.mjs')).href;

test('QA copiar ejemplo no permite continuar solo por ocultar el chip', async () => {
    const { trabajarSobreCopia } = await import(modulo);
    let confirmar!: () => void, finalizo = false;
    const pendiente = new Promise<void>(r => { confirmar = r; });
    const eventos: string[] = [];
    const page = {
        waitForFunction: async () => { eventos.push('chip'); },
        evaluate: async () => { eventos.push('clic'); },
        getByText: (texto: string, opciones: { exact: boolean }) => {
            assert.equal(texto, 'La copia es un tablero nuevo, independiente y guardado localmente.');
            assert.equal(opciones.exact, true);
            return { waitFor: async () => { eventos.push('confirmacion'); await pendiente; } };
        },
    };
    const operacion = trabajarSobreCopia(page).then((r: boolean) => { finalizo = true; return r; });
    await new Promise<void>(r => setImmediate(r));
    assert.deepEqual(eventos, ['chip', 'clic', 'chip', 'confirmacion']);
    assert.equal(finalizo, false, 'montar la copia no equivale a confirmar el documento');
    confirmar();
    assert.equal(await operacion, true);
});

test('QA copiar ejemplo no silencia una confirmación documental ausente', async () => {
    const { trabajarSobreCopia } = await import(modulo);
    const page = {
        waitForFunction: async () => {}, evaluate: async () => {},
        getByText: () => ({ waitFor: async () => { throw new Error('confirmación no visible'); } }),
    };
    await assert.rejects(trabajarSobreCopia(page), /confirmación no visible/);
});
