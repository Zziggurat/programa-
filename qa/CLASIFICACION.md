# Clasificación de las sondas `_*.mjs`

Los archivos con prefijo `_` no entran automáticamente en el gate. Esta clasificación cubre las
70 sondas versionadas y evita confundir una captura o un experimento con una regresión ejecutable.

Las regresiones especializadas sin prefijo también quedan fuera del gate histórico hasta acumular
estabilidad suficiente. `automatizacion-plc.mjs` es el vertical slice V4: opera START/STOP,
sensores, pausa, scan único, fuerzas, ACK/reset y PID mediante la UI real; se ejecuta expresamente
con `npm run qa:automatizacion`.

## Regresiones válidas

Acumulan aserciones objetivas, devuelven un exit code real y son candidatas a un gate explícito.
Ser una regresión válida no implica que deba ejecutarse en cada PR: coste y estabilidad se deciden
por separado.

- `_v-cables.mjs`
- `_v-camara2.mjs`
- `_v-integracion.mjs`
- `_v-perfil.mjs`
- `_v-picking.mjs`
- `_v-sesion.mjs`
- `_v-trenza.mjs`

## Experimentos

Reproducciones puntuales, sondas de una hipótesis o versiones reemplazadas por otra prueba. Pueden
servir para investigar, pero sus resultados no son un contrato del producto.

- `_aceptacion-editor.mjs`
- `_acierto-clic.mjs`
- `_agarre-casos.mjs`
- `_cable-en-canaleta.mjs`
- `_capacidad.mjs`
- `_cinco-tableros.mjs`
- `_estados.mjs`
- `_fidelidad-punto.mjs`
- `_perfil-arrastre.mjs`
- `_perfil-hover.mjs`
- `_tirador-pegado.mjs`
- `_v-alinear.mjs`
- `_v-camara.mjs` — reemplazada por `_v-camara2.mjs`
- `_v-editor.mjs`
- `_v-tiron.mjs`
- `_v-tiron2.mjs`

## Diagnósticos manuales o visuales

Generan láminas, capturas, métricas o información para inspección humana. No deben decidir por sí
solos el estado de CI. Cuando contienen comprobaciones numéricas, su exit code puede ser útil al
ejecutarlas manualmente, pero siguen fuera del gate estable.

- `_ab-dibujado.mjs`
- `_bisect-parpadeo.mjs`
- `_capturas-fase.mjs`
- `_color-cables.mjs`
- `_coplanares.mjs`
- `_culpable-parpadeo.mjs`
- `_fases.mjs`
- `_flicker-todos.mjs`
- `_fotos-canaletas.mjs`
- `_fotos-visual.mjs`
- `_frontal-detalle.mjs`
- `_frontal.mjs`
- `_gabinete.mjs`
- `_luz.mjs`
- `_marcas.mjs`
- `_matriz-estados.mjs`
- `_medir-aro.mjs`
- `_parpadeo.mjs`
- `_pilotos-puerta.mjs`
- `_puerta-barrido.mjs`
- `_qa-frontal-final.mjs`
- `_realce.mjs`
- `_repro-color.mjs`
- `_resto-parpadeo.mjs`
- `_ux-audit.mjs`
- `_v-armario.mjs`
- `_v-aro.mjs`
- `_v-bisagra.mjs`
- `_v-color.mjs`
- `_v-contrapicado.mjs`
- `_v-costado.mjs`
- `_v-detalle-armario.mjs`
- `_v-escaneo.mjs`
- `_v-halo.mjs`
- `_v-hoja.mjs`
- `_v-mazo-mirar.mjs`
- `_v-palabra-larga.mjs`
- `_v-parpadeo.mjs`
- `_v-persistencia.mjs` — mezcla round-trip con comparación de capturas
- `_v-piloto22.mjs` — medidas numéricas y láminas de inspección
- `_v-pilotos.mjs`
- `_v-puerta.mjs`
- `_v-quien-atraviesa.mjs`
- `_v-rendimiento.mjs`
- `_v-rotulos.mjs`
- `_v-w54.mjs`
- `_ver-malla.mjs`

La regresión oficial de persistencia es `se-guarda-solo.mjs`: modifica el proyecto mediante la UI,
recarga el navegador y comprueba el estado restaurado. Las comparaciones visuales de
`_v-persistencia.mjs` complementan esa prueba, pero no la sustituyen.
