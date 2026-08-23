/**
 * Dossier técnico del tablero en PDF (jsPDF).
 *
 * El documento describe EL TABLERO QUE HAY EN PANTALLA, no una plantilla: todo se recalcula
 * en el momento de exportar a partir del modelo. Por eso incluye el plano de la placa a
 * escala con los aparatos en su sitio, sus medidas reales y el recuento por familias: es lo
 * que permite a un cliente reconocer su tablero en el papel y a un taller fabricarlo.
 *
 * Orden del documento:
 *   Portada · 1 Ficha del tablero · 2 Disposición de la placa (a escala) · 3 Componentes
 *   4 Lista de materiales · 5 Índice de aparatos · 6 Conductores · 7 Referencias cruzadas
 *   8 Borneros · 9 Verificación eléctrica
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

import { Proyecto } from '../src/modelo/tipos.js';
import { esReferenciaVisualInerte } from '../src/modelo/apariencia.js';
import { revisarTablero } from '../src/motores/revision.js';
import { fondoDe } from '../src/motores/ficha-tablero.js';
import { factorTemperatura, TEMPERATURA_TABLA_C } from '../src/motores/electrico.js';
import { longitudesDibujadasMm } from './escena3d.js';
import { declarado, opcionesDe } from '../src/modelo/proyecto.js';
import { CONTROLADORES } from './controladores.js';
import { descargar } from './dialogos.js';
import {
	BloqueDossier, EstiloTrozo, aWinAnsi, bloquesEn, colorDossier, repartirEnLineas, saleSeccion,
	seccionesOrdenadas, tintaSobre,
} from '../src/modelo/dossier.js';

const GRIS: [number, number, number] = [90, 98, 106];
const VERDE: [number, number, number] = [30, 130, 60];
const ROJO: [number, number, number] = [176, 48, 48];

/** #rrggbb → componentes 0-255. Los aparatos de catálogo traen su color real. */
function rgb(hex: string | undefined, porDefecto: [number, number, number]): [number, number, number] {
	if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return porDefecto;
	return [
		parseInt(hex.slice(1, 3), 16),
		parseInt(hex.slice(3, 5), 16),
		parseInt(hex.slice(5, 7), 16),
	];
}

const mm = (v: number): string => `${Math.round(v)} mm`;
const metros = (v: number): string => `${(v / 1000).toFixed(2)} m`;

/**
 * Plano de la placa de montaje A ESCALA, con canaletas, rieles y cada aparato en su sitio
 * y con su marca. Es la parte que hace fiel al dossier: se ve el tablero, no una lista.
 * Devuelve la escala usada (mm de papel por mm de tablero).
 */
function dibujarPlaca(
	doc: jsPDF,
	proyecto: Proyecto,
	marco: { x: number; y: number; ancho: number; alto: number },
	color: [number, number, number],
): number {
	const g = proyecto.gabinete;
	if (!g || g.ancho <= 0 || g.alto <= 0) return 0;
	/*
	 * Las cotas se dibujan 6 mm FUERA de la placa, así que la placa no puede ocupar el hueco
	 * entero: hay que dejarles su sitio dentro. Sin esto, en la portada la cota de abajo caía justo
	 * encima del renglón de la escala y se leían las dos cosas encimadas.
	 */
	const COTAS = 10;
	const k = Math.min((marco.ancho - COTAS) / g.ancho, (marco.alto - COTAS) / g.alto);
	// Centrado dentro del hueco, dejando el margen de las cotas.
	const x0 = marco.x + (marco.ancho - COTAS - g.ancho * k) / 2;
	const y0 = marco.y + (marco.alto - COTAS - g.alto * k) / 2;
	const px = (v: number): number => x0 + v * k;
	const py = (v: number): number => y0 + v * k;

	// Placa de montaje.
	doc.setFillColor(246, 247, 248);
	doc.setDrawColor(...GRIS);
	doc.setLineWidth(0.4);
	doc.rect(x0, y0, g.ancho * k, g.alto * k, 'FD');

	// Canaletas: banda ámbar con su tapa insinuada.
	doc.setDrawColor(190, 150, 70);
	doc.setFillColor(240, 219, 176);
	for (const c of g.canaletas) {
		const w = c.orientacion === 'v' ? c.ancho : c.largo;
		const h = c.orientacion === 'v' ? c.largo : c.ancho;
		doc.rect(px(c.x), py(c.y), w * k, h * k, 'FD');
	}
	// Rieles DIN: barra gris de 35 mm.
	doc.setFillColor(203, 209, 214);
	doc.setDrawColor(150, 158, 165);
	for (const r of g.rieles) {
		const w = r.orientacion === 'v' ? 35 : r.largo;
		const h = r.orientacion === 'v' ? r.largo : 35;
		doc.rect(px(r.x), py(r.y), w * k, h * k, 'FD');
	}

	// Aparatos, con su color real y su designación si cabe.
	doc.setLineWidth(0.25);
	for (const col of g.colocaciones) {
		const d = proyecto.dispositivos.find((x) => x.id === col.dispositivoId);
		if (!d) continue;
		const [r, gg, b] = rgb(d.colorCuerpo, [120, 128, 136]);
		doc.setFillColor(r, gg, b);
		doc.setDrawColor(40, 46, 52);
		doc.rect(px(col.x), py(col.y), col.ancho * k, col.alto * k, 'FD');
		const marca = d.designacion ?? '';
		const anchoPapel = col.ancho * k;
		const altoPapel = col.alto * k;
		if (!marca) continue;
		// Tinta clara sobre cuerpo oscuro y al revés, para que la marca se lea siempre.
		const claro = (r * 299 + gg * 587 + b * 114) / 1000 > 150;
		doc.setTextColor(claro ? 25 : 245);
		const cx = px(col.x) + anchoPapel / 2;
		const cy = py(col.y) + altoPapel / 2;
		// Un aparato estrecho (un modular de 18 mm) no admite el rótulo en horizontal: se gira,
		// que es exactamente lo que se hace en un plano de montaje real.
		const largoTexto = marca.length * 0.62;
		if (anchoPapel >= largoTexto * 3.2 && altoPapel > 3) {
			doc.setFontSize(Math.min(6, Math.max(3.6, anchoPapel * 0.3)));
			doc.text(marca, cx, cy + 1, { align: 'center', maxWidth: anchoPapel - 1 });
		} else if (altoPapel >= largoTexto * 3.2 && anchoPapel > 3) {
			doc.setFontSize(Math.min(6, Math.max(3.6, altoPapel * 0.3)));
			doc.text(marca, cx + 1, cy, { align: 'center', angle: 90 });
		}
		// Si no cabe de ninguna de las dos formas, el aparato queda sin rotular en el plano y
		// se localiza por la tabla de posiciones: mejor eso que un texto ilegible encima.
	}

	// Cotas exteriores de la placa, en cm, como se pide una placa al taller.
	doc.setDrawColor(...color);
	doc.setTextColor(...color);
	doc.setFontSize(7.5);
	doc.setLineWidth(0.3);
	const yc = y0 + g.alto * k + 6;
	doc.line(x0, yc, x0 + g.ancho * k, yc);
	doc.line(x0, yc - 1.5, x0, yc + 1.5);
	doc.line(x0 + g.ancho * k, yc - 1.5, x0 + g.ancho * k, yc + 1.5);
	doc.text(mm(g.ancho), x0 + (g.ancho * k) / 2, yc - 1.6, { align: 'center' });
	const xc = x0 + g.ancho * k + 6;
	doc.line(xc, y0, xc, y0 + g.alto * k);
	doc.line(xc - 1.5, y0, xc + 1.5, y0);
	doc.line(xc - 1.5, y0 + g.alto * k, xc + 1.5, y0 + g.alto * k);
	doc.text(mm(g.alto), xc + 1.5, y0 + (g.alto * k) / 2, { angle: 90, align: 'center' });

	doc.setTextColor(0);
	return k;
}

