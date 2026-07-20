/**
 * Motor de potenciales eléctricos.
 *
 * Calcula las clases de equivalencia de bornes conectados (union-find), igual que
 * Conductor::relatedPotentialConductors() en QElectroTech pero de forma explícita:
 * dos bornes comparten potencial si los une un conductor, un puente interno de un
 * dispositivo o un puente entre bornas de un bornero.
 */
import { Proyecto, TipoBorne } from '../modelo/tipos.js';
import { claveBorne } from '../modelo/proyecto.js';

export interface Potencial {
	id: string;              // "P1", "P2", …
	/** Claves "dispositivo::borne" que pertenecen al potencial. */
	bornes: string[];
	/** Ids de los conductores que materializan el potencial. */
	conductores: string[];
	/** Naturaleza dominante: PE > N > L > control > señal. */
	tipo: TipoBorne;
	/** Tensiones nominales (V) declaradas por los dispositivos presentes. */
	tensiones: number[];
}

export interface ResultadoPotenciales {
	potenciales: Potencial[];
	/** Potencial al que pertenece cada clave "dispositivo::borne". */
	porBorne: Map<string, Potencial>;
	/** Potencial de cada conductor. */
	porConductor: Map<string, Potencial>;
}

class UnionFind {
	private padre = new Map<string, string>();

	raiz(x: string): string {
		let r = this.padre.get(x);
		if (r === undefined) {
			this.padre.set(x, x);
			return x;
		}
		if (r !== x) {
			r = this.raiz(r);
			this.padre.set(x, r);
		}
		return r;
	}

	unir(a: string, b: string): void {
		const ra = this.raiz(a);
		const rb = this.raiz(b);
		if (ra !== rb) this.padre.set(rb, ra);
	}

	claves(): string[] {
		return [...this.padre.keys()];
	}
}

const PRIORIDAD_TIPO: TipoBorne[] = ['PE', 'N', 'L', 'control', 'senal', 'otro'];

export function calcularPotenciales(proyecto: Proyecto): ResultadoPotenciales {
	const uf = new UnionFind();

	// Registrar todos los bornes existentes (aunque estén sueltos, para poder consultarlos).
	for (const d of proyecto.dispositivos) {
		for (const b of d.bornes) uf.raiz(claveBorne({ dispositivoId: d.id, borneId: b.id }));
		for (const [b1, b2] of d.puentesInternos ?? []) {
			uf.unir(`${d.id}::${b1}`, `${d.id}::${b2}`);
		}
		for (const grupo of d.puentes ?? []) {
			for (let i = 1; i < grupo.length; i++) uf.unir(`${d.id}::${grupo[0]}`, `${d.id}::${grupo[i]}`);
		}
	}
	for (const c of proyecto.conductores) uf.unir(claveBorne(c.de), claveBorne(c.a));

	// Agrupar por raíz.
	const grupos = new Map<string, string[]>();
	for (const clave of uf.claves()) {
		const r = uf.raiz(clave);
		const lista = grupos.get(r) ?? [];
		lista.push(clave);
		grupos.set(r, lista);
	}

	const tipoDeBorne = new Map<string, TipoBorne>();
	const tensionDeDispositivo = new Map<string, number>();
	for (const d of proyecto.dispositivos) {
		if (d.tensionNominal !== undefined) tensionDeDispositivo.set(d.id, d.tensionNominal);
		for (const b of d.bornes) tipoDeBorne.set(`${d.id}::${b.id}`, b.tipo ?? 'otro');
	}

	const potenciales: Potencial[] = [];
	const porBorne = new Map<string, Potencial>();
	let n = 0;

	// Orden estable para que los ids P1, P2… sean deterministas.
	const raicesOrdenadas = [...grupos.keys()].sort();
	for (const raiz of raicesOrdenadas) {
		const bornes = grupos.get(raiz)!.sort();
		n += 1;
		const tipos = new Set(bornes.map((b) => tipoDeBorne.get(b) ?? 'otro'));
		const tipo = PRIORIDAD_TIPO.find((t) => tipos.has(t)) ?? 'otro';
		const tensiones = [
			...new Set(
				bornes
					.map((b) => tensionDeDispositivo.get(b.split('::')[0]))
					.filter((t): t is number => t !== undefined),
			),
		].sort((a, b) => a - b);
		const p: Potencial = { id: `P${n}`, bornes, conductores: [], tipo, tensiones };
		potenciales.push(p);
		for (const b of bornes) porBorne.set(b, p);
	}

	const porConductor = new Map<string, Potencial>();
	for (const c of proyecto.conductores) {
		const p = porBorne.get(claveBorne(c.de));
		if (p) {
			p.conductores.push(c.id);
			porConductor.set(c.id, p);
		}
	}

	return { potenciales, porBorne, porConductor };
}
