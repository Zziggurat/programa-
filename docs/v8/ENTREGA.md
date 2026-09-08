# Manifiesto de entrega V8

Estado: candidato V8 verificado localmente y por CI34193274343 (seis jobs verdes).
El cierre público se identifica mediante el tag anotado `tablerostudio-v8`, cuya creación
exige además CI del main integrado, Pages y artifact verificados. Sin ese tag no hay
aprobación final de publicación. No es una release comercial.

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
Se compararon también los blobs `git show HEAD:ruta` con los dos archivos locales:
3308535 bytes y SHA-256 idénticos. El atributo `-text` del repositorio conserva los
bytes del HTML; la descarga de Git no depende de una conversión local CRLF.

Primera generación rechazada por la ruta CSS `./assets/` de Vite; corregida con prueba
de equivalencia `assets/`, `/assets/`, `./assets/` y rechazo de rutas externas/traversal.
No se editó a mano el Build ID ni el contenido de los HTML.

El artifact remoto debe descargarse y comparar **el HTML extraído** con este SHA-256.
Una URL de artifact temporal no sustituye estas copias versionadas ni el tag final.

## Verificación por quien recibe la entrega

1. Resuelve el tag anotado `tablerostudio-v8` a su commit y comprueba el workflow
   **Pruebas** de ese SHA: unit/build, histórico, V6, V7, V8 y offline deben terminar bien.
2. Descarga `dist-final/TableroStudio.html` de ese commit/tag, no una versión elegida
   por una URL de artifact antigua. Compara el archivo HTML con el SHA-256 de esta tabla.
3. Abre el HTML localmente y comprueba el Build ID en Acerca de o en el informe.
4. Sigue [el recorrido de aceptación](USO.md). Exporta tus proyectos portables antes de
   borrar almacenamiento del navegador: el HTML no es una copia de tus proyectos.

La aprobación final se identifica mediante el tag y los checks del commit al que apunta;
un documento de candidato o un check de otro SHA no la sustituyen. No se genera una
release comercial ni se cambia la versión semántica heredada por cerrar esta campaña.
