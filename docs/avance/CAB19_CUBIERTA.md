# CAB-19/20: datos declarados de cubierta y límite del índice legacy

Estado: incremento parcial. No acepta CAB-19, CAB-20, M6 ni la versión funcional 1.0.

## Qué quedó operativo

- Un conductor puede guardar `fisica.diametroExteriorMm` y `fisica.radioMinimoCurvaturaMm`. Los dos son positivos, opcionales y explícitos; el lector rechaza valores hostiles en vez de sustituirlos por la sección del cobre. El inspector permite editarlos, deshacer y reabrir sin alterar la conexión ni la longitud eléctrica.
- El diámetro exterior, si existe, determina el radio del tubo y de la separación usada por el repartidor. Si falta, permanece la aproximación visual V9, pero no se presenta como diámetro declarado. Cambiarlo invalida la caché de rutas; un plan V4 del conductor queda pendiente para revisión, mientras la firma de planes antiguos sin diámetro permanece idéntica.
- El DRC avisa si el radio nominal de nodos circulares manuales V2 es menor que el mínimo declarado. Un radio mayor solo supera esa comparación puntual: no certifica codos que no cupieron, extremos de borne, puerta, campo ni fabricación.
- El índice 2D legacy de canaleta usa el área circular del diámetro declarado cuando existe y señala cuántos cables aún toman el supuesto de aislación. Se corrigieron el aviso DRC, el dossier HTML y la ficha PDF para rotularlo como **estimación**, nunca «capacidad admisible» ni estado `ok`. La sección nominal `ancho × alto` del ducto tampoco es una medición de su interior útil.

## Lo que sigue indeterminado

- La ocupación de una ruta M6/V4 no se puede certificar con la lista de canaletas del router 2D legacy. Faltan pertenencia espacial por tramo, dimensiones interiores declaradas, ranuras/acceso, criterio de proyecto explícito, empaque real y evaluación térmica de agrupación. Una suma de áreas circular no prueba que cierre la tapa.
- El radio exterior declarado no convierte el radio de cada codo automático en curvatura verificada. La política de radio de salidas de borne/puerta/campo sigue pendiente.
- Los datos introducidos son declaraciones del proyecto, no ficha de fabricante validada. No se deduce diámetro desde mm² de metal ni un radio certificado desde la imagen/render.

## Evidencia focal

`test/datos-cubierta-cab19.test.ts` cubre roundtrip, rechazo de datos hostiles, radio M6 insuficiente, cambio de tubo/área provisional, invalidez focal de plan y caché. `qa/curvas-m6.mjs` usa el inspector visible para declarar 6 mm exteriores y radio mínimo 10/6 mm, comprueba malla 3D, DRC, Undo y reapertura. Las cifras y la batería final se registran en `EVIDENCIA_FUNCIONAL.md`.
