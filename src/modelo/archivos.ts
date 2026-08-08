/**
 * Nombres de archivo seguros para lo que el programa entrega.
 *
 * Vive en el núcleo y no en la interfaz porque es una regla, no un detalle de dibujo, y porque
 * así se puede probar sin navegador. La regla es esta:
 *
 * **Si el atributo `download` de un enlace lleva UN SOLO carácter fuera de ASCII, el navegador
 * TIRA EL NOMBRE ENTERO y guarda el archivo como «download», sin extensión.** Comprobado con
 * Chromium: «triángulo.tablero.json» se descarga como «download».
 *
 * Y los tableros de aquí se llaman «Climatización», «Tablero de distribución» o «Arranque
 * estrella-triángulo». O sea que le pasaba a casi todos: quien guardaba su proyecto se
 * encontraba con un archivo llamado «download» que Windows no sabe abrir, y quien mandaba el
 * dossier a un cliente le mandaba un «download» sin extensión.
 *
 * La solución no es prohibir las tildes en los títulos —el título es del que trabaja— sino
 * TRANSLITERARLAS solo en el nombre del archivo: «Climatizacion sala 3.tablero.json» se lee
 * igual de bien y se abre en cualquier sistema.
 */

/** Quita las tildes conservando la letra: á → a, ñ → n, ü → u. */
export function sinTildes(t: string): string {
	return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Las extensiones que entrega el programa, incluidas las compuestas.
 *
 * `.tablero.json` y `.dossier.html` son una sola extensión a efectos de esto: partirlas por el
 * último punto dejaría «.json» y un cuerpo acabado en «.tablero», que al recortar se queda a
 * medias y ya no se reconoce.
 */
const EXTENSION = /\.(tablero\.json|dossier\.html|etiquetas\.html|csv|json|html|pdf|dxf|txt|svg)$/i;

/**
 * Nombres que Windows tiene reservados para dispositivos, desde MS-DOS.
 *
 * No se pueden usar ni con extensión: «CON.txt» tampoco vale. Y no hace falta mala fe para dar
 * con uno —a un tablero de una máquina se le puede llamar «AUX» sin pensarlo—; lo que pasa
 * entonces es que la descarga falla sin decir por qué.
 */
const RESERVADO_EN_WINDOWS = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/** Lo más largo que se deja el nombre entero, extensión incluida. */
const LARGO_MAXIMO = 100;

/**
 * Deja un nombre de archivo en ASCII puro, conservando lo que se lee.
 *
 * Además de las tildes quita lo que los sistemas de archivos no admiten (`/ \ : * ? " < > |`) y
 * recorta a 100 caracteres, que es donde empiezan a quejarse algunos.
 *
 * LA EXTENSIÓN TIENE SU SITIO RESERVADO. Antes se recortaba el nombre COMPLETO, extensión
 * incluida, así que un tablero con un título largo —y los de aquí lo son: «Tablero de fuerza y
 * control climatizadores cubierta terminal…»— se descargaba con la extensión cortada por la
 * mitad, o sin ella. El archivo salía bien por dentro y Windows no sabía con qué abrirlo: había
 * que renombrarlo a mano para recuperar el trabajo. Ahora se aparta la extensión, se recorta solo
 * el cuerpo, y se vuelve a pegar.
 */
export function nombreSeguroDeArchivo(nombre: string, porDefecto = 'tablero'): string {
	const plano = sinTildes(nombre);
	const conExtension = EXTENSION.exec(plano);
	const extension = conExtension ? conExtension[0] : '';
	const cuerpo = conExtension ? plano.slice(0, conExtension.index) : plano;

	let limpio = cuerpo
		.replace(/[^A-Za-z0-9 ._-]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, LARGO_MAXIMO - extension.length)
		.trim()
		// Un nombre no puede acabar en punto ni en espacio: Windows lo rechaza.
		.replace(/[. ]+$/, '');
	if (!limpio) limpio = porDefecto;
	if (RESERVADO_EN_WINDOWS.test(limpio)) limpio = `${limpio}-1`;
	return limpio + extension;
}
