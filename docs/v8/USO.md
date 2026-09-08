# Datos técnicos V8 — recorrido de uso

Los datos permiten explicar qué magnitud se utilizó, con qué unidad, bajo qué condiciones,
de qué fuente declarada y de qué revisión. No certifican un tablero ni sustituyen una ficha
verificada, un cálculo normativo o la revisión de un profesional habilitado.

## Primer recorrido

1. Abre **Datos técnicos** en la barra del editor.
2. Pulsa **Añadir catálogo sintético**. Es una biblioteca de ensayo, no de fabricante.
3. **Abrir laboratorio V8** abre un ejemplo de solo lectura. Cierra el panel y pulsa
   **Hacer una copia para trabajar** antes de adoptar cambios.
4. En **Instalación / ampacidad**, selecciona `w-fase-carga`. La tabla sintética declara
   30 A, ambiente ×0,94 y agrupamiento ×0,80: Iz = 22,56 A. No existe factor 1 por omisión.
5. En Ingeniería, valida: Ib = 10 A no supera Iz, pero In = 25 A sí lo supera. La
   coordinación Ib ≤ In ≤ Iz falla deliberadamente.
6. En **Catálogos y vínculos**, selecciona la protección r1 y abre
   **Vincular / resolver / comparar**. Elige `q1`; revisa condiciones AC, 230 V y decisiones.
7. Genera preview. BASE sigue intacta. Cancelar no guarda; aplicar exige confirmación y
   guarda un candidato transaccional. El editor permite deshacer el cambio aplicado.
8. Compara r2: su capacidad sintética Icu es 0,1 kA, menor que la Icc estimada del ejemplo.
   Adoptarla puede empeorar la validación. Un override previo se conserva hasta quitarlo
   explícitamente; actualizar una ficha no actualiza por sí solo los proyectos.

## Crear datos propios

**Nuevo producto** abre un borrador con catálogo, identidad, variante, familia y procedencia.
Introduce campos mediante **Añadir campo**: valor, unidad, naturaleza, condiciones y fuente
por campo. Los rangos se escriben `mínimo;máximo`. Vacío no significa cero.

**Guardar borrador** conserva trabajo sin publicarlo. **Mis borradores** lo recupera.
**Publicar revisión inmutable** valida el contenido y pide confirmación. **Crear nueva
revisión** copia una ficha con revisión incrementada; no sobrescribe la publicada.
Las revisiones publicadas mantienen identidad y hash: repetir exactamente una importación
es idempotente; otro contenido con la misma identidad/revisión se rechaza.

El nombre comercial, imagen o fabricante declarado nunca decide la función eléctrica.
El vínculo debe corresponder a la familia del perfil persistente y, para PLC, a bornes reales.
Los canales digitales se identifican por borne, no por posición en un array.
Si editas valores, decisiones o condiciones después de preparar un preview, la confirmación
anterior se retira. Debes previsualizar de nuevo: no se aplica una fotografía distinta de
lo que acabas de editar.

## Decisiones de un vínculo

- **Catálogo**: adopta el campo de la revisión exacta si sus condiciones son aplicables.
- **Conservar**: fija explícitamente el dato efectivo anterior y su fuente.
- **Override**: valor del usuario, con procedencia propia; no se presenta como fabricante.
- **Sin herencia**: supresión explícita con motivo; no recupera un valor legacy oculto.

Un desacuerdo sin decisión es conflicto, no permiso para escoger el mayor valor. Varias
entradas aplicables simultáneamente también son conflicto. Un campo eliminado de una
revisión sigue visible cuando tiene una decisión anterior; quitar su override puede dejar
el dato ausente. **Ver datos resueltos** muestra el estado persistente, no el preview.

## Instalación, criterios y faltantes

Una tabla requiere coincidencia de material, aislamiento, temperatura de aislamiento,
sección, método, temperatura base, conductores cargados y agrupamiento. Los factores solo
se combinan como autoriza la tabla. Fuera de dominio no se extrapola silenciosamente.

**Criterios** aplica una revisión fijada y overrides parciales por proyecto o circuito.
**Heredar** no crea un override; **Desactivado** y **No aplica** exigen motivo y no cuentan
como cumplimiento. Desactivar coordinación no rellena datos de instalación ausentes.

