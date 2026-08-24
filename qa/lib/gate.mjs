/**
 * Gate de navegador que debe estar verde en cada PR.
 *
 * Solo contiene regresiones deterministas, con exit code real y sin inspección humana. Las suites
 * pesadas o focalizadas (`cables-fusion` y las campañas nuevas) se ejecutan aparte.
 */
export const GATE_OFICIAL = Object.freeze([
	'abrir-atomico',
	'camara',
	'cables',
	'capas',
	'datos-proyecto',
	'entradas-hostiles',
	'mazo-puerta',
	'modales-teclado',
	'picking-puerta',
	'piloto-puerta',
	'se-guarda-solo',
	'sin-fantasmas',
	'texto-hostil',
]);
