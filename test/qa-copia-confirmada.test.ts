import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const modulo = pathToFileURL(resolve(import.meta.dirname, '../../qa/lib/entorno.mjs')).href;

test('QA copiar ejemplo no permite continuar solo por ocultar el chip', async () => {
    const { trabajarSobreCopia } = await import(modulo);
    let confirmar!: () => void, finalizo = false;
    const pendiente = new Promise<boolean>(r => { confirmar = () => r(true); });
    const eventos: string[] = [];
    const page = {
        waitForFunction: async () => { eventos.push('chip'); },
        evaluate: async () => { eventos.push('clic'); },
        evaluateHandle: async (_fn: unknown, opciones: { texto: string }) => {
            assert.equal(opciones.texto, 'La copia es un tablero nuevo, independiente y guardado localmente.');
            eventos.push('observar');
            const o = { esperar: () => pendiente, cancelar: () => { eventos.push('cancelar'); } };
            return { evaluate: async (fn: (o: unknown) => unknown) => fn(o), dispose: async () => { eventos.push('liberar'); } };
        },
    };
    const operacion = trabajarSobreCopia(page).then((r: boolean) => { finalizo = true; return r; });
    await new Promise<void>(r => setImmediate(r));
    assert.deepEqual(eventos, ['chip', 'observar', 'clic', 'chip']);
    assert.equal(finalizo, false, 'montar la copia no equivale a confirmar el documento');
    confirmar();
    assert.equal(await operacion, true);
    assert.deepEqual(eventos.slice(-2), ['cancelar', 'liberar']);
});

test('QA copiar ejemplo no silencia una confirmación documental ausente', async () => {
    const { trabajarSobreCopia } = await import(modulo);
    const page = {
        waitForFunction: async () => {}, evaluate: async () => {},
        evaluateHandle: async () => ({
            evaluate: async (fn: (o: unknown) => unknown) => fn({ esperar: () => Promise.resolve(false), cancelar() {} }),
            dispose: async () => {},
        }),
    };
    await assert.rejects(trabajarSobreCopia(page), /No se publicó la confirmación/);
});

test('QA conserva una nueva confirmación aunque el toast expire y no acepta la anterior', async () => {
    const { observarNuevoMensaje } = await import(pathToFileURL(resolve(import.meta.dirname, '../../qa/lib/confirmacion-visible.mjs')).href);
    const anteriores = ['document', 'MutationObserver'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const);
    const toast = { textContent: 'confirmado', hidden: false };
    let emitir!: () => void, desconectado = 0;
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: () => toast } });
    Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class {
        constructor(cb: (registros: unknown[]) => void) { emitir = () => cb([]); } observe() {} disconnect() { desconectado++; }
    } });
    const o = observarNuevoMensaje({ texto: 'confirmado', timeout: 1000 });
    try {
        let resuelto = false; void o.resultado.then(() => { resuelto = true; });
        toast.hidden = true; emitir(); // Expira la notificación anterior, no es una copia nueva.
        await new Promise<void>(r => setImmediate(r)); assert.equal(resuelto, false);
        toast.hidden = false; toast.textContent = 'confirmado'; emitir();
        toast.hidden = true; emitir(); // Se oculta antes de que Node vuelva a consultar.
        assert.equal(await o.resultado, true);
        assert.equal(desconectado, 1);
    } finally {
        o.cancelar();
        for (const [k, descriptor] of anteriores) {
            if (descriptor) Object.defineProperty(globalThis, k, descriptor);
            else Reflect.deleteProperty(globalThis, k);
        }
    }
});
