# Matriz de implementación y aceptación V9

Estado: implementación cerrada funcionalmente; la campaña final/CI/publicación se registra en `VALIDACION.md` y `ENTREGA.md`. «Cubierto» significa que existe contrato y evidencia automatizada, no certificación eléctrica.

| Caso obligatorio | Implementación | Evidencia | Estado |
|---|---|---|---|
| Proyecto V8 sin V9 | loader tolerante; bloque `ingenieria.disenoAsistido` opcional | campaña unitaria histórica y loader V2–V8 | Cubierto |
| BASE ya cumple | BASE es candidato real y mínima intervención ordena primero | `diseno-asistido-v9-adversarial` | Cubierto |
| Cambiar sección | override técnico efectivo + fila de instalación exacta | tests V9 A0/opciones y motor V8 | Cubierto |
| Cambiar protección | revisión completa exacta; no campos Frankenstein | tests V9 A0 y operaciones V8 | Cubierto |
| Cambio combinado necesario | enumerador sección×protección | laboratorio/adversarial y QA navegador | Cubierto |
| Combinación con regresión | cada combinado ejecuta motor completo | laboratorio conserva combinado inviable | Cubierto |
| Iz 30×0,94×0,80 = 22,56 A | ampacidad V8 común | `datos-tecnicos-calculos` / documentación V8 | Cubierto |
| Mayor sección aumenta Icc | prospectiva se recalcula por candidato/punto | test A0 prospectiva y escenarios V7 | Cubierto |
| In mayor no sacrifica Iz | reglas comunes de coordinación, sin atajo V9 | fixture combinado y validación V8 | Cubierto |
| Dato 230 V en red 400 V | filtro de condiciones + regla de contexto de red | adversarial V9 y `datos-tecnicos-contexto-red` | Cubierto |
| Icu sin Icc / Icc sin Icu | conserva `INDETERMINATE` y faltantes | `ingenieria-fixtures-v7`, protecciones V8 | Cubierto |
| Cargas compartidas 15+15 | motor completo evalúa protección común | circuitos/protecciones V7–V8 | Cubierto |
| Carga compartida desconocida | dato ausente no se convierte en cero | `datos-tecnicos-protecciones` | Cubierto |
| Motor/arranque requerido | usa reglas existentes; ausente queda indeterminado | `ingenieria-protecciones` | Cubierto |
| Retorno/topología ambiguos | prospectiva V8 no inventa retorno; estado visible | `datos-tecnicos-protecciones` y validación V7 | Cubierto |
| Familia/polos/condiciones incompatibles | allowlist de familia y filtro explícito de condiciones | adversarial V9 / schema V8 | Cubierto; compatibilidad mecánica queda limitada |
| Override protegido | opción excluida; decisión intacta | adversarial V9 | Cubierto |
| Opción ignorada por resolver | postcondición `CAMBIO_NO_EFECTIVO` | test A0 + core | Cubierto |
| Revisiones distintas no se mezclan | identidad exacta y adopción de ficha completa | test A0 / integridad V8 | Cubierto |
| Catálogo cambia durante búsqueda | snapshot clona revisiones y refs exactas | determinismo/roundtrip V9 y repositorio V8 | Cubierto |
| Datos sintéticos | procedencia viaja a resultado/informe/proyecto | fixture, HTML/JSON y portable | Cubierto |
| Universo vacío/sin factibles | BASE permanece; exclusiones y estado no recomiendan inviable | core + UI deshabilita apply | Cubierto |
| Presupuesto/cancelación | `LIMITADA`/`CANCELADA`, progreso y resultados completos | tests de sesión/presupuesto | Cubierto |
| Reordenación no semántica | identidad y ranking canónicos | adversarial V9 | Cubierto |
| Pareto/empates/ausencias | dominancia solo entre métricas presentes; desempate por hash | adversarial manual | Cubierto |
| BASE/proyecto cambia | hashes y revalidación antes de aplicar | stale test V9 | Cubierto |
| Plan/candidato manipulado | hash de plan/candidato + reevaluación de informe | tests V9 seguridad | Cubierto |
| Guardado/montaje fallan | persistencia antes de publicar; BASE inmutable en fallo | test transaccional V9 + repositorio V8 | Cubierto |
| Apply combinado + undo/redo | una mutación del gestor documental | QA V9 16/16 | Cubierto |
| Portable a perfil limpio | revisiones usadas congeladas con la decisión | adversarial V9 | Cubierto |
| Resultado antiguo/otro proyecto | UI invalida; informe crea snapshot nuevo | stale/import test | Cubierto |
| Seguridad import/HTML/CSV | límites, allowlist, prototype/hash, escape y CSV seguro | tests V9 | Cubierto |
| Sin red / `file://` | helper offline V9 sobre el HTML entregado | `qa:empaquetado` | Implementado; pendiente de campaña final |

## Fronteras deliberadas

- Topología, cargas, tensión/frecuencia, longitudes, rutas, instalación, criterios, PE y geometría no son variables de V9.
- La sustitución eléctrica no demuestra dimensiones, bornes ni representación 3D del producto: se informa como revisión humana pendiente.
- `EXHAUSTIVA` solo cubre el universo declarado; `LIMITADA` no permite afirmar ausencia de solución.
- Los hashes prueban integridad/reproducibilidad, no autenticidad de fabricante ni conformidad normativa.
