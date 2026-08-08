/**
 * Escribir texto en un PDF dentro de un hueco que NO puede crecer.
 *
 * Vive aparte del resto del PDF porque no sabe nada del tablero ni del DOM —solo recibe el
 * documento de jsPDF y unas medidas—, y así se puede probar sin navegador.
 */
import { jsPDF } from 'jspdf';

/**
 * Escribe un texto EN UNA SOLA LÍNEA dentro del ancho que se le da, cueste lo que cueste.
 *
 * Auditoría TS-P2-05. Los campos del cajetín se escribían con el `maxWidth` de jsPDF, y ese
 * `maxWidth` NO RECORTA: parte el texto en varias líneas y las va bajando. En una casilla de
 * 8,5 mm de alto eso significa que la segunda línea se sale de su casilla, cruza la raya de abajo
 * y se planta encima del rótulo siguiente.
 *
 * Con datos de aquí pasa a la primera: una OBRA como «Ampliacion Terminal Internacional -
 * Climatizacion cubierta nivel 4» se parte en dos a 7,6 pt dentro de 74 mm —medido— y la segunda
 * línea aterriza sobre «FECHA». En la última fila del cajetín se saldría de la caja entera.
 *
 * Un cajetín de plano no hace eso nunca: encoge la letra, y si aun así no cabe, corta con puntos
 * suspensivos. Se encoge hasta `minimo` —5,4 pt, el tamaño de los propios rótulos y lo mínimo que
 * se lee impreso—; por debajo, más vale cortar y que se VEA que falta algo, que entregar un plano
 * con una letra que en obra no se puede leer.
 *
 * Deja el documento con el tamaño de letra que tenía, para no arrastrar el encogido al campo
 * siguiente. Y devuelve lo que ha decidido —a qué tamaño y con qué texto—, que es lo único que
 * permite comprobar desde una prueba que de verdad cupo en una línea sin tener que abrir el PDF.
 */
export function textoDeUnaLinea(
	doc: jsPDF, texto: string, x: number, y: number, ancho: number, tam: number,
	opciones: { align?: 'left' | 'center' | 'right'; minimo?: number } = {},
): { tam: number; texto: string } {
	const minimo = opciones.minimo ?? 5.4;
	let size = tam;
	doc.setFontSize(size);
	while (size > minimo && doc.getTextWidth(texto) > ancho) {
		size = Math.max(minimo, size - 0.2);
		doc.setFontSize(size);
	}
	let salida = texto;
	if (doc.getTextWidth(salida) > ancho) {
		while (salida.length > 1 && doc.getTextWidth(`${salida}…`) > ancho) salida = salida.slice(0, -1);
		salida += '…';
	}
	// Sin `maxWidth`: aquí ya se ha decidido que cabe, y pasárselo volvería a habilitar el corte
	// en varias líneas, que es justo lo que se está evitando.
	doc.text(salida, x, y, opciones.align ? { align: opciones.align } : undefined);
	doc.setFontSize(tam);
	return { tam: size, texto: salida };
}

/**
 * ¿En cuántas líneas partiría jsPDF este texto con ese `maxWidth`?
 *
 * Se expone para poder EXIGIR desde una prueba que un campo de cajetín salga en una sola, que es
 * la única forma de comprobar que no se pisa con la casilla de abajo sin abrir el PDF a ojo.
 */
export function lineasQueOcupa(doc: jsPDF, texto: string, ancho: number, tam: number): number {
	const antes = doc.getFontSize();
	doc.setFontSize(tam);
	const n = (doc.splitTextToSize(texto, ancho) as string[]).length;
	doc.setFontSize(antes);
	return n;
}
