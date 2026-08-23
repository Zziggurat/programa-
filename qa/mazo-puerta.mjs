/** Gate estable del mazo, la trenza y las entradas de puerta; no genera capturas. */
process.argv.push('--gate');
await import('./_v-trenza.mjs');
