/**
 * LA TENSIÓN ES DEL BORNE, NO DEL APARATO.
 *
 * Segunda auditoría, TS2-P1-04. El tablero que el propio programa arma desde la Planta salía con
 * TRES avisos R6 de «conflicto de tensión» recién generado, y los tres eran mentira:
 *
 *     P7   conecta dispositivos de 24 V y 220 V     ← a1::GND + g1::PE + red::PE
 *     P35  conecta dispositivos de 24 V y 220 V     ← g1::L (primario) + q1::2
 *     P36  conecta dispositivos de 24 V y 220 V     ← g1::N (primario) + q1::4
 *
 * El motor colgaba la `tensionNominal` del aparato a TODOS sus bornes. Con eso, el primario de una
 * fuente 220/24 se leía a 24, y un PE —que une la carcasa de un aparato de 220 con la masa de un
 * controlador de 24 porque para eso está— se leía como un conflicto.
 *
 * Que el DRC avise de lo que él mismo acaba de armar no es un aviso de más: es la manera de que
 * nadie mire los avisos, y el día que salte uno de verdad —una bobina de 24 alimentada a 220— pase
 * de largo. Por eso se arregló el modelo y no la regla.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Dispositivo } from '../src/modelo/tipos.js';
import { tensionDeBorne, tensionSecundariaDe } from '../src/motores/tensiones.js';

const fuente = (mas: Partial<Dispositivo> = {}): Dispositivo => ({
	id: 'g1', tipo: 'fuente', descripcion: 'Fuente 220 V / 24 V CC',
	tensionNominal: 220, tensionSecundariaV: 24,
	bornes: [
		{ id: 'L', tipo: 'L', lado: 'primario' },
		{ id: 'N', tipo: 'N', lado: 'primario' },
		{ id: 'PE', tipo: 'PE' },
		{ id: '+24', tipo: 'control', lado: 'secundario+' },
		{ id: '0V', tipo: 'control', lado: 'secundario-' },
	],
	...mas,
});

const borne = (d: Dispositivo, id: string) => d.bornes.find((b) => b.id === id)!;

test('una fuente tiene DOS tensiones: la del primario y la del secundario', () => {
	const g = fuente();
	assert.equal(tensionDeBorne(g, borne(g, 'L')), 220, 'el primario está a la tensión de entrada');
	assert.equal(tensionDeBorne(g, borne(g, 'N')), 220);
	assert.equal(tensionDeBorne(g, borne(g, '+24')), 24, 'el secundario, a la que reparte');
	assert.equal(tensionDeBorne(g, borne(g, '0V')), 24);
});

test('un PE no tiene tensión de empleo: une el 220 con el 24 porque para eso está', () => {
	const g = fuente();
	assert.equal(tensionDeBorne(g, borne(g, 'PE')), undefined);
	const plc: Dispositivo = {
		id: 'a1', tipo: 'plc', tensionNominal: 24,
		bornes: [{ id: 'GND', tipo: 'PE' }, { id: '24V~', tipo: 'control' }],
	};
	assert.equal(tensionDeBorne(plc, plc.bornes[0]), undefined, 'la masa del DDC tampoco');
	assert.equal(tensionDeBorne(plc, plc.bornes[1]), 24, 'su alimentación sí');
});

test('un proyecto guardado sin `lado` sigue leyéndose bien (se deduce del id)', () => {
	const viejo: Dispositivo = {
		id: 'g1', tipo: 'fuente', descripcion: 'Fuente conmutada 220 VAC → 24 VDC',
		tensionNominal: 220,
		bornes: [{ id: 'L', tipo: 'L' }, { id: '+V', tipo: 'control' }, { id: '-V', tipo: 'control' }],
	};
	assert.equal(tensionDeBorne(viejo, viejo.bornes[0]), 220);
	assert.equal(tensionDeBorne(viejo, viejo.bornes[1]), 24, '`+V` es secundario aunque no lo diga');
	assert.equal(tensionDeBorne(viejo, viejo.bornes[2]), 24);
});

test('un aparato normal reparte su tensión nominal por todos sus bornes', () => {
	const q: Dispositivo = {
		id: 'q1', tipo: 'disyuntor', tensionNominal: 220,
		bornes: [{ id: '1', tipo: 'L' }, { id: '2', tipo: 'L' }, { id: 'PE', tipo: 'PE' }],
	};
	assert.equal(tensionDeBorne(q, q.bornes[0]), 220);
	assert.equal(tensionDeBorne(q, q.bornes[1]), 220);
	assert.equal(tensionDeBorne(q, q.bornes[2]), undefined, 'menos el PE, que no tiene');
});

test('un transformador de mando 380/110 no se lee como si sacara 24', () => {
	const t: Dispositivo = {
		id: 't1', tipo: 'transformador', descripcion: 'Transformador de mando 380/110 V',
		tensionNominal: 380,
		bornes: [{ id: 'P1', tipo: 'L' }, { id: 'S1', tipo: 'control' }],
	};
	assert.equal(tensionSecundariaDe(t), 110);
	assert.equal(tensionDeBorne(t, t.bornes[0]), 380);
	assert.equal(tensionDeBorne(t, t.bornes[1]), 110);
});
