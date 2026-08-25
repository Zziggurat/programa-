# Entrega reproducible y CI

La fuente de verdad de TableroStudio es `app/`, `src/`, `ejemplo/` y sus dependencias. Los archivos
`dist-final/TableroStudio.html` y `desktop/app.html` son dos copias derivadas, byte a byte idénticas;
no se editan manualmente.

## Camino único de desarrollo

```text
desarrollar
  → tests focales
  → pnpm test
  → pnpm run editor:build --mode qa
  → pnpm run qa:simulacion (cuando cambia simulación/UI)
  → npm run empaquetar
  → npm run entrega:check
  → npm run qa:empaquetado
  → campaña QA final
  → commit
  → push
  → esperar CI verde
  → probar el HTML de ese commit
```

`npm run empaquetar` hace un build de entrega y usa `app/empaquetar.mjs`, la única implementación
del formato autocontenido. `npm run entrega:check` compila en una carpeta temporal, llama al mismo
empaquetador y compara ambos destinos sin tocar el worktree. Un byte distinto o un archivo ausente
termina con exit code distinto de cero y pide regenerarlo.

La comparación byte a byte del entregable se ejecuta en `windows-latest`, plataforma canónica del
artefacto offline/desktop. Vite/Rollup usa binarios nativos cuyo bundle minificado no resulta
idéntico entre Windows y Linux aun con la misma fuente; cambiar de plataforma sin fijarla producía
un falso `stale`. El empaquetador además normaliza LF/CRLF y `entrega:check` contiene una regresión
explícita que exige el mismo resultado con ambos estilos de salto. Unit/Build y el gate de navegador
siguen corriendo en Ubuntu, de forma independiente.

El empaquetador calcula un Build ID SHA-256 corto sobre bundle, CSS y marcado canónicos. Aparece en
Ayuda/Acerca de, en la meta `tablerostudio-build`, en `window.__TABLEROSTUDIO_BUILD_ID__` y en la
consola. No depende del reloj ni del SHA de Git: incluir el commit dentro de un artefacto que se
versiona crearía una dependencia circular. El mismo contenido produce el mismo ID; un cambio del
bundle lo modifica.

## Checks de GitHub Actions

El workflow obligatorio `Pruebas` separa tres señales:

- **Unit / TypeScript / Build** (20 min): typecheck, tests rápidos y build QA.
- **QA Gate navegador** (60 min): Chromium fijado por lockfile y gate histórico estable. El límite
  deja margen sobre los tiempos locales medidos, pero sigue detectando un proceso bloqueado.
- **Entregable offline** (30 min, Windows canónico): frescura de ambos HTML, apertura real con `file://`, IndexedDB,
  Mis Tableros, Energizar, V2/V3 y ausencia de dependencias HTTP. Publica el HTML de ese commit
  como artifact durante 14 días.

La concurrencia cancela un workflow viejo cuando llega otro commit a la misma rama; un timeout
sigue apareciendo en el job concreto y no se confunde con esa sustitución. Los QA especializados
de simulación, fusión, componentes, multiproyecto y puerta se conservan en `QA especializado`,
ejecutable manualmente mediante `workflow_dispatch`; no alargan cada push.

GitHub Pages y el HTML offline son entregas distintas. Un despliegue Pages verde no demuestra que
`dist-final/TableroStudio.html` esté fresco; esa garantía pertenece exclusivamente al job
**Entregable offline**. El workflow no hace auto-commits ni genera bucles.
