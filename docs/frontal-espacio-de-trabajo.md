# El frontal como espacio de trabajo

Un tablero tiene dos caras y en cada una se hace un oficio distinto: dentro se arma y se cablea, y
en el frontal se decide lo que el tablero le dice a quien lo opera. Hasta ahora solo había un
espacio, así que había que esquivar la puerta para cablear y bucear entre canaletas para colocar un
piloto.

---

## 1. Tres espacios, una sola escena

| espacio | qué se hace | qué se ve |
|---|---|---|
| **Interior** | armar, mover estructura, cablear | la placa, los carriles, las canaletas; la puerta se abre y se aparta |
| **Frontal** | componer la cara de operación | la hoja de frente y cerrada, como una superficie técnica |
| **Conjunto** | mirar y enseñar | el armario entero |

Cambiar de espacio **no reconstruye nada ni mueve un aparato**: cambia la cámara, lo que se ve y las
herramientas a mano. Y cada espacio **se acuerda de su cámara**, así que volver es volver a donde uno
estaba — medido: **0,0 mm de desvío** al ir al frontal, trabajar allí y regresar.

En el frontal desaparecen del panel las secciones del interior (catálogo, cables, estructura) y los
modos Editor/Trabajo, que allí no significan nada. Los bornes clicables tampoco se enseñan: en el
frontal no se cablea.

## 2. Editar sobre la puerta

Seleccionar (con tolerancia **en píxeles**, como los cables), arrastrar sobre el plano de la hoja,
alinear por los seis bordes, repartir con la misma separación entre ejes, duplicar, borrar y afinar
con las flechas: **una pulsación un milímetro, con Mayúsculas diez**.

Una pieza **no puede quedarse flotando** por delante o por detrás de la chapa. No es una
comprobación: todo se expresa en el plano de la hoja y **no existe la coordenada** donde meter esa
distancia. El grado de libertad no está.

El arrastre funciona con la puerta esté donde esté —abierta, cerrada o a medias— porque el plano se
toma de la hoja y no del mundo.

## 3. Ayudas que no recolocan nada

```
imantado → primero los VECINOS, después la rejilla
```

Ese orden es una decisión: alinearse con la pieza de al lado es lo que uno quiere de verdad —tres
pilotos a la misma altura— y la rejilla es la red de fondo. Con la rejilla primero, un vecino que no
cayera en ella **no se podría igualar nunca**, que es justo el caso de un tablero heredado.

Cada enganche dibuja **su guía**: azul si se alineó con una pieza, gris si cayó en la rejilla. Una
ayuda que mueve algo sin decirlo es indistinguible de un fallo.

- **Alt** mientras se arrastra las apaga todas.
- Al **soltar no se toca nada**: no hay una sola función en `edicion-frontal.ts` que recoloque una
  pieza después de haberla soltado.
- Lo único que se impone pase lo que pase es **el borde de la hoja**, porque fuera de la chapa no hay
  dónde hacer el taladro. Ni siquiera Alt lo salta, porque no es una ayuda.

## 4. Señalética

Placas y rótulos configurables, en tres estilos: **grabado** sobre la chapa, **placa** atornillada, y
**aviso** de riesgo eléctrico (fondo amarillo, borde negro).

No son aparatos: no consumen, no salen en el esquema y no ensucian el listado de materiales ni el
DRC. Por eso viven en `gabinete.rotulos` y no en `dispositivos`.

El texto se dibuja con el **atlas de serigrafía que ya existía**, partido por **palabras** y no por
líneas enteras: las palabras se repiten —MARCHA, MOTOR, TABLERO, FALLA— y las frases no, así que dos
placas que digan «MARCHA» cuestan una sola celda del atlas. Un tablero con cuarenta rótulos sigue
siendo una textura. Y el texto se ajusta al ancho de la placa en varias líneas, en vez de aplastarse
para caber en una celda.

## 5. El registro de componentes

`componentes-puerta.ts` pasa a tener **fichas**: familia, huella y constructor.

```ts
registrarFrontal('pulsador', {
    familia: 'Pulsador',
    huella: () => ({ forma: 'redonda', ancho: 22 }),
    construir: construirPulsadorPuerta,
});
```

Añadir pulsadores NA/NC, setas de emergencia, selectores de tres posiciones, voltímetros,
amperímetros, multimedidores o una pantalla es **registrar una ficha**. No hay que tocar la escena,
ni la animación de la simulación, ni la selección, ni el editor del frontal, ni el guardado: todos
preguntan por la ficha y **ninguno sabe qué familias existen**.

La huella admite ya la forma rectangular, que es la que necesitan los instrumentos y el HMI.

## 6. Segunda pasada visual

Con el frontal poblado y la cámara encima se ven cosas que de lejos no:

| | antes | ahora |
|---|---|---|
| halo del piloto | disco liso de 1,50 radios: de cerca, un círculo con el canto recortado | degradado radial, 1,28 radios, se apaga rápido como un LED |
| lente | 9,6 mm de radio contra 14,5 del aro: una cuenta dentro de una arandela | 11 contra 13,6, que es lo que se ve en un pilotode 22 mm |
| leyenda | el piloto dibujaba su letra **y** además tenía su rótulo: dos textos superpuestos | la leyenda es señalética y se mueve, se alinea y se edita |
| chapa | pintura lisa | el mismo grano de *powder-coat* que la placa de montaje |

No se ha tocado la respuesta metálica: subirla convertiría el armario en un espejo, que es justo lo
que un armario pintado no es.

## Validación

| | resultado |
|---|---|
| arrastrar con el ratón de verdad sobre el lienzo | el piloto S se imanta a la altura de su rótulo |
| flechas | 1 mm, y 10 mm con Mayúsculas |
| alinear + repartir | los tres pilotos a la misma altura y a la misma distancia |
| añadir y quitar | ✔ (un piloto nuevo llega con su rótulo) |
| ir al frontal y volver | **0,0 mm** de desvío de cámara |
| z-fighting con todo montado | **0 por millón**, con el control de cámara quieta en 0 |
| pilotos | siguen encendiéndose por el circuito; 6 energizaciones = 0 reconstrucciones |
| editor de cables (20 pasos) | todos pasan, con el bloqueo de eje exacto |
| cinco tableros | picking 8/8, sin errores de JavaScript |
| pruebas | **696 verdes** |

### Un ajuste honesto en la prueba de aceptación

Al crecer el tablero de ejemplo, el punto de cable que usa la prueba pasó a nacer **dentro de una
canaleta**, donde el volumen libre va de 2 a 57 mm. El empujón de 18 × 3 px desde una cámara casi de
canto se quedaba en el mismo milímetro y el paso cantaba «no cambió la profundidad» sin que nada
estuviera roto. Comprobado aparte antes de tocar nada: pidiendo 10, 25, 35 y 50 mm el punto se
guarda **exactamente ahí**, y 70 se recorta a 57 porque es donde acaba el hueco de la canaleta. Lo
que se cambió fue el arrastre de la prueba, no lo que la prueba exige.
