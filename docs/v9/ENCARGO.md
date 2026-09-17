# TABLEROSTUDIO V9 — DISEÑO ASISTIDO Y DIMENSIONAMIENTO EXPLICABLE
## Encargo maestro de implementación y cierre completo para Codex
### Continuación desde V8 publicada · circuitos existentes · aplicación controlada · local/offline

## 0. Autorización, objetivo y significado de «terminada»

Implementa y entrega V9 completa. Este encargo autoriza investigación dirigida del repositorio, diseño de contratos, implementación, pruebas, documentación, commits, respaldo de la rama, integración final y publicación según los controles siguientes. No te limites a un plan, schemas, un prototipo o funciones invisibles. Continúa automáticamente entre incrementos comprobados; los checkpoints no son solicitudes de aprobación.

El usuario es Diego. TableroStudio debe ser una herramienta seria de ingeniería de tableros: diseño, simulación, análisis, diagnóstico y documentación. No gamificación. Debe poder utilizar las nuevas herramientas desde la interfaz sin programar ni editar JSON. El mundo 3D/CAD avanzado se deja para después.

V9 añade una capacidad concreta:

> Sobre un circuito existente, definir qué cambios se permiten, generar combinaciones de conductor y protección, evaluarlas con los mismos motores V5–V8, explicar resultados y diferencias, y aplicar únicamente la alternativa confirmada por el usuario.

V8 responde «qué datos utilizo y qué cumple/falla/falta». V9 debe responder además «qué alternativas evaluadas satisfacen los requisitos declarados, por qué y con qué límites».

«V9 terminada» significa el alcance obligatorio de este documento implementado, visible, probado y entregado. No significa que TableroStudio sea ya 1.0, un producto certificado ni un optimizador universal. No iniciar V10.

Las secciones siguientes son la especificación NUEVA de V9. Los datos del cierre V8 son antecedentes para verificar, no prueba de que V9 exista. El handoff histórico que dice «no iniciar V9» describía el alcance de V8; este nuevo encargo autoriza explícitamente V9.

## 1. Baseline conocido y fuentes

Referencia publicada V8:

- Repositorio: `Zziggurat/programa-`.
- Rama estable: `main`.
- Commit de cierre: `4a0025f327c07d40bc104f614220a5e863a69165`.
- Tag anotado: `tablerostudio-v8`.
- Build ID de producto: `C72A570F34`.
- HTML: `3.308.535` bytes por copia.
- SHA-256 del HTML: `4b091b41761ab32e6758cf66342a74597e05f929cc8dbcd2e110cbe0d4f7822c`.
- Run final V8: `34248820580`, intento 1, seis jobs aprobados según el informe.
- Referencia de tests: 1385 unitarios/integración; V8 3 suites/117 comprobaciones; V7 3/44; V6 3/32; histórico 13/263; offline 67.

Fuentes internas prioritarias: `docs/HANDOFF_V8.md`, `docs/v8/MATRIZ.md`, `docs/v8/USO.md`, `docs/v8/DECISIONES.md`, `docs/v8/VALIDACION.md`, `docs/v8/ENTREGA.md`, anotación del tag y código real. El informe adjunto acredita el cierre reportado; no sustituye inspeccionar contratos.

No vuelvas al antiguo baseline V7, no repitas V8 y no borres su historia. La arquitectura V8 incluye datos técnicos versionados, resolver común, subconjunto congelado, condiciones de aplicabilidad, criterios, ampacidad, prospectiva y adopción transaccional. Reutilízala.

## 2. Preflight y rama de trabajo

Antes de modificar archivos, lee los `AGENTS.md` aplicables y verifica:

```bash
git rev-parse --show-toplevel
git remote -v
git status --short --branch
git branch --show-current
git worktree list
git rev-parse HEAD
git log --oneline --decorate -20
git diff --stat
git diff --cached --stat
git diff --check
git fetch origin
git rev-parse origin/main
git rev-parse 'tablerostudio-v8^{}'
```

En el primer arranque se espera V8 publicada sin cambios ajenos. Comprueba el commit desreferenciado del tag, no confundas su objeto anotado con el commit. No recrees ni muevas tags V7/V8.

Crea `v9/astra-diseno-asistido` desde el baseline verificado. Si existe trabajo V9 reconocible, inspecciona rama, diffs y registros y reanuda; no lo descartes por no coincidir con V8. Si main avanzó, identifica autoría y alcance antes de decidir compatibilidad. No mezcles cambios ajenos sin autorización.

Prohibido `reset --hard`, `clean`, checkout destructivo, rebase automático, force-push, borrado de trabajo o movimiento de tags publicados. Los commits verdes de V9 pueden respaldarse normalmente en su rama. No publiques una V9 parcial como versión terminada en main.

Al cerrar, usa PR si el repositorio lo requiere, o fast-forward verificado si no hay divergencia y el flujo lo permite. Conserva el historial. Nunca saltes protecciones, checks o permisos.

## 3. Alcance obligatorio y límites de esta V9

### Debe quedar completo

1. Preparar una solicitud de diseño para un circuito existente desde Ingeniería o un issue.
2. Definir objetivo, restricciones, campos/entidades modificables, elementos bloqueados y productos/revisiones permitidos.
3. Generar alternativas de sección y protección, individualmente y en combinación.
4. Adoptar revisiones técnicas coherentes: no fabricar equipos mezclando datos de distintas fichas.
5. Evaluar cada alternativa con resolver, física, prospectiva, ampacidad y validaciones existentes, dentro de sus capacidades.
6. Clasificar factibles, inviables, indeterminadas y errores; informar cobertura y alcance explorado.
7. Ordenar y mostrar alternativas no dominadas, con razones, métricas y diferencias frente a BASE.
8. Mantener interfaz utilizable, progreso, cancelación y resultado parcial honesto cuando corresponda.
9. Previsualizar, aplicar transaccionalmente, deshacer/rehacer, guardar, reabrir y exportar sin perder datos.
10. Producir informe de decisión y paquete reproducible, con datos y revisiones necesarias.
11. Mantener compatibilidad V2–V8 y entregar HTML offline, CI final y tag V9.

### No iniciar en esta fase

- Síntesis de un tablero desde cero ni inserción automática de fuente, motor, contactores o cableado nuevo.
- Optimización simultánea de toda la planta o todos los tableros; cada búsqueda tiene un alcance seleccionado.
- Rebalance automático de fases o dimensionamiento automático de todas las fuentes de control. Los escenarios manuales existentes permanecen; una ampliación futura podrá usar la infraestructura V9.
- Reemplazo automático de motor, VFD, bobina, PLC o topología. Se evalúan sus restricciones existentes, pero el generador inicial cambia conductores/protecciones autorizados.
- Modelos nuevos de SPICE, EMT, PWM, armónicos, PLC/IEC 61131, normas o sistemas de puesta a tierra.
- CAD, esquemáticos 2D nuevos, routing, render fotorealista, optimización global del visor, nube o precios/compras.
- Un LLM integrado que decida los cálculos. El programa final debe resolver V9 mediante algoritmos locales tipados, sin API de IA ni credenciales.

La extensión es acotada para terminar con profundidad. No elimines requisitos obligatorios llamándolos «para después»; tampoco amplíes V9 solo porque existan recursos disponibles.