/**
 * Deja las páginas del documento en el orden pedido.
 *
 * `orden` son los números de página ACTUALES, en el orden en que se quieren. Se coloca de la
 * primera a la última llevando la cuenta de dónde ha ido a parar cada una: mover una página
 * desplaza un puesto a todas las que quedan entre su sitio viejo y el nuevo, y sin llevar esa
 * cuenta el documento sale barajado en vez de ordenado.
 */
function reordenarPaginas(doc: jsPDF, orden: number[]): void {
	const posicion = new Map<number, number>();
	for (let i = 1; i <= orden.length; i++) posicion.set(i, i);
	for (let destino = 1; destino <= orden.length; destino++) {
		const cual = orden[destino - 1];
		const actual = posicion.get(cual)!;
		if (actual === destino) continue;
		doc.movePage(actual, destino);
		for (const [pagina, pos] of posicion) {
			if (pagina !== cual && pos >= destino && pos < actual) posicion.set(pagina, pos + 1);
		}
		posicion.set(cual, destino);
	}
}

/** Genera y descarga el dossier técnico del proyecto en PDF. */
/**
 * Arma el dossier y lo devuelve SIN descargarlo.
 *
 * Separado de `exportarPDF()` para que la vista previa pueda enseñarlo antes de que nadie lo
 * guarde: el documento que se ve es exactamente el que se descarga, porque es el mismo.
 */
