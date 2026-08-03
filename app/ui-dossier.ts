/**
 * VISTA PREVIA DEL DOSSIER, CON SU EDITOR.
 *
 * El dossier ya no se descarga a ciegas: primero se VE, y mientras se ve se puede retocar.
 *
 * Lo que se enseña no es una maqueta parecida al PDF: es EL PDF, metido en un visor del propio
 * navegador. Así no hay dos verdades —lo que se ve y lo que se descarga— que puedan separarse.
 *
 * Lo que se puede tocar es lo que tiene sentido tocar: qué apartados lleva, y lo que uno añade de
 * su cosecha (una carta de presentación, fotos de la obra, el alzado del tablero). Las tablas y
 * las cifras NO se editan a mano a propósito: salen del tablero, y un dossier donde se pudieran
 * escribir a dedo dejaría de valer para lo único que vale, que es ser fiel.
 *
 * VIVE APARTE DE `main.ts` y no importa nada de él: todo lo que necesita del resto del programa
 * —el proyecto, avisar, marcar sucio, la foto del tablero— se lo pasan al instalarlo. Es lo que
 * permite leer este archivo entero sin tener el editor delante.
 */
import { Proyecto } from '../src/modelo/tipos.js';
import {
	AjustesDossier, BloqueDossier, COLOR_POR_DEFECTO, FUENTES, PAPELES, PapelDossier,
	SECCIONES_DOSSIER, TAMANOS, TrozoTexto, saleSeccion, seccionesOrdenadas,
} from '../src/modelo/dossier.js';
import { descargar, escaparHtml } from './dialogos.js';

/** Lo que el editor del dossier necesita del resto del programa. */
export interface ContextoDossier {
	/** El tablero de ahora mismo. Es una función porque el proyecto se reemplaza al abrir otro. */
	proyecto: () => Proyecto;
	avisar: (mensaje: string, tono?: 'ok' | 'info' | 'error') => void;
	marcarSucio: () => void;
	capturar: () => void;
	/** Una foto del tablero como se ve ahora: en 3D o en alzado 2D. La saca la escena. */
	fotoDelTablero: (en2D: boolean) => string;
}

const $ = (id: string): HTMLElement => document.getElementById(id)!;

/**
 * Engancha todo el editor del dossier a su panel. Se llama una vez al arrancar.
 *
 * Devuelve la única puerta que el resto del programa necesita: abrir o cerrar el panel.
 */
