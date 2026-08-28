# Física eléctrica V5

V5 añade una capa cuantitativa sobre el motor funcional existente. V2/V3/V4 siguen decidiendo
estados, contactos, mandos, PLC, señales y fallos; V5 deriva la topología conductiva que queda
cerrada y resuelve sus magnitudes. La interfaz consume `ResultadoSimulacion.fisica`: no recalcula
fórmulas ni mantiene una segunda verdad.

## Contrato y procedencia

La configuración persistente vive en `Dispositivo.fisica` y `Conductor.fisica`. Tensión,
corriente, Icc, pérdidas, resultados del solver y fallos inyectados son runtime y nunca se guardan.
Los proyectos V4, sin campos V5, abren sin migración destructiva y no invocan el solver físico.

Cada dato relevante usa una de estas procedencias:

- `CALCULADO`: sale de datos suficientes y del solver.
- `CONFIGURADO`: fue declarado por el proyecto.
- `ESTIMADO`: usa un modelo de ingeniería documentado.
- `INYECTADO`: pertenece a un ensayo de esta sesión.
- `NO_MODELADO`: faltan datos o esa capacidad no existe.

Las unidades internas son SI: V, A, Ω, W, var, VA, Hz y m. La sección se presenta en mm² y se
convierte explícitamente a m². Las tolerancias del solver, tests y visualización están centralizadas.

## Arquitectura

`src/fisica/complejos.ts` concentra complejos/fasores. `algebra.ts` resuelve sistemas complejos con
pivoteo y errores tipados. `solver.ts` implementa análisis nodal estable, fuentes ideales o Norton,
cargas Z/I/PQ, damping y límites de iteración. `topologia-proyecto.ts` adapta el proyecto y los
contactos funcionales al grafo físico. `fallas.ts` aplica fallos topológicos y obtiene Thevenin/Icc.
`protecciones.ts` concentra curvas, ventanas e interpretación de selectividad. `analogicas.ts`
calcula carga física de 4–20 mA y 0–10 V.

El orden temporal es:

1. resolver el estado funcional y los contactos;
2. construir la topología física derivada;
3. iterar el solver sin avanzar tiempo;
4. avanzar memoria térmica/I²t una sola vez por Δt;
5. si una protección abre, volver a resolver en el mismo instante sin acumular otro Δt.

Las islas sin referencia se excluyen de la matriz activa y se publican `SIN_REFERENCIA`; no
destruyen el resultado de una isla sana ni aparecen como 0 V. Fuentes ideales incompatibles y
fuentes paralelas no modeladas producen diagnósticos tipados.

## Conductores y potencia

Para cobre, aluminio o un material personalizado:

`R20 = rho20 × L / A`

`R(T) = R20 × [1 + alpha × (T − 20)]`

En AC, `Z = R + jX`; X solo se incorpora si se declara. La longitud puede provenir de una ruta 3D
fiable, una longitud manual o una estimación, siempre con procedencia. El resultado por conductor
incluye I, ΔV, ΔV %, pérdidas `I²R`, material, sección y temperatura.

El solver publica V nodal; I de ramas; P/Q/S/PF de cargas y fuentes; pérdidas; residuo KCL y error
de balance `Pfuente − Pcargas − Ppérdidas`. La fuente trifásica interpreta el valor configurado como
tensión línea-línea y usa `Vfase = Vlínea / √3`, con fases 0°, −120° y +120°. Una carga trifásica por
`fases` es explícitamente balanceada y usa una estrella interna flotante; el neutral se obtiene solo
cuando la topología aporta un camino.

El transformador V5 básico representa un secundario monofásico aislado con relación y una Z
equivalente derivada de potencia, impedancia porcentual y X/R. Es un equivalente desacoplado:
todavía no refleja la carga al primario.

## Fallas, protección y selectividad

Los ensayos V5 admiten L-N, L-L, L-PE, trifásico simétrico aproximado por fase, conductor abierto y
resistencia anormal. La falla franca usa 1 mΩ para evitar singularidad numérica; puede configurarse
otra Zf. Icc se obtiene como `Vprefalla / (Zth + Zf)`. Sin impedancia de fuente, Icc queda
`NO_MODELADO`: nunca se inventa una cifra exacta.