export function construirDossier(proyecto: Proyecto): jsPDF {
	// Recalcular todo para que el PDF refleje el estado actual del tablero. Sale de UNA sola
	// revisión y con las MISMAS longitudes de cable que usa la pantalla: cuando cada uno hacía su
	// propia cadena, el papel medía los hilos por el ruteo teórico de las canaletas y la pantalla
	// por el trazado dibujado —dos caídas de tensión distintas para el mismo tablero—, y el papel
	// se saltaba la sincronización, así que no avisaba de aparatos sin colocar ni que se pisan.
	const revision = revisarTablero(proyecto, {
		renumerarAparatos: true, // el documento se entrega con la numeración al día
		longitudesMm: longitudesDibujadasMm(proyecto),
	});
	const { potenciales, ruteo, hallazgos, referencias, ficha, termico } = revision;
	const bom = revision.bom;
	const conductores = revision.listaConductores;
	const planes = revision.planesBorneros;
	const datos = proyecto.datos ?? {};
	const opciones = opcionesDe(proyecto);

	// Papel y color los pone quien firma: en Chile lo corriente es Carta, y el azul del programa no
	// tiene por qué ser el color de su empresa.
	const ajustes = proyecto.dossier;
	const doc = new jsPDF({ unit: 'mm', format: ajustes?.papel === 'carta' ? 'letter' : 'a4' });
	const anchoPag = doc.internal.pageSize.getWidth();
	const altoPag = doc.internal.pageSize.getHeight();
	/** Color del documento: el corporativo si lo hay, y si no el azul de siempre. */
	const AZUL = colorDossier(ajustes);
	/** Tinta que se lee sobre ese color (con un corporativo claro, el blanco desaparecía). */
	const TINTA_CAB = tintaSobre(AZUL);
	/** Hasta dónde se escribe antes de saltar de página, y dónde va el pie. Depende del papel. */
	const LIMITE = altoPag - 15;
	const PIE_Y = altoPag - 7;
	const empresa = ajustes?.empresa ?? {};
	const fecha = new Date().toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' });

	/*
	 * TODO lo que se escriba en este documento pasa antes por `aWinAnsi`.
	 *
	 * Las fuentes que trae jsPDF de serie solo saben WinAnsi. Un carácter fuera de ahí no sale mal:
	 * sale ROTO —la fila se estira de lado a lado de la celda y el texto queda cortado— porque el
	 * ancho medido deja de cuadrar con lo que se dibuja. Pasó con un aparato del ejemplo descrito
	 * como «estrella→triángulo».
	 *
	 * Se hace envolviendo `text` y `getTextWidth` del documento, y no en los cien sitios que
	 * escriben: uno solo que se olvide vuelve a romper una página entera, y además así queda
	 * cubierto lo que escribe autoTable por su cuenta, que no pasa por aquí.
	 */
	{
		const escribir = doc.text.bind(doc);
		const medir = doc.getTextWidth.bind(doc);
		type Texto = string | string[];
		const limpiar = (t: Texto): Texto => (Array.isArray(t) ? t.map(aWinAnsi) : aWinAnsi(String(t)));
		doc.text = ((t: Texto, ...resto: unknown[]) =>
			(escribir as (...a: unknown[]) => jsPDF)(limpiar(t), ...resto)) as typeof doc.text;
		doc.getTextWidth = ((t: string) => medir(aWinAnsi(String(t)))) as typeof doc.getTextWidth;
	}

	let y = 0;

	/**
	 * Mete el logo respetando su proporción dentro de la caja que se le da, y devuelve lo que ocupó
	 * de ancho. Devuelve 0 si no hay logo o si el archivo no se deja leer: un PNG roto no puede
	 * tumbar la generación del dossier entero.
	 */
	const ponerLogo = (x: number, yLogo: number, altoMax: number, anchoMax: number): number => {
		if (!empresa.logo) return 0;
		try {
			const props = doc.getImageProperties(empresa.logo);
			const escala = Math.min(altoMax / props.height, anchoMax / props.width);
			const an = props.width * escala;
			doc.addImage(empresa.logo, props.fileType, x, yLogo, an, props.height * escala, undefined, 'FAST');
			return an;
		} catch {
			return 0;
		}
	};

	/** El apartado que se está dibujando, para poder repetirlo si una tabla salta de página. */
	let apartadoActual = '';

	/** Dibuja la banda de cabecera SIN tocar dónde se está escribiendo. */
	const pintarCabecera = (titulo: string): void => {
		doc.setFillColor(...AZUL);
		doc.rect(0, 0, anchoPag, 16, 'F');
		doc.setTextColor(...TINTA_CAB);
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(11);
		// El documento lo firma la empresa, no la herramienta: si hay logo va delante, y si hay
		// nombre manda ese. «TableroStudio» solo sale mientras nadie haya dicho quién firma.
		const anchoLogo = ponerLogo(12, 3, 10, 34);
		doc.text(empresa.nombre || 'TableroStudio', 12 + (anchoLogo ? anchoLogo + 4 : 0), 10);
		doc.setFont('helvetica', 'normal');
		doc.setFontSize(9);
		doc.text(proyecto.nombre, anchoPag - 12, 10, { align: 'right' });
		doc.setTextColor(0);
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(14);
		doc.text(titulo, 12, 27);
		doc.setDrawColor(...AZUL);
		doc.setLineWidth(0.5);
		doc.line(12, 30, anchoPag - 12, 30);
	};

	const cabecera = (titulo: string): void => {
		apartadoActual = titulo;
		pintarCabecera(titulo);
		y = 38;
	};

	const tabla = (cabeceras: string[], filas: (string | number)[][], anchos?: Record<number, number>): void => {
		// Una tabla que arranca a dos dedos del pie deja su encabezado y una fila suelta abajo, y
		// todo lo demás en la página siguiente. Si no queda sitio ni para eso, se pasa entera.
		if (y > LIMITE - 34) { doc.addPage(); pintarCabecera(`${apartadoActual} (continúa)`); y = 38; }
		autoTable(doc, {
			startY: y,
			head: [cabeceras],
			body: filas.map((f) => f.map((c) => (c === undefined || c === null ? '' : String(c)))),
			theme: 'striped',
			headStyles: { fillColor: AZUL, fontSize: 9 },
			bodyStyles: { fontSize: 8.5 },
			alternateRowStyles: { fillColor: [244, 246, 248] },
			// El `top` es para las páginas que abra la PROPIA tabla: ahí la cabecera se repite y la
			// tabla tiene que empezar por debajo de ella.
			margin: { left: 12, right: 12, top: 38 },
			columnStyles: anchos ? Object.fromEntries(Object.entries(anchos).map(([k, v]) => [k, { cellWidth: v }])) : undefined,
			/*
			 * Una tabla larga se parte sola en varias páginas, y las que abría salían DESNUDAS: sin
			 * banda, sin título y sin decir de qué apartado eran. En el dossier de un tablero de
			 * verdad eso dejaba páginas con una tabla suelta flotando y el resto en blanco.
			 */
			didDrawPage: (datos) => {
				if (datos.pageNumber > 1) pintarCabecera(`${apartadoActual} (continúa)`);
			},
		});
		// @ts-expect-error autotable añade lastAutoTable
		y = (doc.lastAutoTable?.finalY ?? y) + 8;
	};

	const errores = hallazgos.filter((h) => h.severidad === 'error').length;
	const avisos = hallazgos.length - errores;

	/* ------------- Lo que añade a mano quien firma el dossier ------------- */

	/** Pone la fuente y el estilo de un trozo en el documento, para medir o para escribir. */
	const ponerEstilo = (e: EstiloTrozo): void => {
		doc.setFont(e.fuente, e.negrita && e.cursiva ? 'bolditalic' : e.negrita ? 'bold' : e.cursiva ? 'italic' : 'normal');
		doc.setFontSize(e.tam);
	};
	const medirTrozo = (texto: string, e: EstiloTrozo): number => {
		ponerEstilo(e);
		return doc.getTextWidth(texto);
	};

	/** Escribe un texto con formato mezclado a partir de `y`, saltando de página si hace falta. */
	const escribirConFormato = (bloque: BloqueDossier, ancho: number): void => {
		const lineas = repartirEnLineas(bloque.trozos ?? [], ancho, medirTrozo);
		for (const linea of lineas) {
			if (y + linea.alto > LIMITE) { doc.addPage(); y = 24; }
			let x = 12;
			for (const t of linea.trozos) {
				ponerEstilo(t.estilo);
				doc.setTextColor(20, 24, 28);
				doc.text(t.texto, x, y + linea.alto * 0.72);
				x += t.ancho;
			}
			y += linea.alto;
		}
		doc.setFont('helvetica', 'normal');
		doc.setTextColor(0);
	};

	/** Mete una imagen respetando su proporción y sin que se salga de la página. */
	const meterImagen = (bloque: BloqueDossier, anchoMax: number): void => {
		if (!bloque.imagen) return;
		/*
		 * UNA IMAGEN QUE NO SE PUEDE DIBUJAR NO PUEDE TIRAR EL DOSSIER ENTERO.
		 *
		 * Segunda auditoría, TS2-P1-11. `getImageProperties()` iba sin red: con un formato que
		 * jsPDF no conoce lanza «addImage does not support files of type 'UNKNOWN'» y se llevaba
		 * por delante la generación completa —comprobado por la auditoría con un SVG, que el
		 * selector de archivos acepta como `image/*`—. El cargador ya no deja entrar formatos que
		 * no se puedan imprimir, pero un proyecto guardado con la versión anterior puede traer uno
		 * dentro. Aquí se salta esa imagen, se dice en su sitio, y el resto del documento sale.
		 */
		let props: { width: number; height: number; fileType: string };
		try {
			props = doc.getImageProperties(bloque.imagen);
		} catch {
			doc.setFontSize(9);
			doc.setTextColor(...GRIS);
			doc.text('[Imagen en un formato que no se puede imprimir: se omitió]', 12, y, { maxWidth: anchoMax });
			doc.setTextColor(0);
			y += 8;
			return;
		}
		if (!props.width || !props.height) return;
		const ancho = Math.min(anchoMax, anchoMax * ((bloque.anchoPct ?? 100) / 100));
		let alto = (props.height / props.width) * ancho;
		/*
		 * Y UNA IMAGEN MÁS ALTA QUE LA PÁGINA SE REDUCE, no se cambia de página.
		 *
		 * Antes se pasaba entera a la siguiente conservando la misma altura, así que una foto
		 * vertical de móvil seguía desbordándose exactamente igual, ahora en una página en
		 * blanco. Se limita a lo que cabe, manteniendo la proporción.
		 */
		const altoUtil = LIMITE - 24;
		let anchoFinal = ancho;
		if (alto > altoUtil) { anchoFinal = ancho * (altoUtil / alto); alto = altoUtil; }
		// Si no cabe en lo que queda de página, se pasa entera a la siguiente en vez de partirla.
		if (y + alto > LIMITE) { doc.addPage(); y = 24; }
		doc.addImage(bloque.imagen, props.fileType, 12, y, anchoFinal, alto, undefined, 'FAST');
		y += alto + 3;
		if (bloque.pie) {
			doc.setFontSize(8.5);
			doc.setTextColor(...GRIS);
			doc.text(bloque.pie, 12, y, { maxWidth: ancho });
			doc.setTextColor(0);
			y += 6;
		}
		y += 4;
	};

	/** Un bloque del usuario: su título si lo tiene, y su contenido. */
	const dibujarBloque = (b: BloqueDossier, ancho: number, tamTitulo = 12.5): void => {
		if (b.titulo) {
			if (y > LIMITE - 17) { doc.addPage(); y = 24; }
			doc.setFont('helvetica', 'bold');
			doc.setFontSize(tamTitulo);
			doc.setTextColor(...AZUL);
			doc.text(b.titulo, 12, y);
			doc.setTextColor(0);
			doc.setFont('helvetica', 'normal');
			y += tamTitulo * 0.56;
		}
		if (b.tipo === 'imagen') meterImagen(b, ancho);
		else escribirConFormato(b, ancho);
	};

	/** Dibuja, en su propia página, todo lo que el usuario ha puesto en `donde`. */
	const dibujarBloques = (donde: BloqueDossier['donde'], titulo: string): void => {
		const bloques = bloquesEn(proyecto.dossier, donde);
		if (bloques.length === 0) return;
		doc.addPage();
		cabecera(titulo);
		for (const b of bloques) { dibujarBloque(b, anchoPag - 24); y += 4; }
	};

	/*
	 * APARTADOS QUE SE PUEDEN QUITAR.
	 *
	 * Se dibuja TODO y al final se borran las páginas de los apartados apagados, en vez de llenar
	 * el generador de condicionales. Es menos código y menos frágil: el dibujo de cada apartado no
	 * se entera de nada, y añadir uno nuevo no obliga a tocar la fontanería.
	 */
	const rangos: { id: string; desde: number; hasta: number }[] = [];
	const marcar = (id: string): void => {
		const previo = rangos[rangos.length - 1];
		if (previo) previo.hasta = doc.getNumberOfPages() - 1;
		rangos.push({ id, desde: doc.getNumberOfPages(), hasta: doc.getNumberOfPages() });
	};

	/* ---------------------------- Portada ---------------------------- */
	doc.setFillColor(...AZUL);
	doc.rect(0, 0, anchoPag, 62, 'F');
	doc.setTextColor(...TINTA_CAB);
	// El logo arriba a la derecha, donde se mira primero al recibir un documento.
	ponerLogo(anchoPag - 20 - 42, 10, 20, 42);
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(24);
	doc.text('Dossier técnico', 20, 32);
	doc.setFontSize(15);
	doc.setFont('helvetica', 'normal');
	doc.text(proyecto.nombre, 20, 44);
	doc.setFontSize(10);
	const lineaCliente = [datos.cliente, datos.obra].filter(Boolean).join(' · ');
	if (lineaCliente) doc.text(lineaCliente, 20, 53, { maxWidth: anchoPag - 40 });
	doc.setFontSize(9);
	const pie = [
		datos.proyectista ? `Proyectista: ${datos.proyectista}` : '',
		datos.revision ? `Revisión ${datos.revision}` : '',
		datos.fecha || fecha,
	].filter(Boolean).join('  ·  ');
	doc.text(pie, 20, lineaCliente ? 59 : 54);

	// Quién entrega el documento, justo bajo la banda: es la primera pregunta de quien lo recibe.
	doc.setTextColor(0);
	if (empresa.nombre || empresa.contacto) {
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(10.5);
		doc.setTextColor(...AZUL);
		if (empresa.nombre) doc.text(empresa.nombre, 20, 69);
		doc.setFont('helvetica', 'normal');
		doc.setFontSize(8.5);
		doc.setTextColor(...GRIS);
		if (empresa.contacto) doc.text(empresa.contacto, 20, empresa.nombre ? 74 : 69, { maxWidth: anchoPag - 40 });
		doc.setTextColor(0);
	}

	// Tarjetas con las cifras que definen el tablero: es lo que se mira primero.
	doc.setTextColor(0);
	const tarjetas: [string, string][] = [
		['Aparatos', String(ficha.aparatos.total)],
		['Conexiones', String(ficha.conductores.total)],
		['Caja (an × al × f)', ficha.caja ? `${Math.round(ficha.caja.ancho)} × ${Math.round(ficha.caja.alto)} × ${mm(ficha.caja.profundidad)}` : '—'],
		['Placa de montaje', ficha.placa ? `${Math.round(ficha.placa.ancho)} × ${mm(ficha.placa.alto)}` : '—'],
		['Cable total', metros(ficha.conductores.longitudTotalMm)],
		['Verificación', errores ? `${errores} error${errores > 1 ? 'es' : ''}` : (avisos ? `${avisos} aviso${avisos > 1 ? 's' : ''}` : 'Conforme')],
	];
	const anchoTarjeta = (anchoPag - 40 - 2 * 6) / 3;
	// Si hay empresa, las cifras bajan lo que ocupa su nombre y su contacto.
	const yTarjetas = 72 + (empresa.nombre || empresa.contacto ? (empresa.nombre && empresa.contacto ? 11 : 6) : 0);
	tarjetas.forEach(([titulo, valor], i) => {
		const cx = 20 + (i % 3) * (anchoTarjeta + 6);
		const cy = yTarjetas + Math.floor(i / 3) * 26;
		doc.setFillColor(244, 246, 248);
		doc.setDrawColor(220, 225, 230);
		doc.roundedRect(cx, cy, anchoTarjeta, 21, 2, 2, 'FD');
		doc.setFontSize(7.5);
		doc.setTextColor(...GRIS);
		doc.text(titulo.toUpperCase(), cx + 4, cy + 6.5);
		doc.setFontSize(11);
		doc.setFont('helvetica', 'bold');
		const esVerificacion = titulo === 'Verificación';
		doc.setTextColor(...(esVerificacion ? (errores ? ROJO : VERDE) : [20, 24, 28] as [number, number, number]));
		doc.text(valor, cx + 4, cy + 15, { maxWidth: anchoTarjeta - 8 });
		doc.setFont('helvetica', 'normal');
	});

	/*
	 * Vista del tablero en la propia portada: el cliente reconoce su tablero de un vistazo.
	 *
	 * Si el usuario ha puesto algo suyo EN LA PORTADA, el plano se dibuja más bajo para dejarle
	 * sitio debajo. Antes se escribía encima del plano, que es peor que no dejar poner nada.
	 */
	const dePortada = bloquesEn(proyecto.dossier, 'portada');
	// La portada se MIDE, no se clava con números: el papel puede ser Carta —18 mm más corta— y
	// arriba puede haber una empresa que empuja las cifras hacia abajo. Con las medidas fijas de
	// antes, el plano se salía por el pie en cuanto pasaba cualquiera de las dos cosas.
	const yRotulo = yTarjetas + 2 * 26 + 4;
	const yPlano = yRotulo + 6;
	// Lo que queda hasta el pie, descontado el renglón de la escala. Si el usuario ha puesto algo
	// suyo en la portada, el plano le cede algo más de un tercio.
	const disponible = PIE_Y - 6 - yPlano - 6;
	const altoPlano = Math.max(50, dePortada.length ? disponible * 0.62 : disponible);
	doc.setTextColor(...GRIS);
	doc.setFontSize(9);
	doc.text('Disposición de la placa de montaje', 20, yRotulo);
	doc.setTextColor(0);
	const escalaPortada = dibujarPlaca(doc, proyecto, { x: 20, y: yPlano, ancho: anchoPag - 46, alto: altoPlano }, AZUL);
	doc.setFontSize(7.5);
	doc.setTextColor(...GRIS);
	doc.text(
		escalaPortada
			? `Escala aproximada 1:${Math.round(1 / escalaPortada)} · medidas en milímetros`
			: 'El proyecto todavía no tiene gabinete definido.',
		20, yPlano + altoPlano + 5,
	);
	doc.setTextColor(0);
	if (dePortada.length) {
		y = yPlano + altoPlano + 13;
		for (const b of dePortada) { dibujarBloque(b, anchoPag - 40, 11); y += 3; }
	}

	// Lo que va al principio, en su propia página antes de los apartados generados.
	dibujarBloques('principio', 'Presentación');

	/*
	 * ---------- Procedencia de los datos ----------
	 *
	 * La página que hace este dossier defendible delante de un cliente exigente: dice, antes que
	 * nada, QUÉ SE HA DECLARADO Y QUÉ NO. Un documento técnico que calla lo que le falta obliga a
	 * quien lo recibe a averiguarlo, y lo que se averigua tarde se paga caro.
	 */
	doc.addPage();
	cabecera('Procedencia de los datos');
	marcar('procedencia');
	doc.setFontSize(9);
	doc.setTextColor(...GRIS);
	doc.text(
		'Todo lo que sigue en este dossier sale del tablero tal como está dibujado en este momento: '
		+ 'los aparatos son los que hay colocados, las conexiones las que hay cableadas y las medidas '
		+ 'las de la placa. Nada se rellena por parecido. Lo que el proyecto todavía no declara se '
		+ 'lista aquí y aparece marcado en su apartado.',
		12, y, { maxWidth: anchoPag - 24 },
	);
	y += 18;

	const faltantes: [string, string][] = [];
	const anotar = (campo: string, falta: boolean, consecuencia: string): void => {
		if (falta) faltantes.push([campo, consecuencia]);
	};
	anotar('Cliente', !datos.cliente, 'no sale en la portada ni en el cajetín del esquema');
	anotar('Obra', !datos.obra, 'no sale en la portada ni en el cajetín del esquema');
	anotar('Proyectista', !datos.proyectista, 'el plano no dice quién lo firma');
	anotar('Fabricante del conjunto', !datos.fabricante,
		'IEC 61439-1 §6.1 lo exige en la placa de características');
	anotar('Corriente de cortocircuito presunta (Icp)', !opciones.iccPresuntaKA,
		'no se puede comprobar si las protecciones aguantan la falta');
	anotar('Corriente asignada del conjunto (InA)', !opciones.corrienteAsignadaA,
		'la placa de características queda incompleta');
	anotar('Grado de protección (IP)', !opciones.gradoIP,
		'sin él no se sabe si la envolvente vale para donde va');
	anotar('Régimen de neutro', !opciones.regimenNeutro, 'condiciona la protección contra contactos indirectos');
	anotar('Uso previsto (interior o intemperie)', !opciones.usoPrevisto,
		'un tablero a la intemperie exige otra envolvente y otro cálculo térmico');
	anotar('Temperatura ambiente de proyecto', !declarado(proyecto, 'temperaturaAmbienteC'),
		`el balance térmico se ha calculado suponiendo ${opciones.temperaturaAmbienteC} °C`);
	anotar('Forma de instalación del armario', !declarado(proyecto, 'montajeGabinete'),
		'el balance térmico se ha calculado suponiendo montaje mural');
	anotar('Frecuencia asignada', !declarado(proyecto, 'frecuenciaHz'), 'la placa de características queda incompleta');

	if (faltantes.length === 0) {
		doc.setFillColor(233, 245, 236);
		doc.setDrawColor(...VERDE);
		doc.roundedRect(12, y, anchoPag - 24, 16, 2, 2, 'FD');
		doc.setTextColor(...VERDE);
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(10);
		doc.text('El proyecto declara todos los datos necesarios. Nada queda supuesto.', 17, y + 10);
		doc.setFont('helvetica', 'normal');
		doc.setTextColor(0);
		y += 24;
	} else {
		doc.setTextColor(0);
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(10.5);
		doc.text(`Pendiente de declarar (${faltantes.length})`, 12, y);
		doc.setFont('helvetica', 'normal');
		y += 4;
		tabla(['Dato', 'Qué implica que falte'], faltantes, { 0: 66 });
	}

	// Y lo que sí está declarado, con su procedencia, para que se lea de un vistazo.
	const declarados: [string, string][] = [
		['Aparatos y conexiones', `${ficha.aparatos.total} aparatos y ${ficha.conductores.total} conexiones dibujadas`],
		['Medidas de la placa', ficha.placa ? `${mm(ficha.placa.ancho)} × ${mm(ficha.placa.alto)}, del propio tablero` : 'sin gabinete definido'],
		['Longitudes de cable', `${metros(ficha.conductores.longitudTotalMm)}, del ruteo real por canaleta con `
			+ `${Math.round(opciones.reservaCable * 100)} % de reserva`],
		['Verificación eléctrica', errores
			? `${errores} error(es) y ${avisos} aviso(s) — ver el apartado de verificación`
			: `sin errores${avisos ? `, ${avisos} aviso(s)` : ''}`],
		/*
		 * BAJO QUÉ TABLA se ha verificado la sección de los conductores.
		 *
		 * Un documento que pone «verificado» sin decir contra qué tabla no es defendible: la misma
		 * sección admite 19,5 A o 7 A según la temperatura y los circuitos que lleve al lado. Se
		 * dicen las tres cosas —tabla, temperatura y agrupamiento— y de dónde salen.
		 */
		['Intensidad admisible de los conductores',
			`IEC 60364-5-52, cobre con aislación PVC 70 °C, instalación B1 (tabla a ${TEMPERATURA_TABLA_C} °C), `
			+ (termico
				? `corregida a los ${Math.round(termico.temperaturaInteriorC)} °C que alcanza el interior del `
					+ `armario según el balance térmico (factor ${factorTemperatura(termico.temperaturaInteriorC).toFixed(2)}) `
				: `corregida a los ${opciones.temperaturaAmbienteC} °C de ambiente declarados `)
			+ 'y por el número de circuitos que comparten cada canaleta (tabla B.52.17)'],
	];
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(10.5);
	doc.text('Declarado y comprobado', 12, y);
	doc.setFont('helvetica', 'normal');
	y += 4;
	tabla(['Dato', 'De dónde sale'], declarados, { 0: 66 });

	/* --------------------- 1. Ficha del tablero --------------------- */
	doc.addPage();
	cabecera('1. Ficha del tablero');
	marcar('ficha');
	// Si el proyecto no declara la caja, la ficha la deduce de la placa: hay que decirlo, no
	// dar por buena una medida supuesta en un papel que se usa para pedir el armario.
	const cajaTexto = ficha.caja
		? `${mm(ficha.caja.ancho)} × ${mm(ficha.caja.alto)} × ${mm(ficha.caja.profundidad)}`
			+ (ficha.caja.estimada ? ' (estimada: placa + margen estándar)' : '')
		: '—';
	const filasFicha: [string, string][] = [
		['Caja eléctrica (an × al × fondo)', cajaTexto],
		['Placa de montaje (an × al)', ficha.placa ? `${mm(ficha.placa.ancho)} × ${mm(ficha.placa.alto)}` : '—'],
		['Ocupación de la placa', `${ficha.ocupacionPlacaPct} %`],
		['Riel DIN', `${ficha.rieles.cantidad} tramo${ficha.rieles.cantidad === 1 ? '' : 's'} · ${metros(ficha.rieles.largoTotalMm)} en total`],
		['Canaleta', `${ficha.canaletas.cantidad} tramo${ficha.canaletas.cantidad === 1 ? '' : 's'} · ${metros(ficha.canaletas.largoTotalMm)} en total`],
		['Llenado máximo de canaleta', ficha.canaletas.cantidad ? `${ficha.canaletas.llenadoMaxPct} % del máximo admisible` : '—'],
		['Aparatos en la placa', String(ficha.aparatos.enPlaca)],
		['Aparatos de campo (fuera del tablero)', String(ficha.aparatos.deCampo)],
		['Conductores', String(ficha.conductores.total)],
		['Longitud total de cable', metros(ficha.conductores.longitudTotalMm)],
		['Tensiones de trabajo', ficha.tensiones.length ? ficha.tensiones.map((v) => `${v} V`).join(' · ') : '—'],
		['Fondo libre tras el aparato más profundo', ficha.holguraFondoMm !== undefined ? mm(ficha.holguraFondoMm) : '—'],
		['Referencias de material distintas', String(bom.length)],
		['Icc presunta en la acometida', opciones.iccPresuntaKA ? `${opciones.iccPresuntaKA} kA` : 'sin declarar'],
		['Temperatura ambiente de proyecto', `${opciones.temperaturaAmbienteC} °C`],
		['Potencia disipada en el interior', termico ? `${termico.disipacionW} W` : '—'],
		['Temperatura interior estimada', termico ? `${termico.temperaturaInteriorC} °C (+${termico.saltoTermicoK} K)` : '—'],
		['Verificación eléctrica (DRC)', errores ? `${errores} errores · ${avisos} avisos` : (avisos ? `${avisos} avisos` : 'Sin hallazgos')],
	];
	autoTable(doc, {
		startY: y,
		body: filasFicha,
		theme: 'plain',
		bodyStyles: { fontSize: 9.5 },
		columnStyles: { 0: { fontStyle: 'bold', cellWidth: 92, textColor: GRIS }, 1: { cellWidth: 80 } },
		margin: { left: 12, right: 12 },
	});
	// @ts-expect-error autotable añade lastAutoTable
	y = (doc.lastAutoTable?.finalY ?? y) + 10;

	doc.setFont('helvetica', 'bold');
	doc.setFontSize(11);
	doc.text('Componentes por familia', 12, y);
	doc.setFont('helvetica', 'normal');
	y += 4;
	tabla(['Familia', 'Cantidad', 'Marcado de los aparatos'],
		ficha.aparatos.porFamilia.map((f) => [f.familia, f.cantidad, f.designaciones.join(', ')]),
		{ 0: 34, 1: 20 });

	// Honestidad con el cliente: si algún equipo lleva medidas estimadas y no de hoja de datos,
	// el dossier lo dice. Un fondo mal supuesto es un tablero que no cierra.
	const nominales = proyecto.dispositivos.filter((d) =>
		CONTROLADORES.some((f) => f.referencia === d.referencia && f.medidas === 'nominal'));
	if (nominales.length > 0) {
		doc.setFontSize(8.5);
		doc.setTextColor(...ROJO);
		doc.text('Medidas por confirmar', 12, y);
		doc.setTextColor(...GRIS);
		doc.text(
			`Las dimensiones de ${nominales.map((d) => `${d.designacion} (${d.referencia})`).join(', ')} son `
			+ 'estimaciones de su familia de producto. Contrástalas con la hoja de datos del fabricante antes de fabricar.',
			12, y + 4.5, { maxWidth: anchoPag - 24 },
		);
		doc.setTextColor(0);
		y += 16;
	}

	if (ficha.conductores.porSeccion.length > 0) {
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(11);
		doc.text('Cable por sección', 12, y);
		doc.setFont('helvetica', 'normal');
		y += 4;
		tabla(['Sección', 'Conductores', 'Longitud'],
			ficha.conductores.porSeccion.map((s) => [
				s.seccion !== undefined ? `${s.seccion} mm²` : 'sin definir',
				s.cantidad,
				// Los conductores que no pasan por canaleta (los que van a campo) no tienen
				// recorrido calculado: se dice, en vez de sumarles cero y falsear el metraje.
				s.conRuta === 0
					? 'sin recorrido calculado'
					: `${metros(s.longitudMm)}${s.conRuta < s.cantidad ? ` (${s.cantidad - s.conRuta} sin rutear)` : ''}`,
			]), { 0: 32, 1: 30 });
	}

	/* --------------- 2. Disposición de la placa (a escala) --------------- */
	doc.addPage();
	cabecera('2. Disposición de la placa');
	marcar('placa');
	// La altura del hueco deja sitio bajo el dibujo para la cota, la leyenda y el pie.
	const escala = dibujarPlaca(doc, proyecto, { x: 12, y: 38, ancho: anchoPag - 32, alto: 142 }, AZUL);
	y = 194;
	// Leyenda: sin ella el plano se lee mal, sobre todo quien no armó el tablero.
	const leyenda: [string, [number, number, number], [number, number, number]][] = [
		['Canaleta', [240, 219, 176], [190, 150, 70]],
		['Riel DIN', [203, 209, 214], [150, 158, 165]],
		['Aparato', [120, 128, 136], [40, 46, 52]],
	];
	let lx = 12;
	doc.setFontSize(8);
	for (const [texto, relleno, borde] of leyenda) {
		doc.setFillColor(...relleno);
		doc.setDrawColor(...borde);
		doc.setLineWidth(0.3);
		doc.rect(lx, y - 3, 6, 3.4, 'FD');
		doc.setTextColor(...GRIS);
		doc.text(texto, lx + 8, y);
		lx += 8 + doc.getTextWidth(texto) + 8;
	}
	y += 7;
	doc.setFontSize(8);
	doc.setTextColor(...GRIS);
	doc.text(escala
		? `Vista frontal de la placa de montaje. Escala aproximada 1:${Math.round(1 / escala)}. Medidas en milímetros desde la esquina superior izquierda.`
		: 'El proyecto todavía no tiene gabinete definido.', 12, y);
	doc.setTextColor(0);
	y += 7;
	const colocaciones = proyecto.gabinete?.colocaciones ?? [];
	if (colocaciones.length > 0) {
		tabla(['Marcado', 'Aparato', 'Posición x · y', 'Huella (an × al)', 'Fondo'],
			colocaciones
				.map((c) => {
					const d = proyecto.dispositivos.find((x) => x.id === c.dispositivoId);
					return { c, d };
				})
				.filter((e): e is { c: typeof colocaciones[number]; d: NonNullable<typeof e.d> } => !!e.d)
				.sort((a, b) => (a.d.designacion ?? '').localeCompare(b.d.designacion ?? '', undefined, { numeric: true }))
				.map(({ c, d }) => [
					d.designacion ?? d.id,
					d.descripcion ?? d.tipo,
					`${Math.round(c.x)} · ${Math.round(c.y)} mm`,
					`${Math.round(c.ancho)} × ${Math.round(c.alto)} mm`,
					mm(fondoDe(d)),
				]),
			{ 0: 22, 2: 30, 3: 32, 4: 18 });
	}

	/* --------------------- 3. Lista de materiales --------------------- */
	doc.addPage();
	cabecera('3. Lista de materiales (BOM)');
	marcar('bom');
	if (bom.length === 0) {
		doc.setFontSize(10);
		doc.text('El proyecto no tiene aparatos.', 12, y);
	} else {
		let totalUnidades = 0;
		const filas = bom.map((f, i) => {
			totalUnidades += f.cantidad;
			return [i + 1, f.cantidad, f.descripcion || '—', f.fabricante || '—', f.referencia || '—', f.designaciones.join(', ')];
		});
		filas.push(['', totalUnidades, 'TOTAL DE UNIDADES', '', '', '']);
		tabla(['#', 'Cant.', 'Descripción', 'Fabricante', 'Referencia', 'Marcado'], filas,
			{ 0: 8, 1: 12, 3: 30, 4: 30 });
	}

	/* --------------------- 4. Índice de aparatos --------------------- */
	doc.addPage();
	cabecera('4. Índice de aparatos');
	marcar('aparatos');
	tabla(['Marcado', 'Descripción', 'Tensión', 'In / Ib', 'En el esquema'],
		referencias.indice.map((e) => {
			const d = proyecto.dispositivos.find((x) => x.id === e.dispositivoId);
			return [
				e.designacion,
				e.descripcion || '—',
				d?.tensionNominal ? `${d.tensionNominal} V` : '—',
				d?.corrienteNominal ? `${d.corrienteNominal} A` : '—',
				e.posicion,
			];
		}), { 0: 24, 2: 20, 3: 20, 4: 26 });

	// Ficha eléctrica de las protecciones en una sola tabla: es la página que mira un inspector
	// para saber si el tablero está coordinado, y la que hay que poder contrastar con las hojas
	// de datos. El «~» marca lo que todavía es una estimación y no un dato firmado.
	const ES_PROT = new Set(['disyuntor', 'diferencial', 'guardamotor', 'fusible', 'seccionador']);
	const protecciones = proyecto.dispositivos.filter((d) =>
		ES_PROT.has(d.tipo) && !esReferenciaVisualInerte(d));
	if (protecciones.length > 0) {
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(11);
		doc.text('Ficha eléctrica de las protecciones', 12, y);
		doc.setFont('helvetica', 'normal');
		y += 4;
		tabla(['Marcado', 'Referencia', 'In', 'Curva', 'Regulación', 'Icu', 'Sens.', 'Disip.'],
			protecciones.map((d) => [
				d.designacion ?? d.id,
				d.referencia ?? '—',
				d.corrienteNominal ? `${d.corrienteNominal} A` : '—',
				d.curvaDisparo ?? '—',
				d.rangoRegulacionA ? `${d.rangoRegulacionA[0]}–${d.rangoRegulacionA[1]} A` : '—',
				d.poderCorteKA !== undefined ? `${d.poderCorteEstimado ? '~' : ''}${d.poderCorteKA} kA` : '—',
				d.sensibilidadMA ? `${d.sensibilidadMA} mA${d.claseDiferencial ? ` ${d.claseDiferencial}` : ''}` : '—',
				d.disipacionW !== undefined ? `${d.disipacionEstimada ? '~' : ''}${d.disipacionW} W` : '—',
			]), { 0: 22, 2: 14, 3: 14, 4: 24, 5: 18, 6: 20, 7: 18 });

		const estimados = protecciones.filter((d) => d.poderCorteEstimado || d.disipacionEstimada).length;
		doc.setFontSize(8);
		doc.setTextColor(...(estimados ? ROJO : GRIS));
		doc.text(
			estimados
				? `Los valores marcados con «~» (${estimados} de ${protecciones.length} aparatos) son los `
					+ 'habituales de su familia de producto, no los de la hoja de datos del modelo concreto. '
					+ 'Cópialos del fabricante en la ficha de cada aparato antes de certificar el conjunto.'
				: 'Todos los datos eléctricos proceden de la ficha declarada de cada aparato.',
			12, y, { maxWidth: anchoPag - 24 },
		);
		doc.setTextColor(0);
	}

	/* --------------------- 5. Lista de conductores --------------------- */
	doc.addPage();
	cabecera('5. Lista de conductores');
	marcar('conductores');
	if (conductores.length === 0) {
		doc.setFontSize(10);
		doc.text('El proyecto no tiene conductores.', 12, y);
	} else {
		tabla(['Nº', 'Desde', 'Hacia', 'Sección', 'Color', 'Longitud'],
			conductores.map((c) => [c.numero, c.de, c.a, c.seccion || '—', c.color || '—',
				c.longitudMm ? metros(c.longitudMm) : '—']),
			{ 0: 14, 3: 20, 5: 22 });
	}

	/* --------------------- 6. Referencias cruzadas --------------------- */
	if (referencias.cruzadas.length > 0) {
		doc.addPage();
		cabecera('6. Referencias cruzadas');
		marcar('referencias');
		const filas = referencias.cruzadas.flatMap((x) =>
			x.contactos.length === 0
				? [[x.designacion, x.posicion, '(sin contactos)', '', '']]
				: x.contactos.map((c) => [x.designacion, x.posicion, c.designacion, c.contacto, c.posicion]));
		tabla(['Maestro', 'Hoja.col', 'Contacto', 'Tipo', 'Hoja.col'], filas);
	}

	/* --------------------- 7. Balance térmico --------------------- */
	if (termico) {
		doc.addPage();
		cabecera('7. Balance térmico del gabinete');
		marcar('termico');
		const MONTAJES: Record<string, string> = {
			mural: 'adosado a pared (cara trasera sin disipar)',
			exento: 'exento (disipa por todas las caras)',
			empotrado: 'empotrado entre otros armarios (solo frente y techo)',
		};
		autoTable(doc, {
			startY: y,
			body: [
				// Se dice de dónde sale cada ENTRADA del cálculo. Un salto térmico calculado sobre
				// un montaje y una temperatura que nadie ha declarado es un número con pinta de
				// medida y fondo de suposición: quien lo lea tiene derecho a saberlo.
				['Instalación', MONTAJES[termico.montaje]
					+ (declarado(proyecto, 'montajeGabinete') ? '' : ' — SUPUESTO, sin declarar en el proyecto')],
				['Superficie efectiva de disipación', `${termico.superficieM2.toFixed(2)} m²`],
				['Potencia disipada en el interior', `${termico.disipacionW} W`],
				['Densidad de disipación', `${(termico.superficieM2 > 0 ? termico.disipacionW / termico.superficieM2 : 0).toFixed(0)} W/m²`],
				['Temperatura ambiente de proyecto', `${termico.temperaturaAmbienteC} °C`
					+ (declarado(proyecto, 'temperaturaAmbienteC') ? '' : ' — SUPUESTA, sin declarar en el proyecto')],
				['Salto térmico estimado', `+${termico.saltoTermicoK} K`],
				['Temperatura interior estimada', `${termico.temperaturaInteriorC} °C`],
			] as [string, string][],
			theme: 'plain',
			bodyStyles: { fontSize: 9.5 },
			columnStyles: { 0: { fontStyle: 'bold', cellWidth: 92, textColor: GRIS }, 1: { cellWidth: 88 } },
			margin: { left: 12, right: 12 },
		});
		// @ts-expect-error autotable añade lastAutoTable
		y = (doc.lastAutoTable?.finalY ?? y) + 8;

		// El veredicto va en un banner del color de su gravedad: es la línea que decide si el
		// armario se pide con rejilla, con ventilador o con climatizador.
		const colorVeredicto: [number, number, number] =
			termico.veredicto === 'holgado' ? VERDE
				: termico.veredicto === 'justo' ? [176, 132, 30]
					: termico.veredicto === 'ventilacion' ? [190, 100, 30] : ROJO;
		const TITULO_VEREDICTO: Record<string, string> = {
			holgado: 'Refrigeración natural suficiente',
			justo: 'Al límite de la refrigeración natural',
			ventilacion: 'Requiere ventilación forzada',
			climatizacion: 'Requiere climatización',
		};
		doc.setFillColor(...colorVeredicto);
		doc.rect(12, y, anchoPag - 24, 1.6, 'F');
		doc.setFillColor(248, 249, 250);
		doc.setDrawColor(226, 230, 234);
		doc.rect(12, y + 1.6, anchoPag - 24, 20, 'FD');
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(10.5);
		doc.setTextColor(...colorVeredicto);
		doc.text(TITULO_VEREDICTO[termico.veredicto], 16, y + 8.5);
		doc.setFont('helvetica', 'normal');
		doc.setFontSize(9);
		doc.setTextColor(...GRIS);
		doc.text(termico.recomendacion, 16, y + 14.5, { maxWidth: anchoPag - 32 });
		doc.setTextColor(0);
		y += 30;

		if (termico.principales.length > 0) {
			doc.setFont('helvetica', 'bold');
			doc.setFontSize(11);
			doc.text('Aparatos que más calientan', 12, y);
			doc.setFont('helvetica', 'normal');
			y += 4;
			tabla(['Aparato', 'Disipación', 'Origen del dato'],
				termico.principales.map((p) => [
					p.designacion,
					`${p.watts} W`,
					p.estimado ? 'estimada por tipo de aparato' : 'declarada en la ficha del aparato',
				]), { 0: 50, 1: 28 });
		}

		// Un cálculo de proyecto no es un ensayo: decirlo evita que el papel se use como
		// certificado. Y si casi toda la disipación es estimada, el número vale lo que valen
		// las estimaciones — el cliente tiene que saberlo.
		const pctDeclarada = Math.round(termico.fraccionDeclarada * 100);
		doc.setFontSize(8);
		doc.setTextColor(...GRIS);
		doc.text(
			`Estimación por el método simplificado de IEC 60890. ${pctDeclarada} % de la potencia disipada procede de `
			+ 'datos declarados en la ficha de los aparatos; el resto son valores típicos por tipo. Para una verificación '
			+ 'formal del calentamiento (IEC 61439-1, apartado 10.10) hay que introducir la disipación de catálogo de cada '
			+ 'aparato o realizar el ensayo.',
			12, y, { maxWidth: anchoPag - 24 },
		);
		doc.setTextColor(0);
	}

	/* --------------------- 8. Planes de borneros --------------------- */
	for (const plan of planes) {
		doc.addPage();
		cabecera(`Bornero ${plan.designacion}`);
		tabla(['Borna', 'Interna', 'Externa', 'Nº cond.', 'Puentes'],
			plan.filas.map((f) => [f.borna, f.internas.join(' / ') || '—', f.externas.join(' / ') || '—',
				f.numeroConductor || '—', f.puenteCon.join(', ') || '—']));
	}

	/* --------------------- 9. Verificación DRC --------------------- */
	doc.addPage();
	cabecera('Verificación eléctrica (DRC)');
	marcar('drc');
	if (hallazgos.length === 0) {
		doc.setFontSize(11);
		doc.setTextColor(...VERDE);
		doc.text('Sin errores ni avisos. El tablero pasa todas las reglas.', 12, y);
		doc.setTextColor(0);
	} else {
		tabla(['Severidad', 'Regla', 'Detalle'],
			hallazgos.map((h) => [h.severidad === 'error' ? 'ERROR' : 'aviso', h.regla, h.mensaje]),
			{ 0: 22, 1: 42 });
	}

	/* ------------- Anexo A · Placa de características IEC 61439 ------------- */
	doc.addPage();
	cabecera('Anexo A · Placa de características');
	marcar('anexo');
	doc.setFontSize(9);
	doc.setTextColor(...GRIS);
	doc.text(
		'IEC 61439-1 apartado 6 exige que todo conjunto lleve una placa de características indeleble y visible con el '
		+ 'montaje terminado. Esta es la placa del tablero con lo que declara el proyecto; los campos marcados «a declarar» '
		+ 'los completa el fabricante del conjunto antes de la entrega.',
		12, y, { maxWidth: anchoPag - 24 },
	);
	doc.setTextColor(0);
	y += 16;

	const SIN = 'a declarar';
	const USO: Record<string, string> = { interior: 'Interior', intemperie: 'A la intemperie' };
	const tensionMax = ficha.tensiones.length ? Math.max(...ficha.tensiones) : undefined;
	// Ui y Uimp no se inventan: se toma el escalón normalizado inmediatamente por encima de la
	// tensión de empleo, que es lo que hace un proyectista, y se marca como valor propuesto.
	const ui = tensionMax === undefined ? undefined : tensionMax <= 250 ? 500 : tensionMax <= 500 ? 690 : 1000;
	const uimp = tensionMax === undefined ? undefined : tensionMax <= 250 ? 4 : 6;
	const camposPlaca: [string, string][] = [
		['Fabricante del conjunto', datos.fabricante || SIN],
		['Designación de tipo', proyecto.nombre],
		['Número de serie / identificación', SIN],
		['Fecha de fabricación', SIN],
		['Norma de referencia', 'IEC 61439-2'],
		['Tensión asignada de empleo  Ue', tensionMax !== undefined ? `${tensionMax} V` : SIN],
		['Tensión asignada de aislamiento  Ui', ui !== undefined ? `${ui} V (propuesto)` : SIN],
		['Tensión soportada a impulsos  Uimp', uimp !== undefined ? `${uimp} kV (propuesto)` : SIN],
		// Lo que NO declara el proyecto se deja «a declarar», no se rellena con el valor por
		// defecto del programa: esta placa la firma quien monta el conjunto.
		['Frecuencia asignada', declarado(proyecto, 'frecuenciaHz') ? `${opciones.frecuenciaHz} Hz` : SIN],
		['Corriente asignada del conjunto  InA', opciones.corrienteAsignadaA ? `${opciones.corrienteAsignadaA} A` : SIN],
		['Corriente de cortocircuito presunta  Icp', opciones.iccPresuntaKA ? `${opciones.iccPresuntaKA} kA` : SIN],
		['Factor de diversidad  RDF', SIN],
		['Grado de protección', opciones.gradoIP || SIN],
		['Régimen de neutro', opciones.regimenNeutro || SIN],
		['Uso previsto', USO[opciones.usoPrevisto] ?? SIN],
		['Temperatura ambiente de proyecto',
			declarado(proyecto, 'temperaturaAmbienteC') ? `${opciones.temperaturaAmbienteC} °C` : SIN],
		['Temperatura interior estimada', termico ? `${termico.temperaturaInteriorC} °C` : SIN],
		['Dimensiones (an × al × f)', ficha.caja ? `${mm(ficha.caja.ancho)} × ${mm(ficha.caja.alto)} × ${mm(ficha.caja.profundidad)}` : SIN],
		['Masa', SIN],
		['Forma de separación interna', SIN],
	];

	// La placa se dibuja a tamaño de impresión para poderla recortar y pegar en la puerta.
	const placaX = 12;
	const placaAncho = anchoPag - 24;
	const altoFila = 6.6;
	const altoPlaca = 20 + camposPlaca.length * altoFila + 8;
	doc.setDrawColor(...AZUL);
	doc.setLineWidth(0.8);
	doc.rect(placaX, y, placaAncho, altoPlaca);
	doc.setFillColor(...AZUL);
	doc.rect(placaX, y, placaAncho, 13, 'F');
	doc.setTextColor(255);
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(11);
	doc.text('CONJUNTO DE APARAMENTA DE BAJA TENSIÓN', placaX + 5, y + 6);
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(8);
	doc.text('IEC 61439-1 / IEC 61439-2', placaX + 5, y + 10.6);
	doc.setTextColor(0);

	let fy = y + 19;
	doc.setFontSize(8.5);
	for (const [campo, valor] of camposPlaca) {
		const pendiente = valor === SIN;
		doc.setTextColor(...GRIS);
		doc.text(campo, placaX + 5, fy);
		const finCampo = placaX + 7 + doc.getTextWidth(campo);
		doc.setFont('helvetica', pendiente ? 'italic' : 'bold');
		doc.setTextColor(...(pendiente ? ROJO : [20, 24, 28] as [number, number, number]));
		// El ancho se mide con la MISMA tipografía con la que se dibuja, o el filete se solapa.
		const inicioValor = placaX + placaAncho - 8 - doc.getTextWidth(valor);
		doc.text(valor, placaX + placaAncho - 5, fy, { align: 'right' });
		doc.setFont('helvetica', 'normal');
		// Filete entre campo y valor: se lee la fila sin perder el renglón.
		if (inicioValor > finCampo + 3) {
			doc.setDrawColor(228, 232, 236);
			doc.setLineWidth(0.2);
			doc.line(finCampo, fy - 1.1, inicioValor, fy - 1.1);
		}
		fy += altoFila;
	}
	doc.setTextColor(0);
	y += altoPlaca + 8;

	const pendientes = camposPlaca.filter(([, v]) => v === SIN).length;
	doc.setFontSize(8);
	doc.setTextColor(...(pendientes ? ROJO : VERDE));
	doc.text(
		pendientes
			? `Quedan ${pendientes} campos por declarar antes de que la placa sea válida.`
			: 'Todos los campos de la placa están declarados.',
		12, y,
	);
	doc.setTextColor(...GRIS);
	doc.text(
		'Los valores marcados «propuesto» salen de la tensión de empleo del proyecto y hay que confirmarlos contra la '
		+ 'coordinación de aislamiento real. Esta placa no sustituye a la verificación de diseño de IEC 61439-1 capítulo 10.',
		12, y + 5, { maxWidth: anchoPag - 24 },
	);
	doc.setTextColor(0);

	/*
	 * El último apartado se cierra AQUÍ, antes de los anexos del proyectista.
	 *
	 * Antes se cerraba después, y entonces el rango del último apartado se tragaba las páginas que
	 * había puesto el usuario: quitar «Anexo A · Placa de características» le borraba también sus
	 * propias fotos y su carta. Lo suyo no es un apartado del programa y no se apaga con esa casilla.
	 */
	const ultimo = rangos[rangos.length - 1];
	if (ultimo) ultimo.hasta = doc.getNumberOfPages();

	dibujarBloques('final', 'Anexos del proyectista');

	/* --------- Los apartados: los que salen, y en el orden que se haya pedido --------- */
	const total = doc.getNumberOfPages();
	const paginasDe = new Map<string, number[]>();
	for (const r of rangos) {
		const ps: number[] = [];
		for (let n = r.desde; n <= r.hasta; n++) ps.push(n);
		paginasDe.set(r.id, ps);
	}
	// Lo de antes de los apartados (portada y presentación) y lo de después (los anexos del
	// proyectista) no se mueve ni se quita: no son apartados del programa.
	const primera = rangos[0]?.desde ?? total + 1;
	const finApartados = ultimo?.hasta ?? 0;
	const orden: number[] = [];
	for (let n = 1; n < primera; n++) orden.push(n);
	for (const sec of seccionesOrdenadas(ajustes)) {
		if (!saleSeccion(ajustes, sec.id)) continue;
		orden.push(...(paginasDe.get(sec.id) ?? []));
	}
	for (let n = finApartados + 1; n <= total; n++) orden.push(n);

	// Fuera lo que no sale, de atrás hacia delante: borrar una página mueve las de después.
	const salen = new Set(orden);
	for (let n = total; n >= 1; n--) if (!salen.has(n)) doc.deletePage(n);
	// Y ahora al orden pedido, ya con la numeración compactada por los borrados.
	const nuevoNumero = new Map<number, number>();
	let k = 0;
	for (let n = 1; n <= total; n++) if (salen.has(n)) nuevoNumero.set(n, ++k);
	reordenarPaginas(doc, orden.map((n) => nuevoNumero.get(n)!));

	/* --------------------- Pie de página en todas --------------------- */
	const paginas = doc.getNumberOfPages();
	for (let i = 1; i <= paginas; i++) {
		doc.setPage(i);
		doc.setFontSize(8);
		doc.setTextColor(...GRIS);
		doc.text(`Página ${i} de ${paginas}`, anchoPag - 12, PIE_Y, { align: 'right' });
		// Al pie, quién firma delante del proyecto: una hoja suelta tiene que decir de quién es.
		doc.text([empresa.nombre, `${proyecto.nombre} — dossier técnico`].filter(Boolean).join(' · '),
			12, PIE_Y, { maxWidth: anchoPag - 50 });
	}

	return doc;
}

/** El dossier como PDF listo para enseñar en la vista previa. */
export function dossierComoBlob(proyecto: Proyecto): Blob {
	return construirDossier(proyecto).output('blob') as Blob;
}

export function exportarPDF(proyecto: Proyecto): void {
	// Se descarga con el mismo camino que todo lo demás, y no con `doc.save()`, para que el nombre
	// pase por la limpieza: un acento en el título dejaba el PDF guardado como «download».
	descargar(`${proyecto.nombre} - dossier.pdf`, dossierComoBlob(proyecto));
}
