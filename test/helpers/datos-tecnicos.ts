import { publicarRevision } from '../../src/datos-tecnicos/hash.js';
import { crearProyecto } from '../../src/modelo/proyecto.js';
import { referenciaTecnica } from '../../src/datos-tecnicos/tipos.js';
import type { CampoTecnico } from '../../src/datos-tecnicos/campos.js';
import type {
	BaseRevisionTecnica, DatoTecnico, RevisionCurvaTecnica,
	RevisionProductoTecnico, RevisionTablaAmpacidad, RevisionCriteriosTecnicos,
} from '../../src/datos-tecnicos/tipos.js';

/** Datos deliberadamente sintéticos. Ninguna magnitud procede de un fabricante o norma. */
export const procedenciaSintetica = () => ({
	origen: 'SINTETICO' as const, referencia: 'Fixture aritmético V8; no apto para selección real',
});

export function baseTecnica(id = 'producto-prueba', revision = 1): BaseRevisionTecnica {
	return {
		version: 1, canon: 1, catalogo: { id: 'catalogo-prueba', nombre: 'Catálogo sintético de regresión' },
		id, revision, hash: `sha256:${'0'.repeat(64)}`, nombre: `Fixture ${id}`,
		estado: 'ACTIVA', procedencia: procedenciaSintetica(),
	};
}

export function datoTecnico(campo: CampoTecnico = 'proteccion.Icu', valor: DatoTecnico['valor'] = 6,
	unidad = 'kA'): DatoTecnico {
	return { campo, valor, unidad, naturaleza: Array.isArray(valor) ? 'INTERVALO' : 'NOMINAL',
		procedencia: procedenciaSintetica() };
}

export function productoTecnico(cambios: Partial<RevisionProductoTecnico> = {}): RevisionProductoTecnico {
	return publicarRevision({ ...baseTecnica(), tipo: 'PRODUCTO', familia: 'PROTECCION',
		variante: 'AC 230 V', campos: [
			{ ...datoTecnico(), condiciones: { sistema: 'AC', tensionV: 230 } },
			datoTecnico('proteccion.inA', 25, 'A'),
		], ...cambios });
}

export function curvaTecnica(cambios: Partial<RevisionCurvaTecnica> = {}): RevisionCurvaTecnica {
	return publicarRevision({ ...baseTecnica('curva-prueba'), tipo: 'CURVA', base: 'MULTIPLOS_IN',
		unidadTiempo: 's', interpolacion: 'LOG_LOG', condiciones: { sistema: 'AC' },
		puntos: [{ corriente: 1, minimoS: 10, maximoS: 20 }, { corriente: 5, minimoS: .1, maximoS: 1 }],
		...cambios });
}

export function tablaTecnica(cambios: Partial<RevisionTablaAmpacidad> = {}): RevisionTablaAmpacidad {
	const condicion = { material: 'COBRE' as const, aislamiento: 'PVC-sintetico', metodo: 'metodo-prueba' };
	return publicarRevision({ ...baseTecnica('tabla-prueba'), tipo: 'AMPACIDAD', politicaSeccion: 'EXACT_ONLY',
		filas: [
			{ ...condicion, temperaturaAislamientoC: 70, seccionMm2: 4, temperaturaBaseC: 20, cargados: 3, agrupamientoBase: 1, izA: 30 },
			{ ...condicion, temperaturaAislamientoC: 70, seccionMm2: 6, temperaturaBaseC: 20, cargados: 3, agrupamientoBase: 1, izA: 42 },
		], factores: [
			{ ...condicion, id: 'temperatura', dimension: 'AMBIENTE', politica: 'EXACT_ONLY', puntos: [{ valor: 20, factor: 1 }, { valor: 30, factor: .94 }] },
			{ ...condicion, id: 'grupo', dimension: 'AGRUPAMIENTO', politica: 'EXACT_ONLY', puntos: [{ valor: 1, factor: 1 }, { valor: 2, factor: .8 }] },
		], combinaciones: [['temperatura', 'grupo']], ...cambios });
}

export function criteriosTecnicos(cambios: Partial<RevisionCriteriosTecnicos> = {}): RevisionCriteriosTecnicos {
	return publicarRevision({ ...baseTecnica('criterios-prueba'), tipo: 'CRITERIOS',
		ambitoDeclarado: 'Política interna sintética', parametros: {
			maxVoltageDropPercent: { modo: 'VALOR', valor: 3 },
			coordinarIbInIz: { modo: 'VALOR', valor: true },
			capacidadCorte: { modo: 'VALOR', valor: 'Icu' },
		}, ...cambios });
}

export function proyectoConProductoTecnico(producto = productoTecnico()) {
	const p = crearProyecto('Proyecto sintético V8');
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Regresión' }];
	p.gabinete = { ancho: 600, alto: 800, colocaciones: [], rieles: [], canaletas: [] };
	p.dispositivos = [{ id: 'q1', tipo: 'disyuntor', corrienteNominal: 25,
		bornes: [{ id: '1', tipo: 'L' }, { id: '2', tipo: 'L' }] }];
	p.datosTecnicos = { version: 1, revisiones: [producto], instalaciones: [], vinculos: [{
		entidad: 'DEVICE', entidadId: 'q1', producto: referenciaTecnica(producto),
		condiciones: { sistema: 'AC', tensionV: 230 }, decisiones: {
			'proteccion.Icu@': { modo: 'CATALOGO' }, 'proteccion.inA@': { modo: 'CATALOGO' },
		},
	}] };
	return p;
}
