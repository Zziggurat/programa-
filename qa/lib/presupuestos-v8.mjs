/** Presupuesto TOTAL, nunca timeout de una interacción.
 * CI 34197538052: catálogo 7:32, importación 7:47; ingeniería progresó hasta
 * 33/47 a los 10 min (proyección ~14,2 min). Margen: 12/12/18 min.
 * El supervisor de procesos concede otros dos minutos para cierre/diagnóstico.
 * No es un SLA del producto ni cambia los límites de Playwright por acción.
 */
const minutos = Object.freeze({
    'datos-tecnicos-catalogo': 12,
    'datos-tecnicos-importacion': 12,
    'datos-tecnicos-ingenieria': 18,
});
export function presupuestoV8(suite) {
    return Object.hasOwn(minutos, suite) ? minutos[suite] * 60_000 : undefined;
}
export function presupuestoSupervisor(suite, explicito) {
    const valor = explicito === undefined
        ? (presupuestoV8(suite) === undefined ? 12 * 60_000 : presupuestoV8(suite) + 2 * 60_000)
        : Number(explicito);
    if (!Number.isFinite(valor) || valor < 1000) {
        throw new Error('QA_SUITE_TIMEOUT_MS debe ser un número de milisegundos mayor o igual a 1000.');
    }
    return valor;
}
/** El intervalo entre checks permite localizar un tramo lento aunque CI agrupe stdout. */
export function crearRelojProgreso(reloj = Date.now) {
    const inicio = reloj(); let anterior = inicio;
    return numero => {
        const ahora = reloj(), intervalo = ahora - anterior; anterior = ahora;
        return `[#${numero}; +${((ahora - inicio) / 1000).toFixed(1)}s; tramo ${(intervalo / 1000).toFixed(1)}s]`;
    };
}
