/**
 * Apariencia paramétrica declarada para componentes propios. No certifica que la
 * envolvente coincida con un producto de fabricante ni altera su perfil eléctrico.
 * La ausencia de este campo conserva el panel fotográfico de proyectos antiguos.
 */
export interface CarcasaParametrica {
	plantilla: 'modulo-din' | 'caja-industrial';
	acabado: 'gris-claro' | 'grafito' | 'negro';
}

const esObjeto = (valor: unknown): valor is Record<string, unknown> =>
	typeof valor === 'object' && valor !== null && !Array.isArray(valor);

export function validarCarcasaParametrica(valor: unknown): string[] {
	if (valor === undefined) return [];
	if (!esObjeto(valor)) return ['la carcasa paramétrica debe ser un objeto'];
	const errores: string[] = [];
	if (valor.plantilla !== 'modulo-din' && valor.plantilla !== 'caja-industrial') {
		errores.push('la plantilla de carcasa no está reconocida');
	}
	if (valor.acabado !== 'gris-claro' && valor.acabado !== 'grafito' && valor.acabado !== 'negro') {
		errores.push('el acabado de carcasa no está reconocido');
	}
	if (Object.keys(valor).some((clave) => clave !== 'plantilla' && clave !== 'acabado')) {
		errores.push('la carcasa contiene parámetros no reconocidos');
	}
	return errores;
}

export function leerCarcasaParametrica(valor: unknown): CarcasaParametrica | undefined {
	if (valor === undefined || validarCarcasaParametrica(valor).length) return undefined;
	const carcasa = valor as Record<string, unknown>;
	return { plantilla: carcasa.plantilla as CarcasaParametrica['plantilla'],
		acabado: carcasa.acabado as CarcasaParametrica['acabado'] };
}
