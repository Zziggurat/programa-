/** Se ejecuta en el navegador. Observa DOM público; no modifica modelo ni notificaciones. */
export function observarNuevoMensaje({ texto, timeout }) {
    const toast = document.getElementById('toast');
    if (!toast) throw new Error('No existe el indicador público de notificaciones');
    let resolver;
    const resultado = new Promise(r => { resolver = r; });
    let terminado = false, reloj;
    const acabar = valor => {
        if (terminado) return;
        terminado = true; clearTimeout(reloj); observador.disconnect(); resolver(valor);
    };
    const observador = new MutationObserver(() => {
        if (!toast.hidden && toast.textContent === texto) acabar(true);
    });
    // No aceptar el texto que ya existía: requiere una nueva publicación tras instalarse.
    observador.observe(toast, { childList: true, characterData: true, subtree: true,
        attributes: true, attributeFilter: ['hidden'] });
    return { resultado,
        // El límite de confirmación comienza tras la acción/montaje, como antes. El observador
        // ya está instalado para no perder un mensaje durante esas acciones con límite propio.
        esperar: () => { if (!terminado && !reloj) reloj = setTimeout(() => acabar(false), timeout); return resultado; },
        cancelar: () => acabar(false) };
}

export async function observarConfirmacion(page, texto, timeout) {
    const h = await page.evaluateHandle(observarNuevoMensaje, { texto, timeout });
    return {
        async esperar() {
            if (!await h.evaluate(o => o.esperar())) throw new Error(`No se publicó la confirmación: ${texto}`);
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
