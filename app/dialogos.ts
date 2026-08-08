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

import { nombreSeguroDeArchivo } from '../src/modelo/archivos.js';

export { nombreSeguroDeArchivo };

const $ = (id: string): HTMLElement => document.getElementById(id)!;

/**
 * Escapa texto para meterlo en HTML sin que un nombre con < o & rompa la página.
 *
 * Vive aquí porque la usan todos los paneles que pintan HTML —el editor, el dossier, el panel de
 * la simulación— y tener tres copias iguales era pedir que un día se arreglara solo una.
 *
 * ESCAPA TAMBIÉN LAS COMILLAS, y no es un detalle: la mayoría de las veces esto se usa DENTRO de
 * un atributo —`title="${esc(x)}"`, `value="${esc(x)}"`— y ahí una comilla no rompe el texto, lo
 * cierra. Con `"` se sale del atributo y con ` onerror="…"` se entra en otro. Antes solo se
 * escapaban `& < >`, así que una nota de obra con una comilla ya truncaba el `title`, y una
 * preparada a mala fe podía añadir un manejador de eventos. El proyecto y el parte de obra se
 * importan de archivos y de otros equipos: ese texto no es de fiar por definición.
 */
export function escaparHtml(t: string): string {
	return t
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

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
	/*
	 * Al abrirse, el foco entra en el diálogo. Siempre, no solo cuando hay algo que escribir.
	 *
	 * Sus teclas —Enter acepta, Escape cancela— cuelgan del propio `#modal-dialogo`, así que solo
	 * llegan si el foco está DENTRO. Una confirmación sin campo no enfocaba nada, y el foco se
	 * quedaba donde estuviese: resultado, un «¿Eliminar -Q1 y sus cables?» que no se cerraba con
	 * Escape por mucho que se pulsara, y había que ir a buscar el ratón. Con el botón enfocado las
	 * dos teclas funcionan y además se ve de un vistazo cuál es la respuesta por omisión.
	 */
	setTimeout(() => {
		if (opciones.input) { input.focus(); input.select(); } else ($('dialogo-ok') as HTMLButtonElement).focus();
	}, 0);

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

/**
 * Descarga un contenido como archivo, sin pasar por el servidor.
 *
 * El nombre se limpia AQUÍ y no en cada sitio que descarga: así ninguna exportación futura puede
 * saltarse la limpieza y volver a producir un archivo llamado «download». El enlace se mete en el
 * documento antes de pulsarlo, y el blob se libera después y no en la misma vuelta, que es lo que
 * deja descargas a medias en algunos navegadores.
 */
export function descargar(nombre: string, contenido: string | Blob, tipo = 'text/plain'): void {
	const blob = contenido instanceof Blob ? contenido : new Blob([contenido], { type: tipo });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = nombreSeguroDeArchivo(nombre);
	a.rel = 'noopener';
	a.style.display = 'none';
	document.body.appendChild(a);
	a.click();
	setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 20_000);
}
