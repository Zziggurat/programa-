# Decisiones V8

## D01 — Fuentes de verdad

El proyecto guarda decisiones/vínculos exactos y un subconjunto técnico congelado compartido.
Los catálogos globales almacenan revisiones inmutables; nunca se usa latest para evaluar.
El runtime y los resultados no entran en el documento técnico.

## D02 — Integración incremental

Resolver y proyección pura hacia los contratos existentes. No duplicar PhysicsEngine ni las reglas
de Ingeniería. Un proyecto sin V8 debe continuar por el recorrido legacy conservado.

## D03 — Datos de ensayo

Datasets sintéticos explícitos; hash prueba integridad, no autenticidad. El estado humano/documental
es independiente de lo declarado en un import. Sin descarga automática de fuentes documentales.

## D04 — Flujo Git

Rama V8 desde baseline; commits semánticos. Integración convencional autorizada al terminar,
con preflight de main remoto y checks. Nunca mover tag V7 ni usar force.

## D05 — No inventar granularidad física

Una fuente con salidas nominales distintas no puede recibir un único cambio de tensión
común sin identificar salida. Tampoco puede proyectarse burden de una AI sobre el parámetro
físico común de un PLC con varias AI. Ambos casos son CONFLICT explícito, con original
conservado y adopción rechazada; no se cambian contratos V5–V7 para simular soporte inexistente.
Regresiones metamórficas de orden y preservación verifican ambos límites.

## D06 — Condición declarada y contexto conectado

Resolver una ficha para el contexto declarado no acredita por sí solo su uso en otra red.
La validación de capacidad contrasta V/AC-DC/Hz/polos con la conectividad del snapshot físico
y el nominal explícito de su fuente. No usa tensión deprimida bajo carga/falla. Distingue
una fase respecto a referencia de varios conductores de fase mediante sus ángulos; no
equipara por redondeo un nominal 400/√3 con una ficha escalar230. Contexto ausente/ambiguo
no se sustituye por el texto del vínculo. Temperatura/ajuste no observables siguen declarados.

## D07 — Ausencia analógica y protección compartida

Rango/modo/unidad obligatorios ausentes retiran solo el transmisor/AI de la proyección,
no sus terminales ni el diseño. El PLC no recupera la señal mediante el adaptador legacy.
Otros canales válidos continúan operando. NO_MODELADO no equivale a señal cero.

Una protección común en una única fase/DC agrega las cargas únicas de sus circuitos,
sin contar repetidamente el mismo aparato. Reparto trifásico compartido o fuente ambigua
requieren una agregación por fase demostrada: mientras no exista se devuelve indeterminado,
no se suman fases indiscriminadamente ni se acredita cada ramal como si fuera la demanda total.

## D08 — Evidencia de un disparo, no corriente ficticia

Se conserva el análisis del evento despejado en ResultadoFisicaElectrica mientras ese
ensayo siga presente y desenergizado. Red y mediciones siguen siendo las actuales, sin
reinyectar Icc/potencia. Reactivar/cambiar/quitar el ensayo invalida esa evidencia; reiniciar
simulación limpia el resultado. No se persiste un historial de fallas en el Proyecto.
