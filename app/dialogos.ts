/**
 * Diálogos y avisos de la aplicación.
 *
 * Los Artifacts corren en un iframe sandbox que BLOQUEA window.confirm/prompt/alert (devuelven
 * false/null sin mostrar nada), así que el programa trae los suyos. Además dan una experiencia
 * coherente en escritorio, web y Electron.
 *
 * Este módulo no sabe nada del tablero: solo habla con el DOM, y por eso se puede leer y
 * probar por separado del resto del editor.
 */

const $ = (id: string): HTMLElement => document.getElementById(id)!;

export let cerrarDialogo: ((valor: string | null) => void) | undefined;

export function abrirDialogo(mensaje: string, opciones: {
	input?: boolean; valorInicial?: string; ok?: string; peligro?: boolean;
} = {}): Promise<string | null> {
	const modal = $('modal-dialogo');
	const input = $('dialogo-input') as HTMLInputElement;
	$('dialogo-msg').textContent = mensaje;
	input.hidden = !opciones.input;
	input.value = opciones.valorInicial ?? '';
	($('dialogo-ok') as HTMLButtonElement).textContent = opciones.ok ?? 'Aceptar';
	modal.classList.toggle('peligro', !!opciones.peligro);
	modal.hidden = false;
	if (opciones.input) setTimeout(() => { input.focus(); input.select(); }, 0);

	return new Promise((resolve) => {
		cerrarDialogo = (valor) => {
			modal.hidden = true;
			cerrarDialogo = undefined;
			resolve(valor);
		};
	});
}

/** Confirmación con botones. Devuelve true si el usuario acepta. */
export async function confirmar(mensaje: string, opciones: { ok?: string; peligro?: boolean } = {}): Promise<boolean> {
	return (await abrirDialogo(mensaje, opciones)) !== null;
}

/** Pide un texto. Devuelve la cadena escrita, o null si cancela. */
export function pedirTexto(mensaje: string, valorInicial = ''): Promise<string | null> {
	return abrirDialogo(mensaje, { input: true, valorInicial });
}

/** Aviso flotante no bloqueante. */
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function avisar(mensaje: string, tipo: 'info' | 'ok' | 'error' = 'info'): void {
	const toast = $('toast');
	toast.textContent = mensaje;
	toast.className = tipo;
	toast.hidden = false;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
}


/** Cierra el diálogo abierto devolviendo `valor` (lo usan los botones y el teclado). */
export function responderDialogo(valor: string | null): void {
	cerrarDialogo?.(valor);
}

/** Descarga un contenido como archivo, sin pasar por el servidor. */
export function descargar(nombre: string, contenido: string, tipo = 'text/plain'): void {
	const a = document.createElement('a');
	a.href = URL.createObjectURL(new Blob([contenido], { type: tipo }));
	a.download = nombre;
	a.click();
	URL.revokeObjectURL(a.href);
}
