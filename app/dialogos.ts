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
import { abrirVentana, cerrarVentana } from './ventanas.js';

export { nombreSeguroDeArchivo };

const $ = (id: string): HTMLElement => document.getElementById(id)!;

/* --------------------------- Quién va delante de quién --------------------------- */

/*
 * EL ÚLTIMO QUE SE ABRE ES EL QUE MANDA.
 *
 * Todas las ventanas comparten la capa `--capa-modal`, que es lo que hace que ninguna se cuele
 * por delante del diálogo bloqueante ni de los avisos. Pero entre ELLAS el empate lo desempata el
 * navegador por orden en el documento, y eso no tiene nada que ver con el orden en que se abren.
 *
 * Lo que pasaba: en la primera visita la guía rápida está abierta; se pulsaba «Empezar con un
 * ejemplo» y la ventana de ejemplos salía DEBAJO de la guía —`#modal-ayuda` va después en el
 * HTML—, así que se veían las tarjetas atenuadas detrás y no se podía pinchar ninguna. Igual con
 * la explicación de un ejemplo, o con el DRC abierto desde otra ventana.
 *
 * Se arregla donde está el problema y no ventana por ventana: un observador mira el atributo
 * `hidden` de todo `[id^="modal-"]` y, cuando una se muestra, la pone la última de la pila. Así
 * vale también para la ventana que se añada mañana, sin que nadie tenga que acordarse.
 */
const CAPA_MODAL = Number(getComputedStyle(document.documentElement).getPropertyValue('--capa-modal')) || 60;
/** Hasta dónde puede subir una ventana: siempre por debajo de `--capa-dialogo` (70). */
const ESCALONES = 8;
/*
 * `#modal-dialogo` se queda fuera a propósito: vive en `--capa-dialogo`, por encima de todas las
 * ventanas, porque cuando pregunta algo hay alguien esperando la respuesta. Meterlo en esta pila
 * lo bajaría a la capa de las ventanas y una de ellas podría taparlo.
 */
const FUERA_DE_LA_PILA = new Set(['modal-dialogo']);

const pilaDeVentanas: HTMLElement[] = [];

function reordenarVentanas(): void {
	pilaDeVentanas.forEach((el, i) => { el.style.zIndex = String(CAPA_MODAL + Math.min(i, ESCALONES)); });
}

function anotarVentana(el: HTMLElement): void {
	const donde = pilaDeVentanas.indexOf(el);
	if (donde !== -1) pilaDeVentanas.splice(donde, 1);
	if (el.hidden) el.style.zIndex = '';
	else pilaDeVentanas.push(el);
	reordenarVentanas();
}

const vigilante = new MutationObserver((cambios) => {
	for (const c of cambios) anotarVentana(c.target as HTMLElement);
});
for (const el of document.querySelectorAll<HTMLElement>('[id^="modal-"]')) {
	if (FUERA_DE_LA_PILA.has(el.id)) continue;
	vigilante.observe(el, { attributes: true, attributeFilter: ['hidden'] });
	if (!el.hidden) anotarVentana(el);   // la guía de la primera visita ya está abierta al cargar
}

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
	/*
	 * SE ABRE POR EL GESTOR DE VENTANAS, no poniendo `hidden = false` a mano.
	 *
	 * Esto es lo que causaba la pantalla congelada. El gestor apaga con `inert` todo lo que no es
	 * la ventana de arriba, y `#modal-dialogo` es hermano de las demás en `<body>`: con la
	 * biblioteca de ejemplos abierta, el aviso ya estaba inerte ANTES de mostrarse. Se mostraba
	 * delante —capa 70, encima de todo— y no se podía pulsar ni «Cancelar» ni «Abrir de todas
	 * formas»; los clics se los quedaban las tarjetas de debajo. El programa se quedaba muerto con
	 * el aviso puesto, y era justo el aviso que sale al cambiar de un ejemplo a otro.
	 *
	 * Pasando por el gestor, el aviso entra en la pila y la inercia se recompone con él arriba.
	 */
	/*
	 * Si ya había un aviso esperando respuesta, se le contesta «cancelar» antes de pisarlo. Dejarlo
	 * colgado dejaría colgado también al `await` que estuviera esperándolo.
	 */
	cerrarDialogo?.(null);

	return new Promise((resolve) => {
		/*
		 * Se contesta UNA sola vez, venga la respuesta de donde venga: del botón, de Enter, de
		 * Escape, o del gestor porque la ventana se cerró por otro camino. Sin este cerrojo, el
		 * cierre que dispara `cerrarVentana` volvería a entrar aquí.
		 */
		let resuelto = false;
		const terminar = (valor: string | null): void => {
			if (resuelto) return;
			resuelto = true;
			cerrarDialogo = undefined;
			cerrarVentana('modal-dialogo');
			resolve(valor);
		};
		cerrarDialogo = terminar;
		abrirVentana('modal-dialogo', {
			titulo: opciones.input ? 'Escribe un valor' : 'Confirmación',
			// Cerrar es la respuesta «cancelar». Va por aquí para no depender de QUÉ lo cerró.
			alCerrar: () => terminar(null),
		});
		/*
		 * Al abrirse, el foco entra en el diálogo. Siempre, no solo cuando hay algo que escribir.
		 *
		 * Sus teclas —Enter acepta, Escape cancela— cuelgan del propio `#modal-dialogo`, así que
		 * solo llegan si el foco está DENTRO. Una confirmación sin campo no enfocaba nada, y el
		 * foco se quedaba donde estuviese: resultado, un «¿Eliminar -Q1 y sus cables?» que no se
		 * cerraba con Escape por mucho que se pulsara, y había que ir a buscar el ratón.
		 */
		setTimeout(() => {
			if (opciones.input) { input.focus(); input.select(); } else ($('dialogo-ok') as HTMLButtonElement).focus();
		}, 0);
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
