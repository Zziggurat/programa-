# Manifiesto de entrega V8

Estado: candidato local; la aprobación remota se registra en ESTADO/VALIDACION.
El tag anotado `tablerostudio-v8` identificará el cierre, no una release comercial.

| Propiedad | Valor |
|---|---|
| Build ID calculado | `C72A570F34` |
| HTML web | `dist-final/TableroStudio.html` |
| HTML desktop | `desktop/app.html` |
| Tamaño de cada copia | 3308535 bytes |
| SHA-256 de cada HTML, no del ZIP | `4b091b41761ab32e6758cf66342a74597e05f929cc8dbcd2e110cbe0d4f7822c` |
| Node / Playwright-core | 24.19.0 / 1.61.1 |
| Dependencias canónicas | npm + package-lock.json |

Generación: `npm run empaquetar`. Esta campaña usó su misma compilación Vite en un
outDir temporal y `node app/empaquetar.mjs --dist-app=...` para no sobrescribir la build
QA en uso. Producción: 394 módulos, bundle `index-CrQBSR8I.js`, CSS `index-CSsRLJuT.css`.
`node herramientas/verificar-entrega.mjs` recompiló de forma independiente y comprobó
ambos HTML actuales e igualdad LF/CRLF. CSP conserva hashes exactos y `connect-src 'none'`.

Primera generación rechazada por la ruta CSS `./assets/` de Vite; corregida con prueba
de equivalencia `assets/`, `/assets/`, `./assets/` y rechazo de rutas externas/traversal.
No se editó a mano el Build ID ni el contenido de los HTML.

El artifact remoto debe descargarse y comparar **el HTML extraído** con este SHA-256.
Una URL de artifact temporal no sustituye estas copias versionadas ni el tag final.
