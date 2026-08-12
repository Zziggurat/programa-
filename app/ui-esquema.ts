/**
 * La vista de esquema: el plano de mando y potencia.
 *
 * Es el documento con el que trabaja el electricista y el que se entrega al cliente. Se monta
 * desde el MISMO modelo que el 3D —no hay dos verdades— y se muestra como una capa por encima del
 * lienzo. Aquí está todo lo suyo: montar las hojas, pasarlas, el zoom, colocar los símbolos a mano
 * arrastrándolos y las tres exportaciones (PDF, SVG y DXF).
 *
 * No importa nada de `main.ts`: lo que necesita del editor entra por `ContextoEsquema`.
 */
import { Proyecto } from '../src/modelo/tipos.js';
import { cerrarTodasLasVentanas } from './ventanas.js';
import { ResultadoPotenciales } from '../src/motores/potenciales.js';
import {
	anchoColumna, filaDeAltura, HOJA_A3, HojaEsq, MARGEN, montarEsquema,
} from '../src/motores/esquema.js';
import { hojaASvg } from './esquema-svg.js';
import { exportarEsquemaPDF } from './esquema-pdf.js';
import { dxfDeEsquema } from './exportaciones.js';
import { avisar, confirmar, descargar, pedirTexto } from './dialogos.js';

/** Lo que la vista de esquema necesita del editor. */
export interface ContextoEsquema {
	proyecto: () => Proyecto;
	potenciales: () => ResultadoPotenciales;
	/** El aparato seleccionado ahora mismo, para resaltarlo en la hoja. */
	dispositivoSeleccionado: () => string | undefined;
	/** Selecciona un aparato en todo el programa (el esquema y el 3D son dos vistas del mismo). */
	seleccionar: (id: string) => void;
	/**
	 * Guarda un punto de deshacer antes de cambiar nada, y DICE SI SE PUEDE CAMBIAR: en un tablero
	 * de ejemplo dice que no. Quien la llama tiene que mirar el resultado y no tocar nada si es
	 * `false`; `test/solo-lectura.test.ts` comprueba que nadie se lo salte.
	 */
	capturar: () => boolean;
	marcarSucio: () => void;
	actualizarTodo: () => void;
	/** Nombre base de archivo del proyecto, ya saneado. */
	nombreArchivo: () => string;
	/** Cierra la capa de Visualización: las dos capas no pueden convivir. */
	cerrarVisualizacion: () => void;
}

/** Lo que el editor puede pedirle a la vista de esquema una vez instalada. */
export interface PanelEsquema {
	abierto: () => boolean;
	abrir: (abrir: boolean) => void;
	/** Vuelve a montar el esquema desde el modelo y lo pinta. No hace nada si está cerrado. */
	refrescar: () => void;
	/** Recalcula el tamaño de la hoja (al cambiar el tamaño de la ventana). */
	reajustarZoom: () => void;
	/** Pasa de hoja (+1 siguiente, -1 anterior). */
	pasarHoja: (delta: number) => void;
}

const $ = (id: string): HTMLElement => document.getElementById(id)!;

