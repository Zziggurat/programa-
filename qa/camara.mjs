/** Gate estable de cámara e interacción; omite solo los barridos manuales extremos. */
process.argv.push('--gate');
await import('./_v-camara2.mjs');
