/**
 * R1 sintético: dos circuitos reales independientes y once enlaces de reserva sin alimentación.
 * No es un tablero industrial validado ni una muestra de capacidad certificada. Es una escena
 * determinista de densidad para medir la interacción ordinaria con 30 aparatos/100 conductores.
 * Requiere `tsc` previo, que produce `dist/ejemplo/biblioteca.js` sin tocar el producto.
 */
import { EJEMPLOS } from '../../dist/ejemplo/biblioteca.js';

export const MANIFIESTO_R1 = Object.freeze({
	id: 'r1-densidad-sintetica',
	version: 1,
	dispositivos: 30,
	conductores: 100,
	gabineteMm: [1100, 800],
	uso: 'Apertura, guardado, selección, drag y validación del editor; no aceptación eléctrica',
	defectosIntencionales: [
		'Once conductores de reserva entre borneros internos carecen de alimentación y carga.',
		'Las dos maniobras son circuitos independientes, no un sistema de potencia coordinado.',
	],
});

const clonar = (objeto) => structuredClone(objeto);

function trasladarCircuito(origen, etiqueta, dx, numeroHoja) {
	const p = clonar(origen);
	const id = (s) => `${etiqueta}-${s}`;
	for (const hoja of p.hojas) {
		hoja.id = id(hoja.id);
		hoja.numero += numeroHoja;
		hoja.titulo = `${etiqueta.toUpperCase()} · ${hoja.titulo}`;
	}
	for (const d of p.dispositivos) {
		d.id = id(d.id);
		if (d.hojaId) d.hojaId = id(d.hojaId);
		if (d.rol?.tipo === 'esclavo') d.rol.maestroId = id(d.rol.maestroId);
		if (d.designacion) d.designacion = `=${etiqueta.toUpperCase()}${d.designacion}`;
	}
	for (const c of p.conductores) {
		c.id = id(c.id);
		c.de.dispositivoId = id(c.de.dispositivoId);
		c.a.dispositivoId = id(c.a.dispositivoId);
		for (const punto of c.trazado ?? []) punto.x += dx;
	}
	for (const riel of p.gabinete.rieles ?? []) { riel.id = id(riel.id); riel.x += dx; }
	for (const ducto of p.gabinete.canaletas ?? []) { ducto.id = id(ducto.id); ducto.x += dx; }
	for (const colocacion of p.gabinete.colocaciones ?? []) {
		colocacion.dispositivoId = id(colocacion.dispositivoId);
		if (colocacion.rielId) colocacion.rielId = id(colocacion.rielId);
		colocacion.x += dx;
	}
	for (const rotulo of p.gabinete.rotulos ?? []) { rotulo.id = id(rotulo.id); rotulo.x += dx; }
	return p;
}

function reservas() {
	const especificaciones = [
		['aux-a', 80, 190, 6],
		['aux-b', 410, 190, 5],
		['aux-c', 735, 280, 11],
	];
	const dispositivos = especificaciones.map(([id, , , n]) => ({
		id, tipo: 'bornero', descripcion: 'Bornes de reserva no energizados · fixture sintético R1',
		hojaId: 'h-reserva',
		bornes: Array.from({ length: n }, (_, i) => ({ id: String(i + 1), tipo: 'control' })),
	}));
	const colocaciones = especificaciones.map(([dispositivoId, x, ancho]) => ({
		dispositivoId, x, y: 688, ancho, alto: 50, rielId: 'r-reserva',
	}));
	const conductores = Array.from({ length: 11 }, (_, i) => ({
		id: `reserva-w${i + 1}`,
		de: { dispositivoId: i < 6 ? 'aux-a' : 'aux-b', borneId: String(i < 6 ? i + 1 : i - 5) },
		a: { dispositivoId: 'aux-c', borneId: String(i + 1) },
		seccion: 1,
		color: 'gris',
		clase: 'interno',
	}));
	return { dispositivos, conductores, colocaciones };
}

