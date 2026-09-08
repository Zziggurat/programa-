# TABLEROSTUDIO V8 — ENCARGO MAESTRO PARA ASTRA
## Datos técnicos, catálogos versionados y criterios de ingeniería
### Campaña integral: revisión dirigida, implementación, experiencia de uso, pruebas y entrega

## 0. Encargo, autonomía y límites

Continúa el proyecto real `Zziggurat/programa-`. Implementa V8 completa conforme a este documento; no te limites a proponer un plan. Haz primero una revisión crítica dirigida del código y después ejecuta los bloques autorizados hasta completar la entrega o alcanzar un bloqueo real del entorno.

El usuario es Diego. Quiere una herramienta profesional de diseño, simulación, análisis, diagnóstico, validación y documentación de tableros industriales. Prioriza corrección, trazabilidad, conservación del trabajo y herramientas utilizables. El mundo 3D, CAD, routing avanzado y render quedan para más adelante. No quiere gamificación, puntuaciones, misiones ni niveles. Los ejemplos técnicos sí son apropiados.

Esta ejecución se inicia con Astra y el nivel ULTRACODE seleccionado por el usuario. El usuario informó 71 % de uso restante y un reset aproximadamente 48 minutos después de su mensaje. Esa información no es telemetría permanente: no presupongas que sigue vigente, que identifica todas las cuotas, que el reset es automático ni que conoces el saldo restante.

No trabajes contra un cronómetro de 48 minutos. No consumas recursos deliberadamente para agotar una ventana. Avanza por entregas comprobables y deja estado recuperable continuamente. Si llega un reset y puedes continuar, sigue desde el mismo checkpoint; si el entorno interrumpe la sesión, la siguiente ejecución debe poder reconstruir el trabajo desde el repositorio.

Tienes autorización para lectura, implementación V8, pruebas, documentación, commits y el flujo Git de la sección siguiente. Toma decisiones técnicas reversibles sin pedir aprobación en cada gate. Pregunta solo ante datos externos imprescindibles no disponibles, riesgo real de pérdida de trabajo, divergencia ajena, permisos insuficientes o cambio sustancial del alcance. No compres servicios, uses créditos adicionales deliberadamente, configures APIs pagadas ni modifiques la suscripción.

No empieces V9, optimización industrial automática, IEC 61131-3/Ladder/ST, nuevas físicas profundas, nube, marketplace, precios, scraping masivo ni refactor global.

## 1. Baseline y preflight real

Baseline final pre-Astra conocido:

- Repositorio: `Zziggurat/programa-`.
- Rama estable: `main`.
- Commit: `a65cc0cbb304cb153d5aaa030a39ad7400438a03`.
- Tag anotado: `tablerostudio-v7`, que debe resolver a ese commit.
- Build ID de producto: `4FE91DB16B`.
- Documento de traspaso: `docs/HANDOFF_ASTRA.md`.
- Informe previo: 1182 tests verdes; verificar evidencia real, no tratar un contador como certificado de corrección.

Antes de editar, lee los `AGENTS.md` aplicables y el handoff. Verifica ubicación y repositorio:

```bash
git rev-parse --show-toplevel
git remote -v
git status --short --branch
git branch --show-current
git worktree list
git rev-parse HEAD
git log --oneline --decorate -15
git diff --stat
git diff --cached --stat
git diff --check
git fetch origin
git rev-parse origin/main
git rev-parse 'tablerostudio-v7^{}'
```

Lee diffs completos solo de archivos relevantes, no descargues todo el repositorio al contexto. Un tag anotado tiene un SHA de objeto distinto del commit; verifica el commit desreferenciado. No recrees ni muevas el tag V7.

En el primer arranque se espera el baseline limpio. Si `main` avanzó, identifica los cambios antes de continuar. Si aparece trabajo previo V8 reconocible, entra en modo reanudación; no lo descartes por no coincidir con V7. Preserva cambios ajenos y detente antes de mezclarlos.

No uses `reset --hard`, `clean`, checkout destructivo, rebase automático, force-push ni borrado de tags. No restaures V7 sobre trabajo V8 ya existente.

## 2. Rama de trabajo y publicación

Para esta campaña crea, si no existe, `v8/astra-datos-tecnicos` desde el baseline verificado. Mantén `main` y el tag V7 como referencia estable mientras desarrollas. Si esa rama ya existe, inspecciona su estado local/remoto y continúa; no crees copias divergentes por cada interrupción.

Haz commits semánticos por incrementos coherentes. Puedes subir normalmente la rama V8 para respaldar checkpoints verdes, sin publicar avances incompletos en `main`. No incluyas secretos, documentos privados, paquetes temporales ni datos de terceros sin autorización.

Cuando V8 esté terminada y validada, integra convencionalmente a `main`: preferentemente PR revisable con los checks requeridos; si el flujo disponible es local, fast-forward verificado cuando no haya divergencia. No resuelvas cambios ajenos mediante un merge improvisado. Vuelve a verificar el commit final y sus checks después de integrar.

Distingue claramente «checkpoint de desarrollo», «candidato a entrega» y «V8 terminada». Un push de respaldo no es una release.

## 3. Estado durable y protocolo de interrupción

Crea o reutiliza, sin duplicaciones innecesarias:

- `docs/v8/PLAN.md`: alcance, gates, dependencias, criterios de aceptación y decisiones.
- `docs/v8/ESTADO.md`: checkpoint actual, pendientes, comandos y siguiente acción exacta.
- `docs/v8/DECISIONES.md`: decisiones importantes, alternativas rechazadas y razones verificables.
- `docs/v8/VALIDACION.md`: evidencia de tests, hashes, entorno, limitaciones y aceptación.

