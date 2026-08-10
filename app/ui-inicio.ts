/**
 * Por dónde se empieza un tablero: la ventana de inicio, la biblioteca de ejemplos y las
 * plantillas propias.
 *
 * Son las tres puertas de entrada al editor y las tres hacen lo mismo —reemplazar el tablero que
 * hay en pantalla—, así que comparten el aviso de «tienes trabajo sin guardar». Estaban repartidas
 * por el medio de `main.ts`, entre el 3D y los entregables, y no tocan la escena para nada: son
 * HTML y `localStorage`. Aquí no se importa nada de `main.ts`; lo que necesitan del editor entra
 * por `ContextoInicio` cuando se instala, y así no hay imports cruzados.
 */
import { EJEMPLOS, EjemploTablero } from '../ejemplo/biblioteca.js';
import { Proyecto } from '../src/modelo/tipos.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { numerarDispositivos } from '../src/motores/numeracion.js';
import { avisar, confirmar, escaparHtml, pedirTexto, responderDialogo } from './dialogos.js';

/** Lo que la ventana de inicio necesita del editor para hacer su trabajo. */
export interface ContextoInicio {
	/** El proyecto abierto ahora mismo (se lee para el nombre y para guardarlo como plantilla). */
	proyecto: () => Proyecto;
	/** Reemplaza el proyecto abierto. */
	ponerProyecto: (p: Proyecto) => void;
	/** Guarda un punto de deshacer antes de reemplazar nada. */
	capturar: () => void;
	/** Deja la selección vacía (principal y múltiple). */
	limpiarSeleccion: () => void;
	/** Da por vista la tarjeta de bienvenida del lienzo vacío. */
	descartarBienvenida: () => void;
	aplicarModo: (nuevo: 'editor' | 'trabajo') => void;
	/** Rehace escena, paneles y verificación tras cambiar el objeto `proyecto`. */
	trasCambiarProyecto: () => void;
	encuadrar: () => void;
	/** ¿Hay trabajo hecho que todavía no se ha descargado? */
	hayCambiosSinExportar: () => boolean;
	/** Recalcula el tamaño del lienzo (estuvo tapado por el inicio y la ventana pudo cambiar). */
	ajustarTamano: () => void;
	/** ¿Quedó un encuadre pendiente porque el lienzo aún no medía? */
	encuadrePendiente: () => boolean;
	/** Abre la segunda herramienta (el plano de la planta). */
	irAPlanta: () => Promise<void>;
}

/** Lo que el editor puede pedirle a la ventana de inicio una vez instalada. */
export interface PanelInicio {
	mostrar: () => void;
	ocultar: () => void;
	abrirBiblioteca: () => void;
	/** El tablero ya no es el del ejemplo abierto: se retira su explicación. */
	olvidarEjemplo: () => void;
	/** ¿Se puede tirar lo que hay en pantalla? Pregunta solo si hay trabajo sin descargar. */
	puedoReemplazarElTablero: (que: string) => Promise<boolean>;
	/** `?inicio=0`: se entró directo al editor, sin pasar por la ventana de inicio. */
	saltoElInicio: boolean;
}

const $ = (id: string): HTMLElement => document.getElementById(id)!;

interface PlantillaTablero { nombre: string; fecha: string; proyecto: Proyecto }
const CLAVE_PLANTILLAS = 'tablerostudio-plantillas';