## 4. Gestión de ejecución y estado durable

Crea o reutiliza:

- `docs/v9/ENCARGO.md`: este documento.
- `docs/v9/PLAN.md`: gates, dependencias, matriz requisito → implementación → prueba.
- `docs/v9/ESTADO.md`: checkpoint, diff pendiente, pruebas válidas/invalidadas, proceso activo y siguiente acción.
- `docs/v9/DECISIONES.md`: decisiones con razones y alternativas descartadas.
- `docs/v9/VALIDACION.md`: entorno, ejecuciones terminales, fallos y evidencia.

Evita una transcripción inmensa. ESTADO debe comenzar con un resumen vigente inequívoco, seguido del historial necesario. No escribir el SHA de un commit dentro de ese mismo commit; usar el checkpoint precedente, tag o manifiesto de publicación externo a esa autorreferencia.

Haz commits por fronteras coherentes. Respalda la rama sin secretos, logs privados, documentos de terceros o artefactos temporales. Checkpoint significa probar, registrar, guardar y CONTINUAR, no detenerse a pedir un nuevo prompt.

No presupongas cuotas ni resets del usuario. No compres créditos, APIs, runners o servicios. Si hay corte real, el trabajo debe recuperarse desde Git y ESTADO. Al reanudar comprueba si un proceso/run terminó antes de duplicarlo.

Un integrador mantiene la arquitectura. Si hay subagentes, como máximo dos revisores acotados con propiedad explícita de archivos; preferentemente lectura de seguridad/corrección y pruebas. No permitan instalaciones, builds o ediciones concurrentes conflictivas sobre lockfile, schemas, persistencia, UI central o QA compartido. No reproducir el incidente pnpm de V8.

## 5. Gate A0: revisión dirigida y preparación operativa

Inspecciona símbolos y contratos reales, no toda la aplicación:

- `src/ingenieria/engine.ts`, `escenarios.ts`, `validacion.ts`, `circuitos.ts`.
- `src/ingenieria/conductores.ts`, `protecciones.ts`, `potencia.ts`, `compatibilidad.ts`.
- `src/ingenieria/prospectiva.ts`, `contexto-proteccion.ts`, `documentacion.ts`.
- `src/datos-tecnicos/{tipos,campos,resolver,operaciones,hash,ampacidad,criterios,curvas,repositorio}.ts`.
- `src/modelo/tipos.ts`, cargadores/persistencia y componentes personalizados.
- `app/gestor-documentos.ts`, `app/ui-ingenieria.ts`, `app/ui-datos-tecnicos.ts` y puntos necesarios de `main.ts`.
- Helpers de copia/descarga, presupuestos QA, runner, workflows y empaquetado existentes.

Produce una matriz breve de reutilización y brechas. Reproduce solo bloqueantes concretos y añade regresión antes del fix mínimo. Revisa especialmente:

1. Los parches V7 de sección/protección modifican perfiles persistidos: ¿la resolución V8 los sobrescribiría, ignoraría o haría incoherentes?
2. `ejecutarIngenieria` devuelve `tecnica` y `prospectiva`. ¿Los indicadores antiguos de ScenarioEngine leen solo `fisica.fallas` y perderían la Icc prospectiva V8? Utiliza el dato del punto correcto, no un máximo global.
3. ¿Existe una confirmación estable de operación documental y una identidad/revisión para rechazar previews obsoletos?
4. ¿La parte pesada del análisis puede ejecutarse sin actualizar la escena ni provocar un montaje por candidato?
5. ¿Qué reglas aportan veredicto, dato faltante y procedencia sin que V9 duplique sus ecuaciones?

No declares por anticipado que todo lo existente es correcto ni que está roto. Adapta los contratos tras leerlos. La revisión debe conducir pronto a un primer recorrido integrado, no a una auditoría interminable.

## 6. Lecciones de V8 que se incorporan sin abrir otra megafase

La estabilidad operativa necesaria para V9 se resuelve en A0 y en la integración; no se exige al usuario lanzar antes una V8.1 separada.

- Busca una señal persistente de «documento listo», ligada a la operación y su identidad. No equipares montaje visible con escritura confirmada.
- Reutiliza la operación transaccional V8 y sus promesas/eventos. Si falta una señal pública estable, añádela de manera mínima y útil también para la UI, con regresiones. No hagas depender la nueva V9 de la duración de un toast.
- Un botón Guardar/exportar debe observar una descarga cuando ese sea el contrato, no una navegación imaginaria.
- Cierra páginas/contextos que ya no se utilizan. El informe estático puede capturarse aparte del visor, sin eliminar cobertura visual.
- Separa tiempo por acción, tiempo total de suite y supervisor externo de limpieza. Conserva los presupuestos V8 medidos; no restaurar automáticamente límites menores.
- Renderizar no es evaluar. La búsqueda no debe reconstruir Three.js por candidato.
- Una pausa/reducción de render solo se autoriza si es mínima, medida y no altera simulación, reloj, interactividad ni cobertura. No es requisito rediseñar el renderer para terminar V9.

Congela estas fronteras antes de la campaña larga. Las mejoras externas no bloqueantes se documentan y no se implementan en este cierre.

## 7. Arquitectura del motor de propuestas

Introduce un módulo propio, por ejemplo `src/diseno-asistido/`, adaptando nombres a las convenciones del repositorio. Los nombres siguientes son orientativos, NO símbolos existentes:

- `SolicitudDiseno` / `IntencionDiseno`.
- `SnapshotBusqueda` / `UniversoCandidatos`.
- `GeneradorCandidatos`.
- `PlanCambiosDiseno`.
- `EvaluadorPropuestas`.
- `ResultadoPropuesta` / `CoberturaPropuesta`.
- `OrdenadorAlternativas` / `FronteraPareto`.
- `SesionBusqueda`.
- `InformeDecisionDiseno`.

Flujo único:

```text
Proyecto BASE + solicitud + revisiones/criterios fijados
→ comprobación de alcance y precondiciones
→ universo finito de opciones permitidas
→ planes de cambio tipados, deduplicados y deterministas
→ candidato aislado mediante adaptadores V7/V8
→ resolver técnico → Engine existente → física/ampacidad/prospectiva/validación
→ factibilidad + impacto + ranking explicable
→ preview y confirmación
→ transacción documental existente
```

V9 orquesta búsquedas, no crea otro solver, otro catálogo ni otra interpretación de las reglas. La UI consume resultados y comandos; no calcula física, ampacidad, puntuaciones o elegibilidad en handlers.

## 8. Solicitud de diseño e intención del usuario

La solicitud debe declarar como mínimo:

- Identidad de proyecto/documento, revisión y circuito seleccionado.
- Objetivo: corregir incumplimientos del circuito o comparar mejoras bajo requisitos fijos.
- Conductores/protecciones que pueden cambiar y campos autorizados.
- Entidades/campos bloqueados; un valor conservado no equivale a autorización para editarlo.
- Secciones admisibles o revisiones de productos admitidas, con límites explícitos.
- Perfil y revisión de criterios, restricciones obligatorias y preferencias de ordenación.
- Política de datos permitidos y confianza documental; modo sintético claramente señalado.
- Presupuesto finito de candidatos/evaluaciones y política de exploración.

