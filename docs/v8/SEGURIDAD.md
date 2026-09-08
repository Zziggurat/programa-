# Fronteras de confianza V8

## Datos importados

Los paquetes técnicos son datos no confiables. El parser limita archivo (32 MiB),
profundidad (32), nodos, colecciones y campos. Rechaza claves peligrosas, claves desconocidas,
versiones futuras, no finitos, unidades incompatibles, intervalos invertidos, duplicados
ambiguos, hashes incorrectos y dependencias ausentes. La publicación y adopción usan el mismo
contrato; la UI no es la única barrera.

No hay eval, funciones dinámicas, plugins de import ejecutables ni expresiones libres.
Las operaciones de interpolación/factores son enums de una lista cerrada. Las rutas de
proyección proceden del registro de campos del código, no de rutas aportadas por un JSON.

El texto se escapa al mostrar fichas, comparaciones e informes. Los enlaces documentales
son declarativos: no se descargan. Se rechazan URLs con credenciales, esquemas peligrosos
y rutas privadas en referencias documentales. Una etiqueta DOCUMENTAL no equivale a
documento autenticado; revisión humana local e integridad de contenido son hechos distintos.

El import se verifica antes del commit transaccional. Cancelar, reemplazar archivo, cerrar
el modal o destruir el panel invalidan candidatos y abortan trabajo pendiente. Los proyectos
adoptan explícitamente y conservan su subconjunto exacto; importar biblioteca no los modifica.

## Exportaciones

HTML sin scripts externos y CSV con BOM, delimitador/quoting y defensa de fórmulas.
El empaquetador incorpora CSS extraído e inline en orden de cascada, computa CSP sobre los
bytes efectivos y rechaza rutas de CSS externas o que escapen a assets. El paquete offline
mantiene `connect-src 'none'`. No promete firma digital, certificación ni historial inviolable.

## Dependencias del checkpoint

Instalación real `npm ci`: 49 paquetes, 18 s; package-lock sin cambios de dependencias V8.
`npm audit --omit=dev --json`: **0 vulnerabilidades reportadas de producción**.
El audit completo reporta dos hallazgos heredados en `vite@7.3.6 → postcss@8.5.20 → nanoid@3.3.16`:

- [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8): Nano ID puede
  bloquearse al configurar generadores personalizados con tamaño cero. La llamada observada
  en PostCSS es `nanoid(6)`; los imports técnicos no ejecutan este paquete de build.
- [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp): PostCSS puede leer
  source maps indicados por CSS atacante bajo determinadas opciones. V8 no importa CSS del
  usuario; Vite procesa CSS versionado del proyecto, no el JSON técnico.

No se introdujeron estas versiones en V8 ni se observó un camino desde sus imports a esas
operaciones. Esto es análisis de alcance, **no afirmación de ausencia absoluta de riesgo**.
Actualizar estas dependencias de desarrollo mediante cambio controlado queda en backlog;
no se ejecutó `npm audit fix` ni actualización indiscriminada. No compilar repositorios/CSS
no confiables con el toolchain actual como si fueran entradas inocuas.

## Evidencia y límites

Tests de contrato, contaminación de prototipos, rangos/unidades, hash independiente,
cancelación/cuota/rollback y CSV/HTML acompañan la implementación. QA importación prueba
seis entradas hostiles, archivo válido seguido de inválido, cancelaciones, idempotencia,
texto XSS literal y roundtrip sin catálogo global. Los resultados finales y los reintentos
se registran en VALIDACION.md; un rechazo esperado de entrada hostil es una aserción del
gate, no una excepción silenciada.