Un camino PE solo existe si está declarado. `fuente.referenciaPe` representa una unión local de la
referencia con el borne PE de esa fuente, separada de los puentes funcionales del tablero; no crea
una tierra perfecta universal ni afirma modelar TN-S, TT o IT.

Conductor abierto y terminal flojo modifican la misma red resuelta. Un cortocircuito entrega la
corriente prospectiva a la protección; un disparo instantáneo abre la topología y la red posterior
queda sin corriente. El runtime conserva el cálculo prospectivo del evento como `DESPEJADA` para
explicar qué provocó la apertura.

Las curvas B/C/D/K/Z/gG/aM incluidas son modelos genéricos de ingeniería. La interpolación es
logarítmica y publica banda `tMin..tMax`; no promete un instante exacto. La coordinación se clasifica
`SELECTIVA`, `PARCIAL`, `NO_SELECTIVA` o `INDETERMINADA` según solape de bandas, siempre “según el
modelo V5”, nunca como certificación de fabricante.

El diferencial conserva su actuación V2 por fuga inyectada. V5 puede publicar la suma fasorial de
corrientes de polos cuando la topología aporta información, pero todavía no sustituye el ensayo
inyectado por un disparo residual calculado.

## Instrumentación física

El lazo 4–20 mA añade resistencia de ida/vuelta, burden, caída, tensión disponible y compliance. Si
no queda tensión suficiente para sostener la corriente demandada, la corriente se limita y la
calidad pasa a `COMPLIANCE_INSUFICIENTE`; 4 mA sigue siendo live zero cuando es viable. En 0–10 V se
modelan resistencia de salida, cable y carga de entrada, con `CARGA_EXCESIVA` si el error supera el
criterio del modelo. No se modelan electrónica interna, ruido ni HART.

## Interfaz y fixtures

En Energizar, “Magnitudes físicas V5” muestra resumen/balance, conductores, bornes, cargas,
protecciones, fallas, coordinación, lazos y diagnósticos. Los valores de longitud/sección que se
editan allí son **ajustes de ensayo runtime** y no cambian el diseño ni un ejemplo de solo lectura.
Los botones de corto, conductor abierto y terminal flojo usan esa misma vía pública de ensayo.

Fixtures versionados:

- `Fixture V5 — caída de tensión`: 230 V, Q1, tres tramos Cu de 20 m y 23 Ω.
- `Fixture V5 — motor trifásico`: 400 V, Q1, KM1, selector y carga motor balanceada.
- `Fixture V5 — cortocircuito y selectividad`: Q1/Q2 en serie, Z de fuente/cable y punto L-N/L-PE.
- El fixture V3 de temperatura se reutiliza con cable, burden y compliance físicos.

## Rendimiento

La topología V5 se reconstruye al resolver porque el estado de contactos y fallos puede cambiar en
cada paso. Todavía no hay caché de matriz: se prioriza corrección y no existen dirty flags fiables
para todas las mutaciones legacy. El resultado expone tiempo, nodos, ramas e iteraciones. El stress
focal versionado usa 81 nodos, 237 ramas y varias cargas; una frontera serializable para Worker solo
se justificará si mediciones reales muestran bloqueo de UI.

## Límites explícitos / NO MODELADO

- SPICE completo y transitorios EMT;
- armónicos, THD, skin/proximity effect profundo y PWM de VFD;
- arcos, arc flash, offset DC y pico electrodinámico de cortocircuito;
- saturación, inrush, ferroresonancia y grupos vectoriales completos de transformador;
- modelo térmico completo del cable y ampacidad normativa;
- sistemas TN/TT/IT externos completos: solo se resuelven N, PE y enlaces declarados;
- curvas, coordinación, cascading/back-up o selectividad certificada de fabricante;
- motor dq/FEM, FEM mecánico, torque e interacción electromagnética detallada;
- semiconductores y conmutación electrónica;
- paralelo complejo de fuentes incompatibles;
- caché/Worker del solver hasta disponer de evidencia de rendimiento.

Nada de lo anterior se infiere de una marca, imagen o texto visible. Un componente personalizado con
el mismo perfil físico usa exactamente el mismo PhysicsEngine.
