/**
 * ABRIR UNA VENTANA TIENE QUE PARAR LO DE DETRÁS. PARA TODAS LAS VENTANAS.
 *
 * Esto vivía dentro de `mundo-ui.ts` y solo lo usaba la Planta 3D. La tercera auditoría, TS3-P2-02,
 * lo dijo claro: los modales del EDITOR no lo heredaban. Con «Ejemplos» abierto, enfocar el botón
 * de cerrar y pulsar Shift+Tab llevaba el foco a `#grupo-borrar` —detrás del modal—, y el
 * contenedor no declaraba `role="dialog"` ni `aria-modal="true"`. El bloqueo de atajos
 * destructivos que ya había reduce el daño, pero no arregla ni el teclado ni el lector de
 * pantalla: quien navega con Tab se sale del diálogo sin enterarse y sigue pulsando cosas que ya
 * no ve.
 *
 * Así que el gestor sale aquí, a un solo sitio, y lo usan las dos herramientas. La diferencia
 * entre una y otra es lo que hay que SUSPENDER mientras la ventana está abierta —la Planta tiene
 * un paseo que se come el teclado; el editor, no— y eso entra por parámetro.
 */

/** Las ventanas abiertas ahora mismo, de la primera a la de más arriba. */
const abiertas: { id: string; suspendido?: () => void }[] = [];
/** A dónde vuelve el foco al cerrar cada una. */
const focoPrevio = new Map<string, HTMLElement | null>();

/**
 * ¿Hay alguna ventana encima? Lo consultan los atajos para no actuar a ciegas.
 *
 * Se sanea antes de responder: si el gestor arrastra una ventana que ya nadie ve, esto diría que
 * sí y los atajos se quedarían bloqueados sin nada delante que los justifique.
 */
export function hayVentanaAbierta(): boolean {
	sanear();
	return abiertas.length > 0;
}

/**
 * La de más arriba, que es la que manda sobre el teclado.
 *
 * Sin sanear: la llama `cerrarVentana`, que es a su vez a quien llama el saneo.
 */
export function ventanaDeArriba(): string | undefined {
	return abiertas[abiertas.length - 1]?.id;
}

/** Lo que se puede enfocar dentro de un elemento, en el orden en que lo recorre el tabulador. */
function enfocables(raiz: HTMLElement): HTMLElement[] {
	return [
		...raiz.querySelectorAll<HTMLElement>(
			'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), '
			+ 'textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
		),
	].filter((e) => e.offsetParent !== null);
}

/**
 * Apaga (o vuelve a encender) todo lo que NO es la ventana abierta.
 *
 * `inert` es lo que de verdad bloquea: quita del alcance del ratón, del tabulador y del lector de
 * pantalla de una vez. Se aplica a los HERMANOS de la ventana, en `<body>` y dentro de `#mundo`,
 * porque unas ventanas cuelgan de uno y otras del otro.
 */
function fondoInerte(caja: HTMLElement, apagar: boolean): void {
	const raices = [document.getElementById('mundo'), document.body]
		.filter((r): r is HTMLElement => !!r);
	for (const raiz of raices) {
		for (const hijo of [...raiz.children] as HTMLElement[]) {
			if (hijo === caja || hijo.contains(caja)) continue;
			if (apagar) hijo.setAttribute('inert', ''); else hijo.removeAttribute('inert');
		}
	}
}

/** Tab, Shift+Tab y Escape dentro de la ventana de arriba. */
function alTabular(ev: KeyboardEvent): void {
	const id = ventanaDeArriba();
	if (!id) return;
	const caja = document.getElementById(id);
	if (!caja) return;
	if (ev.key === 'Escape') { ev.preventDefault(); cerrarVentana(id); return; }
	if (ev.key !== 'Tab') return;
	const lista = enfocables(caja);
	if (lista.length === 0) return;
	const primero = lista[0];
	const ultimo = lista[lista.length - 1];
	const activo = document.activeElement as HTMLElement | null;
	// El foco da la vuelta DENTRO del diálogo en vez de escaparse a lo de detrás.
	if (ev.shiftKey && (activo === primero || !caja.contains(activo))) {
		ev.preventDefault(); ultimo.focus();
	} else if (!ev.shiftKey && (activo === ultimo || !caja.contains(activo))) {
		ev.preventDefault(); primero.focus();
	}
}

