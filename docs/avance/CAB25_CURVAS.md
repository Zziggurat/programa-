# CAB-25: curvas de referencia M6

Estado: incremento funcional comprobado; CAB-25 y M6 todavía no aceptados íntegramente.

## Contrato implementado

- La ruta manual V1 conserva `POLILINEA` y sus puntos XYZ exactos. No se migra ni suaviza al abrir.
- La ruta manual V2 persiste `ARCO_CIRCULAR`, `radioMm` y los mismos IDs/nodos XYZ. El cambio de modo y radio se hace en el inspector, con Undo/Redo y guardado. Una importación con versión, radio o campos desconocidos falla explícitamente en vez de rehacer el cable automáticamente.
- Los arcos son empalmes circulares tridimensionales entre rectas. Para un giro `θ`, el recorte de cada recta es `R·tan(θ/2)` y el arco tiene largo `R·θ`. No se usa Catmull-Rom ni Bézier para este modo. No se reduce `R` si el recorte supera un tramo o se superpone con el de un codo vecino: queda el vértice literal y se informa `SIN_ESPACIO` o `RETORNO`.
- El radio declarado se aplica a los nodos manuales editables. Los tramos de salida/entrada fija del borne permanecen literales: su geometría y radio de fabricación no están verificados. No se interpreta la sección del cobre como diámetro exterior ni como radio mínimo certificado.
- Una referencia resuelta suministra los mismos XYZ a reparto, preview, picking y malla. El muestreo del círculo tiene error de cuerda objetivo de hasta 0,1 mm; el largo geométrico usa la expresión analítica, no esas muestras ni el LOD del tubo. No se adopta como longitud eléctrica ni como propuesta de corte: CAB-26/27 siguen pendientes.
- Al arrastrar un nodo circular, el diagnóstico local revisa su arco y los enlaces vecinos, incluidos los arcos de los nodos adyacentes. No reconstruye todo el cableado en cada `pointermove`. Las incidencias son avisos; la intención manual no se expulsa ni se corrige silenciosamente.

## Alcance y evidencia

La prueba rápida cubre tangencias, largo analítico, giro en profundidad, codos sin espacio, entradas hostiles, misma referencia en malla/picking y persistencia. La QA `node qa/curvas-m6.mjs` usa el inspector real para activar el modo, arrastrar, deshacer, cambiar radio, diagnosticar y reabrir. La suite M6 anterior debe seguir verde en V1.

La captura visual focal muestra un pequeño tablero de dos aparatos con el modo y el radio legibles en el inspector. No acredita capacidad de canaleta, ausencia de todo cruce, fatiga de puerta ni radio de un cable comercial concreto.

## Trabajo pendiente para aceptar CAB-25/M6

1. Unificar el suavizado de recorridos automáticos legacy y planes V4 con una intención versionada; hoy siguen usando su algoritmo anterior y no afirman radio verificable.
2. Declarar datos de cubierta/diámetro y radio mínimo del conductor desde una fuente técnica fiable, con revisión de interferencias y ocupación a partir de esa fuente (CAB-19/20).
3. Resolver o señalar todos los codos fijos de borne, puerta y campo bajo el marco físico correcto; el modo V2 actual solo admite `PLACA`.
4. Completar metraje, reservas, terminales y política de adopción eléctrica CAB-26/27 sin alterar proyectos V9 por defecto.
5. Ejecutar la aceptación densa/visual y campaña M9 del MASTER SPEC. No promover a `main` ni etiquetar 1.0 por este incremento.
