# Manifiesto de entrega V9

La aprobación pública se identifica por el tag anotado `tablerostudio-v9`. El tag solo se
crea después de que `main` y el candidato sean el mismo commit, los siete jobs de
**Pruebas** terminen verdes y se comprueben artifact, Pages y HTML. La anotación conserva
esa evidencia externa sin crear la autorreferencia imposible de escribir el SHA final en
un archivo incluido en ese mismo SHA.

| Propiedad | Valor |
|---|---|
| Build ID calculado | `CDCBF490B0` |
| HTML web | `dist-final/TableroStudio.html` |
| HTML desktop | `desktop/app.html` |
| Tamaño de cada copia | 3.347.021 bytes |
| SHA-256 de cada HTML, no del ZIP | `9ddf567eda0b6545b84f9f7f707e962d711fd47d0eaafc4f4ed6372cff1c6412` |
| Node / Playwright-core | 24.19.0 / 1.61.1 |
| Dependencias canónicas | npm + `package-lock.json` |

Generación: `npm run empaquetar`. La campaña local equivalente ejecutó Vite producción
(398 módulos, 8,20 s) y `node app/empaquetar.mjs`; el proceso completo tardó 10,09 s.
`node herramientas/verificar-entrega.mjs` reconstruyó de forma independiente, comprobó
frescura, igualdad entre ambas copias y estabilidad LF/CRLF. No se editó a mano el Build
ID ni el HTML.

`node qa/empaquetado.mjs` abrió el archivo entregado mediante `file://`, recorrió V2–V9,
ejecutó búsqueda/aplicación/guardado V9 y verificó 0 errores JavaScript y 0 solicitudes
HTTP externas. La CSP y `connect-src 'none'` siguen siendo parte del contrato offline.

## Verificación por quien recibe la entrega

1. Resuelve `tablerostudio-v9^{}` y comprueba que coincide con `main`.
2. Comprueba los siete jobs de **Pruebas** sobre ese SHA exacto.
3. Descarga el artifact `TableroStudio-<sha>` y compara el HTML extraído —no el ZIP— con
   tamaño y SHA-256 de esta tabla.
4. Descarga también `dist-final/TableroStudio.html` desde el tag y repite la comparación.
5. Abre el HTML localmente y comprueba Build ID `CDCBF490B0` en Acerca de.
6. Sigue `USO.md`. Un resultado factible sigue siendo una ayuda trazable, no certificación.

El artifact de Actions expira; el blob versionado y el tag son el respaldo durable. El
despliegue Pages documenta la entrega, pero no sustituye la comprobación del HTML offline.