**Datos faltantes** usa el mismo centro de issues de Ingeniería. Desde una incidencia se
puede resolver su vínculo o instalación y volver a validar. Icn, Icu e Ics son magnitudes
distintas; el criterio especifica cuál comparar. Una Ics no utilizada no invalida una Icu
resuelta. La cobertura de cada regla depende de sus datos realmente necesarios.
Una condición escrita en el vínculo no acredita la tensión real del circuito: la capacidad
de corte se contrasta también con fuente y polos conectados. Si no puede demostrarse ese
contexto, se informa como indeterminado. La demanda de una protección común monofásica/DC
suma sus cargas únicas; no aprueba cada rama aislada ignorando las otras.

## Icc prospectiva y curvas

**Icc prospectiva** solicita protección, terminal de falla, retorno real y tipo soportado.
Es un ensayo de diseño aislado: no persiste ni inyecta una falla en la simulación operativa.
Se distingue red insuficiente, análisis pendiente, dato ausente y topología no soportada.
No se inventa impedancia ni se convierte una corriente nominal en Icc.

Las curvas versionadas declaran dominio, base A o múltiplos de In, intervalo temporal y
operación permitida EXACT_ONLY, LINEAR o LOG_LOG. No se extrapolan; una curva no aplicable
no activa por detrás la curva genérica. Tablas y curvas avanzadas se importan con el formato
tipado; no aceptan fórmulas ejecutables ni código del usuario.

## Portabilidad, revisión humana y seguridad

**Exportar subconjunto** comparte revisiones y dependencias mínimas, con manifiesto y hashes.
**Compartir proyecto portable** incluye las revisiones fijadas en el proyecto, además del
contenido y assets del sistema existente. Otro equipo no necesita instalar el catálogo
global. Borrarlo localmente no borra la copia congelada de proyectos ya vinculados.

**Importar JSON** valida límites, schema, unidades, condiciones, integridad y dependencias;
presenta preview antes de escribir. Elegir otro archivo o cancelar invalida el candidato
anterior. No se descargan fuentes documentales automáticamente. El límite es 32 MiB de
archivo técnico, con límites adicionales de profundidad, colecciones y revisión.

**Registrar revisión humana** conserva evidencia local para un hash exacto. Un import no
puede proclamarse revisado por el usuario receptor. Esta evidencia no viaja como firma ni
certificación en el paquete. Un hash demuestra integridad, no autenticidad de la fuente.

## Informe

En Ingeniería → Documentación, prepara el informe del snapshot actual. HTML, JSON y CSV
técnico comparten resoluciones, fuentes, revisiones, hashes, criterios, factores y faltantes.
El HTML es autónomo/imprimible; el CSV conserva BOM UTF-8, delimitador y protección de
fórmulas. Los datos sintéticos siguen identificados en la exportación y reimportación.

## Límites honestos

- No incluye catálogos comerciales certificados, tablas normativas copiadas ni selectividad
  garantizada. Las políticas y datasets de ejemplo son sintéticos.
- La Icc usa el modelo físico existente; escenarios trifásicos y transformadores acoplados
  no soportados se identifican, no se reemplazan por otro solver.
- Una fuente con salidas de distinta tensión no admite un único cambio nominal ambiguo.
- El modelo físico actual tiene una impedancia analógica común por dispositivo. Asignar
  burden a una AI de un PLC multicanal se rechaza explícitamente; no altera las otras AI.
- Un rango que el motor necesita como escalar queda pendiente de una decisión puntual;
  no se elige automáticamente media, máximo ni mínimo.
- Rango/modo/unidad analógicos ausentes retiran el transmisor o AI de la proyección efectiva,
  sin borrar el diseño ni rescatar una lectura legacy. Los canales vecinos siguen operando.
- La agregación compartida trifásica requiere reparto de demanda por fase demostrado. No se
  trata como suma monofásica ni se declara validada por comprobar cada ramal por separado.
- Las capacidades funcionales V2–V7 se conservan; V8 no añade SPICE, PWM, selectividad
  certificada, un router industrial ni dinámica de proceso nueva.
