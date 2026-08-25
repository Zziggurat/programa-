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
import { abrirVentana, cerrarVentana } from './ventanas.js';

/** Lo pone Vite a partir de package.json; el empaquetador añade el Build ID de contenido. */
declare const __VERSION__: string;

/** Lo que la ventana de inicio necesita del editor para hacer su trabajo. */
export interface ContextoInicio {
	/** El proyecto abierto ahora mismo (se lee para el nombre y para guardarlo como plantilla). */
	proyecto: () => Proyecto;
	/**
	 * Cambia el tablero de la pantalla por otro, ENTERO O NADA.
	 *
	 * Antes esto eran cinco llamadas sueltas —`capturar`, `ponerProyecto`, `limpiarSeleccion`,
	 * `trasCambiarProyecto` y `encuadrar`— y las dos puertas de entrada las repetían en distinto
	 * orden. Tercera auditoría, TS3-P2-03: si el montaje del tablero nuevo falla a mitad, el
	 * historial se queda con un paso de deshacer que no deshace nada y sin nada que rehacer, y en
	 * estas dos ni siquiera volvía el proyecto anterior. Ahora es una sola operación que mueve
	 * proyecto, historial y guardado a la vez, o no mueve ninguno y lanza.
	 *
	 * `ajustes` es lo que haya que dejar puesto ANTES de pintar —el modo Trabajo de los ejemplos—,
	 * para que la primera pintada ya salga bien y quede dentro de la transacción.
	 */
	reemplazarProyecto: (p: Proyecto, ajustes?: () => void) => void | Promise<void>;
	/** Da por vista la tarjeta de bienvenida del lienzo vacío. */
	descartarBienvenida: () => void;
	aplicarModo: (nuevo: 'editor' | 'trabajo') => void;
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

	/*
	 * QUÉ COPIA ES ESTA. Tercera auditoría, TS3-P3-03.
	 *
	 * La versión se ve también en un build web normal. En el HTML offline, el empaquetador añade a
	 * este mismo texto el hash de contenido; no se usa el SHA del commit porque crearía una
	 * dependencia circular al versionar el propio artefacto generado.
	 *
	 * Se pone con `textContent`, no con `innerHTML`: son tres cadenas que mete el empaquetador y no
	 * llevan marcado ninguno.
	 */
	$('acerca-de').textContent = `TableroStudio ${__VERSION__}`;