/**
 * Devuelve el foco a donde estaba, o a lo más parecido que quede en pie.
 *
 * El caso que lo obliga: «Guía rápida» y «Datos del proyecto…» se abren desde un desplegable que
 * se cierra al abrirse la ventana. Al pulsar Escape, `btn-ayuda` ya no se puede enfocar —está en
 * un `.lista` con `display: none`— y `focus()` no hace nada, sin error ni aviso: el foco se queda
 * en `<body>` y quien navega con teclado tiene que empezar a tabular desde el principio de la
 * página. Lo cazó `qa/modales-teclado.mjs`, que es justo lo que comprueba.
 *
 * Se sube hasta el primer antepasado que SÍ se vea y se enfoca su primer control, que en un
 * desplegable es su propio botón. El foco acaba en «Aprender ▾», que es de donde salió.
 */
function devolverFoco(el: HTMLElement | null | undefined): void {
	if (!el) return;
	if (el.isConnected && el.offsetParent !== null) { el.focus(); return; }
	for (let n = el.parentElement; n; n = n.parentElement) {
		if (n.offsetParent === null) continue;
		const disparador = enfocables(n)[0];
		if (disparador) { disparador.focus(); return; }
	}
}

export interface OpcionesVentana {
	/**
	 * Qué hay que parar mientras esté abierta, y cómo se vuelve a poner en marcha. La Planta pasa
	 * aquí el paseo: si no, la W sigue moviendo la cámara por debajo del modal.
	 */
	suspender?: () => () => void;
	/** Nombre accesible, si la ventana no trae un `<h2>` o `<h3>` que sirva. */
	titulo?: string;
}

/**
 * DESCARTA LAS QUE EL GESTOR CREE ABIERTAS Y YA NO LO ESTÁN.
 *
 * El gestor lleva su propia lista, pero `hidden` lo puede tocar cualquiera: un manejador antiguo,
 * un guion de pruebas que quita una ventana de en medio, o código que todavía no pasa por aquí. Si
 * eso ocurre, la lista se queda con una ventana que ya no está y `abrirVentana` la da por abierta:
 * a partir de ahí ESA VENTANA NO SE VUELVE A ABRIR NUNCA, sin error ni aviso.
 *
 * No es teórico. `qa/datos-proyecto.mjs` cierra «Datos del proyecto» con `setAttribute('hidden')`
 * y en el intento siguiente la ventana ya no se abría: tres comprobaciones que llevaban tiempo
 * pasando empezaron a fallar en cuanto esa ventana entró en el gestor. Se sanea la lista contra el
 * DOM en vez de dar por hecho que nadie va a tocar `hidden`, porque tocarlo es legal.
 */
let saneando = false;
function sanear(): void {
	// `cerrarVentana` vuelve a entrar aquí por debajo; sin esto se llamaría a sí misma sin fin.
	if (saneando) return;
	saneando = true;
	try { saneo(); } finally { saneando = false; }
}

function saneo(): void {
	for (const v of [...abiertas]) {
		const caja = document.getElementById(v.id);
		if (caja && !caja.hidden) continue;
		if (caja) { cerrarVentana(v.id); continue; }
		// Ni siquiera sigue en la página: se descuenta a mano, que `cerrarVentana` no sabría.
		const i = abiertas.findIndex((x) => x.id === v.id);
		if (i >= 0) abiertas.splice(i, 1)[0].suspendido?.();
		focoPrevio.delete(v.id);
	}
	if (abiertas.length === 0) window.removeEventListener('keydown', alTabular, true);
}

