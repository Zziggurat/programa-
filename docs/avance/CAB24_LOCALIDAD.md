# CAB-24: localidad durable del cableado

Estado: núcleo de planes V4 implementado; **contrato de interfaz todavía incumplido**. Este documento no acepta M6 ni la versión 1.0.

## Reproducción mínima

Después de `pnpm build`, ejecutar `node qa/diagnostico-localidad.mjs`. El ejemplo de arranque directo contiene 28 cables. Al pasar solamente `w4` a una ruta manual XYZ, **8 de los otros 27** cambian sus puntos, nodos o profundidad. Guardar y reabrir conserva el *nuevo reparto*, no las rutas ajenas originales. `node qa/diagnostico-localidad.mjs --assert-locality` termina deliberadamente con código 1 hasta que exista una solución. No pertenece al gate verde.

La prueba no demuestra que las ocho rutas queden mal físicamente. Demuestra un cambio no solicitado, contrario a la localidad requerida. Las pruebas existentes de determinismo frente al orden de arrays no cubren este contrato temporal: pueden devolver siempre el mismo reparto global y aun así mover rutas ajenas tras cada edición.

## Causa en el código actual

`rutasDeCables` firma el proyecto completo. Un cambio invalida `ultimoReparto` y `repartirCables` vuelve a colocar todos los automáticos en orden de sección e ID, con ocupación y rejilla reconstruidas desde cero. La segunda pasada puede recolocar más cables. El Worker de `programarReconstruccionDeCables` adopta ese resultado global. El proyecto persiste el trazado manual o el estado pendiente, pero no persiste el plan automático ya asignado; la caché de `escena3d.ts` solo vive en memoria. Por eso conservar una malla o una entrada de caché en la sesión no cierra CAB-24 tras la reapertura.

## Contrato para la implementación

1. Un plan automático aceptado debe tener identidad, versión, geometría XYZ reproducible y datos suficientes para reconstruir su reserva de canaleta/carril. No es una ruta manual del usuario ni una longitud eléctrica adoptada. Un archivo viejo sin plan conserva su lectura anterior; la creación de planes nuevos debe ser explícita y atómica con una edición/documento, no una mutación oculta del render.
2. Al editar un cable se inmovilizan los planes válidos de los demás y se calcula solo el cable cambiado contra esas reservas. Si el nuevo camino invade otro, se informa la interferencia o queda pendiente; no se desplaza en cascada al vecino. La posible excepción de operación de grupo debe estar identificada como tal en UI e historial.
3. Un aparato o ducto modificado invalida los planes cuyos anclajes, corredor o envolvente física dependen de él. Esos planes pasan a revisión pendiente con una causa visible; ni se dibujan como conectados a un anclaje viejo ni se reparan silenciosamente. Un cambio ajeno a su dominio no los invalida.
4. Guardar, reabrir, duplicar, exportar/importar, Undo/Redo y Worker deben conservar el mismo resultado. Una respuesta vieja del Worker no puede adoptar un plan para otra versión del documento. El render y el picking consumen la misma ruta efectiva.
5. La regresión focal debe pasar a verde sin permitir fusiones, pérdida de picking frontal o roturas de canaleta. Se necesita además prueba de cambio de aparato/ducto, conflicto informado, inversión de arrays, archivo legacy y manipulación de datos de plan inválidos.

Persistir objetos `{x,y,z}` para cada muestra repetiría miles de claves JSON en los ejemplos grandes. La V4 usa series numéricas planas sin cuantización para conservar XYZ exacto y reducir ese coste. Sigue pendiente medir el tamaño de snapshots y autosave multiproyecto sobre tableros densos antes de activar la asignación por defecto en la interfaz.

## Incremento de núcleo disponible

El formato V4 incorpora `planRutaAutomatica` en un conductor. Guarda los `Number` exactos de los puntos XYZ y nodos XY como series planas, radio, anclajes, identidad de fuente y firma del entorno local. El lector limita tamaño y coordenadas, rechaza dos escritores (plan y trazado manual), y rechaza un plan cuyo conductor o entorno ya cambió; no invoca el router para reparar una importación. La ruta persistida, cuando está vigente, se usa directamente en render/picking. `asignarPlanesAutomaticos` captura de manera explícita el reparto ya visible; no se llama al dibujar ni al abrir un proyecto antiguo. Los cinco ejemplos se capturaron y reabrieron sin variar su geometría; editar `w4` con los demás planes asignados deja sus rutas intactas incluso tras cargar e invertir arrays.

Esto es solo el núcleo. Falta la operación transaccional desde la UI, invalidar y marcar como pendientes las rutas afectadas tras mover aparato/canaleta, reservar carriles ya fijados para cables nuevos, presentar planes/alternativas y medir el coste de autosave. La sonda de usuario `qa/diagnostico-localidad.mjs --assert-locality` debe permanecer roja mientras el flujo normal no utilice los planes. No confundir la prueba del API con cierre de CAB-24.