	($('btn-ayuda') as HTMLButtonElement).onclick = () => abrirVentana('modal-ayuda');
	($('btn-cerrar-ayuda') as HTMLButtonElement).onclick = () => cerrarVentana('modal-ayuda');
	$('modal-ayuda').addEventListener('click', (e) => {
		if (e.target === $('modal-ayuda')) cerrarVentana('modal-ayuda');
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

	/**
	 * Abre un tablero de ejemplo y ofrece su explicación.
	 *
	 * PREGUNTA ANTES SI HAY TRABAJO SIN GUARDAR. No lo hacía: abrir un ejemplo para consultar una
	 * duda —que es justo para lo que están— se llevaba por delante el tablero que uno tenía a
	 * medias, sin avisar y sin poder recuperarlo salvo por Ctrl+Z. Abrir un ARCHIVO sí preguntaba
	 * desde siempre; esto se quedó fuera, y es el camino que más se usa.
	 *
	 * Y el ejemplo se marca como tal: se mira y se energiza, pero no se edita. Un ejemplo que se
	 * puede editar deja de enseñar en cuanto alguien borra un cable sin querer.
	 */
	async function abrirEjemplo(ej: EjemploTablero): Promise<void> {
		if (!(await puedoReemplazarElTablero(`el ejemplo «${ej.titulo}»`))) return;
		const nuevo = ej.crear();
		numerarDispositivos(nuevo);
		nuevo.esEjemplo = true;
		try {
			// El modo Trabajo entra dentro: el ejemplo se abre listo para recorrer el cableado.
			await ctx.reemplazarProyecto(nuevo, () => ctx.aplicarModo('trabajo'));
		} catch {
			avisar(`No se pudo abrir el ejemplo «${ej.titulo}». El tablero que tenías sigue como estaba.`, 'error');
			return;
		}
		ctx.descartarBienvenida();
		cerrarVentana('modal-ejemplos');
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
		abrirVentana('modal-explicacion');
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
			// La pregunta de «tienes trabajo sin guardar» la hace `abrirEjemplo`, que es el embudo:
			// así la hereda cualquier otro camino que se añada mañana, y no se pregunta dos veces.
			b.onclick = () => { void abrirEjemplo(ej); };
			div.appendChild(b);
			cont.appendChild(div);
		}
		// Tras los ejemplos, las plantillas que ha guardado el propio usuario.
		cont.insertAdjacentHTML('beforeend', pintarPlantillasPropias());
		for (const b of cont.querySelectorAll<HTMLButtonElement>('[data-plantilla]')) {
			b.onclick = () => { void (async () => {
				if (await puedoReemplazarElTablero('esta plantilla')) await abrirPlantilla(Number(b.dataset.plantilla));
			})(); };
		}
		for (const b of cont.querySelectorAll<HTMLButtonElement>('[data-bajar-plantilla]')) {
			b.onclick = () => {
				const p = plantillasGuardadas()[Number(b.dataset.bajarPlantilla)];
				if (!p) return;
				const url = URL.createObjectURL(new Blob([JSON.stringify(p, null, 2)],
					{ type: 'application/json' }));
				const a = document.createElement('a');
				a.href = url;
				a.download = 'plantilla-danada.json';
				document.body.appendChild(a);
				a.click();
				a.remove();
				setTimeout(() => URL.revokeObjectURL(url), 1000);
				avisar('Plantilla descargada tal cual estaba guardada.', 'ok');
			};
		}
		for (const b of cont.querySelectorAll<HTMLButtonElement>('[data-borrar-plantilla]')) {
			b.onclick = () => { void borrarPlantilla(Number(b.dataset.borrarPlantilla)); };
		}
		abrirVentana('modal-ejemplos');
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
	/**
	 * UNA PLANTILLA ROTA NO PUEDE LLEVARSE POR DELANTE LA BIBLIOTECA ENTERA.
	 *
	 * Tercera auditoría, TS3-P1-06. Aquí se leía `p.proyecto.dispositivos.length` para pintar la
	 * tarjeta, y con una entrada `{proyecto:{}}` eso es
	 * «Cannot read properties of undefined (reading 'length')»: la biblioteca no llegaba a
	 * abrirse, aunque las otras cinco plantillas estuvieran perfectas. El cargador se invoca
	 * después, al pulsar «Abrir», así que nunca alcanzaba a aislar esa tarjeta.
	 *
	 * Cada tarjeta se pinta ahora por su cuenta y la que no se puede leer sale EN CUARENTENA: se
	 * ve, se dice que no vale, y se puede descargar tal cual está o quitarla. Que una plantilla
	 * esté rota es un problema de esa plantilla, no de las demás.
	 */
	function pintarPlantillasPropias(): string {
		const lista = plantillasGuardadas();
		if (lista.length === 0) return '';
		// El nombre lo escribe el usuario y va a `innerHTML`: sin escapar, un `<em>` en el nombre
		// de una plantilla entraba como NODO en la biblioteca en vez de leerse como texto.
		return `<h3 class="titulo-biblioteca">Tus plantillas</h3><div class="rejilla-ejemplos">`
			+ lista.map((p, i) => {
				let resumen: string;
				try {
					const d = (p.proyecto as { dispositivos?: unknown[] }).dispositivos;
					const c = (p.proyecto as { conductores?: unknown[] }).conductores;
					if (!Array.isArray(d) || !Array.isArray(c)) throw new Error('sin aparatos ni cables');
					resumen = `${d.length} aparatos, ${c.length} cables`;
				} catch {
					return `
			<article class="tarjeta-ejemplo en-cuarentena">
				<h4>${escaparHtml(p.nombre)}</h4>
				<p>⚠️ Esta plantilla está dañada y no se puede abrir. Las demás sí.</p>
				<div class="acciones-ejemplo">
					<button class="boton" data-bajar-plantilla="${i}" title="Descargar el texto guardado, tal cual está">⬇️ Descargar</button>
					<button class="boton peligro" data-borrar-plantilla="${i}" title="Quitarla de la lista">🗑️</button>
				</div>
			</article>`;
				}
				const fecha = Number.isFinite(Date.parse(p.fecha))
					? new Date(p.fecha).toLocaleDateString('es-CL') : 'fecha desconocida';
				return `
			<article class="tarjeta-ejemplo">
				<h4>${escaparHtml(p.nombre)}</h4>
				<p>Guardada el ${escaparHtml(fecha)} · ${escaparHtml(resumen)}</p>
				<div class="acciones-ejemplo">
					<button class="boton primario" data-plantilla="${i}">Abrir</button>
					<button class="boton peligro" data-borrar-plantilla="${i}" title="Eliminar esta plantilla">🗑️</button>
				</div>
			</article>`;
			}).join('')
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
	async function abrirPlantilla(indice: number): Promise<void> {
		const p = plantillasGuardadas()[indice];
		if (!p) return;
		let nuevo: Proyecto;
		try {
			nuevo = cargarProyecto(JSON.stringify(p.proyecto)).proyecto;
		} catch (e) {
			avisar(`No se pudo abrir la plantilla «${p.nombre}»: ${(e as Error).message}`, 'error');
			return;
		}
		nuevo.nombre = p.nombre;
		try {
			// Reencuadra por dentro. Segunda auditoría, TS2-P2-13: sin eso, una plantilla de una
			// placa muy distinta a la que había en pantalla se abría fuera de escala y parecía
			// vacía, con el tablero fuera del cuadro.
			await ctx.reemplazarProyecto(nuevo);
		} catch {
			avisar(`No se pudo abrir la plantilla «${p.nombre}». El tablero que tenías sigue como estaba.`, 'error');
			return;
		}
		olvidarEjemplo();
		cerrarVentana('modal-ejemplos');
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
	($('btn-cerrar-ejemplos') as HTMLButtonElement).onclick = () => cerrarVentana('modal-ejemplos');
	($('btn-cerrar-explicacion') as HTMLButtonElement).onclick = () => cerrarVentana('modal-explicacion');
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

	/*
	 * QUÉ PANTALLA PIDE CADA HERRAMIENTA, DICHO ANTES DE ENTRAR.
	 *
	 * Tercera auditoría, TS3-P2-09: «La mejora responsive se concentra en Planta. El editor
	 * mantiene paneles laterales de aproximadamente 306 px y 300 px; en anchuras pequeñas el área
	 * útil del tablero queda cubierta o casi nula. […] No presentar "responsive" como propiedad de
	 * toda la aplicación mientras solo una herramienta lo sea».
	 *
	 * Es verdad, y la salida honesta es la segunda que propone el informe: fijar una anchura mínima
	 * y decirla. Los 1024 px salen de la cuenta: 306 + 300 de paneles dejan menos de 420 px de
	 * placa, y en 420 px no se coloca un aparato en un riel ni se cablea un borne. Poner cajones
	 * como los de la Planta sería otra cosa —y otro trabajo—, no un ajuste de CSS.
	 *
	 * Se avisa aquí, en la pantalla donde se ELIGE herramienta, y no cuando ya está el tablero
	 * abierto y tapado. Y se dice también lo que sí sirve: la Planta, que es justo la que se lleva
	 * a la cubierta.
	 */
	const ANCHO_MINIMO_EDITOR = 1024;
	function declararAnchoMinimo(): void {
		const aviso = $('inicio-aviso-ancho');
		const estrecho = window.innerWidth < ANCHO_MINIMO_EDITOR;
		aviso.hidden = !estrecho;
		if (!estrecho) return;
		aviso.textContent = `Esta pantalla mide ${window.innerWidth} px de ancho. El editor de `
			+ `tableros necesita ${ANCHO_MINIMO_EDITOR} px o más: por debajo, los dos paneles `
			+ 'laterales se comen la placa y no queda sitio para trabajar. La Planta 3D sí funciona '
			+ 'aquí —buscar máquinas, ver sus puntos y medir tiradas—, que es para lo que se baja a '
			+ 'la cubierta con el teléfono.';
	}
	declararAnchoMinimo();
	window.addEventListener('resize', declararAnchoMinimo);

	($('btn-inicio') as HTMLButtonElement).onclick = mostrarInicio;
	($('inicio-tableros') as HTMLButtonElement).onclick = ocultarInicio;
	($('inicio-terreno') as HTMLButtonElement).onclick = () => { ocultarInicio(); void ctx.irAPlanta(); };
	($('inicio-abrir') as HTMLButtonElement).onclick = () => { ocultarInicio(); $('btn-abrir').click(); };
	($('inicio-ejemplos') as HTMLButtonElement).onclick = () => { ocultarInicio(); abrirBibliotecaEjemplos(); };
	($('inicio-guia') as HTMLButtonElement).onclick = () => {
		ocultarInicio();
		abrirVentana('modal-ayuda');
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
			if (saltarInicio) abrirVentana('modal-ayuda');
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