Por defecto permanecen bloqueados topología, fuentes, tensión, frecuencia, carga, placa del motor, programa PLC, geometría, rutas/longitudes, PE/bonding, condiciones de instalación, factores y criterios. El optimizador no «arregla» un tablero reduciendo la carga, acortando el cable, mejorando ficticiamente la temperatura o desactivando una regla.

El usuario puede editar su diseño o criterios fuera de la búsqueda; eso crea una BASE/solicitud nueva e invalida el resultado anterior. Todos los candidatos de una misma búsqueda se evalúan bajo los mismos requisitos.

Nunca deshabilites automáticamente protecciones, alteres umbrales físicos ni elimines dispositivos/conductores para reducir errores.

## 9. Alcance eléctrico y dependencias compartidas

Trabaja sobre un circuito ya reconocido. No confundas una lista de entidades con una frontera eléctricamente independiente.

Calcula el conjunto afectado: carga, conductores de ida/retorno pertinentes, protección propia y compartida, alimentación, upstream/downstream, tramos comunes, otros circuitos que dependen de lo modificado y restricciones relevantes de equipos.

Si hay múltiples fuentes, reparto multifase desconocido o topología ambigua no soportada, informa el motivo y bloquea la recomendación sobre esa frontera. No inventes un árbol ni un neutro ideal.

El evaluador inicial debe ejecutar el mismo análisis completo del candidato. Una evaluación parcial por dependencias solo se admite si se demuestra equivalente y ofrece un beneficio medido. Un circuito seleccionado no autoriza ignorar la demanda de los otros ramales bajo una protección común.

Los problemas preexistentes fuera del alcance no deben ocultarse ni convertirse en problemas «resueltos». Diferencia estado del circuito/alcance y estado global. Una propuesta puede cumplir el alcance evaluado sin certificar todo el tablero; comunica ambos resultados.

Un fallo global preexistente independiente no tiene por qué impedir comparar alternativas locales. Un incumplimiento nuevo, agravado o indeterminado en la frontera afectada impide presentar la alternativa como solución plenamente evaluada.

## 10. Restricciones duras, preferencias y cobertura

Las restricciones duras determinan factibilidad. Las preferencias ordenan únicamente alternativas comparables; no compensan un incumplimiento eléctrico con menos pérdidas o menor sección.

Construye un conjunto explícito de obligaciones según alcance y criterios: compatibilidad, corriente nominal, caída, ampacidad, coordinación conductor/protección, capacidad de corte, arranque/curvas/selectividad cuando el caso y los datos lo requieren. Reutiliza las reglas existentes.

La ausencia de una regla en la salida no equivale a PASS. Comprueba que toda obligación esté evaluada, no aplicable con motivo válido o pendiente. Desactivar una regla no convierte su información faltante en una verificación realizada.

Distingue estos ejes:

- Estado técnico de cada obligación: PASS/FAIL/WARNING/INDETERMINATE/NOT_APPLICABLE según contratos existentes.
- Factibilidad del candidato: cumple requisitos evaluados / inviable / indeterminado / evaluación fallida.
- Cobertura: obligaciones evaluadas, pendientes y no aplicables, con nombres, no un porcentaje decorativo.
- Procedencia: documental, usuario, genérica o sintética y estado de revisión V8.
- Alcance de búsqueda: completa, limitada, cancelada o fallida.

Un ERROR de cálculo, excepción, NaN, referencia rota o no convergencia no significa que se demostró «diseño eléctricamente inviable». Clasifica el error separadamente y conserva el diagnóstico.

## 11. Universo de opciones y catálogos

Fija el universo al comenzar. Usa revisiones V8 exactas y congeladas: no `latest`, consultas web ni catálogos que cambian durante la ejecución. Una actualización global no altera una búsqueda en curso.

Las opciones pueden venir de:

1. Secciones explícitamente permitidas para el conductor y su instalación/dataset.
2. Productos/revisiones de protección seleccionados o filtrados por el usuario.
3. Ajustes válidos de una protección ajustable, solo si el dataset/perfil declara su dominio.
4. Perfiles genéricos o del usuario ya admitidos, bajo una política explícita que preserve su procedencia.

No fabriques una referencia comercial combinando calibre de A, curva de B e Icu de C. Un producto no es un recipiente donde todos los campos sean variables libres.

Mantén catálogo, variante, revisión/hash, dependencias y origen de cada elección. No elijas automáticamente productos retirados/rechazados; aplica la política explícita y muestra cualquier exclusión.

Los datos sintéticos son adecuados para laboratorio y pruebas. Nunca pierden esa etiqueta al generar, ordenar, aplicar o exportar una propuesta. No presentar una solución sintética como selección comercial verificada.

## 12. Generación determinista y búsqueda acotada

Empieza con enumeración acotada y filtros seguros. Orden canónico por entidades, opciones y revisiones. Identidad de candidato basada en contenido semántico normalizado, no en índice de array, hora o orden de llegada de un worker.

Incluye BASE como referencia sin cambios y detecta cuándo ya satisface los requisitos. No debe recomendar cambios por obligación.

Soporta candidatos de sección, de protección y combinados. Probar solo «un campo a la vez» no satisface V9: hay problemas donde cambiar ambos es necesario y cambios individuales que empeoran otros criterios.

Evita materializar un producto cartesiano enorme. Calcula su tamaño potencial con aritmética segura y genera de forma perezosa. Deduplica planes idénticos; si dos opciones tienen efectos iguales pero identidades/procedencia diferentes, conserva o agrupa esa distinción de forma explícita.

Define límites configurables y finitos para opciones, combinaciones, evaluaciones, tiempo operativo y memoria. Elige defaults tras medir; documéntalos. La cantidad de evaluaciones, no una velocidad de máquina, debe permitir repetir determinísticamente un ensayo limitado.

Una búsqueda pequeña debe poder agotar todo su universo. Para una grande, informa qué parte se evaluó. No escondas el truncamiento ni aumentes presupuestos indefinidamente para prometer una respuesta.

## 13. Poda válida y honestidad de búsqueda

Descarta antes del solver solo por razones demostradas: familia incompatible, producto fuera de condiciones, cambio prohibido, referencia corrupta, combinación duplicada o límites explícitos incompatibles.

No supongas que «más sección siempre mejora todo»: puede aumentar Icc, cambiar corriente de una carga dependiente de tensión o afectar coordinación. No supongas que «más In» ni «mayor Icu» hacen automáticamente mejor una protección.

Una poda por monotonía o dominancia previa requiere prueba de que no elimina una solución relevante bajo las condiciones modeladas. Si no puedes demostrarla, utiliza búsqueda acotada sin esa poda y declara los límites.

Estados de terminación y mensajes deben ser honestos:

- EXHAUSTIVA: se evaluó o descartó con prueba todo el universo declarado.
- LIMITADA: se alcanzó un presupuesto; existen candidatos no evaluados.
- CANCELADA: decisión del usuario; conservar solo los resultados realmente completos.
- ERROR: el motor no completó la búsqueda de manera válida.

«Sin alternativa válida encontrada en 120 candidatos evaluados de este universo» no significa «no existe solución». Solo una búsqueda exhaustiva puede afirmar ausencia de solución dentro del universo y modelo declarados, nunca universalmente.