Si este encargo llega como archivo, consérvalo en `docs/v8/ENCARGO.md`; no copies íntegramente conversaciones históricas. `AGENTS.md`, si existe, puede enlazar el estado durable, pero no debe convertirse en una transcripción ni reemplazarse sin necesidad.

Actualiza ESTADO antes de una operación larga y al cerrar cada incremento. Incluye:

```text
Rama / baseline:
Último commit de implementación verificado:
Gate e incremento actual:
Trabajo sin commit, si existe:
Decisiones vigentes:
Pruebas realmente ejecutadas y resultado terminal:
Pruebas pendientes o invalidadas por cambios posteriores:
Proceso activo: comando, directorio, PID/identificador y log, si aplica:
Build de producto verificado:
Run/attempt/job de CI, si aplica:
Bloqueos:
Siguiente acción exacta:
```

No intentes escribir dentro de un commit su propio SHA final. Usa el checkpoint anterior o un manifiesto externo a la autorreferencia. No pongas «todo verde» en documentos que luego sigues modificando sin revalidar.

En una reanudación: lee ESTADO, consulta Git, revisa el diff pendiente y comprueba si un proceso o CI terminó. No relances trabajos aún activos ni reconstruyas gates ya demostrados. Una salida parcial sin exit code no acredita éxito.

No puedes garantizar un último commit antes de un corte abrupto. Por eso los checkpoints deben ser frecuentes, no depender de adivinar el porcentaje restante. Conserva trabajo parcial reconocible; no hagas un commit ficticiamente «verde» para dejar limpio el árbol.

## 4. Organización del razonamiento y herramientas

Un agente principal conserva responsabilidad de arquitectura e integración. Si existen herramientas de subagentes, usa como máximo dos colaboradores adicionales para tareas realmente independientes, con alcance y archivos asignados. Es útil una revisión independiente de contratos de datos y otra de tests/seguridad. No presupongas que tienen el mismo contexto ni que su trabajo es gratuito.

No permitas ediciones concurrentes sobre persistencia, lockfile, schemas, UI central o workflows. Cada colaborador entrega hallazgos verificables, diff y tests; el integrador revisa. Sin subagentes, ejecuta secuencialmente las mismas revisiones.

No delegues toda la arquitectura a múltiples agentes con diseños incompatibles. No ejecutes varios Chromium pesados en la misma máquina sin necesidad. Paraleleliza análisis de lectura o tests pequeños solo cuando aporte.

Durante desarrollo ejecuta pruebas focales. Amplía al cambiar una frontera compartida. Evita repetir gates verdes sin cambios relevantes, imprimir miles de líneas o sondear CI cada pocos segundos. Usa logs durables y espera del proceso/run cuando la herramienta lo permita; comunica cambios de estado, no mensajes repetitivos de «sigue activo».

## 5. Revisión crítica pre-V8: mapa y riesgos, no reescritura

Contrasta el handoff contra estas rutas reales del baseline:

- `src/modelo/tipos.ts`, `src/modelo/ingenieria.ts`, `src/modelo/comportamiento.ts`.
- `src/componentes/personalizados.ts`.
- `src/persistencia/tipos.ts`, `src/persistencia/repositorio.ts`.
- `src/ingenieria/circuitos.ts`, `engine.ts`, `validacion.ts`.
- `src/ingenieria/conductores.ts`, `protecciones.ts`, `potencia.ts`, `compatibilidad.ts`.
- `src/ingenieria/escenarios.ts`, `documentacion.ts`.
- `src/fisica/topologia-proyecto.ts`, `protecciones.ts` y adaptadores necesarios.
- `app/ui-ingenieria.ts`, exportaciones y almacenamiento de componentes.
- `package.json`, `package-lock.json`, workflows y herramientas de entrega.

Localiza símbolos, entradas, salidas y dependencias; evita volver a auditar todo Three.js. Revisa source of truth, persistencia, fallbacks, unidades, condiciones de cálculo, datos opcionales y compatibilidad con componentes personalizados.

No aceptes «COMPLETA V7» ni tests verdes como demostración universal. Identifica: bloqueantes para V8, riesgos controlables y backlog externo. Reproduce los bloqueantes con un caso mínimo; corrige solo lo necesario y conserva una regresión. No limpies miles de líneas por estética ni fuerces estructuras de datos sin medición.

Entrega una matriz requisito → módulo existente → cambio V8 → prueba antes de extender schemas. Una revisión dirigida bien delimitada debe desembocar en implementación, no consumir toda la campaña en informes.

## 6. Invariantes heredados obligatorios

Preserva:

1. La imagen, marca, nombre o referencia no decide el comportamiento eléctrico. Los IDs enlazan entidades, no implican física por su texto.
2. La configuración persistida se distingue del resultado derivado y del estado runtime.
3. Las iteraciones del solver no ejecutan scans PLC ni acumulan tiempo térmico adicional.
4. El análisis estático declara sus supuestos; no debe confundirse con medición del tablero energizado.
5. VFD/motor y transformador primario/secundario no se cuentan dos veces en potencia.
6. Comparar escenarios no modifica BASE; aplicar es una acción explícita y transaccional.
7. Ausencia de datos, no aplicabilidad y conflicto no se convierten en PASS.
8. Curvas genéricas y datasets de prueba no equivalen a datos certificados.
9. Proyectos V7 sin bindings V8 conservan comportamiento y apertura salvo corrección de un defecto demostrado.
10. Componentes nativos y personalizados usan los mismos motores para perfiles equivalentes.

