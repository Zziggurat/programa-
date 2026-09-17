# Diseño asistido V9 — recorrido de uso

V9 compara cambios acotados de sección y protección sobre un circuito que ya existe. Reutiliza los datos técnicos y el mismo motor de Ingeniería del proyecto; no redibuja el circuito, no cambia carga, longitudes, canaletas, criterios ni topología.

## Laboratorio reproducible

1. Abre **Aprender → Ejemplos**.
2. Elige **Diseño asistido V9 — conductor y protección**.
3. El ejemplo es de solo lectura. Puedes buscar y estudiar alternativas, pero para aplicarlas pulsa **Hacer una copia para trabajar**.
4. Abre **Ingeniería**, pulsa **Validar proyecto** y entra en la pestaña **Diseño**.

El laboratorio usa exclusivamente cifras `SINTETICO`. BASE incumple los criterios declarados; cambiar solo sección o solo protección no basta, mientras algunas combinaciones sí satisfacen el alcance. Otras combinaciones continúan inviables para demostrar que sumar dos cambios no garantiza una solución.

## Configurar una búsqueda

- **Circuito** fija la frontera reconocida por Ingeniería.
- **Conductores modificables** es el grupo que V9 puede redimensionar como una unidad. Los no marcados permanecen bloqueados.
- **Secciones permitidas** es una lista finita. Una sección sin fila de ampacidad aplicable se excluye y se explica.
- **Protección** identifica el único aparato cuya revisión puede cambiar.
- **Revisiones exactas permitidas** fija catálogo, producto, revisión y hash. No se mezclan campos de fichas distintas.
- **Máximo de candidatos** limita evaluaciones, no relaja criterios.

Pulsa **Buscar alternativas**. La vista informa generados, evaluados, pendientes, tiempo y permite **Cancelar**. Un resultado `LIMITADA` o `CANCELADA` solo describe las alternativas realmente evaluadas; no afirma que no exista otra solución ni anuncia un óptimo global.

## Interpretar resultados

- `FACTIBLE`: cumple los criterios evaluados del alcance.
- `INVIABLE`: al menos una obligación requerida falla.
- `INDETERMINADO`: falta información para decidir una obligación.
- `ERROR`: la evaluación no terminó válidamente; no equivale a inviabilidad eléctrica.
- `PARETO`: no dominada entre las alternativas evaluadas para métricas comparables.

`Ib` es corriente de diseño, `In` calibre de la protección, `Iz` ampacidad corregida e `Icc` corriente de cortocircuito prospectiva en el punto configurado. Abre **Explicación, deltas y evidencia** para ver diferencias frente a BASE, reglas, datos faltantes, procedencia y limitaciones. Las preferencias son lexicográficas y visibles; no existe una puntuación opaca.

Una BASE factible con preferencia de mínima intervención aparece como **Mantener diseño**. No se fabrican cambios para que siempre exista una recomendación.

## Aplicar, deshacer y compartir

Solo una alternativa `FACTIBLE` distinta de BASE ofrece **Previsualizar y aplicar**. El diálogo enumera exactamente las secciones y la revisión que cambiarán. Tras confirmar, V9 vuelve a comprobar BASE y candidato y publica una sola operación documental.

- `Ctrl+Z` deshace toda la aplicación.
- `Ctrl+Y` la rehace.
- El proyecto guarda la decisión y revisiones necesarias; no guarda el resultado dinámico del solver.
- **Archivo → Compartir proyecto portable** conserva la decisión y el subconjunto técnico exacto para abrirlo en un almacenamiento limpio.

Un proyecto de ejemplo exige copia. Si BASE cambió, el plan fue manipulado o una revisión ya no es exacta, la aplicación se rechaza y el trabajo actual se conserva.

## Informes

Después de buscar se puede descargar:

- JSON estructurado: intención, algoritmo/Build ID, hashes, referencias fijadas, cobertura y resultados acotados.
- CSV técnico UTF-8: resumen por alternativa con protección contra fórmulas de hoja de cálculo.
- HTML autocontenido e imprimible: contexto explícito, método, alternativas, límites y trazabilidad.

El informe es evidencia, no autorización para mutar otro proyecto. Si se importa mediante la API de V9, se valida como dato no confiable, se exigen las revisiones exactas y se reevalúa sobre una BASE nueva. Nunca se aplica el resultado antiguo.

## Límites honestos

V9 no certifica normativa, selectividad, fabricación ni compatibilidad mecánica. No calcula costos, no consulta Internet y no descarga CAD. Un cambio de protección queda acompañado por la limitación de montaje cuando el modelo carece de dimensiones/terminales compatibles demostrados. La procedencia sintética nunca se convierte en documental por aplicar o exportar.

Todo el recorrido funciona en `dist-final/TableroStudio.html` mediante `file://`, sin servidor ni API obligatoria.
