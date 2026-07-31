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
 * Deja un nombre de archivo en ASCII puro, conservando lo que se lee.
 *
 * Además de las tildes quita lo que los sistemas de archivos no admiten (`/ \ : * ? " < > |`) y
 * recorta a 100 caracteres, que es donde empiezan a quejarse algunos.
 */
export function nombreSeguroDeArchivo(nombre: string, porDefecto = 'tablero'): string {
	const limpio = sinTildes(nombre)
		.replace(/[^A-Za-z0-9 ._-]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 100)
		.trim()
		// Un nombre no puede acabar en punto ni en espacio: Windows lo rechaza.
		.replace(/[. ]+$/, '');
	return limpio || porDefecto;
}
