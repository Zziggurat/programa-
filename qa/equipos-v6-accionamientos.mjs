/** VFD, motor, desequilibrio y neutro V6 con aislamiento de proceso. */
process.env.QA_EQUIPOS_V6_SCOPE = 'accionamientos';
await import('./lib/equipos-v6-core.mjs');
