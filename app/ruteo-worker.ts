/** Reparte rutas deterministas fuera del hilo de interacción del editor. */
import type { Proyecto } from '../src/modelo/tipos.js';
import { firmaRuteo, rutasDeCables } from './escena3d.js';

type Solicitud = { token: number; proyecto: Proyecto };
type Respuesta = { token: number; firma?: string; rutas?: ReturnType<typeof rutasDeCables>; error?: string };
const canal = globalThis as unknown as {
	onmessage: ((evento: MessageEvent<Solicitud>) => void) | null;
	postMessage: (valor: Respuesta) => void;
};

canal.onmessage = ({ data }) => {
	try {
		const firma = firmaRuteo(data.proyecto);
		const rutas = rutasDeCables(data.proyecto);
		canal.postMessage({ token: data.token, firma, rutas });
	} catch (error) {
		canal.postMessage({ token: data.token, error: error instanceof Error ? error.message : String(error) });
	}
};