export function instalarDossier(ctx: ContextoDossier): { abrir: (abrir: boolean) => void } {
	const { avisar, marcarSucio, capturar, fotoDelTablero } = ctx;
	const proyecto = ctx.proyecto;

	let urlDossier: string | undefined;
	let generandoDossier = false;

	function ajustesDossier(): AjustesDossier {
		const p = proyecto();
		if (!p.dossier) p.dossier = {};
		return p.dossier;
	}

	/** Vuelve a generar el PDF y lo enseña. Se llama cada vez que se toca algo del editor. */
	async function refrescarDossier(): Promise<void> {
		if (generandoDossier) return;
		generandoDossier = true;
		$('dos-estado').textContent = 'Generando…';
		try {
			const { dossierComoBlob } = await import('./pdf.js');
			// Un respiro para que el navegador pinte el «Generando…» antes de bloquearse con el PDF.
			await new Promise((r) => setTimeout(r, 0));
			const blob = dossierComoBlob(proyecto());
	        if (urlDossier) URL.revokeObjectURL(urlDossier);
			urlDossier = URL.createObjectURL(blob);
			// `#toolbar=1` deja los controles del visor; `#view=FitH` abre la página entera a lo ancho.
			$('dos-vista').innerHTML = `<iframe src="${urlDossier}#view=FitH" title="Vista previa del dossier"></iframe>`;
			$('dos-estado').textContent = `${Math.round(blob.size / 1024)} KB`;
		} catch (e) {
			$('dos-vista').innerHTML = '<div class="cargando">No se pudo generar el dossier: '
				+ escaparHtml((e as Error).message) + '</div>';
			$('dos-estado').textContent = '';
		} finally {
			generandoDossier = false;
		}
	}

	/** Repinta el editor lateral y vuelve a generar el PDF. */
	function actualizarDossier(): void {
		marcarSucio();
		pintarEditorDossier();
		void refrescarDossier();
	}

	function pintarEditorDossier(): void {
		const a = ajustesDossier();
		const orden = seccionesOrdenadas(a);
		$('dos-secciones').innerHTML = orden.map((sec, i) => {
			const marcado = saleSeccion(a, sec.id) ? ' checked' : '';
			return `<div class="dos-sec${sec.fijo ? ' fijo' : ''}">`
				+ `<label><input type="checkbox" data-sec="${escaparHtml(sec.id)}"${marcado}${sec.fijo ? ' disabled' : ''}>`
				+ `${escaparHtml(sec.nombre)}</label>`
				+ (sec.fijo ? '<span class="candado" title="No se puede quitar: es lo que hace defendible el documento">🔒</span>' : '')
				+ `<button class="mover" data-sube="${i}" title="Antes"${i === 0 ? ' disabled' : ''}>▲</button>`
				+ `<button class="mover" data-baja="${i}" title="Después"${i === orden.length - 1 ? ' disabled' : ''}>▼</button>`
				+ '</div>';
		}).join('');
		for (const c of $('dos-secciones').querySelectorAll<HTMLInputElement>('[data-sec]')) {
			c.onchange = () => {
				a.secciones = { ...a.secciones, [c.dataset.sec!]: c.checked };
				actualizarDossier();
			};
		}
		// Mover un apartado guarda el orden ENTERO, no solo lo que cambió: así el archivo dice
		// siempre qué documento quiere el usuario, y no depende de en qué orden venían.
		const mover = (desde: number, hasta: number): void => {
			if (hasta < 0 || hasta >= orden.length) return;
			capturar();
			const ids = orden.map((sec) => sec.id);
			const [id] = ids.splice(desde, 1);
			ids.splice(hasta, 0, id);
			a.orden = ids;
			actualizarDossier();
		};
		for (const b of $('dos-secciones').querySelectorAll<HTMLButtonElement>('[data-sube]')) {
			const i = Number(b.dataset.sube);
			b.onclick = () => mover(i, i - 1);
		}
		for (const b of $('dos-secciones').querySelectorAll<HTMLButtonElement>('[data-baja]')) {
			const i = Number(b.dataset.baja);
			b.onclick = () => mover(i, i + 1);
		}
		pintarIdentidad();
		pintarBloquesDossier();
	}

	/**
	 * Quién firma y cómo se ve el documento.
	 *
	 * Se repinta con el editor porque el proyecto puede haberse cambiado entero al abrir otro
	 * archivo, y entonces la empresa y el color son los de ESE proyecto, no los que quedaron en los
	 * recuadros.
	 */
	function pintarIdentidad(): void {
		const a = ajustesDossier();
		const emp = a.empresa ?? {};
		($('dos-empresa-nombre') as HTMLInputElement).value = emp.nombre ?? '';
		($('dos-empresa-contacto') as HTMLInputElement).value = emp.contacto ?? '';
		const vista = $('dos-logo-vista') as HTMLImageElement;
		vista.hidden = !emp.logo;
		if (emp.logo) vista.src = emp.logo;
		($('dos-logo-quitar') as HTMLElement).hidden = !emp.logo;
		($('dos-color') as HTMLInputElement).value = a.color ?? COLOR_POR_DEFECTO;
		($('dos-papel') as HTMLSelectElement).innerHTML = PAPELES.map((pap) =>
			`<option value="${pap.id}"${(a.papel ?? 'a4') === pap.id ? ' selected' : ''}>${escaparHtml(pap.nombre)}</option>`,
		).join('');
	}

	/** Cambia algo de la identidad y regenera. `capturar` deja el cambio en el deshacer. */
	function tocarIdentidad(cambio: (a: AjustesDossier) => void): void {
		capturar();
		cambio(ajustesDossier());
		actualizarDossier();
	}

	function pintarBloquesDossier(): void {
		const a = ajustesDossier();
		const bloques = a.bloques ?? [];
		const cont = $('dos-bloques');
		if (bloques.length === 0) {
			cont.innerHTML = '<div id="dos-vacio">Todavía no has añadido nada. Con los botones de abajo '
				+ 'puedes meter una carta de presentación, una foto de la obra o el alzado del tablero.</div>';
			return;
		}
		const DONDE: [string, string][] = [
			['portada', 'En la portada'], ['principio', 'Al principio'], ['final', 'Al final'],
		];
		cont.innerHTML = bloques.map((b, i) => {
			const opciones = DONDE.map(([v, t]) =>
				`<option value="${v}"${b.donde === v ? ' selected' : ''}>${t}</option>`).join('');
			const cuerpo = b.tipo === 'imagen'
				? `<img class="dos-imagen" src="${escaparHtml(b.imagen ?? '')}" alt="">`
					+ `<input type="text" data-pie="${i}" placeholder="Pie de foto (opcional)" value="${escaparHtml(b.pie ?? '')}">`
					+ `<div class="dos-mini"><span style="font-size:11.5px;color:var(--texto-suave)">Ancho</span>`
					+ `<select data-ancho="${i}">${[40, 55, 70, 85, 100].map((v) =>
						`<option value="${v}"${(b.anchoPct ?? 100) === v ? ' selected' : ''}>${v} %</option>`).join('')}</select></div>`
				: barraDeFormato(i)
					+ `<div class="dos-texto" contenteditable="true" data-texto="${i}">${htmlDeTrozos(b.trozos)}</div>`;
			return `<div class="dos-bloque">`
				+ `<div class="cab"><span class="que">${b.tipo === 'imagen' ? '🖼️ Imagen' : '✏️ Texto'}</span>`
				+ `<button data-subir="${i}" title="Subir">▲</button>`
				+ `<button data-bajar="${i}" title="Bajar">▼</button>`
				+ `<button data-borrar="${i}" title="Quitar del dossier">✕</button></div>`
				+ `<input type="text" data-titulo="${i}" placeholder="Título del apartado (opcional)" value="${escaparHtml(b.titulo ?? '')}">`
				+ `<div class="dos-mini"><select data-donde="${i}">${opciones}</select></div>`
				+ cuerpo + '</div>';
		}).join('');
		engancharBloquesDossier();
	}

	/** La barra tipo Word: negrita, cursiva, tamaño y fuente. */
	function barraDeFormato(i: number): string {
		return '<div class="dos-formato">'
			+ `<button data-fmt="bold" data-b="${i}" class="negrita" title="Negrita (Ctrl+B)">B</button>`
			+ `<button data-fmt="italic" data-b="${i}" class="cursiva" title="Cursiva (Ctrl+I)">I</button>`
			+ `<select data-tam="${i}" title="Tamaño de letra"><option value="">Tamaño</option>`
			+ TAMANOS.map((t) => `<option value="${t}">${t} pt</option>`).join('') + '</select>'
			+ `<select data-fuente="${i}" title="Tipo de letra"><option value="">Fuente</option>`
			+ FUENTES.map((f) => `<option value="${f.id}">${escaparHtml(f.nombre.split(' ')[0])}</option>`).join('')
			+ '</select></div>';
	}

	function engancharBloquesDossier(): void {
		const a = ajustesDossier();
		const bloques = a.bloques ?? [];
		const cont = $('dos-bloques');
		const idx = (el: Element, attr: string): number => Number((el as HTMLElement).dataset[attr]);

		for (const el of cont.querySelectorAll<HTMLButtonElement>('[data-borrar]')) {
			el.onclick = () => { bloques.splice(idx(el, 'borrar'), 1); actualizarDossier(); };
		}
		for (const el of cont.querySelectorAll<HTMLButtonElement>('[data-subir]')) {
			el.onclick = () => {
				const i = idx(el, 'subir');
				if (i === 0) return;
				[bloques[i - 1], bloques[i]] = [bloques[i], bloques[i - 1]];
				actualizarDossier();
			};
		}
		for (const el of cont.querySelectorAll<HTMLButtonElement>('[data-bajar]')) {
			el.onclick = () => {
				const i = idx(el, 'bajar');
				if (i >= bloques.length - 1) return;
				[bloques[i + 1], bloques[i]] = [bloques[i], bloques[i + 1]];
				actualizarDossier();
			};
		}
		for (const el of cont.querySelectorAll<HTMLInputElement>('[data-titulo]')) {
			el.onchange = () => { bloques[idx(el, 'titulo')].titulo = el.value.trim() || undefined; actualizarDossier(); };
		}
		for (const el of cont.querySelectorAll<HTMLInputElement>('[data-pie]')) {
			el.onchange = () => { bloques[idx(el, 'pie')].pie = el.value.trim() || undefined; actualizarDossier(); };
		}
		for (const el of cont.querySelectorAll<HTMLSelectElement>('[data-donde]')) {
			el.onchange = () => {
				bloques[idx(el, 'donde')].donde = el.value as BloqueDossier['donde'];
				actualizarDossier();
			};
		}
		for (const el of cont.querySelectorAll<HTMLSelectElement>('[data-ancho]')) {
			el.onchange = () => { bloques[idx(el, 'ancho')].anchoPct = Number(el.value); actualizarDossier(); };
		}
		// Formato: se aplica sobre lo SELECCIONADO, como en cualquier procesador de textos.
		for (const el of cont.querySelectorAll<HTMLButtonElement>('[data-fmt]')) {
			el.onmousedown = (ev) => ev.preventDefault();   // no perder la selección al pulsar
			el.onclick = () => { document.execCommand(el.dataset.fmt!); guardarTexto(idx(el, 'b')); };
		}
		for (const el of cont.querySelectorAll<HTMLSelectElement>('[data-tam]')) {
			el.onchange = () => {
				if (el.value) aplicarEstiloASeleccion('font-size', `${el.value}pt`);
				el.value = '';
				guardarTexto(idx(el, 'tam'));
			};
		}
		for (const el of cont.querySelectorAll<HTMLSelectElement>('[data-fuente]')) {
			el.onchange = () => {
				if (el.value) aplicarEstiloASeleccion('font-family', el.value);
				el.value = '';
				guardarTexto(idx(el, 'fuente'));
			};
		}
		for (const el of cont.querySelectorAll<HTMLElement>('[data-texto]')) {
			// Se guarda al salir del recuadro y no en cada tecla: regenerar el PDF con cada letra
			// dejaría el programa a tirones.
			el.onblur = () => guardarTexto(idx(el, 'texto'));
			el.onkeydown = (ev) => {
				if (!(ev.ctrlKey || ev.metaKey)) return;
				const k = ev.key.toLowerCase();
				if (k !== 'b' && k !== 'i') return;
				ev.preventDefault();
				document.execCommand(k === 'b' ? 'bold' : 'italic');
			};
		}
	}

	/** Envuelve lo seleccionado en un <span> con el estilo pedido. */
	function aplicarEstiloASeleccion(propiedad: string, valor: string): void {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
			avisar('Selecciona antes el texto que quieres cambiar.', 'info');
			return;
		}
		const span = document.createElement('span');
		span.style.setProperty(propiedad, valor);
		try {
			span.appendChild(sel.getRangeAt(0).extractContents());
			sel.getRangeAt(0).insertNode(span);
		} catch {
			avisar('No se pudo aplicar el formato a esa selección.', 'info');
		}
	}

	/** Lee el recuadro editable y guarda su contenido con formato en el proyecto(). */
	function guardarTexto(i: number): void {
		const bloques = ajustesDossier().bloques ?? [];
		const caja = $('dos-bloques').querySelector<HTMLElement>(`[data-texto="${i}"]`);
		if (!caja || !bloques[i]) return;
		const nuevos = trozosDelDom(caja);
		if (JSON.stringify(nuevos) === JSON.stringify(bloques[i].trozos)) return;   // nada que hacer
		bloques[i].trozos = nuevos;
		marcarSucio();
		void refrescarDossier();
	}

	/**
	 * Convierte lo que hay en un recuadro editable en trozos con formato.
	 *
	 * Se recorre el DOM en vez de leer el HTML como texto porque el navegador escribe lo que quiere
	 * —<b>, <strong>, <span style="font-weight:700">, todo mezclado— y lo único que se puede dar por
	 * bueno es el estilo YA CALCULADO de cada nodo, que es lo que se pregunta aquí.
	 */
	function trozosDelDom(raiz: HTMLElement): TrozoTexto[] {
		const trozos: TrozoTexto[] = [];
		const anadir = (texto: string, el: HTMLElement | null): void => {
			if (!texto) return;
			const est = el ? getComputedStyle(el) : undefined;
			const familia = (est?.fontFamily ?? '').toLowerCase();
			const tam = est ? Math.round(parseFloat(est.fontSize) * 0.75) : undefined;   // px → pt
			trozos.push({
				texto,
				negrita: est ? Number(est.fontWeight) >= 600 || est.fontWeight === 'bold' : undefined,
				cursiva: est ? est.fontStyle === 'italic' : undefined,
				// Solo se guarda el tamaño si NO es el del recuadro: así el bloque manda por defecto.
				tam: tam && tam !== 13 ? tam : undefined,
				fuente: familia.includes('times') ? 'times' : familia.includes('courier') ? 'courier' : undefined,
			});
		};
		const recorrer = (nodo: Node, padre: HTMLElement | null): void => {
			for (const hijo of Array.from(nodo.childNodes)) {
				if (hijo.nodeType === Node.TEXT_NODE) { anadir(hijo.textContent ?? '', padre); continue; }
				if (!(hijo instanceof HTMLElement)) continue;
				if (hijo.tagName === 'BR') { trozos.push({ texto: '\n' }); continue; }
				// Un <div> o un <p> dentro del editable son párrafos: llevan salto delante.
				if ((hijo.tagName === 'DIV' || hijo.tagName === 'P') && trozos.length) trozos.push({ texto: '\n' });
				recorrer(hijo, hijo);
			}
		};
		recorrer(raiz, null);
		return trozos.filter((t) => t.texto !== '');
	}

	/** Y al revés: los trozos guardados vuelven a HTML para poderlos editar. */
	function htmlDeTrozos(trozos: TrozoTexto[] | undefined): string {
		if (!trozos?.length) return '';
		return trozos.map((t) => {
			if (t.texto === '\n') return '<br>';
			const estilos = [
				t.negrita ? 'font-weight:700' : '',
				t.cursiva ? 'font-style:italic' : '',
				t.tam ? `font-size:${t.tam}pt` : '',
				t.fuente ? `font-family:${t.fuente}` : '',
			].filter(Boolean).join(';');
			const texto = escaparHtml(t.texto).replace(/\n/g, '<br>');
			return estilos ? `<span style="${estilos}">${texto}</span>` : texto;
		}).join('');
	}

	/** Añade un bloque nuevo al final y repinta. */
	function anadirBloque(b: Omit<BloqueDossier, 'id'>): void {
		capturar();
		const a = ajustesDossier();
		a.bloques = [...(a.bloques ?? []), { ...b, id: `b${Date.now().toString(36)}` }];
		actualizarDossier();
	}

	/**
	 * Una foto del tablero tal como se está viendo, para meterla en el dossier.
	 *
	 * El lienzo se dibuja a propósito justo antes de leerlo: con `preserveDrawingBuffer` el contenido
	 * sobrevive al fotograma, pero si la escena cambió y aún no se ha repintado, se copiaría la de
	 * antes. Para el alzado se cambia a 2D, se dibuja, se lee y se deja la vista como estaba.
	 */
	function abrirDossier(abrir: boolean): void {
		($('panel-dossier') as HTMLElement).hidden = !abrir;
		if (!abrir) {
			if (urlDossier) { URL.revokeObjectURL(urlDossier); urlDossier = undefined; }
			$('dos-vista').innerHTML = '<div class="cargando">Generando el dossier…</div>';
			return;
		}
		pintarEditorDossier();
		void refrescarDossier();
	}

	($('btn-pdf') as HTMLButtonElement).onclick = () => abrirDossier(true);
	($('dos-cerrar') as HTMLButtonElement).onclick = () => abrirDossier(false);
	($('dos-refrescar') as HTMLButtonElement).onclick = () => { void refrescarDossier(); };
	($('dos-descargar') as HTMLButtonElement).onclick = async () => {
		try {
			const { exportarPDF } = await import('./pdf.js');
			exportarPDF(proyecto());
			avisar('Dossier descargado', 'ok');
		} catch (e) {
			avisar('No se pudo generar el PDF: ' + (e as Error).message, 'error');
		}
	};
	/* ---- Quién firma y cómo se ve ---- */
	($('dos-empresa-nombre') as HTMLInputElement).onchange = (ev) => {
		const v = (ev.target as HTMLInputElement).value.trim();
		tocarIdentidad((a) => { a.empresa = { ...a.empresa, nombre: v || undefined }; });
	};
	($('dos-empresa-contacto') as HTMLInputElement).onchange = (ev) => {
		const v = (ev.target as HTMLInputElement).value.trim();
		tocarIdentidad((a) => { a.empresa = { ...a.empresa, contacto: v || undefined }; });
	};
	($('dos-logo') as HTMLButtonElement).onclick = () => ($('dos-logo-archivo') as HTMLInputElement).click();
	($('dos-logo-quitar') as HTMLButtonElement).onclick = () =>
		tocarIdentidad((a) => { a.empresa = { ...a.empresa, logo: undefined }; });
	($('dos-logo-archivo') as HTMLInputElement).onchange = (ev) => {
		const archivo = (ev.target as HTMLInputElement).files?.[0];
		(ev.target as HTMLInputElement).value = '';
		if (!archivo) return;
		// Un logo de 8 MB se guardaría dentro del proyecto y llenaría el cupo del navegador. Se
		// avisa, en vez de aceptarlo callando y que el guardado falle luego sin explicar por qué.
		if (archivo.size > 2_000_000) {
			avisar('El logo pesa más de 2 MB. Usa uno más pequeño: en el papel sale a 2 cm.', 'info');
			return;
		}
		const lector = new FileReader();
		lector.onload = () => tocarIdentidad((a) => {
			a.empresa = { ...a.empresa, logo: String(lector.result) };
		});
		lector.readAsDataURL(archivo);
	};
	($('dos-color') as HTMLInputElement).onchange = (ev) => {
		const v = (ev.target as HTMLInputElement).value;
		tocarIdentidad((a) => { a.color = v; });
	};
	($('dos-color-reset') as HTMLButtonElement).onclick = () =>
		tocarIdentidad((a) => { a.color = undefined; });
	($('dos-papel') as HTMLSelectElement).onchange = (ev) => {
		const v = (ev.target as HTMLSelectElement).value as PapelDossier;
		tocarIdentidad((a) => { a.papel = v; });
	};

	($('dos-add-texto') as HTMLButtonElement).onclick = () => anadirBloque({
		tipo: 'texto', donde: 'principio', titulo: 'Presentación',
		trozos: [{ texto: 'Escribe aquí lo que quieras contarle al cliente. Selecciona un trozo y usa '
			+ 'B, I, el tamaño o la fuente para darle formato.' }],
	});
	($('dos-add-imagen') as HTMLButtonElement).onclick = () => ($('dos-archivo') as HTMLInputElement).click();
	($('dos-archivo') as HTMLInputElement).onchange = (ev) => {
		const archivo = (ev.target as HTMLInputElement).files?.[0];
		(ev.target as HTMLInputElement).value = '';
		if (!archivo) return;
		const lector = new FileReader();
		lector.onload = () => anadirBloque({
			tipo: 'imagen', donde: 'final', imagen: String(lector.result), anchoPct: 100,
			pie: archivo.name.replace(/\.[^.]+$/, ''),
		});
		lector.readAsDataURL(archivo);
	};
	($('dos-add-3d') as HTMLButtonElement).onclick = () => anadirBloque({
		tipo: 'imagen', donde: 'final', imagen: fotoDelTablero(false), anchoPct: 100,
		titulo: 'El tablero en 3D', pie: 'Vista del tablero tal como queda montado.',
	});
	($('dos-add-2d') as HTMLButtonElement).onclick = () => anadirBloque({
		tipo: 'imagen', donde: 'final', imagen: fotoDelTablero(true), anchoPct: 100,
		titulo: 'Alzado del tablero', pie: 'Alzado de frente, sin perspectiva: las medidas se comparan.',
	});

	return { abrir: abrirDossier };
}
