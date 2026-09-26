# CAB-23: propuestas de recorrido automático

Estado: incremento funcional comprobado; aceptación integral M6 y versión 1.0 pendientes. Una propuesta no certifica un tendido fabricable.

## Contrato actual

El alta prepara una copia del tablero. Primero fija en esa copia los recorridos legacy visibles que todavía no tenían plan; los planes ya aceptados no se redistribuyen. El mismo router ofrece hasta tres trayectorias para el cable nuevo. La primera conserva su decisión ordinaria; las siguientes excluyen las anteriores solo para ese cable y deben apartarse al menos `max(3 mm, dos radios)` en alguna de nueve muestras de longitud normalizada. No son offsets de render ni cambios de discretización de la misma línea. La selección no cambia un cable existente.

Cada opción tiene un plan V4 con origen y entorno firmados, longitud espacial derivada de sus propios puntos XYZ, rango Z, número de puntos y diagnósticos de contactos e invasiones. El diálogo identifica extremos e ID, permite elegir la opción, muestra el mismo plan como línea 3D temporal y en proyecciones frontal X/Y y lateral X/Z o Y/Z, y declara restricciones no comprobadas. La lista desplegable de cambios adicionales expone los IDs de planes legacy que se fijarían al aceptar. La vista no hace picking y libera su geometría y material al cambiar opción, cancelar o confirmar.

La foto exacta de BASE invalida una propuesta si el documento cambia durante la revisión; cambiar de sesión también la veta. Aplicar una opción produce una copia y la interfaz la incorpora en una única mutación deshacible. Cancelar deja BASE, planes previos e historial sin cambios. Guardar/cargar la opción 2 conserva sus XYZ exactos; invertir el array de conductores no cambia el orden de las alternativas en el fixture focal.

## Longitud y procedencia

Se detectó que `largoDibujadoMm` daba para un plan automático la aproximación legacy frontal (150 mm en el caso de prueba), mientras los XYZ del plan medían unos 263 mm. El preview ahora mide el plan XYZ mediante `longitudPlanRutaAutomaticaMm`. Sigue siendo **referencia espacial**, no longitud eléctrica adoptada ni corte con reservas. La política global de CAB-26/27, los informes existentes y la simulación no se cambiaron por esta corrección focal.

## Evidencia del incremento

- App/core TypeScript y **1807/1807** pruebas Node, 0 fallos/omitidos; build QA de **443 módulos**.
- `qa/localidad-planes-m6.mjs`: **28/28** en 155,5 s sobre el último cambio, 0 errores JS. Selecciona la opción 2 por UI, observa otro trazo, cancela, vuelve a aceptar, reabre y verifica que los otros 28 planes permanecen exactos. También revisa/cancela/acepta un plan pendiente con Undo/Redo y sin geometría provisional.
- `qa/prender-desde-cero.mjs`: 13 cables, lámpara y motor funcionales, 0 JS. `qa/simulacion-industrial.mjs`: **123/123** en 328,1 s, 14 cables VFD guardados, 0 JS. `qa/cables-fusion.mjs`: cero ejes coincidentes en los tres ejemplos, 59/59 frontal, 186/186 picking semántico, 61/61 sin fantasmas, 0 JS. Estas tres suites pasaron antes del último añadido solo informativo de IDs en el diálogo; no se atribuyen al SHA posterior.
- Una medición Node de cinco propuestas consecutivas en estrella-triángulo con 61 conexiones ya planificadas y tres opciones dio **144/105/103/105/112 ms**. No representa latencia de primera captura legacy, p95 de interfaz ni hardware de referencia adicional.
- La captura de la opción 2 mostró ambas proyecciones y el tablero simultáneamente. Es revisión visual técnica de una escena, no aceptación humana de canaleta densa o fabricación.

## Límites abiertos

Un candidato puede tener avisos; escogerlo no los resuelve. Radio mínimo, diámetro exterior real, ocupación permitida, capacidad del borne, entrada a canaleta y longitud de corte siguen sin validación completa. Si el motor actual solo produce una ruta, el diálogo no inventa otra. Una ruta alternativa no modifica una manual explícita. CAB-18/19/20, CAB-25/26/27, prueba visual densa y campaña M9 permanecen pendientes antes de aceptar M6 o declarar 1.0.