No anunciar óptimo global. Una recomendación debe decir «mejor según esta preferencia entre las alternativas evaluadas», y declarar si la exploración fue exhaustiva.

## 14. Aplicación de parches y coherencia con V8

Reutiliza `proyectarEscenario`, `evaluarEscenarios`, operaciones de datos técnicos y la transacción documental donde encajen. Amplía los tipos de parche de forma compatible si V9 necesita expresar un cambio coherente de vínculo/revisión/instalación.

No escribas únicamente `conductor.seccion` o `fisica.proteccion.inA` suponiendo que V8 utilizará ese dato. Un binding, un override o una tabla pueden dominar el valor. Verifica el proyecto EFECTIVO resultante.

Cada plan debe identificar decisiones técnicas autorizadas, dependencias añadidas y campos que quedan intactos. Comprueba después de proyectarlo:

- Lo que afirma cambiar coincide con lo que realmente usa el resolver.
- No hay cambios fuera de la lista permitida.
- No se fabricaron overrides para saltarse una ficha o un bloqueo.
- No se perdió información, terminales, IDs, conexiones, programa PLC, assets o geometría.
- El subconjunto técnico contiene exactamente las dependencias necesarias, sin incorporar toda la biblioteca.

Un override/conservación previo permanece protegido. Si impide adoptar una opción, excluye esa opción con motivo o solicita al usuario autorización de campo ANTES de la búsqueda. No lo borres silenciosamente durante la evaluación.

## 15. Secciones, instalación y ampacidad

Para cada sección candidata debe resolverse una fila/dataset aplicable, sus factores, políticas y condiciones de instalación. No escales Iz por una regla inventada ni reutilices Iz de la sección anterior.

Conserva material, aislamiento, temperatura ambiente, temperatura de aislamiento, método, agrupamiento, conductores cargados, longitud y procedencia salvo cambio explícitamente autorizado dentro del alcance. Por defecto V9 cambia sección, no esas condiciones.

No cambiar una tabla por otra más favorable solo para aprobar. Si se permiten varias tablas, su aplicabilidad y criterio de selección deben estar fijados y justificados antes de buscar.

Un dato faltante o fuera del dominio deja la obligación indeterminada. No interpolar ni extrapolar salvo política de la revisión V8. No aplicar dos veces un factor ni considerar factor ausente como 1.

Evalúa los tramos relevantes y retorno; no aumentes solo un conductor y anuncies dimensionado todo el circuito. Grupos que deban cambiar conjuntamente se representan explícitamente y se aplican como una unidad. PE/neutro no se redimensionan por heurística fuera de su contrato.

Diferencia material teórico de longitud física. Si optimizas cantidad de conductor, la métrica y su procedencia deben ser visibles; no inventes longitud ni costo.

## 16. Protecciones, Icc, carga compartida y curvas

Una alternativa debe conservar función, polos, AC/DC, tensión/frecuencia y topología compatibles. Cambiar ficha técnica no acredita compatibilidad mecánica ni capacidad de los bornes si faltan esos metadatos.

No transformar un interruptor fijo en ajustable ni modificar su In fuera del dominio declarado. Cambiar calibre/curva debe representar una variante o perfil explícito realmente permitido.

Icn, Icu e Ics son distintos. Usa exclusivamente la magnitud seleccionada por el criterio, bajo sus condiciones válidas. No elegir el mayor ni completar uno desde otro.

Recalcula Icc para el punto/retorno real de la protección en cada alternativa que cambie impedancias. Usa `analizarProspectivaProtecciones`/resultado `prospectiva` donde corresponda. No uses Icc máxima global como si correspondiera a todos los puntos ni recuperes una falla runtime de la sesión.

Conserva demanda compartida y condiciones de arranque. Un circuito motor puede exigir analizar el perfil de arranque y curva existentes. Si esa comprobación obligatoria no está modelada, la propuesta queda indeterminada, no completa.

No simules temporalmente motores/PLC/relés dentro del análisis estático ni acumules memoria térmica por cada candidato. Reutiliza resultados y modelos de diseño soportados. V9 no añade otra simulación transitoria profunda.

La selectividad estimada conserva su carácter estimado. Una curva no modelada o un solapamiento no se transforma en selectividad certificada. No mejorar Icc sacrificando una coordinación obligatoria sin que cambie la clasificación.

## 17. Alcance físico de la sustitución

V9 cambia una decisión eléctrica en un modelo existente, no el montaje completo. Mantén IDs y conectividad; una sustitución que requiera otros terminales, dimensiones o cableado no puede aplicarse fingiendo que son equivalentes.

Para variantes con interfaz compatible demostrada, permite adopción. Para metadatos mecánicos/terminales insuficientes, distingue «alternativa eléctrica evaluada» de «sustitución física comprobada». Conserva una tarea explícita de montaje no validado y nunca declare listo para fabricación lo no modelado.

La aplicación de una ficha no debe hacer que una imagen antigua se presente como representación verificada del nuevo producto. Muestra vínculo/procedencia y alcance visual pendiente donde corresponda. No descargues ni generes CAD para resolverlo.

## 18. Evaluación común y estados de cada propuesta

Evalúa BASE una vez por snapshot. Para cada candidato:

1. Valida estructura, cambios permitidos y cierre de dependencias.
2. Proyecta sin mutar BASE.
3. Resuelve datos/criterios efectivos.
4. Ejecuta el motor común con contexto de diseño equivalente y explícito.
5. Extrae métricas por entidad/circuito/punto relevante, no valores ambiguos globales.
6. Verifica obligaciones y cambios en la frontera afectada/global.
7. Produce estado, evidencia, datos faltantes y motivos de descarte.

No requiere energizar un tablero para reglas de diseño. El resultado debe declarar sus supuestos estáticos y no parecer una medición del estado operativo actual.

Un candidato con todo lo obligatorio evaluable y satisfecho puede rotularse «Cumple los criterios evaluados del alcance». Evita «Seguro», «Certificado», «Correcto para instalar» y «Dimensionamiento completo» sin soporte.

Candidatos inviables/indeterminados pueden inspeccionarse como diagnóstico. El botón principal «Aplicar propuesta recomendada» no debe tratar uno de ellos como recomendación aprobada. El editor manual existente permanece disponible, sin camuflar esas modificaciones como una solución V9 validada.

## 19. Métricas y diferencias frente a BASE

Mostrar cuando estén disponibles:

- Secciones, material/longitud y revisión de instalación.
- Protección, In, curva, capacidad aplicable y revisión.
- Ib, In, Iz y márgenes del criterio declarado.
- Caída de tensión y pérdidas de conductores/red según los resultados existentes.
- Icc por punto, capacidad de corte y coordinación/selectividad relevante.
- Condición de arranque/compatibilidad que se haya evaluado.
- Requisitos que pasan, fallan, faltan o no aplican.
- Cambios persistentes exactos y dependencias afectadas.
- Procedencia, datos sintéticos, revisión humana y limitaciones.

No restes un dato ausente como cero. Un delta «no disponible → calculado» es una transición de disponibilidad, no un número. Usa unidades coherentes y conserva precisión interna; formatea cifras legibles en UI/HTML.

Compara hallazgos mediante identidad técnica estable (código, entidad, circuito, obligación), no exclusivamente texto humano o IDs que cambien con el valor. Un incumplimiento no desaparece solo porque cambió el título.