Regresiones históricas: no materializar `electrica: undefined`; conservar UTF-8 BOM y protección contra fórmulas en CSV; mantener HTML autocontenido/imprimible; no reintroducir espera de navegación inexistente del PDF; no volver a comparar 30 s de pared con 30,5 s simulados para el rotor bloqueado. El acelerador visible y la observación del tiempo simulado deben seguir usando el runtime real.

## 7. Misión funcional V8 y definición de terminado

Implementa una plataforma local/offline de datos técnicos que permita:

- Crear/importar catálogos y productos con revisiones inmutables.
- Registrar valor, unidades, condiciones y procedencia por campo.
- Vincular explícitamente un equipo o conductor a una revisión exacta.
- Resolver datos sin sobreescrituras silenciosas ni discrepancias entre física y validación.
- Evaluar ampacidad mediante tablas y factores explícitos.
- Versionar criterios de proyecto/circuito.
- Encontrar datos faltantes y explicar qué validaciones bloquean.
- Comparar revisiones antes de aplicarlas.
- Compartir un proyecto con su subconjunto técnico necesario, sin catálogo remoto obligatorio.
- Exportar documentación trazable y ejecutar casos de referencia y pruebas adversariales.

No basta con schemas y tests: las funciones principales deben poder operarse desde la interfaz y desde el HTML distribuido. No declares terminada una capacidad que solo funciona mediante hooks privados o fixtures internos.

## 8. Datos técnicos: modelo mínimo sólido

Diseña contratos tipados coherentes con el repositorio. Nombres orientativos:

`CatalogoTecnico`, `RevisionCatalogo`, `ProductoTecnico`, `DatoTecnico<T>`, `CondicionAplicabilidad`, `VinculoTecnico`, `ResultadoResolucionTecnica`, `PerfilCriterios`, `TablaAmpacidad`.

Separa identidad del catálogo, identidad del producto, variante comercial, revisión, valores y assets documentales. Una revisión publicada no se edita in-place; un borrador puede editarse sin modificar una revisión consumida por proyectos.

Prioriza profundidad funcional en protección, contactor/bobina/relé, canal PLC, dispositivo analógico y conductor. Soporta mediante adaptadores los datos que V6/V7 ya consumen de motor, VFD, transformador y fuente. No fabriques un catálogo comercial completo para llenar categorías.

Una referencia comercial repetida no prueba identidad: diferentes fabricantes, polos, tensiones, bobinas, revisiones o variantes pueden compartir fragmentos del nombre. Usa claves estables y enlaces explícitos.

## 9. Procedencia, integridad y verificación son conceptos distintos

Cada magnitud relevante debe poder mostrar:

- Valor tipado, unidad y si es nominal, máximo, mínimo o intervalo.
- Condiciones aplicables: AC/DC, tensión, frecuencia, polos, temperatura, ajuste u otras según campo.
- Origen: configuración del usuario, modelo genérico, dataset sintético o fuente documental.
- Referencia documental, revisión, página/sección cuando esté disponible y fecha de consulta/importación.
- Estado de revisión humana/documental independiente del origen declarado.
- Transformaciones: conversión de unidad, interpolación autorizada o fórmula aplicada.

Un JSON externo puede afirmar «fabricante»: eso no lo convierte en verificado. Diferencia fuente declarada y fuente corroborada. Un hash acredita igualdad/integridad del contenido, no autenticidad, licencia, exactitud eléctrica ni certificación.

No inventes porcentajes de confianza. Expón hechos y estados categóricos justificados. Conserva la trazabilidad incluso cuando el resultado matemático sea CALCULADO a partir de un dato ESTIMADO o SINTÉTICO.

## 10. Revisiones, hashing y ciclo de vida

Define serialización canónica versionada y hashes estables. Ordena mapas/conjuntos cuando corresponda; no reordenes arrays cuyo orden tenga significado técnico. Excluye correctamente campos autorreferentes y fechas de importación locales del contenido técnico hasheado si no son semánticas.

Reglas mínimas:

- Misma revisión + mismo hash: importación idempotente, sin duplicados.
- Misma revisión + distinto contenido: conflicto explícito; nunca sobrescribir.
- Revisión nueva: objeto nuevo; los proyectos anteriores conservan la previa.
- Producto retirado o revisión desaconsejada: advertir, no alterar silenciosamente proyectos fijados.
- Catálogo borrado del almacén global: los proyectos portables conservan su subconjunto necesario.

La comprobación de hash fallida bloquea la adopción del dato, pero no debe impedir rescatar el resto del proyecto ni destruir trabajo.

## 11. Resolver central y precedencia explícita

Diseña un único resolver. La prioridad exacta debe ajustarse a los contratos existentes; documenta una tabla de decisiones, no simples `||` encadenados.

Candidatos de origen: override explícito de proyecto, revisión fijada, perfil existente del componente, modelo genérico permitido y ausencia. Distingue valores del usuario de defaults heredados: un default no debe impedir para siempre adoptar una ficha, ni una ficha borrar una decisión consciente.

Al vincular, muestra conflictos y permite conservar el valor actual o adoptar explícitamente el dato técnico. No uses truthiness: cero, false, ausencia y un valor inválido no son equivalentes. Define cómo eliminar un override y cómo representar «no aplicar herencia» si se necesita.

