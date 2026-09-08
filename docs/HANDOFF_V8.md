# TableroStudio V8 — datos técnicos y criterios de ingeniería

## Estado de entrega

La campaña de cierre está en curso. No considerar este documento como aprobación del
artefacto hasta que [ESTADO](v8/ESTADO.md) y [VALIDACION](v8/VALIDACION.md) registren el
SHA final, checks terminales, Build ID, hashes de HTML y tag. Main conserva V7 mientras tanto.

Historia preservada: [handoff pre-Astra](HANDOFF_ASTRA.md).
Encargo íntegro: [ENCARGO](v8/ENCARGO.md); decisiones: [DECISIONES](v8/DECISIONES.md).

## Qué aporta V8

Datos técnicos independientes de la apariencia del componente y de su perfil funcional.
Una biblioteca global almacena revisiones inmutables; cada proyecto fija referencias exactas
y un subconjunto técnico compartido. El resolver produce una proyección común para física,
simulación, ingeniería e informes. No se consultan revisiones «latest» durante el cálculo.

El usuario trabaja desde **Datos técnicos**: consulta, borradores, publicación, vínculo,
decisiones de campo, instalación/ampacidad, criterios, faltantes, Icc prospectiva,
comparación, adopción confirmada, importación y exportación. El
[recorrido de uso](v8/USO.md) contiene los nombres exactos de controles y laboratorio.

## Archivos para continuar

- `src/datos-tecnicos/tipos.ts` → contratos versionados de productos, curvas, tablas y criterios.
- `src/datos-tecnicos/campos.ts` → registro cerrado de magnitudes/unidades y familias.
- `src/datos-tecnicos/schema.ts` → validación estructural, límites y semántica de datos.
- `src/datos-tecnicos/hash.ts` → canonicalización, integridad, dependencias y frozen mínimo.
- `src/datos-tecnicos/resolver.ts` → precedencia, condiciones, conflictos y proyección efectiva.
- `src/datos-tecnicos/operaciones.ts` → candidatos puros, preview, stale y adopción explícita.
- `src/datos-tecnicos/repositorio.ts` → revisiones/borradores y evidencia humana local.
- `src/datos-tecnicos/ampacidad.ts`, `curvas.ts`, `criterios.ts` → cálculos condicionados.
- `src/ingenieria/engine.ts` → integración en el motor de ingeniería existente.
- `src/ingenieria/{protecciones,conductores,compatibilidad,validacion,datos-tecnicos}.ts`
  → reglas, dependencias y mismo Issue Center.
- `src/ingenieria/prospectiva.ts` → ensayo aislado sobre el modelo físico existente.
- `src/ingenieria/contexto-proteccion.ts` → contexto nominal conectado para no usar capacidad
  de corte declarada bajo otra tensión, sistema o número de polos.
- `src/fisica/evidencia-disparo.ts` → evidencia del mismo ensayo despejado entre ticks,
  separada de la corriente actual; desaparece al retirar o cambiar el fallo.
- `src/ingenieria/documentacion.ts` → informe V7 ampliado, HTML/JSON/CSV trazables.
- `app/ui-datos-tecnicos.ts` → interfaz y coordinación de operaciones visibles.
- `app/gestor-documentos.ts` → identidad de candidato, persistencia y compensación.
- `app/main.ts` → conexión puntual de candidato al historial/montaje, sin refactor general.
- `app/ui-simulacion.ts` → snapshot técnico compartido entre ticks, invalidado por edición.
- `ejemplo/datos-tecnicos-v8.ts` → pequeño laboratorio sintético versionado.
- `qa/datos-tecnicos-*.mjs` → autoría, ingeniería y portabilidad/imports por UI.
- `qa/lib/datos-tecnicos-offline.mjs` → recorrido V8 en el HTML entregado sin hooks QA.

## Contratos que no deben romperse

1. Imagen, marca o texto visible no deciden comportamiento ni certificación.
2. Dato ausente no se convierte en cero, factor uno ni valor legacy recuperado silenciosamente.
3. Icc y Icn/Icu/Ics se resuelven de forma independiente; usa la magnitud elegida por criterio.
4. No extrapolar tablas/curvas fuera de dominio ni elegir el mayor candidato ambiguo.
5. Actualizar biblioteca no modifica proyectos; aplicar requiere candidato ligado a BASE.
6. Un preview nunca muta diseño; fallo de almacenamiento/stale conserva contenido.
7. Overrides sobreviven revisiones y solo se eliminan explícitamente.
8. Portables incluyen dependencias congeladas mínimas, no requieren biblioteca global.
9. Fuente sintética permanece sintética; hash no autentica y revisión humana no viaja como firma.
10. Mantener npm/package-lock, Playwright fijado y entrega reproducible con CSP cerrada.

## Validación y riesgos

[Matriz requisito → prueba](v8/MATRIZ.md), [seguridad](v8/SEGURIDAD.md) y evidencia
terminal en [VALIDACION](v8/VALIDACION.md). Los logs externos conservan rojos/reintentos;
no contar una suite que quedó ejecutándose como un pase.

Los límites físicos se muestran en el producto: fuente con distintas tensiones nominales,
impedancia AI por canal cuando el modelo solo tiene una común, escenarios prospectivos
no soportados y parámetros escalares no deducibles de un intervalo. No añadir un segundo
motor para ocultar una falta de contrato. Una rama técnica pendiente se marca NO_MODELADO.

## Backlog sin iniciar

Actualización controlada de PostCSS/Nano ID del toolchain; granularidad eléctrica por salida
de fuentes y por AI de PLC si se amplía ese contrato; datasets documentales verificados por
el usuario con derecho de uso. No hay catálogo comercial certificado incluido.
Actualizar wrappers de Actions deprecados en un cambio de toolchain probado. La demanda
compartida multifase sin reparto inequívoco permanece indeterminada, no se suma como DC.
No se inició V9, SPICE, selectividad certificada, router industrial, DRC geométrico nuevo
ni optimización global del render.