export function abrirVentana(id: string, opciones: OpcionesVentana = {}): void {
	const caja = document.getElementById(id);
	if (!caja) return;
	sanear();
	if (abiertas.some((v) => v.id === id)) return;
	focoPrevio.set(id, document.activeElement as HTMLElement | null);
	caja.hidden = false;
	caja.setAttribute('role', 'dialog');
	caja.setAttribute('aria-modal', 'true');
	/*
	 * El nombre accesible sale del primer encabezado que tenga dentro. Un diálogo sin nombre se
	 * anuncia como «diálogo» a secas, que no dice nada de lo que hay dentro.
	 */
	if (!caja.getAttribute('aria-label') && !caja.getAttribute('aria-labelledby')) {
		const titulo = opciones.titulo ?? caja.querySelector('h1, h2, h3')?.textContent?.trim();
		if (titulo) caja.setAttribute('aria-label', titulo);
	}
	abiertas.push({ id, suspendido: opciones.suspender?.() });
	/*
	 * La que se abre deja de estar inerte, ANTES de apagar el resto.
	 *
	 * Si ya había otra ventana abierta, esta era uno de sus «hermanos del fondo» y por tanto
	 * estaba inerte: sin esta línea se abría apagada —visible y sin poder pulsar nada—. Lo cazó
	 * `qa/capas.mjs` a la primera: abre la ayuda, abre los ejemplos encima y comprueba que se
	 * puede elegir uno, que es exactamente lo que hace cualquiera.
	 */
	caja.removeAttribute('inert');
	fondoInerte(caja, true);
	if (abiertas.length === 1) window.addEventListener('keydown', alTabular, true);
	enfocables(caja)[0]?.focus();
}

export function cerrarVentana(id: string): void {
	const caja = document.getElementById(id);
	const i = abiertas.findIndex((v) => v.id === id);
	if (!caja || i < 0) return;
	caja.hidden = true;
	const [quitada] = abiertas.splice(i, 1);
	quitada.suspendido?.();
	if (abiertas.length === 0) {
		window.removeEventListener('keydown', alTabular, true);
		fondoInerte(caja, false);
	} else {
		// Queda otra debajo: el fondo se recalcula respecto a ELLA, no se enciende del todo.
		const debajo = document.getElementById(ventanaDeArriba()!);
		if (debajo) { debajo.removeAttribute('inert'); fondoInerte(debajo, true); }
	}
	devolverFoco(focoPrevio.get(id));
	focoPrevio.delete(id);
}

/**
 * Cierra la de más arriba, si hay alguna. Devuelve si cerró algo.
 *
 * El saneo importa aquí más que en ningún sitio: es lo que atiende al Escape. Con una ventana
 * fantasma en la lista, devolvería `true` sin cerrar nada visible y el Escape se lo tragaría.
 */
export function cerrarVentanaDeArriba(): boolean {
	sanear();
	const id = ventanaDeArriba();
	if (!id) return false;
	cerrarVentana(id);
	return true;
}

/**
 * CIERRA TODAS. La llama una herramienta de pantalla completa al abrirse.
 *
 * Las herramientas —el dossier, el esquema, la Planta, la ventana de inicio— viven en
 * `--capa-herramienta` (40) y las ventanas en `--capa-modal` (60). O sea que una herramienta
 * abierta con una ventana encima queda DEBAJO de ella, y además el gestor la ha marcado `inert`
 * por ser hermana en `<body>`: ni se ve ni se puede tocar.
 *
 * No es teórico, y no lo encontré mirando el código: `qa/dossier-personalizado.mjs` no cierra la
 * guía del primer arranque, así que al abrir el dossier el panel entero salía inerte. Playwright
 * rellenaba el campo de la empresa sin protestar y sin escribir nada —el campo se quedaba vacío—,
 * el `change` guardaba una cadena vacía, y lo que se leía era «lo que se escribe se guarda con el
 * proyecto → undefined». La prueba decía la verdad; el fallo era mío, de la ronda anterior.
 *
 * Cerrar es lo correcto y no un apaño: quien abre el dossier ha terminado con la guía. Dejar un
 * modal esperando debajo de una herramienta a pantalla completa no significa nada.
 */
export function cerrarTodasLasVentanas(): number {
	let n = 0;
	// El tope es una red por si alguna ventana no se dejara descontar: mejor salir que colgarse.
	while (cerrarVentanaDeArriba() && n < 50) n++;
	return n;
}