## 20. Ranking, preferencias y alternativas no dominadas

Ordena después de determinar factibilidad. Nunca una solución eléctricamente inviable debe vencer a otra factible por una puntuación agregada.

Preferencias mínimas operables:

- Menor intervención: menos entidades/decisiones autorizadas cambiadas, con definición documentada.
- Menores pérdidas modeladas para el mismo caso de operación.
- Menor sección/cantidad de conductor evaluada, diferenciando sección de volumen cuando haya longitud conocida.
- Mayor margen de una comprobación concreta, no un «margen global» que aumente subiendo indiscriminadamente In.

Usa prioridades lexicográficas o una política explícita fácil de explicar; no inventes pesos, euros, costos o una puntuación opaca de «ingeniería 96/100».

Muestra una frontera de alternativas no dominadas para métricas comparables: una opción puede cambiar menos componentes y otra tener menores pérdidas. No es necesario obligar a que exista una ganadora única.

Para dominancia, define direcciones, tolerancias, igualdad y manejo de métricas ausentes. No compares como cero un indicador desconocido. Usa desempate estable por contenido/identidad; no el orden de resultados concurrentes.

En una búsqueda limitada, denomina la frontera «no dominadas entre las evaluadas». Para escoger una propuesta como recomendación, conserva explicación de preferencias y requisitos satisfechos. Si no hay factibles, di eso sin recomendar automáticamente la menos mala.

## 21. Resultados reproducibles y obsolescencia

Un snapshot de búsqueda incluye identidad/revisión documental, datos relevantes de BASE, manifiesto técnico, criterios, solicitud, opciones permitidas, algoritmo/configuración y Build ID. Los hashes detectan cambios/integridad, no certificación ni autenticidad.

Mismo snapshot + mismo presupuesto de evaluaciones + misma política determinista debe producir mismos candidatos y ranking, independientemente del orden de arrays no semánticos. No ordenes curvas ni secuencias cuyo orden sí importe.

Un límite por tiempo puede producir un prefijo más corto según la máquina: registra candidatos completados y motivo de terminación; no prometas igualdad del conjunto parcial si dependió del tiempo de pared.

Si cambia BASE, catálogo fijado, criterio, solicitud, selección permitida o estado de revisión exigido por la política, marca resultados obsoletos. No permitas aplicar un preview a otro documento aunque tenga nombres parecidos. Cambiar de proyecto cancela o desvincula la sesión y limpia referencias visuales.

## 22. Responsividad, cancelación y memoria

La búsqueda debe ser local y operable. No congelar minutos el hilo principal ni montar el modelo 3D por cada alternativa.

Empieza con análisis puro y generación perezosa. Cede al event loop entre lotes para progreso/cancelación. Si el costo de una evaluación individual bloquea la UI de forma significativa, utiliza un Worker o frontera equivalente, probando igualdad de resultados y funcionamiento `file://`/CSP.

No añadas un Worker decorativo que siga calculando todo en el hilo principal. Si un cálculo síncrono no puede interrumpirse, muestra cancelación solicitada y termina de forma acotada en el siguiente punto seguro; no simules una cancelación instantánea.

Cancela o descarta callbacks de búsquedas anteriores mediante identidad/generación. No publiques un resultado tardío sobre una sesión nueva. Captura errores por candidato sin colgar toda la cola; repetidos errores estructurales deben detener el proceso con diagnóstico.

No mantengas miles de clones completos de Proyecto simultáneos. Guarda planes y resúmenes acotados; reconstruye/evalúa el detalle seleccionado desde el snapshot fijado. Un caché necesita claves de todas las dependencias y pruebas de invalidación; no es obligatorio crear una infraestructura global de caché.

## 23. Aplicar, deshacer y persistir

Una búsqueda y un preview no escriben el diseño. Aplicar requiere confirmación que enumere cambios efectivos, revisiones adoptadas, datos conservados y cualquier limitación de montaje.

Antes de aplicar, comprueba BASE y candidato; reconstruye/verifica el plan con los motores actuales. No confíes en un JSON de resultados que se autodeclare PASS. Usa la operación transaccional V8: guardar, confirmar identidad/revisión y publicar de forma coherente. Un fallo no deja un candidato visible como si estuviera guardado.

Cambios combinados de conductor/protección/vínculos/dependencias deben ser una operación coherente y una unidad de undo/redo. Conserva snapshots anteriores y datos congelados necesarios para deshacer; no hagas garbage collection prematuro de revisiones referenciadas.

Prueba fallo de persistencia, almacenamiento lleno simulado, montaje fallido después de escribir, doble clic, cancelación y cambio de proyecto durante la operación. Reutiliza la compensación V8 donde corresponda; no falsifiques un retroceso del historial.

Ejemplos readonly se inspeccionan pero no se mutan. Ofrece «Hacer una copia para trabajar» y confirma una copia real guardada antes de permitir aplicar. No borres el almacenamiento habitual del usuario en ninguna prueba.

Si la simulación está activa, define una política clara de pausa/confirmación para editar el diseño. No alteres equipos a mitad de scan ni persistas fuerzas/fallas/memoria térmica. La búsqueda sola nunca avanza el reloj ni cambia esa sesión.

## 24. Persistencia nueva y portabilidad

Persiste solo la intención/solicitud necesaria y decisiones aplicadas, con campos opcionales versionados y migración no destructiva. No guardar todos los resultados/corrientes/objetos de runtime como una segunda fuente de verdad.

Una sesión cancelada puede conservar un resumen en memoria. La recuperación tras cerrar el programa debe diferenciar solicitud guardada de resultados que requieren recalcular; no mostrar automáticamente un análisis viejo como vigente.

Amplía el export portable V8 para incluir las revisiones/curvas/tablas/factores/criterios realmente utilizados tras aplicar. Si exportas un informe o plan de decisión, márcalo como evidencia, no una autorización automática a mutar el proyecto receptor.

Reimportar un plan requiere validar schema, límites, referencias y nueva BASE; después reevaluar. Los proyectos V7/V8 sin intención V9 deben abrir y funcionar sin pasar por una migración manual.

## 25. Interfaz de Diseño asistido

Añade una entrada clara en Ingeniería y un acceso desde los issues compatibles: «Buscar alternativas» / «Diseño asistido». Reutiliza estilos, gestor de diálogos, foco e inspectores. No crear una segunda aplicación ni llenar la barra con botones de cada subfunción.

Flujo visible obligatorio:

1. Elegir circuito o llegar desde su issue.
2. Ver diagnóstico inicial, requisitos y datos faltantes.
3. Seleccionar conductores/protecciones modificables y opciones permitidas.
4. Confirmar restricciones, bloqueos, preferencias y límite de búsqueda.
5. Ejecutar con progreso real: generados, evaluados, descartados, pendientes.
6. Cancelar y entender el alcance del resultado parcial.
7. Comparar BASE con dos o más alternativas cuando existan.
8. Abrir evidencia y motivos de factibilidad/descarte/indeterminación.
9. Previsualizar y aplicar explícitamente una propuesta elegible.
10. Deshacer/rehacer, reabrir y exportar informe/proyecto.

Distingue «no hay opciones configuradas», «faltan datos», «no soportado», «búsqueda incompleta» y «ninguna alternativa del universo cumple». No usar una pantalla vacía para todos esos casos.

