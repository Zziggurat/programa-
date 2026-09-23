import { test } from 'node:test';
import assert from 'node:assert/strict';

import { crearComponentePortatil, leerComponentePortatil,
	leerComponentePortatilDesdeArchivo, MAX_TSCOMP_TEXTO } from '../src/componentes/portatil.js';
import type { DefinicionComponentePersonalizado } from '../src/componentes/personalizados.js';
import { referenciaTecnica } from '../src/datos-tecnicos/tipos.js';
import { curvaTecnica, productoTecnico } from './helpers/datos-tecnicos.js';

// PNG de 1 px: la prueba no depende de IndexedDB ni del navegador.
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7xQAAAAASUVORK5CYII='),
	(c) => c.charCodeAt(0));
const imagen = async () => {
	const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(PNG).buffer));
	return { id: `sha256:${[...hash].map((b) => b.toString(16).padStart(2, '0')).join('')}`,
		mime: 'image/png', bytes: PNG };
};
const definicion = async (conFicha: boolean): Promise<DefinicionComponentePersonalizado> => {
	const asset = await imagen();
	const d: DefinicionComponentePersonalizado = {
		formato: 'tablero-studio-componente', version: 1, id: 'cmp-q1', revision: 2,
		nombre: 'Protección propia', creadoEn: '2026-08-23T10:00:00.000Z',
		modificadoEn: '2026-08-23T10:00:00.000Z', tipoDispositivo: 'disyuntor',
		dimensiones: { anchoMm: 18, altoMm: 80, fondoMm: 65 }, assetId: asset.id,
		terminales: [
			{ id: 'L1', rotulo: 'Entrada de línea', tipo: 'L', u: .5, v: .1, lado: 'primario', obligatorio: true,
				maxConductores: 2, seccionMaxMm2: 6 },
			{ id: 'T1', tipo: 'L', u: .5, v: .9, lado: 'secundario+', obligatorio: true },
		],
		bloquesTerminales: [
			{ rotulo: 'Entrada', lado: 'arriba', bornes: ['L1'] },
			{ rotulo: 'Salida', lado: 'abajo', bornes: ['T1'] },
		],
		comportamiento: { version: 1, clase: 'proteccion', funcion: 'termomagnetico', rearmable: true,
			polos: [{ entrada: 'L1', salida: 'T1' }], contactos: [] },
	};
	if (conFicha) {
		const curva = curvaTecnica();
		const producto = productoTecnico({ curva: referenciaTecnica(curva) });
		d.fichaTecnica = { producto: referenciaTecnica(producto), revisiones: [producto, curva] };
	}
	return d;
};

test('.tscomp V1/V2 hace roundtrip sin perder terminales; V2 conserva el cierre V8 exacto', async () => {
	const asset = await imagen();
	for (const conFicha of [false, true]) {
		const d = await definicion(conFicha);
		const original = structuredClone(d);
		const archivo = await crearComponentePortatil(d, asset);
		assert.equal(archivo.version, conFicha ? 2 : 1);
		const restaurado = await leerComponentePortatil(JSON.stringify(archivo));
		assert.deepEqual(restaurado.definicion, d);
		assert.deepEqual(d, original, 'exportar no muta la definición');
		assert.equal(restaurado.asset.id, asset.id);
		assert.equal(restaurado.definicion.terminales[0].lado, 'primario');
		assert.equal(restaurado.definicion.terminales[0].rotulo, 'Entrada de línea');
		assert.equal(restaurado.definicion.terminales[0].obligatorio, true);
		assert.deepEqual(restaurado.definicion.bloquesTerminales?.map((b) => b.bornes), [['L1'], ['T1']]);
		if (conFicha) assert.equal(restaurado.definicion.fichaTecnica?.revisiones.length, 2);
	}
});

