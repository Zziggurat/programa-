/** Se ejecuta en el navegador. Observa DOM público; no modifica modelo ni notificaciones. */
export function observarNuevoMensaje({ texto, timeout }) {
    const toast = document.getElementById('toast');
    if (!toast) throw new Error('No existe el indicador público de notificaciones');
    let resolver;
    const resultado = new Promise(r => { resolver = r; });
    const inicio = performance.now(), mensajes = [];
    let terminado = false, reloj;
    const acabar = valor => {
        if (terminado) return;
        terminado = true; clearTimeout(reloj); observador.disconnect(); resolver(valor);
    };
    const observador = new MutationObserver(registros => {
        mensajes.push({ ms: Math.round(performance.now() - inicio), texto: toast.textContent,
            oculto: toast.hidden, publicados: registros.flatMap(r =>
                Array.from(r.addedNodes ?? [], n => n.textContent)).slice(-8) });
        if (mensajes.length > 20) mensajes.shift();
        if (!toast.hidden && toast.textContent === texto) acabar(true);
    });
    // No aceptar el texto que ya existía: requiere una nueva publicación tras instalarse.
    observador.observe(toast, { childList: true, characterData: true, subtree: true,
        attributes: true, attributeFilter: ['hidden'] });
    return { resultado,
        diagnostico: () => ({ ms: Math.round(performance.now() - inicio), mensajes,
            toast: toast.textContent, oculto: toast.hidden,
            nombre: document.getElementById('nombre-proyecto')?.value,
            guardado: document.getElementById('estado-guardado')?.textContent,
            ejemplo: document.getElementById('chip-ejemplo')?.hidden === false }),
        // El límite de confirmación comienza tras la acción/montaje, como antes. El observador
        // ya está instalado para no perder un mensaje durante esas acciones con límite propio.
        esperar: () => { if (!terminado && !reloj) reloj = setTimeout(() => acabar(false), timeout); return resultado; },
        cancelar: () => acabar(false) };
}

export async function observarConfirmacion(page, texto, timeout) {
    const h = await page.evaluateHandle(observarNuevoMensaje, { texto, timeout });
    return {
        estado: () => h.evaluate(o => o.diagnostico?.()),
        async esperar() {
            if (!await h.evaluate(o => o.esperar())) {
                const estado = await h.evaluate(o => o.diagnostico?.());
                throw new Error(`No se publicó la confirmación: ${texto}. DOM observado: ${JSON.stringify(estado)}`);
            }
        },
        async cerrar() {
            try { await h.evaluate(o => o.cancelar()); } finally { await h.dispose(); }
        },
    };
}

/** Conserva la interacción real que suministra cada recorrido (ratón/teclado). */
export async function copiarEjemploConfirmado(page, accion, timeout = 30_000) {
    const o = await observarConfirmacion(page,
        'La copia es un tablero nuevo, independiente y guardado localmente.', timeout);
    try { await accion(); await o.esperar(); } finally { await o.cerrar(); }
}