Incluye ayuda profesional breve: Ib, In, Iz, Icc, capacidad de corte, procedencia y alcance. No exige entender hashes para usar el flujo principal; el detalle técnico puede plegarse.

Conserva filtros/selección/foco al actualizar progreso. No reemplaces nodos editables continuamente. En pantallas estrechas, identificadores largos deben poder envolverse, copiarse o verse completos sin tapar acciones. No ocultes errores ni dependas solo de colores.

## 26. Presentación de propuestas y decisión

Tarjeta/fila de propuesta:

- Resumen de qué cambia y qué conserva.
- Estado de factibilidad y procedencia claramente separados.
- Métricas relevantes con unidades y deltas frente a BASE.
- Requisitos evaluados y pendientes.
- Razón de su posición en el orden elegido.
- Si es no dominada y en qué métricas compite.
- Alcance de búsqueda y advertencia sintética/no certificada cuando corresponda.
- Accesos a detalle, preview y aplicación permitida.

Mostrar «una sola alternativa encontrada» cuando solo haya una. No fabricar tres opciones por estética. Si BASE es factible y mínima intervención es la preferencia, «mantener diseño» es una respuesta correcta.

No rotular una opción «sobredimensionada» solo por tener mayor sección: expresa el intercambio medido (por ejemplo, más material y menos pérdidas) según los criterios elegidos.

## 27. Informes y evidencia de decisión

Amplía la documentación V7/V8; no recalcules nada desde el HTML/CSV.

Un informe V9 debe contener:

- Proyecto/revisión, fecha explícita del contexto y Build ID.
- Intención, alcance, bloqueos, criterios, datos/revisiones fijados y manifest/hash.
- Método de búsqueda, universo, presupuestos y terminación real.
- Alternativas evaluadas/resumen, factibilidad, ranking/frontera y razones.
- Comparación de métricas y obligaciones con BASE.
- Propuesta elegida, cambios exactos y estado «no aplicada/aplicada» con referencia documental real.
- Datos faltantes, restricciones no modeladas, limitaciones mecánicas y sintéticas.

HTML autocontenido e imprimible, JSON estructurado y CSV técnico cuando sea apropiado. Conserva BOM UTF-8, protección de fórmulas, escape, unidades y formato legible. No enlaces rutas privadas. No generar números de confianza ni certificación por tener hashes.

Fechas y selección forman parte del contexto reproducible. No introducir `Date.now()` oculto en cada render si rompe igualdad del mismo snapshot. Para evidencias de búsquedas grandes, exporta un resumen acotado y un manifiesto, no millones de clones del tablero.

## 28. Seguridad de planes, datos y trabajo del usuario

Reutiliza validadores V8 para catálogos/refs/unidades. Los planes V9 son datos no confiables si se importan: allowlist de tipos/campos/entidades y límites de tamaño, profundidad y número de candidatos/parches.

Rechaza prototype pollution, NaN/Infinity, rangos invertidos, refs/hash falsos, campos no autorizados y schemas futuros no soportados. No `eval`, `new Function`, scripts en perfiles ni expresiones arbitrarias de usuario.

Escapa textos de producto/criterio en UI e informes. No cargar URLs fuente automáticamente ni usar `javascript:`. No incorporar secretos o documentos privados al reporte, logs, artifacts o rama.

No hay ejecución sobre PLC/equipos físicos. Todo este encargo afecta el simulador y sus documentos, no instalaciones reales.

## 29. Laboratorio V9 y datos de prueba

Crea pocos fixtures sintéticos reutilizables, con nombres profesionales y documentación. No cientos de ejemplos repetidos.

Laboratorio principal sugerido: «Diseño asistido V9 — conductor y protección» con BASE que incumpla criterios declarados y opciones que incluyan una solución combinada, otra factible con un intercambio distinto y alternativas inviables. Los números finales deben derivarse del modelo implementado y de oráculos independientes; no copies cifras ilustrativas de conversaciones como resultados garantizados.

Laboratorios complementarios: datos incompletos/conflictos, límites/cancelación y protección compartida. Integra desde UI la importación/adición del pequeño catálogo sintético necesario. No dependas de descargar un catálogo comercial ni de una API externa.

Toda cifra sintética conserva su etiqueta en resultado e informe. Las pruebas demuestran decisiones del modelo, no selección apta para fabricación/instalación real.

## 30. Matriz obligatoria de regresiones

Demuestra estos contratos con la combinación adecuada de unitarios, integración y recorridos UI; no es necesario abrir un navegador para cada fila:

| Caso | Evidencia requerida |
|---|---|
| Proyecto V8 sin V9 | Apertura, simulación y validación conservadas |
| BASE ya cumple | Puede recomendar no cambiar, sin forzar mejoras |
| Cambiar sección | Resolver, fila de ampacidad, caída, pérdidas e Icc coherentes |
| Cambiar protección | Revisión completa, curva/calibre/capacidad y procedencia coherentes |
| Cambio combinado necesario | Genera y evalúa la combinación que cambios aislados no resuelven |
| Combinación con regresión | No asume que sumar dos mejoras individuales produce una mejora global |
| Iz30 ×0,94 ×0,80 | Oracle 22,56 A; Ib22/In25 sigue fallando coordinación |
| Mayor sección, Icc mayor | Detecta nueva insuficiencia de corte cuando el fixture la produce |
| In mayor | No «soluciona» la demanda sacrificando Iz o coordinación |
| Dato de 230 V en 400 V | No adopta capacidad inaplicable |
| Icu sin Icc / Icc sin Icu | Indeterminación con motivo correcto |
| Dos cargas 15+15 bajo In25 | No ignora demanda compartida |
| Carga desconocida compartida | No se convierte en cero |
| Motor y arranque requerido | Usa contrato existente; si falta modelo/datos no aprueba |
| Retorno/topología ambiguos | No inventa ensayo prospectivo ni jerarquía |
| Familia/polos/terminales incompatibles | Exclusión o limitación explícita, sin remapeo oculto |
| Override protegido | No borrado; opción bloqueada o efecto nulo explicado |
| Opción ignorada por resolver | No se presenta como cambio efectivo |
| Producto/curva/tabla de revisiones distintas | No genera combinación Frankenstein |
| Catálogo actualizado durante búsqueda | Snapshot permanece fijado; no latest |
| Datos sintéticos | No se convierten en verificados al ordenar/aplicar/exportar |
| Universo vacío o sin factibles | Mensaje y clasificación correctos |
| Presupuesto alcanzado/cancelación | Resultado parcial verdadero, no óptimo ni búsqueda completa |
| Reordenación no semántica | Mismos candidatos, métricas y ranking |
| Pareto y empates | Dominancia correcta, métricas ausentes no cuentan como cero |
| BASE cambia / proyecto cambia | Candidato obsoleto no aplicable |
| Plan/candidato manipulado | Validación y re-evaluación impiden aplicarlo ciegamente |
| Guardado/montaje fallan | Contenido coherente, compensación y estado visible correctos |
| Apply combinado y undo/redo | Una unidad coherente, revisiones técnicas recuperables |
| Export portable a perfil limpio | Mismos datos resueltos sin biblioteca global |
| Resultado de búsqueda antiguo | No reaparece como vigente tras abrir otro proyecto |
| Seguridad de import/HTML/CSV | Rechazo/escape y trabajo previo conservado |
| Ejecución sin red | V9 usable en HTML file:// |

