# Informe de QA y usabilidad — TableroStudio (editor 3D)

Prueba realizada conduciendo la aplicación por sus flujos reales (proyecto nuevo, catálogo,
cableado, deshacer/rehacer, modos, guardar/abrir, dossier, estructura, imágenes de
referencia) de forma automatizada con navegador real, más una pasada adversarial de casos
límite. Enfoque: que cualquiera —de un niño a una persona mayor— pueda usarlo sin trabarse.

## Resultado general

- **Lógica del programa: sólida, sin bugs funcionales.** Los 22 tests del núcleo pasan y
  todos los flujos de la interfaz respondieron correctamente (añadir, cablear, deshacer,
  eliminar, redimensionar, exportar). El único "error" de consola detectado era el
  `favicon.ico` del servidor de pruebas, no de la aplicación.

## Bug encontrado y corregido

| Bug | Causa | Corrección |
|---|---|---|
| La tarjeta de bienvenida y el modal de ayuda no se ocultaban | El selector de id `#bienvenida { display:flex }` ganaba en especificidad al atributo `hidden` del navegador | Regla global `[hidden] { display:none !important }` |

## Fricciones de usabilidad detectadas → mejoras aplicadas

1. **Un usuario nuevo no sabía por dónde empezar** (placa vacía sin indicaciones).
   → **Tarjeta de bienvenida** centrada con 3 pasos ("Añade → Coloca → Cablea") y un
   botón "Ver un tablero de ejemplo". Desaparece sola al colocar el primer aparato.

2. **No había ayuda ni explicación de los modos.**
   → **Guía rápida** (botón ❓ Ayuda) que se abre automáticamente en la primera visita:
   explica Editor vs Trabajo y cómo se hace cada cosa, en lenguaje sencillo.

3. **Cablear era abstracto** (tres desplegables encadenados).
   → **Cableado por clic**: botón "🎯 Elegir destino en el tablero" — pulsas y haces clic
   sobre el aparato de destino directamente en el 3D, como en EduVolt.

4. **Al girar la cámara, era fácil perderse** sin forma de recuperar la vista.
   → Botón **🏠 Centrar** que reencuadra el tablero al instante.

5. **Detalles de redacción** ("1 conductores").
   → Pluralización correcta ("1 conductor" / "N conductores") y estado vacío "Todavía no
   hay cables."

## Robustez verificada (casos límite)

- Deshacer/Rehacer con historial vacío: sin errores.
- Añadir 12 aparatos seguidos: se colocan y numeran bien; el DRC avisa en vivo.
- Eliminar con Supr y deshacer el borrado: recupera el aparato y sus cables.
- Cambiar de modo repetidamente: estable.
- Dimensiones fuera de rango (5 cm / 999 cm): se acotan a los límites válidos.
- Añadir imagen de referencia y deshacer: sin errores.
- Autoguardado en el navegador: el proyecto persiste entre recargas.

## Próximas mejoras sugeridas (no bloqueantes)

- Iconos por tipo de aparato en el catálogo (hoy es un color); mejora la lectura rápida.
- Resaltar el aparato al pasar el ratón por encima (feedback de "es clicable").
- Cablear pin-a-pin en 3D también para aparatos reales (hoy el clic-destino elige el
  aparato y el borne se pick en el desplegable).
- Paleta de etiquetas IEC para el cableado (L1/L2/L3/N/PE, U/V/W, A1/A2…).