La salida incluye valor, origen, aplicabilidad, revisión/hash, ruta de resolución, conflictos y datos faltantes. Un dato conocido pero inaplicable no debe sustituirse silenciosamente por un genérico para producir verde.

## 12. Una sola interpretación en todo el producto

El resolver debe alimentar coherentemente simulación V5/V6, Ingeniería V7, escenarios, vistas y documentos en los campos que soportan.

Si los motores actuales leen perfiles persistidos directamente, introduce una proyección/adaptador puro del proyecto efectivo para cada evaluación, sin mutar el documento original y sin copiar valores técnicos a cinco stores distintos.

No resuelvas catálogos en cada frame ni hagas búsquedas lineales repetidas por cada borne. Usa índices por identidad/revisión y resuelve una vez por versión efectiva del documento. Un caché solo es aceptable si su clave incluye todas las dependencias y hay pruebas de invalidación.

Si un campo técnico es solo informativo porque el motor no lo modela, decláralo explícitamente. No simules soporte al mostrarlo en la ficha.

## 13. Bindings, portabilidad y datos personales

Un vínculo debe fijar catálogo, producto/variante, revisión y hash. Prohibido depender de `latest` para resultados de un proyecto guardado.

Diseña un paquete portable con el subconjunto técnico congelado que el proyecto utiliza, incluidas dependencias transitivas: curvas, tablas, factores y criterios. Reutiliza el almacenamiento de assets por hash donde encaje; no incrustes catálogos completos por instancia.

Separar configuración/decisiones de datos congelados compartidos y de resultados calculados. No persistir corrientes, scans, fuerzas o diagnósticos runtime al vincular una ficha.

No incluyas rutas privadas locales en documentación exportada. Documentos fuente de terceros solo se empaquetan con autorización/derechos; metadatos y campos técnicos permitidos son suficientes para los fixtures.

## 14. Persistencia y operaciones atómicas

Vincular, desvincular, actualizar revisión, importar paquete y aplicar criterios deben ser transacciones coherentes con la persistencia existente.

Pruebas obligatorias: fallo de escritura, cuota de almacenamiento, cancelación, reapertura, referencia ausente y cambio de proyecto durante una operación. Debe quedar el estado anterior íntegro o el nuevo íntegro, nunca una mezcla de ambos.

Un resultado de preview o validación debe identificarse con revisión/hash del proyecto y sus datos. Si BASE cambia mientras se calcula, descarta o marca el resultado obsoleto; no permitas aplicar un preview calculado contra otra revisión.

Abrir un ejemplo readonly no autoriza mutarlo: ofrece copia editable para cambios persistentes. Respeta autoguardado, Mis Tableros, undo/redo y aislamiento entre proyectos.

## 15. Protecciones: datos condicionados, no un número universal

Modela capacidades Icn/Icu/Ics como entradas condicionadas por tensión, AC/DC, polos/configuración y contexto técnico cuando se conozca. Son campos diferentes; no selecciones el mayor automáticamente ni los intercambies para aprobar una comprobación.

El criterio debe elegir la magnitud aplicable y mostrar por qué. Si no hay entrada compatible, resultado indeterminado con condición faltante. No extrapoles una capacidad a otra tensión sin regla explícita documentada.

Curvas: unidades, base absoluta/múltiplos de In, ajustes, bandas min/max, dominio, interpolación autorizada y procedencia. Valida tiempos/corrientes finitos, positivos donde corresponda, puntos duplicados y bandas invertidas. No extiendas dominios silenciosamente.

Los modelos genéricos heredados conservan su política documentada; datasets externos deben declarar la suya. No reintroduzcas la extrapolación térmica incorrecta corregida en V7.

La comparación de curvas no acredita por sí sola selectividad total ni coordinación de respaldo certificada. Una tabla específica de combinación de fabricante, si se aporta legítimamente, requiere identidades y condiciones exactas; fuera de ellas no aplica.

## 16. Icc: separar falta de datos de falta de análisis

En el baseline, `src/ingenieria/protecciones.ts` obtiene Icc desde fallas presentes en el resultado físico. Por ello un snapshot estático puede mostrar Icc no modelada aunque la fuente tenga alguna configuración de impedancia.

Comprueba este contrato durante la revisión. No afirmes que completar Icu con un catálogo resuelve automáticamente el problema de Icc.

Distingue: faltan datos de red; faltan condiciones/topología; falta ejecutar un análisis prospectivo disponible; o el caso no está soportado.

Si es necesario para una integración V8 útil, añade únicamente un adaptador focal al análisis prospectivo V5 existente: sobre copia/contexto aislado, punto de falla explícito, referencias reales y sin activar fallas en el proyecto ni avanzar tiempo. No inventes un nuevo solver ni una tierra/neutral ideales universales.

Un dato configurado de Icc debe conservar lugar y condición: no equivale sin más a Icc calculada en cualquier protección aguas abajo. Si la información sigue siendo insuficiente, conserva INDETERMINATE con motivo correcto.

## 17. Contactores, bobinas, canales PLC y analógicas

Datos aplicables de bobina: AC/DC, tensión/rango, frecuencia cuando aplique, consumo sostenido y de llamada si está disponible. No infieras automáticamente I=P/V de una bobina AC sin las magnitudes apropiadas.

Canales PLC: tipo de salida, capacidad por canal y por grupo cuando exista, límites según carga, tensión y modo analógico. Diferencia una corriente continua admisible de un pico y de una clasificación para carga resistiva/inductiva.