export function instalarInicio(ctx: ContextoInicio): PanelInicio {
	const proyecto = ctx.proyecto;
	let ejemploAbierto: EjemploTablero | undefined;

	/* --------------------- Ayuda, centrar vista y diálogos --------------------- */

	($('btn-centrar') as HTMLButtonElement).onclick = () => ctx.encuadrar();

	($('btn-ayuda') as HTMLButtonElement).onclick = () => { ($('modal-ayuda') as HTMLElement).hidden = false; };
	($('btn-cerrar-ayuda') as HTMLButtonElement).onclick = () => { ($('modal-ayuda') as HTMLElement).hidden = true; };
	$('modal-ayuda').addEventListener('click', (e) => {
		if (e.target === $('modal-ayuda')) ($('modal-ayuda') as HTMLElement).hidden = true;
	});

	// Botones del diálogo in-app.
	($('dialogo-ok') as HTMLButtonElement).onclick = () => {
		const input = $('dialogo-input') as HTMLInputElement;
		responderDialogo(input.hidden ? 'ok' : input.value);
	};
	($('dialogo-cancelar') as HTMLButtonElement).onclick = () => responderDialogo(null);
	$('modal-dialogo').addEventListener('keydown', (e) => {
		const ev = e as KeyboardEvent;
		if (ev.key === 'Enter') { e.preventDefault(); ($('dialogo-ok') as HTMLButtonElement).click(); }
		if (ev.key === 'Escape') { e.preventDefault(); responderDialogo(null); }
	});

	/* ------------------------------ Reemplazar el tablero ------------------------------ */

	/**
	 * ¿Se puede tirar lo que hay en pantalla?
	 *
	 * El botón «Nuevo» ya preguntaba, pero abrir un ejemplo o una plantilla NO: reemplazaban el
	 * tablero sin decir nada y el guardado automático pisaba la única copia acto seguido. O sea que
	 * ir a mirar cómo era el estrella-triángulo, a media UMA, costaba la mañana. Ctrl+Z lo recupera
	 * mientras la pestaña siga abierta; al cerrarla, no.
	 *
	 * Solo pregunta si hay trabajo sin descargar: en un tablero recién abierto no estorba.
	 */
	async function puedoReemplazarElTablero(que: string): Promise<boolean> {
		if (!ctx.hayCambiosSinExportar()) return true;
		return confirmar(
			`Tienes cambios sin guardar en «${proyecto().nombre}». Si abres ${que} se reemplaza lo que hay.`,
			{ ok: 'Abrir de todas formas', peligro: true },
		);
	}

	/* ------------------- Biblioteca de tableros de ejemplo (para estudiar) ------------------- */

	/** Abre un tablero de ejemplo y ofrece su explicación. */
	function abrirEjemplo(ej: EjemploTablero): void {
		ctx.capturar();
		const nuevo = ej.crear();
		numerarDispositivos(nuevo);
		ctx.ponerProyecto(nuevo);
		ctx.limpiarSeleccion();
		ctx.descartarBienvenida();
		ctx.aplicarModo('trabajo'); // se abre listo para recorrer el cableado
		ctx.trasCambiarProyecto();
		ctx.encuadrar();
		($('modal-ejemplos') as HTMLElement).hidden = true;
		ejemploAbierto = ej;
		($('btn-explicacion') as HTMLElement).hidden = false; // queda a mano para releerla
		mostrarExplicacion(ej);
	}

	/** Ventana con qué hace el tablero, cómo funciona y en qué fijarse. */
	function mostrarExplicacion(ej: EjemploTablero): void {
		$('texto-explicacion').innerHTML = `
		<h2>${ej.titulo}</h2>
		<p><b>${ej.resumen}</b></p>
		<h3>Qué hace</h3>
		<p>${ej.queHace}</p>
		<h3>Cómo funciona, paso a paso</h3>
		<ol>${ej.comoFunciona.map((x) => `<li>${x}</li>`).join('')}</ol>
		<h3>Para estudiarlo en el 3D</h3>
		<ul>${ej.aprender.map((x) => `<li>${x}</li>`).join('')}</ul>
	`;
		($('modal-explicacion') as HTMLElement).hidden = false;
	}

	/** Pinta la biblioteca de ejemplos y la abre. */
	function abrirBibliotecaEjemplos(): void {
		const cont = $('lista-ejemplos');
		cont.innerHTML = '';
		for (const ej of EJEMPLOS) {
			const div = document.createElement('div');
			div.className = 'tarjeta-ejemplo';
			div.innerHTML = `<h3>${ej.titulo}</h3><p>${ej.resumen}</p>`;
			const b = document.createElement('button');
			b.className = 'boton primario';
			b.textContent = 'Abrir y estudiar';
			b.onclick = () => { void (async () => {
				if (await puedoReemplazarElTablero('este ejemplo')) abrirEjemplo(ej);
			})(); };
			div.appendChild(b);
			cont.appendChild(div);
		}
		// Tras los ejemplos, las plantillas que ha guardado el propio usuario.
		cont.insertAdjacentHTML('beforeend', pintarPlantillasPropias());
		for (const b of cont.querySelectorAll<HTMLButtonElement>('[data-plantilla]')) {
			b.onclick = () => { void (async () => {
				if (await puedoReemplazarElTablero('esta plantilla')) abrirPlantilla(Number(b.dataset.plantilla));
			})(); };
		}
		for (const b of cont.querySelectorAll<HTMLButtonElement>('[data-borrar-plantilla]')) {
			b.onclick = () => { void borrarPlantilla(Number(b.dataset.borrarPlantilla)); };
		}
		($('modal-ejemplos') as HTMLElement).hidden = false;
	}

	/* ---------------------------- Plantillas de tablero ---------------------------- */

	/**
	 * Las plantillas propias, con la forma comprobada.
	 *
	 * Segunda auditoría, TS2-P1-01. Esto era un `JSON.parse` con un cast y nada más: lo que hubiera
	 * en `localStorage` se daba por bueno. Una plantilla `{ proyecto: {} }` —que sale sola si la
	 * escritura se cortó a la mitad por falta de cupo— tiraba el editor con «Cannot read properties
	 * of undefined (reading 'length')» nada más abrir la biblioteca, sin haber pulsado nada.
	 *
	 * Aquí solo se mira que la FICHA tenga forma de ficha. El proyecto de dentro se valida entero
	 * al abrirlo, con el mismo cargador que un archivo: ver `abrirPlantilla()`.
	 */
	function plantillasGuardadas(): PlantillaTablero[] {
		let bruto: unknown;
		try {
			bruto = JSON.parse(localStorage.getItem(CLAVE_PLANTILLAS) ?? '[]');
		} catch { return []; }
		if (!Array.isArray(bruto)) return [];
		return bruto.filter((p): p is PlantillaTablero => (
			typeof p === 'object' && p !== null
			&& typeof (p as PlantillaTablero).nombre === 'string'
			&& typeof (p as PlantillaTablero).proyecto === 'object'
			&& (p as PlantillaTablero).proyecto !== null
		));
	}

	/**
	 * Guarda el tablero entero como plantilla reutilizable. En una empresa el 80 % de los tableros
	 * se parecen entre sí: partir de «mi arranque estrella-triángulo» ahorra media jornada.
	 */
	async function guardarComoPlantilla(): Promise<void> {
		const nombre = (await pedirTexto('¿Cómo se llama esta plantilla?', proyecto().nombre))?.trim();
		if (!nombre) return;
		const lista = plantillasGuardadas().filter((p) => p.nombre !== nombre);
		lista.push({ nombre, fecha: new Date().toISOString(), proyecto: structuredClone(proyecto()) });
		try {
			localStorage.setItem(CLAVE_PLANTILLAS, JSON.stringify(lista));
			avisar(`Plantilla «${nombre}» guardada`, 'ok');
		} catch {
			avisar('No se pudo guardar la plantilla (falta espacio en el navegador).', 'error');
		}
	}

	/** Lista las plantillas propias dentro de la biblioteca de ejemplos. */
	function pintarPlantillasPropias(): string {
		const lista = plantillasGuardadas();
		if (lista.length === 0) return '';
		// El nombre lo escribe el usuario y va a `innerHTML`: sin escapar, un `<em>` en el nombre
		// de una plantilla entraba como NODO en la biblioteca en vez de leerse como texto.
		return `<h3 class="titulo-biblioteca">Tus plantillas</h3><div class="rejilla-ejemplos">`
			+ lista.map((p, i) => `
			<article class="tarjeta-ejemplo">
				<h4>${escaparHtml(p.nombre)}</h4>
				<p>Guardada el ${new Date(p.fecha).toLocaleDateString('es-CL')} · `
				+ `${p.proyecto.dispositivos.length} aparatos, ${p.proyecto.conductores.length} cables</p>
				<div class="acciones-ejemplo">
					<button class="boton primario" data-plantilla="${i}">Abrir</button>
					<button class="boton peligro" data-borrar-plantilla="${i}" title="Eliminar esta plantilla">🗑️</button>
				</div>
			</article>`).join('')
			+ `</div>`;
	}

	/**
	 * Abre una plantilla guardada como si fuera un proyecto nuevo.
	 *
	 * POR EL MISMO CARGADOR QUE UN ARCHIVO. Antes se clonaba el objeto y se instalaba tal cual: una
	 * plantilla es un proyecto que lleva meses en `localStorage`, puede venir de una versión
	 * anterior del programa y puede estar a medio escribir, exactamente igual que un `.tablero`
	 * que llega por correo. Que se guardase desde aquí no la hace de fiar.
	 *
	 * Y si no se puede leer, se dice y NO SE TOCA el tablero que hay en pantalla. Reemplazarlo
	 * por algo que no se ha podido validar es la forma más rápida de perder una tarde de trabajo.
	 */
	function abrirPlantilla(indice: number): void {
		const p = plantillasGuardadas()[indice];
		if (!p) return;
		let nuevo: Proyecto;
		try {
			nuevo = cargarProyecto(JSON.stringify(p.proyecto)).proyecto;
		} catch (e) {
			avisar(`No se pudo abrir la plantilla «${p.nombre}»: ${(e as Error).message}`, 'error');
			return;
		}
		ctx.capturar();
		nuevo.nombre = p.nombre;
		ctx.ponerProyecto(nuevo);
		olvidarEjemplo();
		($('modal-ejemplos') as HTMLElement).hidden = true;
		ctx.limpiarSeleccion();
		ctx.trasCambiarProyecto();
		// Y se reencuadra, como al abrir un ejemplo. Segunda auditoría, TS2-P2-13: sin esto, una
		// plantilla de una placa muy distinta a la que había en pantalla se abría fuera de escala
		// y parecía vacía, con el tablero fuera del cuadro.
		ctx.encuadrar();
		avisar(`Plantilla «${p.nombre}» abierta`, 'ok');
	}

	async function borrarPlantilla(indice: number): Promise<void> {
		const lista = plantillasGuardadas();
		const p = lista[indice];
		if (!p) return;
		if (!(await confirmar(`¿Eliminar la plantilla «${p.nombre}»?`, { ok: 'Eliminar', peligro: true }))) return;
		lista.splice(indice, 1);
		// Si el navegador no deja escribir —cupo lleno, modo privado—, la plantilla SIGUE AHÍ y
		// reaparece a la siguiente recarga. Decir «eliminada» de todos modos es mentirle a quien
		// la acaba de borrar. TS2-P2-13.
		try {
			localStorage.setItem(CLAVE_PLANTILLAS, JSON.stringify(lista));
		} catch {
			avisar('No se pudo eliminar la plantilla: el navegador no dejó guardar el cambio.', 'error');
			return;
		}
		abrirBibliotecaEjemplos();
		avisar('Plantilla eliminada', 'ok');
	}

	/** El tablero de pantalla ya no es el del ejemplo: se retira su explicación. */
	function olvidarEjemplo(): void {
		ejemploAbierto = undefined;
		($('btn-explicacion') as HTMLElement).hidden = true;
	}

	($('btn-plantilla') as HTMLButtonElement).onclick = () => { void guardarComoPlantilla(); };
	($('btn-empezar-ejemplo') as HTMLButtonElement).onclick = () => abrirBibliotecaEjemplos();
	($('btn-ejemplos') as HTMLButtonElement).onclick = () => abrirBibliotecaEjemplos();
	($('btn-explicacion') as HTMLButtonElement).onclick = () => { if (ejemploAbierto) mostrarExplicacion(ejemploAbierto); };
	($('btn-cerrar-ejemplos') as HTMLButtonElement).onclick = () => { ($('modal-ejemplos') as HTMLElement).hidden = true; };
	($('btn-cerrar-explicacion') as HTMLButtonElement).onclick = () => { ($('modal-explicacion') as HTMLElement).hidden = true; };
	for (const id of ['modal-ejemplos', 'modal-explicacion']) {
		$(id).addEventListener('click', (e) => { if (e.target === $(id)) ($(id) as HTMLElement).hidden = true; });
	}

	// «Empezar en blanco»: cierra la tarjeta y deja el modo Editor listo para añadir aparatos.
	($('btn-empezar-blanco') as HTMLButtonElement).onclick = () => {
		ctx.descartarBienvenida();
		ctx.aplicarModo('editor');
		($('bienvenida') as HTMLElement).hidden = true;
		ctx.encuadrar();
		avisar('Placa en blanco. Haz clic en un aparato del catálogo (izquierda) para colocarlo.', 'ok');
	};

	/* ---------------------------- Ventana de inicio ----------------------------
	 *
	 * El programa abre aquí, no en el gabinete: son dos herramientas y la elección es del que
	 * trabaja, no del programa. El editor sigue montado por debajo —no se destruye ni se vuelve a
	 * construir— así que entrar y salir del inicio no cuesta nada ni pierde el trabajo a medias.
	 */
	function mostrarInicio(): void {
		($('inicio') as HTMLElement).hidden = false;
	}
	function ocultarInicio(): void {
		($('inicio') as HTMLElement).hidden = true;
		// El lienzo ha estado tapado: puede haber cambiado de tamaño mientras tanto.
		ctx.ajustarTamano();
		if (ctx.encuadrePendiente()) ctx.encuadrar();
	}

	($('btn-inicio') as HTMLButtonElement).onclick = mostrarInicio;
	($('inicio-tableros') as HTMLButtonElement).onclick = ocultarInicio;
	($('inicio-terreno') as HTMLButtonElement).onclick = () => { ocultarInicio(); void ctx.irAPlanta(); };
	($('inicio-abrir') as HTMLButtonElement).onclick = () => { ocultarInicio(); $('btn-abrir').click(); };
	($('inicio-ejemplos') as HTMLButtonElement).onclick = () => { ocultarInicio(); abrirBibliotecaEjemplos(); };
	($('inicio-guia') as HTMLButtonElement).onclick = () => {
		ocultarInicio();
		($('modal-ayuda') as HTMLElement).hidden = false;
	};

	/*
	 * `?inicio=0` entra directo al editor. Lo usan las pruebas automáticas —que abren cientos de
	 * veces la aplicación y no vienen a elegir herramienta— y sirve además para enlazar el editor
	 * desde fuera. Sin el parámetro, siempre se ve el inicio.
	 */
	const saltarInicio = new URLSearchParams(location.search).get('inicio') === '0';
	if (saltarInicio) ocultarInicio();

	// Primera visita: abrir la guía automáticamente una sola vez. Nunca por debajo del inicio:
	// ahí no se ve, y el usuario se encuentra un modal abierto al entrar al editor sin saber por qué.
	try {
		if (!localStorage.getItem('tablerostudio-visto')) {
			if (saltarInicio) ($('modal-ayuda') as HTMLElement).hidden = false;
			localStorage.setItem('tablerostudio-visto', '1');
		}
	} catch { /* sin localStorage */ }

	return {
		mostrar: mostrarInicio,
		ocultar: ocultarInicio,
		abrirBiblioteca: abrirBibliotecaEjemplos,
		olvidarEjemplo,
		puedoReemplazarElTablero,
		saltoElInicio: saltarInicio,
	};
}