/** Invariantes deliberadamente más fuertes que un mero recuento. */
export function verificarDensidadR1(p) {
	const d = new Map(p.dispositivos.map((x) => [x.id, x]));
	const cables = new Set(p.conductores.map((x) => x.id));
	const rieles = new Set(p.gabinete.rieles.map((x) => x.id));
	const ductos = new Set(p.gabinete.canaletas.map((x) => x.id));
	const hojas = new Set(p.hojas.map((x) => x.id));
	const errores = [];
	if (p.dispositivos.length !== 30 || d.size !== 30) errores.push('aparatos: se exigen 30 IDs únicos');
	if (p.conductores.length !== 100 || cables.size !== 100) errores.push('conductores: se exigen 100 IDs únicos');
	if (hojas.size !== p.hojas.length) errores.push('hojas duplicadas');
	for (const a of p.dispositivos) {
		if (a.hojaId && !hojas.has(a.hojaId)) errores.push(`${a.id}: hoja inexistente ${a.hojaId}`);
	}
	for (const c of p.conductores) for (const extremo of [c.de, c.a]) {
		const aparato = d.get(extremo.dispositivoId);
		if (!aparato?.bornes.some((b) => b.id === extremo.borneId))
			errores.push(`${c.id}: borne inexistente ${extremo.dispositivoId}:${extremo.borneId}`);
	}
	for (const c of p.conductores.filter((x) => x.id.startsWith('reserva-'))) {
		if (c.clase !== 'interno') errores.push(`${c.id}: reserva sin clase interna explícita`);
	}
	for (const c of p.gabinete.colocaciones) {
		if (!d.has(c.dispositivoId)) errores.push(`${c.dispositivoId}: colocación sin aparato`);
		if (c.rielId && !rieles.has(c.rielId)) errores.push(`${c.dispositivoId}: riel inexistente`);
		if (c.x < 0 || c.y < 0 || c.x + c.ancho > p.gabinete.ancho || c.y + c.alto > p.gabinete.alto)
			errores.push(`${c.dispositivoId}: fuera de la placa`);
	}
	for (const canaleta of p.gabinete.canaletas) {
		if (!ductos.has(canaleta.id)) errores.push(`${canaleta.id}: canaleta inválida`);
	}
	// Los circuitos de origen no comparten placa ni siquiera tras normalizar tamaños de aparato.
	const estrellas = p.gabinete.colocaciones.filter((c) => c.dispositivoId.startsWith('et-'));
	const directos = p.gabinete.colocaciones.filter((c) => c.dispositivoId.startsWith('dol-'));
	if (estrellas.some((a) => directos.some((b) => a.x < b.x + b.ancho && b.x < a.x + a.ancho
		&& a.y < b.y + b.alto && b.y < a.y + a.alto))) errores.push('solape entre maniobras');
	if (p.gabinete.colocaciones.filter((c) => c.dispositivoId.startsWith('aux-')).length !== 3)
		errores.push('faltan las tres colocaciones de reserva');
	if (p.conductores.filter((c) => c.id.startsWith('reserva-')).length !== 11)
		errores.push('faltan los once enlaces de reserva');
	if (errores.length) throw new Error(`R1 sintético inválido: ${errores.join('; ')}`);
	return { dispositivos: d.size, conductores: cables.size, reservas: 11 };
}

export function crearDensidadR1() {
	const ejemplo = (id) => {
		const hallado = EJEMPLOS.find((e) => e.id === id);
		if (!hallado) throw new Error(`Falta el ejemplo «${id}» para R1`);
		return hallado.crear();
	};
	const et = trasladarCircuito(ejemplo('estrella-triangulo'), 'et', 0, 0);
	const dol = trasladarCircuito(ejemplo('arranque-directo'), 'dol', 650, et.hojas.length);
	const extra = reservas();
	const proyecto = {
		formato: 'tablero-studio', version: 1, nombre: 'R1 sintético · 30 aparatos / 100 conductores',
		opciones: et.opciones,
		hojas: [...et.hojas, ...dol.hojas, { id: 'h-reserva', numero: 5, titulo: 'Reservas no energizadas' }],
		dispositivos: [...et.dispositivos, ...dol.dispositivos, ...extra.dispositivos],
		conductores: [...et.conductores, ...dol.conductores, ...extra.conductores],
		gabinete: {
			ancho: 1100, alto: 800,
			rieles: [...et.gabinete.rieles, ...dol.gabinete.rieles,
				{ id: 'r-reserva', x: 55, y: 713, largo: 995 }],
			canaletas: [...et.gabinete.canaletas, ...dol.gabinete.canaletas,
				{ id: 'c-reserva', x: 55, y: 625, largo: 995, orientacion: 'h', ancho: 35, alto: 55 }],
			colocaciones: [...et.gabinete.colocaciones, ...dol.gabinete.colocaciones, ...extra.colocaciones],
			rotulos: [...(et.gabinete.rotulos ?? []), ...(dol.gabinete.rotulos ?? [])],
		},
	};
	verificarDensidadR1(proyecto);
	return proyecto;
}