No elimines casos difíciles para obtener verde. Si una condición es deliberadamente no modelada, el test demuestra el rechazo/indeterminación y el resto del alcance funcional debe quedar implementado.

## 31. Pruebas del algoritmo con oráculos independientes

Para universos pequeños, implementa en tests un enumerador de referencia sencillo e independiente del generador optimizado. Compara el conjunto completo de planes y la clasificación esperada con fixtures controlados.

Verifica ranking/Pareto con tablas numéricas construidas manualmente: factibles, inviables, empates, métricas ausentes y opciones dominadas. No calcules el esperado llamando a la misma función que se prueba.

Los tests de integración pueden reutilizar el solver real para verificar coherencia de capas, pero también necesitan casos aritméticos verificables de forma independiente. No afirmar que dos funciones que comparten el mismo bug validan una ley física.

Incluye propiedades metamórficas: reversión de arrays no semánticos, repetir búsqueda, importar idempotentemente, cancelar sin mutación, ampliar presupuesto preservando el prefijo determinista, congelar revisión y eliminar un candidato sin cambiar las métricas de los demás.

Prueba temporalmente errores controlados en fronteras críticas —omitir una restricción, tratar undefined como cero, borrar un override o aplicar un preview obsoleto— y demuestra que una regresión los detecta. Retira esos errores antes de commit. No es obligatorio instalar un framework de mutation testing.

Usa tolerancias declaradas y unidades normales; evita igualdad flotante arbitraria y tolerancias que vuelvan indistinguibles propuestas diferentes.

## 32. Rendimiento dirigido de búsqueda

Mide por separado preparación del snapshot, generación, resolución, evaluación, ranking, serialización y render de resultados. Número de checks no mide rendimiento.

Prueba universos pequeños exhaustivos, conjuntos intermedios y universos grandes con presupuesto. Incluye un catálogo sintético de hasta 10.000 productos para medir filtros/índices, pero no ejecutes necesariamente 10.000 simulaciones completas: muestra el límite elegido y el universo real.

Usa cientos de vínculos cuando sea representativo y al menos una búsqueda con múltiples entidades modificables. Mide crecimiento de memoria/tamaño del resultado, no solo tiempo total. Registra p50/p95 solo si hay muestras suficientes.

Evita complejidades accidentales como buscar toda la biblioteca por cada borne de cada candidato. Índices por ID/revisión/hash y snapshots compartidos son preferibles a clones y búsquedas repetidas. No refactorizar todo el grafo por anticipación.

Responsividad/cancelación son criterios de producto. Define sus presupuestos tras medir el mismo entorno y deja claro qué configuración se probó. No prometer SLA universal ni «optimización instantánea».

## 33. QA en capas para no repetir la noche de V8

Organiza desde el inicio:

1. Core/headless: generación, evaluadores, ranking, contratos y fallos de persistencia sin costo de render.
2. UI focal: pocos recorridos completos representativos con controles visibles.
3. Visual/offline: captura de resultados/informe y smoke del archivo distribuido.

Un agregado `qa:diseno-asistido` puede incluir subsuites de búsqueda, aplicación/persistencia e informes/offline según el flujo real. No convertirlo en una única sesión gigante; tampoco repetir en cada subsuite montajes costosos innecesarios.

Los fixtures pueden prepararse programáticamente para una prueba unitaria. En aceptación de usuario, el escenario principal debe demostrar abrir, seleccionar, comparar, confirmar, descargar y reabrir desde UI. Hooks de observación no deben aplicar la propuesta por debajo del botón que se pretende probar.

Para copia y guardado espera identidad/estado confirmado, no 500 ms ni un toast que puede haber desaparecido. Para descarga instala el listener antes del click y valida los bytes. Mantén logs con fase, candidato/check, tiempo y estado; no mensajes repetidos sin avance.

Distingue timeout individual, presupuesto total de suite y supervisor del proceso. El supervisor debe permitir cleanup y conservar evidencia. El job de CI debe contemplar preparación y subsuites. Preserva los presupuestos finales V8 12/12/18 minutos y su supervisión 14/14/20 salvo justificación medida; no extrapoles esos números automáticamente a V9.

Ante timeout, lee causa y progreso. Ajustar un presupuesto total tras medir no es lo mismo que aflojar una aserción; tampoco demuestra rendimiento resuelto. Sin retries infinitos, sleeps arbitrarios, force-clicks generales ni `continue-on-error`.

Cierra solo browser/servidor/workers/temporales propios. Conserva traces/screenshots pertinentes antes de cleanup. No mates procesos ajenos ni mantengas dos escenas activas solo para capturar una tabla.

## 34. Gates de implementación y aceptación

Completa en este orden, con incrementos pequeños cuando convenga:

| Gate | Resultado comprobable |
|---|---|
| A0 | Baseline, mapa real y contratos operativos para snapshot/aplicación/QA |
| A | Solicitud, alcance, bloqueos, obligaciones y snapshot fijo |
| B | Opciones/revisiones elegibles, planes tipados y proyección V7/V8 coherente |
| C | Generador determinista combinado, presupuestos, deduplicación y estados de búsqueda |
| D | Evaluación común, conjunto afectado, factibilidad y métricas con procedencia |
| E | Ranking explicable, Pareto y razones de descarte/indeterminación |
| F | Motor de ejecución responsivo, cancelación y obsolescencia |
| G | UI completa integrada con circuitos/issues/datos técnicos |
| H | Aplicación transaccional, undo/redo, persistencia y portabilidad |
| I | Informes de decisión, laboratorio, ayuda y aceptación visible |
| J | Revisión adversarial, oráculos, seguridad y rendimiento dirigido |
| K | Campaña integrada, HTML offline, CI, publicación y tag V9 |

Después de B/D integra temprano un recorrido mínimo visible y luego complétalo. No dejes todos los riesgos de UI/persistencia para el final. Antes de K cierra las revisiones que puedan modificar contratos centrales; no iniciar una auditoría global nueva mientras esperamos publicar.

Un gate verde tiene pruebas terminales relevantes y diff coherente. Si cambias luego su frontera, marca la evidencia afectada como pendiente. No declarar un gate terminado solo por contar archivos.

## 35. Toolchain y disciplina de pruebas

Usa npm y `package-lock.json`. V8 utilizó Node 24.19.0 y Playwright fijado; confirma la configuración real. No fuerces cambios de versiones ni recrees `pnpm-lock.yaml`/`pnpm-workspace.yaml`. Si falta npm en PATH, localiza su CLI canónico, documentando el comando real.

No ejecutes `npm audit fix` ni actualizaciones masivas. Evalúa las dependencias nuevas de V9; corrige problemas introducidos o directamente relevantes mediante cambios controlados. Mantén documentados los avisos heredados.

Durante desarrollo ejecuta focales y typechecks del módulo afectado. Build identificada antes de navegador. No reconstruyas en una carpeta mientras otra suite está utilizando esa misma build; usa entradas `:run` existentes cuando equivalgan al comando agregado y registra qué probaste.

No se fija como objetivo inflar el contador >1385. Conserva cobertura, explica tests modificados/retirados y añade regresiones útiles. Suites saltadas, fallidas o sin exit code no son verdes.

