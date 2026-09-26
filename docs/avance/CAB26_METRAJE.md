# CAB-26: procedencia del metraje documental

Estado: incremento comprobado; CAB-26, M6 y la versión funcional 1.0 no están aceptados íntegramente.

## Regla aplicada

La referencia XYZ de un plan automático V4 se mide desde sus puntos persistentes, no desde la malla, el nivel de detalle ni la proyección frontal. La ruta manual M6 recibe la referencia XYZ del mismo constructor que utiliza la escena. La proyección documental distingue `PLAN_AUTOMATICO_V4`, `MANUAL_M6`, ruta ortogonal legacy y conexión pendiente. El orden de los conductores y la reapertura no cambian esta procedencia.

Un plan V4 puede coexistir temporalmente con una ruta 2D que el router legacy todavía genera para el mismo conductor. Esa ruta no es su recorrido aceptado: ni el CSV, ni el HTML, ni la lista PDF, ni el total 2D de la ficha deben convertirla en propuesta de corte del plan. Los cables con ruta XYZ permanecen en el recuento de conexiones y secciones. Una longitud eléctrica declarada sigue separada de la referencia geométrica.

Para rutas legacy sin ruta XYZ, el dossier sigue mostrando una **propuesta 2D estimada** con la reserva y las puntas configuradas. Para rutas XYZ, reserva, terminaciones y corte quedan sin valor material derivado: las opciones configuradas se identifican, pero no se aplican sobre un trayecto cuya fabricabilidad no se ha verificado. Tampoco se adopta automáticamente la referencia XYZ como longitud eléctrica. Esa política corresponde a CAB-27.

## Evidencia y límites

- Tests rápidos: caso XYZ V4 con router 2D concurrente; CSV/HTML/PDF de un mismo paquete; ficha totalizada; guardado/carga y orden invertido; V1 manual y conexión pendiente.
- Node completo: **1817/1817**, 0 fallos/omitidos, 21,9 s. TypeScript app/core verde; build QA de **444 módulos** en 6,64 s. QA navegador del paquete offline: **17/17** en 3,9 s, sin solicitudes externas ni errores JavaScript.
- El PDF de un ejemplo con plan V4 se renderizó e inspeccionó en páginas 8–9: la fila del plan indica que su corte no está verificado. Las filas extensas ya no se dividen dejando texto huérfano en la página siguiente; la continuación es legible, aunque la última página de esa tabla queda poco ocupada.
- La QA offline usa un ejemplo sin todos los recorridos XYZ del caso focal; el contenido específico del plan se comprueba en un test de paquete Node. No se ejecutó el gate M9 integral en este incremento.

## Pendiente para aceptar CAB-26

1. Política de reservas, terminaciones y redondeo sobre una ruta XYZ físicamente revisada; distinguir propuesta de corte de corte de taller verificado y registrar revisión/origen.
2. Comprobar radios fijos de borne, puerta/campo, ocupación y obstáculos antes de afirmar una longitud fabricable (CAB-19/20/25).
3. Resolver la ruta 2D concurrente en consumidores de ingeniería/DRC mediante la política visible de CAB-27, sin alterar la longitud eléctrica por defecto de proyectos V9.
4. Inspección densa y campaña integrada M9 del MASTER SPEC. No promover a `main` ni etiquetar 1.0 por este checkpoint.