Si falta el dato de una carga conectada a un grupo, no apruebes la capacidad del grupo como si esa carga consumiera cero. No amplíes el runtime PLC a nuevos lenguajes/tareas en esta fase.

Analógicas: corriente/tensión, rangos, activo/pasivo cuando esté declarado, impedancia de entrada, burden, alimentación y compliance. Reutiliza V3–V6 para los efectos modelados; no conviertas automáticamente 4–20 mA en 0–10 V por vincular una ficha.

## 18. Motor, VFD, transformador y fuente

Mapea los datos técnicos soportados a los perfiles V6 existentes: potencia mecánica vs eléctrica, eficiencia, factor de potencia, tensión de línea/fase, frecuencia, corriente, polos, conexión y rangos.

Conserva datos de placa configurados y diagnósticos de incoherencia. Nunca ajuste varios campos automáticamente solo para que las ecuaciones coincidan. Una combinación aparentemente equivalente puede tener límites y condiciones distintas.

Incluye pruebas representativas de motor/VFD y transformador/fuente vinculados, con balance de potencia y ausencia de doble conteo. No implementes PWM, armónicos, motor dq, inrush profundo ni nuevos sistemas de tierra.

## 19. Ampacidad basada en datasets

Construye un motor de lookup/corrección sobre tablas explícitas. Dimensiones según dataset: material, aislamiento, sección, método de instalación, temperatura base, número de conductores cargados, agrupamiento y otras condiciones declaradas.

La temperatura del conductor usada en R(T), la temperatura ambiente y la temperatura nominal de aislamiento son conceptos distintos. No sustituyas una por otra.

El resultado debe exponer fila base, Iz base, factores, condiciones, cálculo, dominio, supuestos, referencia y revisión. No uses un número universal «sección → amperios».

Los factores solo se multiplican si el dataset declara esa combinación. Evita corregir dos veces una condición incorporada ya a la tabla. No apliques un factor de otro material/aislamiento/método. Un dato faltante no vale automáticamente 1.

EXACT_ONLY es una opción segura por defecto para tablas discretas. STEP debe especificar dirección y límites; LINEAR u otra interpolación solo cuando esté autorizada en el dataset. No extrapoles fuera del dominio para forzar una respuesta.

## 20. Validación de conductor y protección

Reutiliza reglas V7 y adapta su entrada al resultado de ampacidad, manteniendo el perfil legacy explícito cuando corresponda.

Distingue comparar Ib con Iz, coordinar Ib/In/Iz según un criterio configurado y dimensionamiento completo. No declares completo el dimensionamiento por aprobar una sola desigualdad. Verificaciones adicionales solo se ejecutan si hay datos y modelo suficientes.

Las recomendaciones se limitan a alternativas evaluadas y criterios comprobados. Si un criterio obligatorio queda indeterminado, no anuncies «solución óptima/aprobada». Explica los requisitos pendientes.

Caso aritmético de prueba SINTÉTICO: Iz base=30 A, factores 0,94 y 0,80 → Iz=22,56 A. Con Ib=22 A e In=25 A, Ib≤Iz puede cumplirse, pero el criterio configurado Ib≤In≤Iz falla. No atribuyas estos números a una norma ni fabricante.

## 21. Criterios versionados y cobertura

Implementa perfiles con identidad, revisión/hash, jurisdicción o ámbito declarado opcional, referencias, parámetros, ámbito proyecto/circuito y overrides explícitos.

La precedencia debe ser determinista y visible; una sobrescritura parcial no elimina otros parámetros heredados con `undefined`. Cero, ausencia, desactivación de criterio y no aplicabilidad deben distinguirse.

Un perfil de cliente o interno es válido como tal. No lo rotules «cumplimiento IEC/NCh» sin implementación y cobertura documental real. La edición/revisión de un perfil crea nueva versión; los proyectos existentes no cambian solos.

El resumen de revisión incluye reglas evaluadas, fallidas, indeterminadas y no aplicables. «0 errores» no significa revisión completa cuando faltan datos obligatorios. Separa resultado técnico, severidad, cobertura de evaluación y procedencia.

## 22. Centro de datos faltantes

Amplía el Issue Center, no crees un segundo motor contradictorio. Para cada falta muestra entidad, campo/condición, comprobaciones bloqueadas, impacto, origen esperado y acceso a resolverla.

Diferencia MISSING, NOT_APPLICABLE, OUT_OF_DOMAIN, CONFLICT, UNVERIFIED_SOURCE y STALE_RESULT según necesidad; no todo es «falta catálogo».

Desde un issue debe poder abrirse la ficha/vínculo correcto, completar un override o importar/asignar una revisión, volver a validar y ver el cambio. Mantén evidencia de la Icc disponible aunque falte Icu y viceversa.

No apruebes datos porque aumentó el número de campos rellenados. Calidad y aplicabilidad importan más que completar formularios.

## 23. Comparación de revisiones y adopción explícita

Reutiliza `proyectarEscenario`, `evaluarEscenarios` y `aplicarEscenarioTransaccional` cuando encaje, ampliando el contrato sin duplicar el motor.

Compara revisión vigente y candidata: campos añadidos/cambiados/eliminados, unidades normalizadas, procedencia, aplicabilidad, criterios e impacto sobre física y issues. Señala overrides que impiden que un cambio del catálogo afecte al proyecto.

Preview no muta BASE ni publica la revisión automáticamente. Aplicar requiere confirmación, revalidación de la versión base y transacción. Fallo de persistencia o candidato obsoleto deja BASE intacta.

