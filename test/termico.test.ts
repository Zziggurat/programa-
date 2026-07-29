/**
 * Tests del balance térmico (IEC 60890 simplificado).
 *
 * Lo que se comprueba aquí es lo que decide si el armario se pide con rejilla o con
 * climatizador: que solo cuente lo que está dentro, que un dato del fabricante mande sobre la
 * estimación, que el montaje cambie la superficie que disipa y que el veredicto suba de escalón
 * cuando la temperatura lo pide.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { crearProyecto } from '../src/modelo/proyecto.js';
import { Proyecto } from '../src/modelo/tipos.js';
import { calcularBalanceTermico, disipacionDe } from '../src/motores/termico.js';

/** Proyecto con un armario de 600×800 y los aparatos que se le digan, todos colocados. */
function tablero(aparatos: { id: string; tipo: Proyecto['dispositivos'][0]['tipo']; disipacionW?: number }[]): Proyecto {
	const p = crearProyecto('t');
	p.gabinete = { ancho: 600, alto: 800, rieles: [], canaletas: [], colocaciones: [] };
	p.dispositivos = aparatos.map((a) => ({ ...a, designacion: `-${a.id.toUpperCase()}`, bornes: [] }));
	p.gabinete.colocaciones = aparatos.map((a, i) => ({
		dispositivoId: a.id, x: 20 + i * 20, y: 20, ancho: 18, alto: 85,
	}));
	return p;
}

test('sin gabinete no hay balance que dar', () => {
	const p = crearProyecto('t');
	assert.equal(calcularBalanceTermico(p), undefined);
});

test('la disipación declarada por el fabricante manda sobre la típica del tipo', () => {
	assert.deepEqual(disipacionDe({ id: 'a', tipo: 'variador', disipacionW: 12, bornes: [] }),
		{ watts: 12, estimado: false });
	const tipica = disipacionDe({ id: 'b', tipo: 'variador', bornes: [] });
	assert.equal(tipica.estimado, true);
	assert.ok(tipica.watts > 0);
});

test('solo calienta lo que está DENTRO del armario', () => {
	const p = tablero([{ id: 'q1', tipo: 'disyuntor', disipacionW: 10 }]);
	// Un motor en campo: existe en el proyecto pero no está colocado en la placa.
	p.dispositivos.push({ id: 'm1', tipo: 'motor', disipacionW: 900, bornes: [] });
	const b = calcularBalanceTermico(p)!;
	assert.equal(b.disipacionW, 10);
});

test('una imagen de referencia no disipa nada', () => {
	const p = tablero([{ id: 'q1', tipo: 'disyuntor', disipacionW: 10 }]);
	p.dispositivos.push({ id: 'img', tipo: 'otro', imagen: 'datos:...', disipacionW: 500, bornes: [] });
	p.gabinete!.colocaciones.push({ dispositivoId: 'img', x: 300, y: 300, ancho: 100, alto: 100 });
	assert.equal(calcularBalanceTermico(p)!.disipacionW, 10);
});

test('la fracción declarada distingue el dato real de la estimación', () => {
	const p = tablero([
		{ id: 'q1', tipo: 'disyuntor', disipacionW: 30 },
		{ id: 'q2', tipo: 'disyuntor' },   // sin declarar: entra por la tabla típica
	]);
	const b = calcularBalanceTermico(p)!;
	assert.ok(b.fraccionDeclarada > 0.8 && b.fraccionDeclarada < 1,
		`fracción declarada inesperada: ${b.fraccionDeclarada}`);
});

test('el montaje cambia la superficie que disipa: exento > mural > empotrado', () => {
	const p = tablero([{ id: 'q1', tipo: 'disyuntor', disipacionW: 100 }]);
	const exento = calcularBalanceTermico(p, 'exento')!;
	const mural = calcularBalanceTermico(p, 'mural')!;
	const empotrado = calcularBalanceTermico(p, 'empotrado')!;
	assert.ok(exento.superficieM2 > mural.superficieM2);
	assert.ok(mural.superficieM2 > empotrado.superficieM2);
	// Menos superficie, más calor dentro.
	assert.ok(empotrado.temperaturaInteriorC > mural.temperaturaInteriorC);
	assert.ok(mural.temperaturaInteriorC > exento.temperaturaInteriorC);
});

test('el montaje del proyecto se respeta si no se fuerza otro', () => {
	const p = tablero([{ id: 'q1', tipo: 'disyuntor', disipacionW: 100 }]);
	p.opciones = { montajeGabinete: 'empotrado' };
	const b = calcularBalanceTermico(p)!;
	assert.equal(b.montaje, 'empotrado');
	assert.equal(b.superficieM2, calcularBalanceTermico(p, 'empotrado')!.superficieM2);
});

test('un armario casi vacío queda holgado y uno cargado pide refrigeración', () => {
	const flojo = calcularBalanceTermico(tablero([{ id: 'q1', tipo: 'disyuntor', disipacionW: 3 }]))!;
	assert.equal(flojo.veredicto, 'holgado');
	assert.ok(flojo.saltoTermicoK < 5);

	const cargado = calcularBalanceTermico(tablero([{ id: 'v1', tipo: 'variador', disipacionW: 900 }]))!;
	assert.ok(cargado.temperaturaInteriorC > 50, `interior ${cargado.temperaturaInteriorC} °C`);
	assert.ok(cargado.veredicto === 'ventilacion' || cargado.veredicto === 'climatizacion');
	assert.ok(cargado.recomendacion.length > 20);
});

test('la temperatura interior es el ambiente del proyecto más el salto', () => {
	const p = tablero([{ id: 'q1', tipo: 'disyuntor', disipacionW: 60 }]);
	p.opciones = { temperaturaAmbienteC: 45 };
	const b = calcularBalanceTermico(p)!;
	assert.equal(b.temperaturaAmbienteC, 45);
	assert.ok(Math.abs(b.temperaturaInteriorC - (45 + b.saltoTermicoK)) < 0.11);
});

test('sin aparatos dentro no hay salto térmico', () => {
	const b = calcularBalanceTermico(tablero([]))!;
	assert.equal(b.disipacionW, 0);
	assert.equal(b.saltoTermicoK, 0);
	assert.equal(b.veredicto, 'holgado');
});

test('los principales salen ordenados de más a menos calor y son como mucho tres', () => {
	const p = tablero([
		{ id: 'a', tipo: 'disyuntor', disipacionW: 5 },
		{ id: 'b', tipo: 'variador', disipacionW: 80 },
		{ id: 'c', tipo: 'fuente', disipacionW: 20 },
		{ id: 'd', tipo: 'rele', disipacionW: 1 },
	]);
	const b = calcularBalanceTermico(p)!;
	assert.equal(b.principales.length, 3);
	assert.deepEqual(b.principales.map((x) => x.watts), [80, 20, 5]);
});
