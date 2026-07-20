# TableroStudio

Programa propio para diseñar tableros eléctricos, nacido del análisis del código fuente de
[QElectroTech](https://qelectrotech.org) (ver [`docs/analisis-qelectrotech.md`](docs/analisis-qelectrotech.md)).
El objetivo es superar a herramientas como EduVolt Designer con un núcleo más potente y
totalmente personalizable.

## Qué hace ya (núcleo v0.1)

El núcleo es una librería TypeScript **sin interfaz gráfica**, con un modelo de datos JSON y
ocho motores independientes y testeados:

| Motor | Archivo | Qué resuelve |
|---|---|---|
| Potenciales | `src/motores/potenciales.ts` | Clases de equivalencia de bornes conectados (union-find): la base de todo lo demás |
| Numeración IEC | `src/motores/numeracion.ts` | Designaciones IEC 81346 (`=función+ubicación-K1`) con plantillas, secuencias y congelamiento; numeración de conductores por potencial |
| Referencias cruzadas | `src/motores/referencias.ts` | Bobina ↔ contactos con posición `hoja.FilaColumna`, índice de dispositivos |
| DRC | `src/motores/drc.ts` | 8 reglas de detección de errores eléctricos: cortocircuitos, bornes sin conectar, designaciones duplicadas, exceso de conductores por borne, conflictos de tensión, esclavos huérfanos… |
| Listas de bornes | `src/motores/bornes.ts` | Plan de bornero de taller: borna, lado interno/externo, puentes, número de conductor |
| Ruteo de cables | `src/motores/ruteo.ts` | Ruteo automático por canaletas (Dijkstra sobre el grafo de ductos), longitudes reales en mm con reserva, ocupación de canaletas |
| Sincronización | `src/motores/sincronizacion.ts` | Esquema ↔ placa de montaje: faltantes, sobrantes, solapes, fuera de placa |
| Documentación | `src/motores/documentacion.ts` | BOM, lista de conductores, planes de borneros, informe HTML completo, exportación CSV |

## Probarlo

```bash
npm install
npm test        # 22 tests de los motores
npm run ejemplo # genera la documentación de un tablero real en ejemplo/salida/
```

El proyecto de ejemplo (`ejemplo/tablero-ejemplo.ts`) modela un tablero de control típico:
acometida 220 V → interruptor automático → transformador 220/24 V → fusible → controlador,
relé comandado por el PLC, borneros de fuerza y control, sensor y electroválvula en campo,
y un gabinete de 400×600 mm con rieles DIN y canaletas.

## Diseño

- **Modelo puro** (`src/modelo/tipos.ts`): todo el proyecto es un objeto JSON serializable y
  versionable con git. Nada del núcleo depende de una librería gráfica (el error de QET que
  más nos costaría revertir después).
- **El potencial eléctrico es el concepto central**: numeración de conductores, detección de
  cortocircuitos y listas de cables se derivan de él.
- **Los documentos son consultas sobre el modelo** (idea tomada de la base SQLite de QET),
  nunca dibujos mantenidos a mano.
- **Esquema y gabinete comparten el mismo modelo**: la sincronización es una verificación,
  no una importación.

## Hoja de ruta

1. **v0.2 — Editor gráfico** (web, SVG + canvas): dibujar hojas, colocar símbolos, trazar
   conductores; vista del gabinete con arrastrar-y-soltar sobre rieles.
2. **v0.3 — Librería de símbolos**: conversor de los 7.279 símbolos `.elmt` de QElectroTech
   (XML, licencia libre) a SVG/JSON para no dibujar nada desde cero.
3. **v0.4 — Cables multiconductor y mangueras**: agrupar conductores de campo en cables
   `W`, calcular longitudes al campo con puntos de paso.
4. **v0.5 — Exportaciones**: PDF del dossier completo, DXF del gabinete
   (en `sources/createdxf.cpp` de QET hay una referencia de cómo escribir DXF a mano).
5. **v1.0 — Empaquetado** como aplicación de escritorio (Tauri/Electron).
