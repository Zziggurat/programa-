import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

test('V8 offline: CSS modular conserva cascada, CSP, Build ID y bytes idénticos', async () => {
    const modulo = pathToFileURL(resolve(import.meta.dirname, '../../app/empaquetar.mjs')).href;
    const { empaquetar } = await import(modulo);
    const tmp = mkdtempSync(join(tmpdir(), 'ts-v8-package-'));
    try {
        const distApp = join(tmp, 'dist'); mkdirSync(join(distApp, 'assets'), { recursive: true });
        const html = '<html><head><link rel="stylesheet" href="/assets/a.css"><style>.x{color:blue}</style></head><body><p>V8</p></body></html>';
        writeFileSync(join(distApp, 'index.html'), html);
        writeFileSync(join(distApp, 'assets', 'a.js'), 'console.info("fixture");');
        writeFileSync(join(distApp, 'assets', 'a.css'), '.x{color:red}');
        const opciones = { distApp, destino: join(tmp, 'web.html'), desktop: join(tmp, 'desktop.html'), silencioso: true };
        const a = empaquetar(opciones), css = '.x{color:red}\n.x{color:blue}';
        assert.ok(a.salida.includes(`<style>${css}</style>`));
        assert.ok(a.salida.includes(`style-src 'sha256-${createHash('sha256').update(css).digest('base64')}'`));
        assert.ok(!a.salida.includes('href="/assets/'));
        assert.deepEqual(readFileSync(opciones.destino), readFileSync(opciones.desktop));
        // Vite con base './' emite este prefijo en producción; las tres formas son equivalentes.
        for (const ruta of ['./assets/a.css', 'assets/a.css']) {
            writeFileSync(join(distApp, 'index.html'), html.replace('/assets/a.css', ruta));
            const equivalente = empaquetar(opciones);
            assert.equal(equivalente.salida, a.salida);
            assert.equal(equivalente.buildId, a.buildId);
        }
        writeFileSync(join(distApp, 'assets', 'a.css'), '.x{color:green}');
        const b = empaquetar(opciones); assert.notEqual(b.buildId, a.buildId);
        for (const ruta of ['../secreto.css', './assets/../../secreto.css', '//assets/a.css',
            'https://example.com/a.css', 'assets/sub/a.css', './assets/a.css?externo']) {
            writeFileSync(join(distApp, 'index.html'), html.replace('/assets/a.css', ruta));
            assert.throws(() => empaquetar(opciones), /CSS no empaquetable/, ruta);
        }
    } finally { rmSync(tmp, { recursive: true, force: true }); }
});
