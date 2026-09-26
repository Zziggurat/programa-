# CAB-27: política explícita de longitud eléctrica

Estado: incremento funcional validado focalmente; no significa que CAB-27, M6 o 1.0 estén aceptados íntegramente.

## Contrato persistente

Cada conductor puede declarar `fisica.politicaLongitudElectrica`:

| Valor | Longitud usada | Si falta la fuente |
| --- | --- | --- |
| ausente | Compatibilidad del proyecto V9; no cambia al migrar | Se conserva el comportamiento anterior. |
| `DECLARADA` | `fisica.longitudManualM` | Indeterminada; no se recurre a la ruta 2D. |
| `RUTA_XYZ` | Longitud espacial del plan V4 o de la ruta M6 manual resuelta en el mismo snapshot | Indeterminada; no se recurre a la longitud declarada ni a una proyección 2D. |

La ruta V4 se mide desde sus XYZ persistentes. M6 manual requiere la medición de escena que incluye bornes/salidas y arcos circulares, pasada a DRC, Ingeniería y Energizar desde el mismo documento. Una API pura llamada sin esta referencia no inventa el metraje: indica `NO_MODELADO`. El plan pendiente tampoco aporta longitud activa. Una política desconocida en un archivo se rechaza, porque degradarla a V9 cambiaría cálculos sin avisar.

El resultado de adoptar XYZ se clasifica `ESTIMADO` en PhysicsEngine: la geometría está medida, pero radios fijos, diámetro de cubierta, tolerancias, reserva y fabricación no están plenamente verificados. La longitud declarada se clasifica `CONFIGURADO`. Una inyección de ensayo en Energizar prevalece temporalmente como `INYECTADO` y no modifica el Proyecto. Ninguna de estas longitudes es un corte verificado.

## Interacción y documentación

El inspector de cable muestra la fuente seleccionada, la longitud declarada, la referencia XYZ y el valor que DRC usa ahora. Cambiar fuente o metros crea Undo y recalcula DRC, Ingeniería y simulación activa. Editar una ruta manual adoptada publica el nuevo cálculo al confirmar el nodo, tramo, radio o arrastre; el preview a medio gesto no se adopta. Guardar/reabrir conserva selección y valor. CSV y dossier HTML identifican política, longitud adoptada y procedencia; la fila PDF distingue adopción eléctrica de corte de taller.

## Límite de compatibilidad V9

En un proyecto **sin selector** hay una diferencia histórica: `revisarTablero` puede usar el router 2D para DRC aunque PhysicsEngine dé prioridad a `longitudManualM`. La regresión fija esa conducta en vez de alterar resultados antiguos silenciosamente. Quien necesite una fuente única debe elegir explícitamente `DECLARADA` o `RUTA_XYZ` por conductor. Esta diferencia requiere una migración consentida antes de retirar la compatibilidad; cero selección no equivale a certificación.

## Evidencia y pendientes

- Tests rápidos cubren plan V4 con ruta 2D concurrente, selección declarada/XYZ, PhysicsEngine, Energizar, DRC, lazo analógico, inyección runtime, ruta pendiente, archivo hostil, persistencia e inversión de arrays.
- La QA de navegador usa los controles reales para elegir fuente, editar Z, deshacer y reabrir: 15/15 en 28,7 s. El paquete offline pasó 17/17 y la QA industrial 123/123 sobre el mismo producto; resultados y límites en `EVIDENCIA_FUNCIONAL.md`.
- Pendientes: medir continuidad y longitud de salidas de borne/puerta/campo con criterios verificables; decidir una migración explícita de la discrepancia V9; revisión visual densa, datos de diámetro/radio y campaña M9 integral. CAB-27 no certifica corte, selectividad ni capacidad de canaleta.