## 36. Campaña final integrada

Al estabilizar el candidato y su documentación:

- Instalación reproducible y `npm test` / build QA.
- QA Diseño asistido V9 completa.
- QA Datos técnicos V8 e Ingeniería V7.
- QA equipos V6, física, simulación y automatización PLC.
- Gate histórico, fusión, fixture de puerta, multiproyecto y componentes personalizados.
- Empaquetado, `entrega:check` y `qa:empaquetado` con smoke V9.

Usa los nombres reales de scripts del repositorio. Las suites locales pesadas son secuenciales salvo medición que justifique otra organización. Los jobs alojados separados no comparten necesariamente máquina; no atribuirles contención por estar activos a la vez.

Mantén una matriz de impacto. Un cambio solo de captura no obliga a repetir todas las ecuaciones localmente; un cambio del resolver sí invalida evidencia relevante. El candidato definitivo debe pasar su campaña remota de instalación limpia. No mezcles SHAs para afirmar que un run fue íntegramente verde.

Si una suite falla, conserva evidencia y corrige causa. Un reintento acotado es diagnóstico, no estrategia de cierre por suerte. El alcance no crece con cada nuevo warning: solo bloqueantes de esta entrega se corrigen ahora.

## 37. Entrega HTML y revisión visual

Genera mediante el flujo existente:

- `dist-final/TableroStudio.html`.
- `desktop/app.html`.

Deben ser idénticos byte a byte. Build ID V9 nuevo calculado por herramientas, no por editar texto. Revisa fuente y blob de Git cuando la normalización de finales de línea sea relevante. No regenerar bytes por un cambio exclusivamente QA si el flujo no lo exige.

V9 funciona por `file://` sin servidor/API obligatoria. Su smoke compacto debe demostrar: abrir copia del laboratorio, configurar/buscar opciones, ver una propuesta/evidencia, preview sin mutación, aplicación confirmada, reapertura y documento/portable. Conserva recorridos V2–V8 sin copiar toda la QA V9 al smoke.

Si se usa Worker/Blob, validar CSP y ejecución desde el HTML distribuido. No ampliar CSP indiscriminadamente ni desactivar seguridad para lograrlo.

Inspecciona pantallas reales ancha/estrecha e informe imprimible. Si generas PDF para revisar A4, usa herramientas disponibles y mira páginas renderizadas. Estilos computados no acreditan inspección visual. No afirmar ejecución humana de Excel o aceptación de Diego si solo hiciste automatización.

Revisa el caso de identificadores largos de V8 al tocar las nuevas vistas. Una mejora local es apropiada; un rediseño global no.

## 38. CI y publicación sin cadena infinita de cierres

Antes de publicar el candidato, verifica que el workflow ejecute QA V9 además de los checks V8 anteriores, con triggers adecuados para la rama/PR. No borrar controles existentes ni cambiar permisos/protecciones para conseguir un verde.

Prepara los documentos descriptivos ANTES del commit candidato. No fabriques commits adicionales solo para escribir dentro del repositorio el resultado del SHA que acaba de pasar. La evidencia terminal puede vivir en anotación del tag/manifiesto de publicación vinculado al commit.

Sube normalmente la rama y valida el candidato. Si pasa, integra según el flujo permitido. Fast-forward al mismo commit cuando sea posible; si se crea merge commit, verifica su SHA real. No supongas que aprobar la rama equivale a checks ya terminados en main.

Si main dispara otra campaña, espera sus estados terminales sin nuevos cambios para «rellenar el tiempo». Usa watcher/log durable y notifica cambios reales, no sondeos cada pocos segundos. Una pausa del agente no debe perder el ID de run, intento, jobs y próxima acción.

Con main final verde, verifica Pages, artifact de ese SHA y HTML extraído: tamaño, Build ID y SHA-256. Diferencia hash de ZIP y hash de HTML. Verifica también la descarga pública fijada al commit/tag. No depender del artifact con expiración como único respaldo.

Crea `tablerostudio-v9` anotado solo después de aprobar entrega. Si ya existe, no moverlo; verificarlo y reportar conflicto si apunta a otra entrega. Conserva tags V7/V8. No iniciar una release comercial ni declarar 1.0.

La anotación/registro de cierre incluye SHA, run/intento, resultados, Pages, Build ID, hash del HTML, artifact y limitaciones. No requiere una nueva auditoría ni otra ronda de commits de producto.

## 39. Informe final que debe recibir Diego

Comienza con una explicación de uso, no con cientos de líneas de Git. Entrega:

1. Qué hace ahora V9 y dónde abrir Diseño asistido.
2. Nombres reales de laboratorio, controles y recorrido de aceptación.
3. Ejemplo real calculado de BASE y alternativas, con criterios y procedencia.
4. Cómo se eligieron/rechazaron opciones y qué significa búsqueda limitada.
5. Qué cambia al aplicar, cómo deshacer y cómo compartir el proyecto.
6. Matriz alcance → implementación → prueba → estado, sin pendientes obligatorios ocultos.
7. Decisiones de reutilización, correcciones, restricciones no modeladas y backlog separado.
8. Resultados locales/remotos verdaderos, duraciones por fase y diferencias de entorno.
9. Baseline, rama/commits, SHA final, tag, CI del SHA, Pages, artifact, Build ID, bytes/hash.
10. Estado Git final y enlaces de entrega permanentes dentro del flujo autorizado.

Crea `docs/HANDOFF_V9.md` y manual V9 enlazados sin borrar V8. Documenta cómo repetir búsqueda y pruebas sin depender del chat. No afirmes que se realizó una aceptación humana que no ocurrió.

## 40. Condiciones finales de aceptación

V9 NO está terminada si solo existen clases/tests y faltan botones; si solo funciona un fixture hardcodeado; si todas las opciones acaban indeterminadas por una integración pendiente; o si BASE puede mutar al comparar.

V9 SÍ está terminada cuando:

- El usuario configura una búsqueda de conductor/protección sobre un circuito existente.
- Hay casos completos que encuentran soluciones combinadas y casos que explican honestamente por qué no las hay.
- Los resultados usan datos efectivos/revisiones fijas y todas las obligaciones del alcance.
- La preferencia/ranking es explicable, reproducible y no disfraza desconocidos.
- Preview, apply, undo/redo, guardado y portable preservan el trabajo.
- Interfaz y documentación son operables sin JSON ni APIs externas.
- La campaña final acredita el código/HTML realmente publicado, con sus limitaciones.
- Los tags anteriores permanecen intactos y `tablerostudio-v9` fija la nueva referencia.

No más features después de ese punto. No V10.

## 41. Primera acción

Lee el documento completo por segmentos si hace falta. Recupera/crea la rama adecuada, verifica el baseline, lee el handoff V8 y localiza los contratos reales. Registra el plan durable, ejecuta A0 y comienza la primera implementación autorizada. Continúa hasta cerrar todos los gates o hasta un bloqueo real que requiera intervención, preservando checkpoints.

La prioridad es: corrección de las propuestas y conservación del trabajo → evidencia y límites honestos → operabilidad → arquitectura y rendimiento medido → acabado visual. No fabricar datos, certeza, normativa ni una solución óptima que la búsqueda no demostró.