test('.tscomp rechaza V1 que descartaría ficha y V2 incompleto o con cierre ajeno', async () => {
	const archivo = await crearComponentePortatil(await definicion(true), await imagen());
	const v1 = structuredClone(archivo); v1.version = 1;
	await assert.rejects(leerComponentePortatil(JSON.stringify(v1)), /exige \.tscomp V2/);
	const sinFicha = structuredClone(archivo); delete sinFicha.definicion.fichaTecnica;
	await assert.rejects(leerComponentePortatil(JSON.stringify(sinFicha)), /requiere una ficha técnica/);
	const falta = structuredClone(archivo); falta.definicion.fichaTecnica!.revisiones.pop();
	await assert.rejects(leerComponentePortatil(JSON.stringify(falta)), /MISSING|dependencia exacta/);
	const adulterado = structuredClone(archivo); adulterado.definicion.fichaTecnica!.revisiones[0].nombre = 'Adulterado';
	await assert.rejects(leerComponentePortatil(JSON.stringify(adulterado)), /Integridad inválida/);
	const extra = structuredClone(archivo);
	extra.definicion.fichaTecnica!.revisiones.push(productoTecnico({ id: 'ajeno', curva: undefined }));
	await assert.rejects(leerComponentePortatil(JSON.stringify(extra)), /ajenas|dependencia exacta|hasta dos revisiones/);
	const metadata = structuredClone(archivo);
	(metadata.definicion.fichaTecnica as unknown as Record<string, unknown>).revisionHumana = { estado: 'REVISADO' };
	await assert.rejects(leerComponentePortatil(JSON.stringify(metadata)), /solo un producto exacto/);
});

test('.tscomp rechaza campos extra V2, formas hostiles y terminales desconocidos sin TypeError', async () => {
	const archivo = await crearComponentePortatil(await definicion(true), await imagen());
	const extra = { ...archivo, comando: 'ejecutar' };
	await assert.rejects(leerComponentePortatil(JSON.stringify(extra)), /campos desconocidos/);
	const dimensionesExtra = structuredClone(archivo);
	(dimensionesExtra.definicion.dimensiones as unknown as Record<string, unknown>).voltios = 1000;
	await assert.rejects(leerComponentePortatil(JSON.stringify(dimensionesExtra)), /Dimensiones V2: campo desconocido/);
	const borneExtra = structuredClone(archivo);
	(borneExtra.definicion.terminales[0] as unknown as Record<string, unknown>).limiteInventado = 9;
	await assert.rejects(leerComponentePortatil(JSON.stringify(borneExtra)), /Terminal L1: campo desconocido/);
	const roto = structuredClone(archivo);
	(roto.definicion as unknown as Record<string, unknown>).dimensiones = null;
	await assert.rejects(leerComponentePortatil(JSON.stringify(roto)), /definición.*incompleta/i);
	const borne = structuredClone(archivo);
	(borne.definicion.terminales[0] as unknown as Record<string, unknown>).lado = 'arbitrario';
	await assert.rejects(leerComponentePortatil(JSON.stringify(borne)), /lado de fuente no reconocido/);
	const naturaleza = structuredClone(archivo);
	(naturaleza.definicion.terminales[0] as unknown as Record<string, unknown>).tipo = 'script';
	await assert.rejects(leerComponentePortatil(JSON.stringify(naturaleza)), /naturaleza eléctrica no reconocida/);
});

test('.tscomp verifica SHA-256, MIME, firma y base64 canónico antes de importar', async () => {
	const archivo = await crearComponentePortatil(await definicion(false), await imagen());
	const hash = structuredClone(archivo); hash.asset.base64 = hash.asset.base64.replace('iV', 'iU');
	await assert.rejects(leerComponentePortatil(JSON.stringify(hash)), /SHA-256|imagen PNG/);
	const mime = structuredClone(archivo); mime.asset.mime = 'image/jpeg';
	await assert.rejects(leerComponentePortatil(JSON.stringify(mime)), /MIME coherente/);
	const b64 = structuredClone(archivo); b64.asset.base64 = 'iVBORw0KGgo=';
	await assert.rejects(leerComponentePortatil(JSON.stringify(b64)), /SHA-256|imagen PNG/);
});

test('.tscomp rechaza tamaño excesivo antes de leer el archivo', async () => {
	let leido = false;
	await assert.rejects(leerComponentePortatilDesdeArchivo({ size: MAX_TSCOMP_TEXTO + 1,
		text: async () => { leido = true; return ''; } }), /64 MiB/);
	assert.equal(leido, false);
});