export function instalarEsquema(ctx: ContextoEsquema): PanelEsquema {
	const proyecto = ctx.proyecto;
	const { capturar, marcarSucio, actualizarTodo, seleccionar, nombreArchivo } = ctx;

	/** La capa está delante del lienzo (como el modo Visualización, con el que no puede convivir). */
	let esquemaAbierto = false;
	/** Las hojas montadas del esquema abierto: se rehacen enteras en cada refresco. */
	let hojasEsquema: HojaEsq[] = [];
	let hojaActual = 0;
	let zoomEsquema = 1;

	/**
	 * Cuántas hojas hay para donde arrastrar. Se cuenta UNA MÁS que las montadas: cuando una hoja
	 * se llena, lo que se hace es llevar un aparato a la siguiente, y esa todavía no existe.
	 */
	const totalHojas = (): number => Math.max(1, hojasEsquema.length) + 1;

	/** Vuelve a montar el esquema desde el modelo actual y lo pinta. */
	function refrescarEsquema(): void {
		if (!esquemaAbierto) return;
		hojasEsquema = montarEsquema(proyecto(), ctx.potenciales());
		if (hojasEsquema.length === 0) {
			$('esquema-hoja').innerHTML = '<div id="esquema-vacio">Todavía no hay nada que dibujar.<br>'
				+ 'Coloca aparatos y conéctalos, y el esquema se dibuja solo.</div>';
			$('esq-indicador').textContent = 'Sin hojas';
			$('esq-titulo').textContent = '';
			return;
		}
		hojaActual = Math.max(0, Math.min(hojaActual, hojasEsquema.length - 1));
		const hoja = hojasEsquema[hojaActual];
		$('esquema-hoja').innerHTML = hojaASvg(hoja, {
			proyecto: proyecto().nombre,
			datos: proyecto().datos,
			totalHojas: hojasEsquema.length,
			resaltado: ctx.dispositivoSeleccionado(),
		});
		$('esq-indicador').textContent = `Hoja ${hoja.numero} / ${hojasEsquema.length}`;
		$('esq-titulo').textContent = hoja.titulo;
		($('esq-columnas') as HTMLInputElement).value = String(hoja.columnas);
		// Se dice cuántos aparatos están colocados a mano: si no, «Ordenar solo» parece que no hace
		// nada cuando no hay nada que soltar, y sorprende cuando sí lo hay.
		const aMano = proyecto().dispositivos.filter((d) => d.esquema).length;
		($('esq-auto') as HTMLButtonElement).textContent = aMano ? `⟲ Ordenar solo (${aMano})` : '⟲ Ordenar solo';
		aplicarZoomEsquema();

		// Pinchar un símbolo selecciona ese aparato en todo el programa —el esquema y el 3D son dos
		// vistas del mismo tablero— y arrastrarlo lo COLOCA donde se suelte.
		for (const g of $('esquema-hoja').querySelectorAll<SVGGElement>('[data-dispositivo]')) {
			g.addEventListener('pointerdown', (ev) => empezarArrastreEsquema(ev, g));
		}
	}

	/* ------------------- Colocar los símbolos del esquema a mano ------------------- */

	/**
	 * Arrastrar un símbolo del esquema para ponerlo donde uno quiere.
	 *
	 * El motor propone un orden automático que está bien para empezar, pero el esquema que se
	 * entrega lo ordena una persona: agrupa la maniobra, separa lo que va a campo y deja hueco donde
	 * hará falta. Lo que se suelta se queda ahí (se guarda en el proyecto y entra en el historial de
	 * deshacer), y lo que no se toca se sigue ordenando solo.
	 *
	 * Se SUELTA EN REJILLA —columna entera y una de las ocho filas— y no en cualquier punto: un
	 * esquema que se entrega tiene los aparatos alineados, no puestos a ojo.
	 */
	function empezarArrastreEsquema(ev: PointerEvent, g: SVGGElement): void {
		const id = g.getAttribute('data-dispositivo');
		const hoja = hojasEsquema[hojaActual];
		if (!id || !hoja || ev.button !== 0) return;
		const d = proyecto().dispositivos.find((x) => x.id === id);
		if (!d) return;
		ev.preventDefault();
		seleccionar(id);

		const antes = d.esquema ? { ...d.esquema } : undefined;
		let movido = false;
		let destino = antes;

		/** Píxeles de pantalla → columna y fila de la rejilla del esquema. */
		const rejillaEn = (cx: number, cy: number): { columna: number; fila: number } | undefined => {
			// Se busca el <svg> CADA VEZ: cada repintado rehace el innerHTML de la hoja, y una
			// referencia guardada de antes se queda huérfana devolviendo un rectángulo a cero —con lo
			// que el símbolo se quedaba clavado donde se agarró.
			const svg = $('esquema-hoja').querySelector('svg');
			if (!svg) return undefined;
			const caja = svg.getBoundingClientRect();
			if (caja.width < 1 || caja.height < 1) return undefined;
			const xmm = ((cx - caja.left) / caja.width) * hoja.anchoMm;
			const ymm = ((cy - caja.top) / caja.height) * hoja.altoMm;
			const paso = anchoColumna(HOJA_A3, hoja.columnas);
			const enHoja = Math.floor((xmm - MARGEN.izq) / paso);
			/*
			 * La columna es GLOBAL: la hoja 2 empieza donde acaba la 1, y por eso arrastrar más
			 * allá del borde derecho pasa el aparato a la hoja siguiente.
			 *
			 * Eso decía el comentario y no lo hacía el cálculo. Segunda auditoría, TS2-P2-03: el
			 * `Math.min(hoja.columnas - 1, …)` recortaba la columna DENTRO de la hoja actual antes
			 * de sumarle la base, así que pasarse del borde derecho dejaba el aparato pegado a la
			 * última columna de la misma hoja, y del izquierdo, en la primera. Cruzar de hoja era
			 * imposible por la única vía que el propio comentario anunciaba.
			 *
			 * Ahora se recorta CONTRA EL PLANO ENTERO: al pasarse por la derecha se cae en la
			 * primera columna de la hoja siguiente, y por la izquierda, en la última de la
			 * anterior. El tope sigue estando en la primera y la última columna del esquema, que
			 * es donde tiene que estar.
			 */
			const base = (hoja.numero - 1) * hoja.columnas;
			const global = base + enHoja + 1;
			const ultima = totalHojas() * hoja.columnas;
			return {
				columna: Math.max(1, Math.min(ultima, global)),
				fila: filaDeAltura(ymm),
			};
		};

		const alMover = (e: PointerEvent): void => {
			const r = rejillaEn(e.clientX, e.clientY);
			if (!r) return;
			if (!movido) {
				// Solo se considera arrastre cuando de verdad cambia de casilla: así un clic simple
				// sigue siendo un clic y no mueve nada sin querer.
				if (r.columna === (antes?.columna ?? -1) && r.fila === (antes?.fila ?? -1)) return;
				movido = true;
				if (!capturar()) return;
				$('esquema-hoja').classList.add('arrastrando');
			}
			if (r.columna === destino?.columna && r.fila === destino?.fila) return;
			destino = r;
			d.esquema = r;
			refrescarEsquema();
		};

		const alSoltar = (): void => {
			window.removeEventListener('pointermove', alMover);
			window.removeEventListener('pointerup', alSoltar);
			$('esquema-hoja').classList.remove('arrastrando');
			if (!movido) { refrescarEsquema(); return; }   // fue un clic: solo seleccionar
			marcarSucio();
			actualizarTodo();
			refrescarEsquema();
			avisar(`${d.designacion ?? d.id} colocado en la columna ${d.esquema?.columna}`, 'ok');
		};

		window.addEventListener('pointermove', alMover);
		window.addEventListener('pointerup', alSoltar);
	}

	function aplicarZoomEsquema(): void {
		const hoja = hojasEsquema[hojaActual];
		if (!hoja) return;
		const caja = $('esquema-lienzo').getBoundingClientRect();
		// «Ajustar» = zoom 1: la hoja entra entera con un margen cómodo.
		const base = Math.max(0.05, Math.min((caja.width - 40) / hoja.anchoMm, (caja.height - 40) / hoja.altoMm));
		const escala = base * zoomEsquema;
		const el = $('esquema-hoja');
		el.style.width = `${hoja.anchoMm * escala}px`;
		el.style.height = `${hoja.altoMm * escala}px`;
	}

	function abrirEsquema(abrir: boolean): void {
		// Igual que el dossier: una ventana abierta dejaría el esquema debajo e inerte.
		if (abrir) cerrarTodasLasVentanas();
		esquemaAbierto = abrir;
		($('panel-esquema') as HTMLElement).hidden = !abrir;
		$('btn-esquema').classList.toggle('activo', abrir);
		if (abrir) {
			ctx.cerrarVisualizacion(); // las dos capas no pueden convivir
			zoomEsquema = 1;
			refrescarEsquema();
		}
	}

	/* ------------------------ Botones de la vista de esquema ------------------------ */

	($('btn-esquema') as HTMLButtonElement).onclick = () => abrirEsquema(!esquemaAbierto);
	($('esq-cerrar') as HTMLButtonElement).onclick = () => abrirEsquema(false);
	($('esq-anterior') as HTMLButtonElement).onclick = () => pasarHoja(-1);
	($('esq-siguiente') as HTMLButtonElement).onclick = () => pasarHoja(1);
	($('esq-acercar') as HTMLButtonElement).onclick = () => { zoomEsquema = Math.min(6, zoomEsquema * 1.3); aplicarZoomEsquema(); };
	($('esq-alejar') as HTMLButtonElement).onclick = () => { zoomEsquema = Math.max(0.4, zoomEsquema / 1.3); aplicarZoomEsquema(); };
	($('esq-ajustar') as HTMLButtonElement).onclick = () => { zoomEsquema = 1; aplicarZoomEsquema(); };

	function pasarHoja(delta: number): void {
		hojaActual += delta;
		refrescarEsquema();
	}

	// Columnas por hoja: menos columnas = símbolos más separados y más hojas. Es la palanca que
	// convierte un esquema apretado e ilegible en uno que se lee, sin tocar el circuito.
	($('esq-columnas') as HTMLInputElement).onchange = (ev) => {
		const n = Math.max(4, Math.min(20, Number((ev.target as HTMLInputElement).value) || 10));
		(ev.target as HTMLInputElement).value = String(n);
		if (n === (proyecto().esquema?.columnasPorHoja ?? 10)) return;
		if (!capturar()) return;
		proyecto().esquema = { ...proyecto().esquema, columnasPorHoja: n };
		marcarSucio();
		actualizarTodo();
		refrescarEsquema();
	};

	($('esq-titulo-editar') as HTMLButtonElement).onclick = async () => {
		const hoja = hojasEsquema[hojaActual];
		if (!hoja) { avisar('Todavía no hay ninguna hoja.', 'info'); return; }
		const nuevo = await pedirTexto(`Título de la hoja ${hoja.numero}:`, hoja.titulo);
		if (nuevo === null) return;
		if (!capturar()) return;
		const titulos = { ...(proyecto().esquema?.titulos ?? {}) };
		// Vaciarlo devuelve el título automático, que es lo que espera quien borra el texto.
		if (nuevo.trim()) titulos[String(hoja.numero)] = nuevo.trim();
		else delete titulos[String(hoja.numero)];
		proyecto().esquema = { ...proyecto().esquema, titulos };
		marcarSucio();
		actualizarTodo();
		refrescarEsquema();
	};

	($('esq-auto') as HTMLButtonElement).onclick = async () => {
		const aMano = proyecto().dispositivos.filter((d) => d.esquema);
		if (aMano.length === 0) { avisar('El esquema ya está ordenado solo: no has movido nada.', 'info'); return; }
		if (!(await confirmar(
			`Se van a soltar las ${aMano.length} colocaciones hechas a mano y el esquema volverá a `
			+ 'ordenarse solo. Ctrl+Z lo deshace.',
			{ ok: 'Ordenar solo' },
		))) return;
		if (!capturar()) return;
		for (const d of aMano) delete d.esquema;
		marcarSucio();
		actualizarTodo();
		refrescarEsquema();
		avisar('Esquema reordenado automáticamente', 'ok');
	};

	/* ---------------------- Lo que sale de aquí: PDF, SVG y DXF ---------------------- */

	($('esq-pdf') as HTMLButtonElement).onclick = async () => {
		if (hojasEsquema.length === 0) { avisar('No hay esquema que exportar todavía.', 'info'); return; }
		const btn = $('esq-pdf') as HTMLButtonElement;
		btn.disabled = true;
		const antes = btn.textContent;
		btn.textContent = 'Generando…';
		try {
			await exportarEsquemaPDF(hojasEsquema, proyecto().nombre, `${nombreArchivo()}-esquema.pdf`, proyecto().datos ?? {});
			avisar(`Esquema exportado (${hojasEsquema.length} hoja${hojasEsquema.length > 1 ? 's' : ''})`, 'ok');
		} catch (e) {
			avisar(`No se pudo exportar el esquema: ${(e as Error).message}`, 'error');
		} finally {
			btn.disabled = false;
			btn.textContent = antes;
		}
	};

	($('esq-svg') as HTMLButtonElement).onclick = () => {
		const hoja = hojasEsquema[hojaActual];
		if (!hoja) { avisar('No hay ninguna hoja que descargar.', 'info'); return; }
		// Se descarga en tinta negra sobre papel blanco: es lo que se imprime y se archiva.
		descargar(
			`${nombreArchivo()}-esquema-${hoja.numero}.svg`,
			hojaASvg(hoja, { proyecto: proyecto().nombre, datos: proyecto().datos, totalHojas: hojasEsquema.length }),
			'image/svg+xml',
		);
		avisar(`Hoja ${hoja.numero} descargada en SVG`, 'ok');
	};

	($('btn-dxf-esquema') as HTMLButtonElement).onclick = () => {
		/*
		 * SIEMPRE DESDE EL PROYECTO DE AHORA, no desde lo que quedó montado.
		 *
		 * Segunda auditoría, TS2-P2-02. Ponía `hojasEsquema.length ? hojasEsquema : montar…`, o
		 * sea: si el esquema se había abierto ALGUNA VEZ se reutilizaban aquellas hojas, aunque
		 * el tablero hubiera cambiado desde entonces. Reproducción: abrir el esquema, cerrarlo,
		 * mover aparatos o cablear, y exportar el DXF sin volver a abrirlo → sale el esquema de
		 * antes. `refrescarEsquema()` no ayuda porque empieza con `if (!esquemaAbierto) return`.
		 *
		 * Montarlo cuesta un instante y el usuario acaba de pedir un archivo: el precio de
		 * hacerlo siempre es nada, y el de no hacerlo es entregar un plano que no es el tablero.
		 */
		const hojas = montarEsquema(proyecto(), ctx.potenciales());
		const hoja = hojas[Math.min(hojaActual, hojas.length - 1)];
		if (!hoja) { avisar('Todavía no hay esquema que exportar.', 'info'); return; }
		descargar(`${nombreArchivo()}-esquema-${hoja.numero}.dxf`, dxfDeEsquema(hoja), 'image/vnd.dxf');
		avisar(`Hoja ${hoja.numero} del esquema exportada a DXF`, 'ok');
	};

	return {
		abierto: () => esquemaAbierto,
		abrir: abrirEsquema,
		refrescar: refrescarEsquema,
		reajustarZoom: aplicarZoomEsquema,
		pasarHoja,
	};
}
