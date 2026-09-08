import type { CondicionesTecnicas } from '../datos-tecnicos/tipos.js';
import type { ResultadoFisicaElectrica } from '../fisica/topologia-proyecto.js';
import { resolverComportamiento } from '../modelo/comportamiento.js';
import type { Dispositivo, Proyecto } from '../modelo/tipos.js';

/** Contexto nominal comprobable en los polos, no tensión deprimida bajo carga/falla.
 * Reutiliza conexiones del snapshot físico; no atraviesa cargas ni fuentes como puentes.
 * Una declaración del vínculo nunca sustituye a una red desconocida o contradictoria.
 */
export function contextoNominalProteccion(proyecto: Proyecto, d: Dispositivo,
	fisica: ResultadoFisicaElectrica | undefined): { condiciones: CondicionesTecnicas; motivos: string[] } {
	const perfil = resolverComportamiento(d), condiciones: CondicionesTecnicas = {}, motivos: string[] = [];
	if (perfil?.clase !== 'proteccion') return { condiciones, motivos: ['Perfil de protección no disponible.'] };
	condiciones.polos = perfil.polos.length;
	if (!fisica) return { condiciones, motivos: ['Falta snapshot de conectividad física.'] };
	const vecinos = new Map<string, Set<string>>();
	for (const r of fisica.medicion.ramas.values()) {
		if (!['CONDUCTOR', 'CONTACTO', 'PROTECCION'].includes(r.tipo ?? '') || r.id.startsWith(`interno:${d.id}:`)) continue;
		for (const [a,b] of [[r.de,r.a],[r.a,r.de]]) { if (!vecinos.has(a)) vecinos.set(a,new Set()); vecinos.get(a)!.add(b); }
	}
	const alcanzados = new Set<string>();
	const cola = perfil.polos.flatMap(p => [`${d.id}::${p.entrada}`, `${d.id}::${p.salida}`]);
	for (let i=0;i<cola.length;i++) { const n=cola[i]; if (alcanzados.has(n)) continue; alcanzados.add(n); for(const v of vecinos.get(n)??[]) if(!alcanzados.has(v)) cola.push(v); }
	const fuentes = proyecto.dispositivos.flatMap(x => {
		const f=x.fisica?.fuente; if(!f) return [];
		const fases=f.fases.filter(p => alcanzados.has(`${x.id}::${p.borne}`));
		return fases.length ? [{ id:x.id, f, fases }] : [];
	});
	const fasesConocidas = new Set(fuentes.flatMap(x=>x.fases.map(p=>`${x.id}::${p.borne}`)));
	const fuenteSinNominal = fisica.medicion.fuentes.some(f=>alcanzados.has(f.de)&&!fasesConocidas.has(f.de));
	if (fuentes.length !== 1 || fuenteSinNominal) return { condiciones, motivos: ['Fuente nominal conectada ausente o ambigua; no se adopta la tensión declarada del vínculo.'] };
	const {id,f,fases}=fuentes[0];
	condiciones.sistema=f.sistema==='DC'?'DC':'AC';
	condiciones.frecuenciaHz=f.frecuenciaHz;
	const base=f.tensionNominalV/(f.sistema==='AC_TRIFASICA'?Math.sqrt(3):1);
	let tension=base;
	if (f.sistema==='AC_TRIFASICA' && fases.length>1) {
		const angulo=(p:typeof fases[number]) => (p.anguloDeg ?? ({L1:0,L2:-120,L3:120,L:0,POSITIVO:0}[p.fase]))*Math.PI/180;
		const diferencias: number[]=[];
		for(let i=0;i<fases.length;i++) for(let j=i+1;j<fases.length;j++) diferencias.push(base*Math.hypot(Math.cos(angulo(fases[i]))-Math.cos(angulo(fases[j])),Math.sin(angulo(fases[i]))-Math.sin(angulo(fases[j]))));
		tension=Math.max(...diferencias);
	}
	if(Number.isFinite(tension)&&tension>0) condiciones.tensionV=tension;
	motivos.push(`Fuente ${id}; ${f.sistema}; polos físicos ${perfil.polos.length}; fases conectadas ${fases.map(p=>p.borne).sort().join(', ')}; tensión nominal entre conductores activos ${tension} V (no tensión bajo carga).`);
	return { condiciones, motivos };
}