Una revisión nueva puede empeorar el resultado. Incluye ese caso; no presentes toda actualización como mejora.

## 24. Importación y exportación seguras

Formato principal: JSON versionado con manifiesto, productos/revisiones, dependencias y hashes. Para tablas simples, un CSV con plantilla documentada y vista previa es apropiado si mantiene el mismo validador; no hace falta XLSX ni un conversor universal.

Pipeline: leer con límites → parsear → validar estructura/unidades → validar semántica/dominio → resolver dependencias → previsualizar conflictos → confirmar → persistir atómicamente.

Los imports son datos no confiables. Rechaza prototype pollution, claves peligrosas, profundidades/colecciones excesivas, números no finitos, rangos invertidos, enums desconocidos, hashes inconsistentes y referencias rotas. Versiones futuras no soportadas no se convierten silenciosamente al schema actual.

No eval, `new Function`, plugins ejecutables ni expresiones JavaScript dentro de perfiles. Reglas configurables se seleccionan de operaciones tipadas permitidas, no código arbitrario.

Escapa contenido HTML. Valida URLs antes de hacerlas enlaces; no ejecutes `javascript:` ni cargues contenido remoto automáticamente. Mantén BOM UTF-8, delimitador/escape y defensa frente a fórmulas en CSV sin corromper números legítimos.

## 25. Fuentes externas y propiedad de los datos

Construye la infraestructura con datasets sintéticos claramente identificados. Pueden usarse pequeñas fuentes públicas primarias para validar un mapeo concreto si el acceso y uso están autorizados, registrando referencia exacta. No dependas de obtener un catálogo comercial para completar V8.

No inventes citas, páginas, revisiones, licencias ni certificados. No extraigas masivamente fabricantes ni reproduzcas tablas normativas protegidas. Un enlace no otorga permiso de redistribución.

Los datos sintéticos deben mantener su etiqueta en ficha, resultado, informe, exportación y reimportación. El usuario puede usarlos para probar herramientas, no confundirlos con una selección real de ingeniería.

## 26. Interfaz profesional y operable

Añade «Datos técnicos» coherentemente con Ingeniería y Mis Componentes. Reutiliza controles y estilos existentes; no hagas overhaul global.

Flujos completos requeridos:

1. Buscar/filtrar catálogo y producto por campos explícitos.
2. Ver ficha con valores, unidades, condiciones, revisión y fuente.
3. Crear/editar borrador de producto personalizado y publicar nueva revisión.
4. Vincular datos a componente o conductor con previsualización de conflictos.
5. Ver datos resueltos y overrides; quitar override de forma explícita.
6. Completar condiciones de instalación y revisar cálculo de ampacidad.
7. Aplicar un perfil de criterios y ver su revisión.
8. Revisar datos faltantes desde un issue.
9. Comparar/adoptar actualización de revisión sin mutar BASE en preview.
10. Importar/exportar paquete y compartir proyecto portable.

No exijas a Diego editar JSON para el uso ordinario. Datos avanzados pueden plegarse, pero el recorrido principal debe ser descubrible. Explica términos brevemente mediante ayuda contextual profesional.

Conserva selección, foco y paneles abiertos durante actualizaciones. Cambio de proyecto invalida resultados/filtros dependientes. Usa identificadores accesibles y controles estables para pruebas. Operaciones largas muestran progreso y cancelación cuando procede; no congelan silenciosamente la pantalla.

## 27. Informes y trazabilidad de revisión

Amplía el informe V7 existente, sin otro motor documental. Incluye origen y revisión de datos/criterios, overrides, condiciones, cálculo de ampacidad, conflictos, limitaciones y cobertura de evaluación.

Identifica proyecto/revisión, Build ID del motor y manifest/hash técnico utilizado. No declares una auditoría formal inviolable ni firma digital por tener hashes locales.

Reportes del mismo snapshot y parámetros deben ser reproducibles; las fechas forman parte explícita del contexto, no llamadas ocultas a `Date.now()` durante el render.

Mantén HTML offline con espaciado/tablas/imprenta del hotfix, CSV con BOM y escaping seguro. La exportación no debe introducir datos de runtime en Proyecto. No modifiques el dossier general salvo integración necesaria y probada.

## 28. Matriz de casos obligatorios

Usa fixtures pequeños reutilizables; no llenes la biblioteca de copias redundantes. Deben demostrar al menos:

- V7 legacy sin catálogo, preservado.
- Protección con Icc disponible e Icu ausente: indeterminado.
- Misma protección con dato sintético aplicable: resultado calculado con etiqueta sintética.
- Icu disponible pero Icc ausente: sigue indeterminado por la causa correcta.
- Capacidad declarada para tensión/AC-DC incompatible: no se usa silenciosamente.
- Bobina/salida PLC compatible, sobrecargada e insuficientemente documentada.
- Analógica compatible e incompatible/compliance insuficiente.
- Ampacidad completa, condición faltante, temperatura fuera de tabla y corrección duplicada rechazada.
- Override explícito preservado y eliminación del override controlada.
- Revisión nueva que cambia una validación de PASS a FAIL, sin modificar BASE hasta confirmar.
- Actualización con conflicto o fallo de persistencia: rollback íntegro.
- Proyecto exportado que resuelve sus datos en un almacenamiento limpio y sin red.
- Catálogo global borrado sin inutilizar el subconjunto congelado del proyecto.
- Import corrupto, malicioso o schema futuro: rechazo claro sin dañar bibliotecas.
- Dos proyectos con revisiones distintas del mismo producto: resultados independientes.

