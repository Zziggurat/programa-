# Simulación PLC V4

## Contrato temporal

La red eléctrica y el PLC tienen relojes distintos. Una llamada de simulación sigue este orden:

```text
salidas PLC publicadas anteriormente
        ↓
convergencia eléctrica a punto fijo
        ↓
imagen DI/AI congelada de todos los PLC
        ↓
scan de cada PLC (mismo instante e imágenes)
        ↓
publicación atómica DO/AO de todos los PLC
        ↓
nueva convergencia eléctrica, sin volver a ejecutar el scan
```

El número de pasadas que necesita un contactor para estabilizarse no altera TON, contadores,
flancos ni secuencias. Dos PLC tampoco pueden ver la salida recién calculada del otro hasta el
scan siguiente. Los dispositivos se ordenan de forma estable y se publican juntos, por lo que
invertir arrays no cambia el resultado.

El scheduler usa el reloj de simulación, no FPS. Respeta `periodoScanMs`, admite pausa y un scan
único, y limita el *catch-up* tras una suspensión larga. El watchdog limita instrucciones y
operaciones por scan; una infracción lleva a `FAULT` y salidas seguras.

## Persistente frente a runtime

Dentro del proyecto se guardan únicamente `programaPLC`: versión, lenguaje, fuente, periodo de
scan, modo inicial, etiquetas E/S, valores seguros opcionales y límites. El cargador aplica una
lista blanca y valida esos campos. Una DO usa `false` y una AO usa el mínimo normalizado (0 %) si
no se declara `seguro`; STOP, FAULT y pérdida de alimentación publican esos valores.

Pertenecen exclusivamente a la sesión de Energizar:

- estado `SIN_ALIMENTACION`, `STOP`, `RUN` o `FAULT`;
- imágenes de proceso, variables no persistentes y memoria de flancos;
- acumulados de TON/TOF/TP y CTU/CTD;
- paso de secuencias, PID, alarmas, interlocks y log de eventos;
- fuerzas DI/DO/AI/AO, pausa y órdenes de un solo scan.

`RETAIN` sobrevive a una pérdida de alimentación dentro de la sesión. Reiniciar el runtime o
volver a abrir la aplicación lo limpia: V4 todavía no modela memoria no volátil de hardware.

## Lenguaje e IR segura

`plc-compilador.ts` tokeniza y comprueba tipos antes de ejecutar. No usa `eval`, `Function` ni
código dinámico. El programa solo puede leer etiquetas declaradas/terminales del perfil y escribir
salidas o variables válidas. Una etiqueta desconocida, tipo incompatible o doble escritura deja
el programa inválido completo; no se ejecuta un fragmento aparentemente sano.

Resumen del DSL:

```text
VAR BOOL|REAL nombre [= valor] [RETAIN]
salida_o_variable := expresión
SET memoria WHEN condición
RESET memoria WHEN condición
TON|TOF|TP bloque IN condición PT 2s
CTU bloque CU condición RESET condición PV 10
CTD bloque CD condición LOAD condición PV 10
SEQUENCE proceso INITIAL paso
TRANS proceso origen -> destino WHEN condición PRIORITY 100
ALARM id WHEN condición SEVERITY INFO|WARNING|TRIP [LATCHED] MESSAGE "texto"
INTERLOCK salida REQUIRE condición MESSAGE "texto"
PID id PV pv SP sp OUT cv KP 2 TI 8 TD 0 MIN 0 MAX 100 [AUTO condición] [MANUAL valor] [BAD SAFE|HOLD]
```

Las expresiones distinguen `BOOL` y `REAL`, permiten `AND/OR/NOT` (y sus alias en castellano),
comparaciones, aritmética, `MIN`, `MAX`, `CLAMP`, `VALID`, `BAD`, `RISING` y `FALLING`.
SET/RESET tiene dominancia de RESET. Una secuencia toma como máximo una transición por scan y usa
la prioridad explícita para resolver condiciones simultáneas.

Los proyectos antiguos con `programa` se adaptan al runtime nuevo. Conservan su sintaxis y sus
dependencias históricas, pero ya no avanzan repetidamente con el punto fijo eléctrico.

## Imágenes, fuerzas y diagnóstico

DI/AI se capturan juntas antes del scan; DO/AO se publican al terminar. Una fuerza se aplica a la
imagen correspondiente y queda rotulada como `FORZADA`; nunca se escribe en el proyecto ni se
confunde con el valor cableado. Una AO forzada conserva calidad normal pero publica origen
`INYECTADO`. El panel de Energizar ofrece RUN/STOP, pausa, scan único, reset, una watch table de
tags tipados, fuerzas, variables, timers, counters, secuencia, PID, interlocks, diagnósticos,
alarmas y un log acotado a 200 eventos.

Las alarmas enclavadas separan condición, ACK y reset. ACK no elimina una condición presente y el
reset no arranca una secuencia. Los interlocks inhiben la DO y publican el permisivo faltante.

## PID V1 y fidelidad

El bloque PID es discreto y determinista, con P/I/D, *sample time* del scan, límites,
anti-*windup*, manual/automático y política explícita ante PV inválida. La cadena 4–20 mA → AI
escalada → PID → AO 0–10 V → actuador sí está modelada. El retorno MANUAL → AUTO queda acotado,
pero V4 no garantiza transferencia *bumpless* certificada. No existe todavía una planta
hidráulica que realimente el nivel.

Clasificación honesta:

- **CALCULADO:** lógica booleana, aritmética, imágenes E/S, prioridades, estados y escalado de una
  señal cuya configuración está declarada.
- **ESTIMADO:** duración visual/mecánica simplificada de actuadores y cualquier dinámica heredada
  que no provenga de datos certificados.
- **INYECTADO PARA SIMULACIÓN:** fuerzas, valor manual de sondas y fallos elegidos por el usuario.
- **NO MODELADO:** IEC 61131-3 completo, tareas múltiples, interrupciones, módulos remotos,
  comunicaciones, redundancia, memoria no volátil de PLC y física del proceso para sintonizar PID.

## Fixtures y pruebas

`fixtureAutomatizacionSecuencialV4` cablea una fuente de 24 V, PLC, START/STOP/RESET, niveles,
válvulas, agitador y pilotos de marcha/completo/fallo. Demuestra IDLE → LLENANDO → MEZCLANDO →
VACIANDO → COMPLETO, TON de 5 s, CTU de lotes, STOP prioritario, fallo por sensores
contradictorios, alarmas enclavadas, interlocks y que las cargas reaccionan a DO físicas, no a ids.

`fixturePIDV4` cablea un transmisor 4–20 mA, AI, PID V1, AO 0–10 V y válvula modulante. Prueba
calidad, salida segura y consumo físico de la AO sin atribuir al tanque una dinámica inexistente.

Los tests rápidos cubren el compilador y el runtime. `npm run qa:automatizacion` comprueba el
vertical slice mediante controles visibles y queda deliberadamente fuera del gate histórico hasta
acumular estabilidad en CI.
