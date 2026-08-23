/** Gate de picking en el frontal; la captura de diagnóstico queda fuera de CI. */
process.argv.push('--gate');
await import('./_v-picking.mjs');