Los ejemplos eléctricos muestran decisiones del modelo, no acreditan un diseño apto para instalación real.

## 29. Pruebas independientes, no tests que repiten implementación

Añade tests por contrato: schemas, normalización, hash, resolución, revisiones, persistencia, aplicabilidad, ampacidad, criterios, escenarios, informes y UI.

Incluye oráculos aritméticos independientes y expectativas explícitas. No generes el esperado llamando a la misma función que estás verificando. Un test que comprueba únicamente que hay un objeto o un número no demuestra la ecuación ni la procedencia.

Casos metamórficos: reordenar entradas sin significado no cambia resultados; cambiar orden semántico no se ignora; importar dos veces no duplica; preview no muta; revisión nueva no cambia proyectos fijados; dato inaplicable no pasa; fuente sintética no se convierte en fabricante; ausencia sigue ausente.

Usa tolerancias numéricas justificadas donde correspondan, no igualdad float arbitraria ni tolerancias gigantes. En áreas alteradas, introduce temporalmente errores controlados para demostrar que las regresiones relevantes los detectan, retirándolos antes de commit. No adoptes una gran dependencia de mutation testing solo para esta campaña.

## 30. Robustez y estructuras de datos dirigidas

Perfila catálogo/resolver/import/preview, no todo el programa. Usa Map/índices por IDs, revisión y hash cuando eviten búsquedas repetidas; evita O(productos × bindings × campos) innecesario. Reutiliza subconjuntos y evita duplicar megabytes por cada equipo.

Prueba tamaños escalonados: aproximadamente 100, 1000 y 10000 productos sintéticos, con cientos de vínculos en un proyecto. Declara límites de import y muestra rechazo/progreso, no aceptes datos ilimitados.

Mide p50/p95 cuando haya muestras suficientes, tiempo de importación/resolución, tamaño persistido/exportado y responsiveness. No impongas un umbral frágil basado en una sola máquina. Contrasta con baseline del mismo entorno y corrige regresiones atribuibles a V8.

Prueba cancelación, reapertura, varias revisiones, borrado lógico, cambios de proyecto durante preview y almacenamiento lleno simulado. Web Worker/caché adicional solo con cuello medido, frontera serializable clara y equivalencia verificada.

## 31. Gates e incrementos que debes completar

A0 — Recuperación, verificación baseline y auditoría dirigida con matriz de alcance.
A — Modelo técnico, schemas, revisiones y hashing.
B — Resolver, procedencia, aplicabilidad y conflictos.
C — Bindings, persistencia atómica, migración y portabilidad.
D — Adaptadores de equipos/protecciones y conexión real V5–V7.
E — Tablas de conductor, factores y motor de ampacidad.
F — Perfiles de criterios versionados e integración en validación.
G — Datos faltantes, cobertura y navegación desde issues.
H — Comparación de revisiones y aplicación transaccional.
I — Interfaz, import/export y documentación completas.
J — Fixtures, revisión independiente, seguridad y stress dirigido.
K — Campaña integrada, entrega offline, CI y publicación.

Cada gate puede tener incrementos menores con commits. Integra pronto un recorrido mínimo visible de catálogo → vínculo → validación; no dejes toda la integración para el final. Después complétalo sin omitir el resto del alcance.

Si detectas una solución arquitectónica mejor, adáptala manteniendo resultados y contratos, registra la decisión y continúa. No rebajes requisitos silenciosamente por preferencia de implementación.

## 32. Toolchain y comandos reales

`package-lock.json` y npm son el contrato canónico. El historial usó Node 24.19.0 y `playwright-core` fijado; verifica versiones/configuración reales antes de cambiar nada.

No uses un wrapper pnpm que adopte `node_modules` ni cree `pnpm-lock.yaml`/`pnpm-workspace.yaml`. Si npm no está en PATH, localiza el ejecutable/CLI existente y úsalo con el Node correcto. Recuperar una herramienta ausente debe quedar documentado, fuera de código de producto y sin scripts remotos opacos.

No hagas `npm audit fix` automático. Registra vulnerabilidades y corrige las que introduzca V8 o afecten directamente sus imports, mediante cambios controlados y pruebas. No conviertas esta fase en actualización indiscriminada de dependencias.

Los scripts reales del baseline están en `package.json`. Varios `qa:*` recompilan; puedes usar su entrada `:run` o `node qa/todas.mjs <selector>` después de una build identificada cuando conserve exactamente la cobertura y la configuración. Registra qué build probaste. No simules haber ejecutado `npm ci` al invocar solo archivos JS.

## 33. QA de navegador, automatización y tiempo simulado

Crea un agregado `qa:datos-tecnicos` dividido en subsuites manejables: catálogos/vínculos, ampacidad/criterios, revisiones/portabilidad e imports/documentos, según duración real.

Prueba acciones humanas mediante controles visibles: seleccionar, editar, confirmar, descargar, recargar. Hooks de observación son complementarios, no sustituyen el flujo. Para CSV comprueba bytes descargados; para portabilidad usa almacenamiento limpio sin catálogo global; para reportes inspecciona render e impresión cuando las herramientas lo permitan.

Cierra browser/servidor/temporales propios en éxito y error. Preserva logs/trace/screenshots útiles antes de limpiar. No mates procesos ajenos.

Los ensayos temporales usan reloj simulado del producto y sincronización por estados; timeout de pared es un límite operacional, no la ley física. No reintroduzcas el fallo de rotor bloqueado V6.

## 34. Campaña final proporcional y completa

Al estabilizar el candidato, ejecutar con evidencia terminal:

- `npm test` y build QA.
- QA V8 completa.
- `qa:ingenieria`.
- `qa:equipos`.
- `qa:fisica`.
- `qa:simulacion`.
- `qa:automatizacion`, importante porque los datos de E/S atraviesan contratos PLC.
- Gate histórico y regresiones de fusión/puerta.
- `qa:multiproyecto` y `qa:componentes`.
- Instalación reproducible, empaquetado, `entrega:check` y `qa:empaquetado`.

Parte de 1182 tests como referencia histórica, no como objetivo para fabricar pruebas ni obligación de conservar tests duplicados. Reporta añadidos, cambios y retirados con razones. No ocultes skip, suite no ejecutada ni proceso sin final.

Si hay cambios tras una prueba, invalida la evidencia afectada. El cierre remoto debe ejecutar el candidato definitivo desde instalación limpia. No repetir toda la campaña por un cambio documental irrelevante; tampoco reutilizar una prueba de otro bundle como evidencia del actual.

Ante un rojo: conserva logs, clasifica y corrige causa. Un reintento puede aportar evidencia, pero no es solución sistemática. No `continue-on-error`, eliminar assertions, seleccionar solo semillas favorables ni subir timeouts sin explicación.

## 35. Entregable offline y revisión visual

Genera mediante el flujo existente `dist-final/TableroStudio.html` y `desktop/app.html`, idénticos byte a byte. Build ID nuevo por cambio de producto, calculado por la herramienta, nunca escrito a mano.

El smoke `file://` conserva V2–V7 y añade un recorrido compacto V8: catálogo local → vínculo → validación con procedencia → ampacidad/criterio → preview de revisión sin mutación → documentación/portabilidad. Cero dependencia HTTP obligatoria.

No dupliques toda la campaña dentro del smoke. Verifica hashes, tamaños y Build ID del archivo realmente entregado y del artifact descargado. El hash del ZIP no es el hash del HTML.

La inspección visual no se acredita por estilos computados solamente. Si no se puede capturar/renderizar alguna pantalla, registra NO VERIFICADO VISUALMENTE y deja un recorrido manual concreto; no inventes una aprobación humana ni ejecución de Excel.

## 36. CI, publicación y freeze V8

Verifica antes del push final que los workflows cubren QA Datos Técnicos V8 y no solo suites anteriores. Conserva checks de unit/build, histórico, V6/V7 y offline. Si usas PR, comprueba sus triggers y permisos, sin alterar protecciones de rama.

Los jobs alojados separados pueden ejecutarse en máquinas distintas; no atribuyas su lentitud a competencia entre navegadores sin evidencia. Mide pasos/subsuites antes de proponer dividir jobs. No conviertas el cierre en una reforma completa de CI.

Espera estados terminales para el SHA candidato/final correcto y el intento vigente. Identifica runs anteriores fallidos o cancelados, no los ocultes. Si quedan pendientes al agotarse el entorno, registra run/job/attempt en ESTADO y no declares éxito.

Tras integración autorizada en main: verifica HEAD remoto/local, árbol y CI del commit publicado. Pages y artifact deben corresponder al producto final. Solo después crea `tablerostudio-v8` anotado si no existe; nunca muevas un tag publicado.

No dependas de un artifact con expiración como único registro del producto: conserva entregables versionados, hashes y tag conforme al flujo actual. No crees una release comercial ni declares «1.0» por finalizar V8.

## 37. Informe final y traspaso actualizado

Entrega una explicación clara para Diego de lo que cambió y dónde se encuentra en la interfaz, seguida de evidencia técnica:

- Baseline, rama, commits, tag y SHA final.
- Decisiones y hallazgos de auditoría; defectos corregidos con regresión.
- Matriz requisito → implementación → prueba → estado.
- Catálogos/revisiones, resolver/precedencia, procedencia y aplicabilidad.
- Bindings, transacciones, portabilidad y proyectos legacy.
- Protecciones/equipos, Icc disponible/ausente y limitaciones.
- Ampacidad: tablas, factores, ejemplos sintéticos y criterios.
- Datos faltantes/cobertura, escenarios y actualizaciones.
- UI, imports, seguridad y documentación.
- Pruebas realmente ejecutadas, performance y fallos encontrados.
- HTML/Build ID/hashes, CI, Pages, artifact y tag.
- Capacidades no modeladas y tareas pospuestas.
- Recorrido manual de aceptación de V8, con nombres reales de ejemplos/botones.

Actualiza el handoff mediante un documento V8 enlazado, sin borrar la historia V7. La evidencia final puede referir al tag y al manifiesto de entrega para evitar autorreferencias de SHA.

Si se corta antes, entrega solo estado verdadero y siguiente acción, no un informe de finalización ficticio. No inicies V9.

## 38. Regla de cierre

La meta es que un ingeniero pueda responder «qué dato usó, de dónde salió, bajo qué condiciones aplica, qué revisión lo fija y por qué dio ese resultado», además de realizar esas operaciones desde el programa sin editar código.

No busques muchos checks verdes a costa de evidencia. No confundas pruebas automatizadas con certificación eléctrica. No acumules funciones invisibles. Completa V8 con profundidad, conserva V7 y deja todo preparado para continuar desde cualquier checkpoint.

Comienza ahora con preflight, lectura del handoff, plan durable y primera implementación autorizada.
