/** Datos técnicos V8: formularios ordinarios, preview aislado y confirmación documental atómica. */
import './datos-tecnicos.css';
import type { Proyecto } from '../src/modelo/tipos.js';
import { CAMPOS_TECNICOS, type CampoTecnico } from '../src/datos-tecnicos/campos.js';
import { crearPaqueteTecnico, jsonCanonico, leerPaqueteTecnicoAsync, publicarRevision } from '../src/datos-tecnicos/hash.js';
import { LIMITES_TECNICOS } from '../src/datos-tecnicos/schema.js';
import { cambiarConfiguracionTecnica, comprobarPreviewTecnico, prepararPreviewTecnico, vincularProductoTecnico, desvincularProductoTecnico, type PreviewTecnico } from '../src/datos-tecnicos/operaciones.js';
import { familiaDispositivo, leerDatoLegacy, resolverProyectoTecnico } from '../src/datos-tecnicos/resolver.js';
import { resolverAmpacidadTecnica } from '../src/datos-tecnicos/ampacidad.js';
import { CLAVES_CRITERIOS_TECNICOS, resolverCriteriosTecnicos } from '../src/datos-tecnicos/criterios.js';
import { claveDato, referenciaTecnica, type CondicionesTecnicas, type DatoTecnico, type FamiliaTecnica, type RevisionProductoTecnico, type RevisionTecnica, type VinculoTecnico, type RevisionCriteriosTecnicos, type RevisionHumanaTecnica } from '../src/datos-tecnicos/tipos.js';
import type { RepositorioDatosTecnicos } from '../src/datos-tecnicos/repositorio.js';
import { catalogoSinteticoV8, fixtureDatosTecnicosV8 } from '../ejemplo/datos-tecnicos-v8.js';
import { ejecutarIngenieria } from '../src/ingenieria/engine.js';
import { contextoDisenoIngenieria } from './ui-ingenieria.js';
import { descargar, escaparHtml } from './dialogos.js';
import { abrirVentana, cerrarVentana } from './ventanas.js';
export interface ContextoDatosTecnicos {
    repositorio: RepositorioDatosTecnicos;
    proyecto(): Proyecto;
    identidad(): string;
    prepararAplicacion(): Promise<{
        proyecto: Proyecto;
        aplicar(p: Proyecto): Promise<boolean>;
    }>;
    confirmar(mensaje: string): Promise<boolean>;
    abrirEjemplo(p: Proyecto): Promise<void>;
    exportarProyecto(): Promise<void>;
    validar(): void;
    avisar(m: string, tipo?: 'info' | 'ok' | 'error'): void;
}
export interface PanelDatosTecnicos {
    abrir(entidadId?: string): Promise<void>;
    invalidar(): void;
    destruir(): void;
}
const esc = (v: unknown) => escaparHtml(String(v ?? ''));
const opt = (v: string, t = v, elegido?: string) => `<option value="${esc(v)}"${v === elegido ? ' selected' : ''}>${esc(t)}</option>`;
const input = (id: string, label: string, v: unknown = '', type = 'text') => `<label>${esc(label)}<input data-dt-input="${id}" type="${type}" value="${esc(v)}"${type === 'number' ? ' step="any"' : ''}></label>`;
const valorDato = (d?: DatoTecnico) => d ? `${Array.isArray(d.valor) ? d.valor.join(' … ') : d.valor} ${d.unidad}` : 'NO DISPONIBLE';
const familias: FamiliaTecnica[] = ['PROTECCION', 'BOBINA', 'PLC', 'ANALOGICA', 'CONDUCTOR', 'MOTOR', 'VFD', 'TRANSFORMADOR', 'FUENTE'];
export function instalarUIDatosTecnicos(ctx: ContextoDatosTecnicos): PanelDatosTecnicos {
    const raiz = document.createElement('div');
    raiz.id = 'modal-datos-tecnicos';
    raiz.hidden = true;
    raiz.innerHTML = `<section class="dt-ventana"><header><h2 id="dt-titulo">Datos técnicos</h2><button data-dt="cerrar" aria-label="Cerrar Datos técnicos">✕</button></header>
	<nav class="dt-barra"><button data-dt="biblioteca">Catálogos y vínculos</button><button data-dt="instalacion">Instalación / ampacidad</button><button data-dt="criterios">Criterios</button><button data-dt="faltantes">Datos faltantes</button><button data-dt="ensayo">Icc prospectiva</button></nav>
	<p data-dt-estado role="status"></p><main class="dt-cuerpo"></main></section>`;
    document.body.appendChild(raiz);
    const cuerpo = raiz.querySelector<HTMLElement>('.dt-cuerpo')!, estado = raiz.querySelector<HTMLElement>('[data-dt-estado]')!;
    let biblioteca: RevisionTecnica[] = [], seleccionHash = '', entidadId = '', busqueda = '', filtroFamilia = '';
    let vista = 'biblioteca', borrador: RevisionProductoTecnico | undefined, importadas: RevisionTecnica[] | undefined;
    let preview: {
        datos: PreviewTecnico;
        operacion: Awaited<ReturnType<ContextoDatosTecnicos['prepararAplicacion']>>;
        identidad: string;
        formulario: string;
    } | undefined;
    let generacionFormulario = 0;
    let revisionVista: string | undefined, aborto: AbortController | undefined, destruido = false;
    let tablaElegida: string | undefined, criterioElegido: string | undefined, ambitoCriterio = '', generacionImport = 0;
    let overridesCriterio: RevisionCriteriosTecnicos['parametros'] | undefined;
    const revisionesHumanas = new Map<string, RevisionHumanaTecnica>();
    const $ = <T extends HTMLElement = HTMLInputElement>(selector: string) => cuerpo.querySelector<T>(selector)!;
    const leer = (id: string) => $<HTMLInputElement>(`[data-dt-input="${id}"]`)?.value ?? '';
    const numero = (id: string): number | undefined => leer(id).trim() === '' ? undefined : Number(leer(id));
    const seleccionado = () => [...biblioteca, ...(ctx.proyecto().datosTecnicos?.revisiones ?? [])].find(r => r.hash === seleccionHash);
    const mensaje = (m: string, error = false) => { estado.textContent = m; estado.dataset.error = String(error); };
    const huellaFormulario = () => JSON.stringify([vista, seleccionHash,
        [...cuerpo.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea')]
            .map(e => [e.name, e.dataset, e.value, e instanceof HTMLInputElement ? e.checked : undefined])]);
    function invalidarFormulario() {
        generacionFormulario++;
        if (!preview) return;
        preview = undefined;
        $<HTMLElement>('[data-dt-preview]')?.replaceChildren();
        mensaje('El formulario cambió. Previsualiza de nuevo antes de aplicar.');
    }
    const acciones = (html: string) => `<div class="dt-barra">${html}</div>`;
    const boton = (accion: string, texto: string) => `<button data-dt="${accion}">${esc(texto)}</button>`;
    async function actualizarBiblioteca() {
        biblioteca = await ctx.repositorio.listar();
        if (!seleccionHash) seleccionHash = biblioteca[0]?.hash ?? '';
        const revision = seleccionado();
        if (revision) {
            const evidencia = await ctx.repositorio.revisionHumana(revision.hash);
            if (evidencia) revisionesHumanas.set(revision.hash, evidencia);
        }
    }
    function candidatos() { const conjunto = new Map([...biblioteca, ...(ctx.proyecto().datosTecnicos?.revisiones ?? [])].map(r => [r.hash, r])); return [...conjunto.values()]; }
    function opcionesEntidades(familia?: FamiliaTecnica) {
        const p = ctx.proyecto();
        return [...p.dispositivos.filter(d => !familia || familiaDispositivo(d) === familia).map(d => ({ id: d.id, texto: `${d.designacion ?? d.id} · ${d.descripcion ?? d.tipo}` })),
            ...(!familia || familia === 'CONDUCTOR' ? p.conductores.map(c => ({ id: c.id, texto: `Cable ${c.id} · ${c.seccion} mm²` })) : [])];
    }
    function tablaFicha(r: RevisionTecnica) {
        const humana = revisionesHumanas.get(r.hash);
        const cabeza = `<h3>${esc(r.nombre)} · r${r.revision}</h3><p>${esc(r.tipo)} · ${esc(r.catalogo.nombre)} · ${esc(r.estado)}</p><p><b>${esc(r.procedencia.origen)}</b> · ${esc(r.procedencia.referencia)}</p><p class="dt-hash">${esc(r.hash)}</p><p>Hash = integridad; no demuestra autenticidad, licencia ni certificación. La fuente importada es declarada, no verificada.</p>${humana ? `<p>Revisión humana local: ${esc(humana.estado)} · ${esc(humana.responsable)} · ${esc(humana.fecha)}<br>${esc(humana.evidencia)}. No acredita certificación ni viaja en el paquete.</p>` : '<p>Revisión humana local: SIN REVISAR.</p>'}`;
        if (r.tipo !== 'PRODUCTO')
            return cabeza + `<details><summary>Tabla, dominio y condiciones declaradas</summary><pre>${esc(JSON.stringify(r, null, 2))}</pre></details>`;
        return cabeza + `<p>Variante: ${esc(r.variante)} · ${esc(r.fabricanteDeclarado ?? 'Fabricante no declarado')} · ${esc(r.referenciaComercial ?? '')}</p><table><thead><tr><th>Campo / canal</th><th>Valor</th><th>Condiciones</th><th>Procedencia</th></tr></thead><tbody>${r.campos.map(d => `<tr><td>${esc(d.campo)} ${esc(d.canal)}</td><td>${esc(valorDato(d))}<br>${esc(d.naturaleza)}</td><td>${esc(jsonCanonico(d.condiciones ?? {}))}</td><td>${esc(d.procedencia.origen)} · ${esc(d.procedencia.referencia)} ${esc(d.procedencia.seccion)}</td></tr>`).join('')}</tbody></table>`;
    }
    function pintarBiblioteca() {
        const lista = candidatos().filter(r => (!filtroFamilia || r.tipo === 'PRODUCTO' && r.familia === filtroFamilia) && `${r.nombre} ${r.id} ${r.catalogo.nombre} ${r.tipo === 'PRODUCTO' ? `${r.referenciaComercial ?? ''} ${r.variante}` : r.tipo}`.toLocaleLowerCase().includes(busqueda.toLocaleLowerCase()));
        const r = seleccionado();
        cuerpo.innerHTML = acciones(`${input('buscar', 'Buscar catálogo/producto', busqueda)}<label>Familia<select data-dt-input="familia-filtro">${opt('', 'Todas')}${familias.map(f => opt(f, f, filtroFamilia)).join('')}</select></label>${boton('buscar', 'Buscar')}${boton('sintetico', 'Añadir catálogo sintético')}${boton('ejemplo', 'Abrir laboratorio V8')}${boton('nuevo', 'Nuevo producto')}${boton('borradores', 'Mis borradores')}${boton('importar', 'Importar JSON')}${boton('exportar-proyecto', 'Compartir proyecto portable')}`)
            + `<div class="dt-columnas"><aside class="dt-lista">${lista.map(x => `<button data-dt-select="${esc(x.hash)}" aria-pressed="${x.hash === seleccionHash}">${esc(x.nombre)}<br><small>${esc(x.catalogo.nombre)} · r${x.revision} · ${esc(x.tipo)}</small></button>`).join('') || '<p>Sin resultados. Crea un producto o importa un catálogo.</p>'}</aside><article>${r ? tablaFicha(r) + acciones(`${r.tipo === 'PRODUCTO' ? boton('editar', 'Crear nueva revisión') + boton('vincular', 'Vincular / resolver / comparar') : ''}${boton('exportar', 'Exportar subconjunto')}${boton('revision-humana', 'Registrar revisión humana')}${boton('borrar-catalogo', 'Borrar catálogo global')}`) : '<p>Selecciona una ficha para inspeccionar sus datos y procedencia.</p>'}</article></div>`;
    }
    function pintarEditor() {
        const r = borrador!;
        cuerpo.innerHTML = `<h3>${r.hash ? 'Nueva revisión sin alterar la publicada' : 'Borrador de producto'}</h3><div class="dt-form">${input('catalogo-id', 'ID catálogo', r.catalogo.id)}${input('catalogo-nombre', 'Nombre catálogo', r.catalogo.nombre)}${input('producto-id', 'ID producto', r.id)}${input('nombre', 'Nombre', r.nombre)}${input('variante', 'Variante', r.variante)}${input('revision', 'Revisión', r.revision, 'number')}<label>Familia<select data-dt-input="familia">${familias.map(f => opt(f, f, r.familia)).join('')}</select></label>${input('fabricante', 'Fabricante declarado', r.fabricanteDeclarado)}${input('referencia', 'Referencia comercial', r.referenciaComercial)}<label>Origen declarado<select data-dt-input="origen">${['USUARIO', 'GENERICO', 'SINTETICO', 'DOCUMENTAL'].map(x => opt(x, x, r.procedencia.origen)).join('')}</select></label>${input('fuente', 'Fuente / referencia', r.procedencia.referencia)}${input('documento', 'Documento (sin ruta privada)', r.procedencia.documento)}${input('seccion', 'Página / sección', r.procedencia.seccion)}${input('url', 'URL de consulta (no se carga automáticamente)', r.procedencia.url)}</div>
		<p>Editar no modifica revisiones publicadas. Los campos mantienen su fuente propia; los nuevos toman la fuente declarada arriba.</p><table><thead><tr><th>Campo</th><th>Valor / unidad</th><th>Condiciones</th><th>Acciones</th></tr></thead><tbody>${r.campos.map((d, i) => `<tr><td>${esc(d.campo)} ${esc(d.canal)}<br><small>${esc(d.procedencia.origen)}</small></td><td>${esc(valorDato(d))}</td><td>${esc(jsonCanonico(d.condiciones ?? {}))}</td><td><button data-dt-editar-campo="${i}">Editar</button><button data-dt-quitar-campo="${i}">Quitar</button></td></tr>`).join('')}</tbody></table>
		<label>Curva técnica fijada (opcional; dominio propio)<select data-dt-input="curva">${opt('', 'Sin curva')}${candidatos().filter(x => x.tipo === 'CURVA').map(x => opt(x.hash, `${x.nombre} · r${x.revision} · ${x.procedencia.origen}`, r.curva?.hash)).join('')}</select></label>
		${acciones(boton('campo', 'Añadir campo') + boton('guardar-borrador', 'Guardar borrador') + boton('publicar', 'Publicar revisión inmutable') + boton('biblioteca', 'Volver a biblioteca'))}<div data-dt-campo-editor></div>`;
    }
    function recogerEditor() {
        if (!borrador)
            return;
        Object.assign(borrador, { catalogo: { id: leer('catalogo-id'), nombre: leer('catalogo-nombre') }, id: leer('producto-id'), nombre: leer('nombre'), variante: leer('variante'), revision: numero('revision'), familia: leer('familia') });
        borrador.procedencia = { origen: leer('origen') as DatoTecnico['procedencia']['origen'], referencia: leer('fuente'), ...(leer('documento') ? { documento: leer('documento') } : {}), ...(leer('seccion') ? { seccion: leer('seccion') } : {}), ...(leer('url') ? { url: leer('url') } : {}) };
        if (leer('fabricante'))
            borrador.fabricanteDeclarado = leer('fabricante');
        else
            delete borrador.fabricanteDeclarado;
        if (leer('referencia'))
            borrador.referenciaComercial = leer('referencia');
        else
            delete borrador.referenciaComercial;
        const curva = candidatos().find(r => r.tipo === 'CURVA' && r.hash === leer('curva'));
        if (curva) borrador.curva = referenciaTecnica(curva); else delete borrador.curva;
    }
    function editorCampo(indice?: number) {
        recogerEditor();
        const d = indice === undefined ? undefined : borrador!.campos[indice];
        const prefijo = borrador!.familia === 'BOBINA' ? 'bobina' : borrador!.familia.toLowerCase();
        const campos = Object.keys(CAMPOS_TECNICOS).filter(k => k.startsWith(`${prefijo}.`) || borrador!.familia === 'PLC' && k.startsWith('analogica.'));
        const campo = d?.campo ?? campos[0];
        $<HTMLElement>('[data-dt-campo-editor]').innerHTML = `<fieldset><legend>${d ? 'Editar' : 'Añadir'} campo técnico</legend><div class="dt-form"><label>Campo<select data-dt-input="campo">${campos.map(k => opt(k, k, campo)).join('')}</select></label>${input('valor', 'Valor (rango: mínimo;máximo)', Array.isArray(d?.valor) ? d.valor.join(';') : d?.valor)}${input('unidad', 'Unidad', d?.unidad ?? CAMPOS_TECNICOS[campo as CampoTecnico].unidad)}<label>Naturaleza<select data-dt-input="naturaleza">${['NOMINAL', 'MINIMO', 'MAXIMO', 'INTERVALO'].map(k => opt(k, k, d?.naturaleza)).join('')}</select></label>${input('canal', 'Borne de canal (PLC)', d?.canal)}${formCondiciones(d?.condiciones)}${input('campo-fuente', 'Referencia de este campo', d?.procedencia.referencia ?? borrador!.procedencia.referencia)}<label>Origen de este campo<select data-dt-input="campo-origen">${['USUARIO', 'GENERICO', 'SINTETICO', 'DOCUMENTAL'].map(k => opt(k, k, d?.procedencia.origen ?? borrador!.procedencia.origen)).join('')}</select></label></div><button data-dt-guardar-campo="${indice ?? 'nuevo'}">Aceptar campo</button></fieldset>`;
    }
    function formCondiciones(c: CondicionesTecnicas = {}) { return `<label>AC/DC<select data-dt-input="sistema">${opt('', 'Sin condición', c.sistema)}${opt('AC', 'AC', c.sistema)}${opt('DC', 'DC', c.sistema)}</select></label>${input('tension', 'Tensión aplicable V', Array.isArray(c.tensionV) ? c.tensionV.join(';') : c.tensionV)}${input('frecuencia', 'Frecuencia Hz', Array.isArray(c.frecuenciaHz) ? c.frecuenciaHz.join(';') : c.frecuenciaHz)}${input('polos', 'Polos', c.polos, 'number')}${input('temperatura', 'Temperatura de aplicabilidad °C', Array.isArray(c.temperaturaC) ? c.temperaturaC.join(';') : c.temperaturaC)}${input('ajuste', 'Ajuste A', Array.isArray(c.ajusteA) ? c.ajusteA.join(';') : c.ajusteA)}${input('contexto', 'Contexto técnico', c.contexto)}<label>Tipo de carga<select data-dt-input="carga">${opt('', 'Sin condición', c.carga)}${opt('RESISTIVA', 'Resistiva', c.carga)}${opt('INDUCTIVA', 'Inductiva', c.carga)}</select></label>`; }
    const magnitud = (s: string): number | [
        number,
        number
    ] => s.includes(';') ? s.split(';').map(Number) as [
        number,
        number
    ] : Number(s);
    function recogerCondiciones(): CondicionesTecnicas { const c: CondicionesTecnicas = {}; for (const [k, n] of [['tensionV', 'tension'], ['frecuenciaHz', 'frecuencia'], ['temperaturaC', 'temperatura'], ['ajusteA', 'ajuste']] as const)
        if (leer(n).trim())
            c[k] = magnitud(leer(n)); if (leer('sistema'))
        c.sistema = leer('sistema') as 'AC' | 'DC'; if (numero('polos') !== undefined)
        c.polos = numero('polos'); if (leer('contexto'))
        c.contexto = leer('contexto'); if (leer('carga'))
        c.carga = leer('carga') as 'RESISTIVA' | 'INDUCTIVA'; return c; }
    function pintarVinculo() {
        const r = seleccionado();
        if (r?.tipo !== 'PRODUCTO')
            throw new Error('Selecciona un producto.');
        const es = opcionesEntidades(r.familia);
        if (!es.some(e => e.id === entidadId))
            entidadId = es[0]?.id ?? '';
        const p = ctx.proyecto(), v = p.datosTecnicos?.vinculos.find(x => x.entidadId === entidadId), e = p.dispositivos.find(d => d.id === entidadId) ?? p.conductores.find(c => c.id === entidadId);
        const campos = [...new Set([...r.campos.map(claveDato), ...Object.keys(v?.decisiones ?? {})])].sort();
        const resuelto = resolverProyectoTecnico(p);
        cuerpo.innerHTML = `<h3>Vincular / comparar · ${esc(r.nombre)} r${r.revision}</h3><label>Entidad<select data-dt-input="entidad">${es.map(e => opt(e.id, e.texto, entidadId)).join('')}</select></label><p>Elegir Catálogo adopta el dato exacto. Conservar fija el valor actual. Un override es decisión explícita del proyecto.</p><div class="dt-form">${formCondiciones(v?.condiciones)}</div><table><thead><tr><th>Campo</th><th>Actual efectivo</th><th>Candidato</th><th>Decisión</th><th>Override</th></tr></thead><tbody>${campos.map(key => {
            const [campo, canal] = key.split('@'), ficha = r.campos.filter(d => claveDato(d) === key), dec = v?.decisiones[key];
            const actual = resuelto.resoluciones.find(d => d.entidadId === entidadId && d.clave === key);
            return `<tr data-dt-dato="${esc(key)}"><td>${esc(campo)} ${esc(canal)}</td><td>${esc(actual ? actual.estado === 'RESOLVED' ? valorDato(actual.dato) : actual.estado : e ? valorDato(leerDatoLegacy(e, campo as CampoTecnico, canal || undefined)) : '—')}</td><td>${ficha.length ? ficha.map(d => `${esc(valorDato(d))}<br><small>${esc(jsonCanonico(d.condiciones ?? {}))}</small>`).join('<hr>') : 'Ya no declarado en esta revisión'}</td><td><select data-dt-decision>${['CATALOGO', 'CONSERVAR', 'OVERRIDE', 'SIN_HERENCIA'].map(k => opt(k, k, dec?.modo ?? 'CATALOGO')).join('')}</select></td><td><input aria-label="Override ${esc(campo)}" data-dt-override value="${esc(dec && 'dato' in dec ? Array.isArray(dec.dato.valor) ? dec.dato.valor.join(';') : dec.dato.valor : '')}" placeholder="Valor explícito"><button data-dt-quitar-override="${esc(key)}">Quitar override</button></td></tr>`;
        }).join('')}</tbody></table>${acciones(boton('preview-vinculo', 'Previsualizar cambios e impacto') + (v ? boton('desvincular', 'Desvincular producto') : '') + boton('resueltos', 'Ver datos resueltos'))}<section data-dt-preview></section>`;
    }
    function recogerVinculo(): VinculoTecnico {
        const r = seleccionado();
        if (r?.tipo !== 'PRODUCTO')
            throw new Error('Producto requerido');
        entidadId = leer('entidad');
        const p = ctx.proyecto(), d = p.dispositivos.find(d => d.id === entidadId), e = d ?? p.conductores.find(w => w.id === entidadId);
        if (!e)
            throw new Error('No hay entidad compatible; elige otro producto.');
        const vinculo: VinculoTecnico = { entidad: d ? 'DEVICE' : 'CONDUCTOR', entidadId, producto: referenciaTecnica(r), condiciones: recogerCondiciones(), decisiones: {} };
        const anterior = p.datosTecnicos?.vinculos.find(v => v.entidadId === entidadId);
        const efectivos = resolverProyectoTecnico(p).resoluciones;
        for (const fila of cuerpo.querySelectorAll<HTMLElement>('[data-dt-dato]')) {
            const key = fila.dataset.dtDato!, modo = fila.querySelector<HTMLSelectElement>('[data-dt-decision]')!.value;
            const [campo, canal] = key.split('@'), vieja = anterior?.decisiones[key];
            const dato = vieja && 'dato' in vieja ? vieja.dato : r.campos.find(x => claveDato(x) === key);
            if (modo === 'CATALOGO')
                vinculo.decisiones[key] = { modo: 'CATALOGO' };
            if (modo === 'SIN_HERENCIA')
                vinculo.decisiones[key] = { modo: 'SIN_HERENCIA', motivo: 'El usuario suprimió explícitamente la herencia desde Datos técnicos' };
            if (modo === 'CONSERVAR') {
                const actual = efectivos.find(x => x.entidadId === entidadId && x.clave === key && x.estado === 'RESOLVED')?.dato ?? (anterior ? undefined : leerDatoLegacy(e, campo as CampoTecnico, canal || undefined));
                if (!actual)
                    throw new Error(`${key}: no hay valor anterior que conservar.`);
                vinculo.decisiones[key] = { modo: 'CONSERVAR', dato: actual };
            }
            if (modo === 'OVERRIDE') {
                if (!dato) throw new Error(`${key}: falta una ficha de referencia para crear el override. Puedes suprimirlo o quitar la decisión anterior.`);
                const raw = fila.querySelector<HTMLInputElement>('[data-dt-override]')!.value;
                if (!raw.trim())
                    throw new Error(`${key}: escribe el override.`);
                const regla = CAMPOS_TECNICOS[dato.campo];
                vinculo.decisiones[key] = { modo: 'OVERRIDE', dato: { ...dato, valor: regla.tipo === 'enum' ? raw : magnitud(raw), procedencia: { origen: 'USUARIO', referencia: 'Override explícito del proyecto' } } };
            }
        }
        return vinculo;
    }
    async function prepararCambio(crear: (p: Proyecto) => Proyecto) {
        const generacion = ++generacionFormulario, formulario = huellaFormulario();
        const identidad = ctx.identidad(), operacion = await ctx.prepararAplicacion();
        const candidato = crear(operacion.proyecto);
        const datos = prepararPreviewTecnico(operacion.proyecto, candidato);
        if (ctx.identidad() !== identidad || destruido || raiz.hidden || generacion !== generacionFormulario || formulario !== huellaFormulario())
            throw new Error('STALE_RESULT: cambió el documento o el formulario.');
        preview = { datos, operacion, identidad, formulario };
        const a = ejecutarIngenieria({ proyecto: operacion.proyecto, contextoFisico: contextoDisenoIngenieria(operacion.proyecto) }), b = ejecutarIngenieria({ proyecto: candidato, contextoFisico: contextoDisenoIngenieria(candidato) });
        const panel = $<HTMLElement>('[data-dt-preview]') ?? cuerpo;
        const describir = (valor: unknown) => {
            const x = valor as { estado?: string; origen?: string; dato?: DatoTecnico } | undefined;
            return `${esc(x?.estado ?? 'NO DISPONIBLE')} · ${esc(x?.origen)}<br>${esc(valorDato(x?.dato))}<br><small>${esc(x?.dato?.procedencia.origen)} · ${esc(x?.dato?.procedencia.referencia)}<br>${esc(x?.dato?.condiciones ? jsonCanonico(x.dato.condiciones) : 'Sin condición adicional')}</small>`;
        };
        const firma = (r: typeof a.validacion.resultados[number]) => `${r.code}:${r.circuitId ?? ''}:${r.relatedEntities.map(e => `${e.tipo}:${e.id}`).sort().join(',')}`;
        const anteriores = new Map(a.validacion.resultados.map(r => [firma(r), r.status]));
        const cambiosEstado = b.validacion.resultados.filter(r => anteriores.get(firma(r)) !== r.status);
        panel.innerHTML = `<h3>Preview · BASE todavía intacta</h3><p>Fallos ${a.validacion.resumen.fail} → ${b.validacion.resumen.fail}; indeterminadas ${a.validacion.resumen.indeterminate} → ${b.validacion.resumen.indeterminate}; potencia ${esc(a.potencia.totalTablero.pW.toFixed(2))} → ${esc(b.potencia.totalTablero.pW.toFixed(2))} W.</p><p>Una revisión puede empeorar el resultado. Los overrides preservados impiden adoptar el dato de catálogo.</p><table><thead><tr><th>Campo / entidad</th><th>Antes</th><th>Después</th><th>Decisión</th></tr></thead><tbody>${datos.cambios.map(c => `<tr><td>${esc(c.entidad)}<br>${esc(c.campo)}</td><td>${describir(c.antes)}</td><td>${describir(c.despues)}</td><td>${c.overridePreservado ? 'Override/conservar preservado' : 'Dato de catálogo o ausencia explícita'}</td></tr>`).join('')}</tbody></table><h4>Validaciones que cambian</h4>${cambiosEstado.map(r => `<p><b>${esc(anteriores.get(firma(r)) ?? 'Sin evaluación')} → ${esc(r.status)}</b> · ${esc(r.title)}<br><small>${esc(r.missingData.join('; '))}</small></p>`).join('') || '<p>No cambió el estado de las reglas.</p>'}<details><summary>Detalle técnico del candidato y hashes</summary><p>${esc(datos.hashBase)} → ${esc(datos.hashCandidato)}</p><pre>${esc(JSON.stringify({ cambios: datos.cambios, instalaciones: candidato.datosTecnicos?.instalaciones, criterios: candidato.datosTecnicos?.criterios, overridesCriterios: candidato.datosTecnicos?.overridesCriterios }, null, 2))}</pre></details>${acciones(boton('aplicar-preview', 'Confirmar y aplicar') + boton('cancelar-preview', 'Cancelar preview'))}`;
        mensaje('Comparación preparada sobre una copia. Nada se guardó en BASE.');
    }
    function pintarInstalacion() {
        const p = ctx.proyecto(), tablas = candidatos().filter(r => r.tipo === 'AMPACIDAD');
        if (!p.conductores.some(w => w.id === entidadId))
            entidadId = p.conductores[0]?.id ?? '';
        const i = p.datosTecnicos?.instalaciones.find(x => x.conductorId === entidadId), tabla = tablas.find(t => t.hash === (tablaElegida ?? i?.tabla.hash ?? seleccionHash)) ?? tablas[0];
        const resultado = resolverAmpacidadTecnica(p.datosTecnicos, entidadId, p.conductores.find(w => w.id === entidadId)?.seccion);
        cuerpo.innerHTML = `<h3>Instalación y ampacidad</h3><p>Ambiente ≠ temperatura usada en R(T) ≠ temperatura nominal del aislamiento. La tabla debe corresponder a esta instalación.</p><div class="dt-form"><label>Conductor<select data-dt-input="conductor">${p.conductores.map(w => opt(w.id, `${w.id} · ${w.seccion} mm²`, entidadId)).join('')}</select></label><label>Tabla / revisión<select data-dt-input="tabla">${tablas.map(t => opt(t.hash, `${t.nombre} r${t.revision}`, tabla?.hash)).join('')}</select></label><label>Material<select data-dt-input="material">${opt('', 'Sin declarar', i?.material)}${['COBRE', 'ALUMINIO'].map(k => opt(k, k, i?.material)).join('')}</select></label>${input('aislamiento', 'Aislamiento', i?.aislamiento)}${input('aislamiento-temp', 'Temperatura nominal aislamiento °C', i?.temperaturaAislamientoC, 'number')}${input('metodo', 'Método de instalación', i?.metodo)}${input('ambiente', 'Temperatura ambiente °C', i?.temperaturaAmbienteC, 'number')}${input('cargados', 'Conductores cargados', i?.cargados, 'number')}${input('agrupamiento', 'Agrupamiento', i?.agrupamiento, 'number')}</div><fieldset><legend>Factores declarados en la tabla</legend>${tabla?.tipo === 'AMPACIDAD' ? tabla.factores.map(f => `<label><input type="checkbox" data-dt-factor="${esc(f.id)}"${i?.factores.includes(f.id) ? ' checked' : ''}>${esc(f.id)} · ${esc(f.dimension)}</label>`).join('') : 'Importa o añade una tabla primero.'}</fieldset>${tabla ? `<details><summary>Consultar filas y dominios de la tabla</summary>${tablaFicha(tabla)}</details>` : ''}${acciones(boton('preview-instalacion', 'Previsualizar instalación'))}<h4>Último estado persistente: ${esc(resultado.estado)}</h4><p>${esc(resultado.izA === undefined ? 'Iz NO DISPONIBLE' : `Iz = ${resultado.izA} A`)}</p><pre>${esc(JSON.stringify(resultado, null, 2))}</pre><section data-dt-preview></section>`;
    }
    function pintarCriterios() {
        const p = ctx.proyecto(), perfiles = candidatos().filter(r => r.tipo === 'CRITERIOS');
        const alcance = ambitoCriterio ? p.datosTecnicos?.criteriosCircuito?.[ambitoCriterio] : undefined;
        const elegido = perfiles.find(r => r.hash === (criterioElegido ?? (ambitoCriterio ? alcance?.perfil?.hash : p.datosTecnicos?.criterios?.hash)));
        const overrides = overridesCriterio ?? (ambitoCriterio ? alcance?.overrides : p.datosTecnicos?.overridesCriterios) ?? {};
        const circuitos = ejecutarIngenieria({ proyecto: p, contextoFisico: contextoDisenoIngenieria(p) }).circuitos;
        cuerpo.innerHTML = `<h3>Criterios versionados</h3><p>Política de cliente/proyecto; ninguna etiqueta aquí certifica cumplimiento IEC/NCh. HEREDAR no copia el perfil a overrides: mantiene su procedencia.</p><div class="dt-form"><label>Ámbito<select data-dt-input="ambito">${opt('', 'Proyecto', ambitoCriterio)}${circuitos.map(c => opt(c.id, c.nombre, ambitoCriterio)).join('')}</select></label><label>Perfil<select data-dt-input="criterio">${opt('', 'Sin perfil', elegido?.hash ?? '')}${perfiles.map(r => opt(r.hash, `${r.nombre} r${r.revision}`, elegido?.hash)).join('')}</select></label>${input('criterio-nombre', 'Nombre para publicar revisión', elegido?.nombre ?? 'Criterios del proyecto')}</div><table><thead><tr><th>Parámetro / perfil</th><th>Decisión</th><th>Valor / motivo</th></tr></thead><tbody>${CLAVES_CRITERIOS_TECNICOS.map(k => {
            const heredado = elegido?.parametros[k], d = overrides[k];
            return `<tr data-dt-criterio="${k}"><td>${esc(k)}<br><small>Perfil: ${esc(heredado ? heredado.modo === 'VALOR' ? heredado.valor : heredado.modo : 'Sin declarar')}</small></td><td><select data-dt-criterio-modo>${['HEREDAR', 'VALOR', 'DESACTIVADO', 'NO_APLICA'].map(m => opt(m, m, d?.modo ?? 'HEREDAR')).join('')}</select></td><td><input data-dt-criterio-valor aria-label="${k}" value="${esc(d?.modo === 'VALOR' ? d.valor : d?.motivo ?? '')}" placeholder="${k === 'capacidadCorte' ? 'Icn / Icu / Ics' : k === 'coordinarIbInIz' ? 'true / false' : 'Valor numérico o motivo'}"></td></tr>`;
        }).join('')}</tbody></table>${acciones(boton('preview-criterios', 'Previsualizar perfil y overrides') + boton('publicar-criterios', 'Publicar nueva revisión de criterios'))}<details><summary>Origen y estado efectivo actual</summary><pre>${esc(JSON.stringify(resolverCriteriosTecnicos(p.datosTecnicos, ambitoCriterio || undefined, p.ingenieria?.criterios), null, 2))}</pre></details><section data-dt-preview></section>`;
    }
    function recogerParametros(): RevisionCriteriosTecnicos['parametros'] { const out: RevisionCriteriosTecnicos['parametros'] = {}; for (const fila of cuerpo.querySelectorAll<HTMLElement>('[data-dt-criterio]')) {
        const k = fila.dataset.dtCriterio as keyof typeof out, modo = fila.querySelector<HTMLSelectElement>('[data-dt-criterio-modo]')!.value, raw = fila.querySelector<HTMLInputElement>('[data-dt-criterio-valor]')!.value;
        if (modo === 'HEREDAR')
            continue;
        if (modo === 'DESACTIVADO' || modo === 'NO_APLICA')
            out[k] = { modo, motivo: raw };
        else {
            if (!raw.trim())
                throw new Error(`${k}: el valor vacío no equivale a cero`);
            out[k] = { modo: 'VALOR', valor: k === 'capacidadCorte' ? raw as 'Icn' | 'Icu' | 'Ics' : k === 'coordinarIbInIz' ? (raw === 'true' ? true : raw === 'false' ? false : raw as never) : Number(raw) };
        }
    } return out; }
    function pintarFaltantes() { const p = ctx.proyecto(), r = ejecutarIngenieria({ proyecto: p, contextoFisico: contextoDisenoIngenieria(p) }); cuerpo.innerHTML = `<h3>Datos faltantes y cobertura · mismo motor de Ingeniería</h3><p>${r.validacion.resumen.fail} fallos · ${r.validacion.resumen.indeterminate} indeterminadas · ${r.validacion.resumen.notApplicable} no aplicables. Cero errores no implica revisión completa.</p>${r.validacion.issues.map(i => `<article class="dt-issue"><strong>${esc(i.status)} · ${esc(i.title)}</strong><p>${esc(i.description)}</p><p>${esc(i.missingData.join('; '))}</p>${i.relatedEntities.filter(e => e.tipo === 'DEVICE' || e.tipo === 'CONDUCTOR').map(e => `<button data-dt-resolver="${esc(e.id)}">Resolver ${esc(e.id)}</button>`).join('')}</article>`).join('')}`; }
    function pintarEnsayo() { const p = ctx.proyecto(), es = p.dispositivos.filter(d => familiaDispositivo(d) === 'PROTECCION'), bornes = p.dispositivos.flatMap(d => d.bornes.map(b => ({ valor: JSON.stringify([d.id, b.id]), texto: `${d.designacion ?? d.id} / ${b.id}` }))); cuerpo.innerHTML = `<h3>Icc prospectiva en un punto explícito</h3><p>Ensayo estático aislado V5. No activa fallas runtime, no inventa neutro/PE y no calcula selectividad certificada. Se necesita impedancia real de red.</p><div class="dt-form"><label>Protección<select data-dt-input="proteccion">${es.map(d => opt(d.id, d.designacion ?? d.id, entidadId)).join('')}</select></label><label>Punto de falla<select data-dt-input="de">${bornes.map(b => opt(b.valor, b.texto)).join('')}</select></label><label>Retorno real<select data-dt-input="a">${bornes.map(b => opt(b.valor, b.texto)).join('')}</select></label><label>Tipo<select data-dt-input="tipo-falla">${['L_N', 'L_L', 'L_PE', 'TRIFASICA'].map(k => opt(k)).join('')}</select></label></div>${acciones(boton('preview-ensayo', 'Previsualizar ensayo'))}<pre>${esc(JSON.stringify(p.datosTecnicos?.prospectiva ?? [], null, 2))}</pre><section data-dt-preview></section>`; }
    function pintar() { invalidarFormulario(); if (destruido)
        return; if (vista === 'biblioteca')
        pintarBiblioteca();
    else if (vista === 'editor')
        pintarEditor();
    else if (vista === 'vinculo')
        pintarVinculo();
    else if (vista === 'instalacion')
        pintarInstalacion();
    else if (vista === 'criterios')
        pintarCriterios();
    else if (vista === 'faltantes')
        pintarFaltantes();
    else if (vista === 'ensayo')
        pintarEnsayo(); }
    async function accion(a: string) {
        if (['biblioteca', 'instalacion', 'criterios', 'faltantes', 'ensayo'].includes(a)) {
            if (a === 'criterios') { criterioElegido = undefined; overridesCriterio = undefined; }
            if (a === 'instalacion') tablaElegida = undefined;
            vista = a;
            preview = undefined;
            pintar();
            return;
        }
        if (a === 'cerrar') {
            cerrarVentana(raiz.id);
            return;
        }
        if (a === 'buscar') {
            busqueda = leer('buscar');
            filtroFamilia = leer('familia-filtro');
            pintar();
        }
        if (a === 'sintetico') {
            await ctx.repositorio.importar(catalogoSinteticoV8());
            await actualizarBiblioteca();
            pintar();
            mensaje('Catálogo SINTÉTICO añadido; no son datos de fabricante.');
        }
        if (a === 'ejemplo') {
            await ctx.abrirEjemplo(fixtureDatosTecnicosV8());
            vista = 'biblioteca';
            await actualizarBiblioteca();
            pintar();
            mensaje('Ejemplo de solo lectura. Usa Hacer una copia para trabajar antes de modificarlo.');
        }
        if (a === 'nuevo' || a === 'editar') {
            const r = seleccionado();
            borrador = a === 'editar' && r?.tipo === 'PRODUCTO' ? { ...structuredClone(r), revision: r.revision + 1 } : { version: 1, canon: 1, catalogo: { id: 'mis-datos', nombre: 'Mis datos técnicos' }, id: `producto-${crypto.randomUUID()}`, revision: 1, hash: '', nombre: 'Producto nuevo', estado: 'ACTIVA', tipo: 'PRODUCTO', familia: 'PROTECCION', variante: 'Variante propia', campos: [], procedencia: { origen: 'USUARIO', referencia: 'Configuración del usuario; fuente no corroborada' } };
            vista = 'editor';
            pintar();
        }
        if (a === 'campo')
            editorCampo();
        if (a === 'guardar-borrador') {
            recogerEditor();
            await ctx.repositorio.guardarBorrador(borrador!);
            mensaje('Borrador guardado. Ningún proyecto usa todavía esta revisión.');
        }
        if (a === 'borradores') {
            const bs = await ctx.repositorio.listarBorradores();
            cuerpo.innerHTML = `<h3>Mis borradores</h3>${bs.map((b, i) => `<button data-dt-borrador="${i}">${esc(b.nombre)} r${b.revision}</button>`).join('') || '<p>No hay borradores.</p>'}`;
            cuerpo.querySelectorAll<HTMLButtonElement>('[data-dt-borrador]').forEach(b => b.onclick = () => { borrador = bs[Number(b.dataset.dtBorrador)]; vista = 'editor'; pintar(); });
        }
        if (a === 'publicar') {
            recogerEditor();
            const r = publicarRevision(borrador!);
            if (!(await ctx.confirmar(`Publicar ${r.nombre} r${r.revision}? Una revisión publicada es inmutable.`)))
                return;
            await ctx.repositorio.importar([r, ...candidatos().filter(x => x.tipo === 'CURVA' && r.curva?.hash === x.hash)]);
            seleccionHash = r.hash;
            vista = 'biblioteca';
            await actualizarBiblioteca();
            pintar();
            mensaje('Revisión publicada. Los vínculos existentes no cambiaron.');
        }
        if (a === 'vincular') {
            vista = 'vinculo';
            pintar();
        }
        if (a === 'preview-vinculo') {
            const v = recogerVinculo();
            await prepararCambio(p => vincularProductoTecnico(p, v, candidatos()));
        }
        if (a === 'desvincular') {
            const r = recogerVinculo();
            await prepararCambio(p => desvincularProductoTecnico(p, r.entidad, r.entidadId));
        }
        if (a === 'resueltos') {
            const r = resolverProyectoTecnico(ctx.proyecto());
            $<HTMLElement>('[data-dt-preview]').innerHTML = `<h3>Resolución persistente vigente</h3><pre>${esc(JSON.stringify(r.resoluciones.filter(x => x.entidadId === entidadId), null, 2))}</pre>`;
        }
        if (a === 'cancelar-preview') {
            preview = undefined;
            pintar();
            mensaje('Preview cancelado; BASE intacta.');
        }
        if (a === 'aplicar-preview') {
            const actual = preview;
            if (!actual)
                throw new Error('No hay preview vigente');
            if (actual.formulario !== huellaFormulario()) {
                invalidarFormulario();
                throw new Error('STALE_RESULT: cambió el formulario. Previsualiza de nuevo.');
            }
            if (ctx.identidad() !== actual.identidad)
                throw new Error('STALE_RESULT: cambió el proyecto');
            comprobarPreviewTecnico(ctx.proyecto(), actual.datos);
            if (!(await ctx.confirmar('Aplicar el candidato revisado? Esta acción guarda la revisión y puede deshacerse.')))
                return;
            if (!await actual.operacion.aplicar(actual.datos.candidato)) throw new Error('APLICACION_CANCELADA: BASE no cambió.');
            preview = undefined;
            pintar();
            ctx.validar();
            mensaje('Aplicado y guardado atómicamente. Historial disponible con Deshacer.');
        }
        if (a === 'preview-instalacion') {
            const conductorId = leer('conductor'), tabla = candidatos().find(r => r.hash === leer('tabla'));
            if (tabla?.tipo !== 'AMPACIDAD')
                throw new Error('Selecciona una tabla.');
            const i = { conductorId, tabla: referenciaTecnica(tabla), ...(leer('material') ? { material: leer('material') as 'COBRE' | 'ALUMINIO' } : {}), ...(leer('aislamiento') ? { aislamiento: leer('aislamiento') } : {}), ...(leer('metodo') ? { metodo: leer('metodo') } : {}), temperaturaAislamientoC: numero('aislamiento-temp'), temperaturaAmbienteC: numero('ambiente'), cargados: numero('cargados'), agrupamiento: numero('agrupamiento'), factores: [...cuerpo.querySelectorAll<HTMLInputElement>('[data-dt-factor]:checked')].map(f => f.dataset.dtFactor!) };
            await prepararCambio(p => cambiarConfiguracionTecnica(p, c => { c.instalaciones = c.instalaciones.filter(x => x.conductorId !== conductorId); c.instalaciones.push(i); }, candidatos()));
        }
        if (a === 'preview-criterios') {
            const perfil = candidatos().find(r => r.hash === leer('criterio')), ambito = leer('ambito'), overrides = recogerParametros();
            await prepararCambio(p => cambiarConfiguracionTecnica(p, c => { if (ambito) {
                c.criteriosCircuito ??= {};
                c.criteriosCircuito[ambito] = { ...(perfil ? { perfil: referenciaTecnica(perfil) } : {}), overrides };
            }
            else {
                if (perfil)
                    c.criterios = referenciaTecnica(perfil);
                else
                    delete c.criterios;
                c.overridesCriterios = overrides;
            } }, candidatos()));
        }
        if (a === 'publicar-criterios') {
            const anterior = candidatos().find(r => r.hash === leer('criterio')), plantilla = anterior?.tipo === 'CRITERIOS' ? anterior : catalogoSinteticoV8().find(r => r.tipo === 'CRITERIOS')!;
            const r = publicarRevision({ ...plantilla, tipo: 'CRITERIOS', id: anterior?.id ?? `criterios-${crypto.randomUUID()}`, revision: anterior ? anterior.revision + 1 : 1, nombre: leer('criterio-nombre'), parametros: { ...(anterior?.tipo === 'CRITERIOS' ? anterior.parametros : {}), ...recogerParametros() }, procedencia: { origen: 'USUARIO', referencia: 'Perfil de criterios configurado por el usuario' } } as RevisionCriteriosTecnicos);
            if (!(await ctx.confirmar(`Publicar criterios ${r.nombre} r${r.revision}? No se adoptarán automáticamente.`))) return;
            await ctx.repositorio.importar([r]);
            seleccionHash = r.hash;
            criterioElegido = r.hash;
            await actualizarBiblioteca();
            pintar();
            mensaje('Perfil publicado sin cambiar los proyectos vinculados.');
        }
        if (a === 'preview-ensayo') {
            const [d, db] = JSON.parse(leer('de')), [r, rb] = JSON.parse(leer('a')), proteccionId = leer('proteccion'), tipo = leer('tipo-falla') as 'L_N' | 'L_L' | 'L_PE' | 'TRIFASICA';
            if (d === r && db === rb)
                throw new Error('Los dos extremos del ensayo deben ser distintos.');
            await prepararCambio(p => cambiarConfiguracionTecnica(p, c => { c.prospectiva = [...(c.prospectiva ?? []).filter(x => x.proteccionId !== proteccionId), { proteccionId, de: { dispositivoId: d, borneId: db }, a: { dispositivoId: r, borneId: rb }, tipo }]; }));
        }
        if (a === 'exportar') {
            const r = seleccionado();
            if (!r)
                return;
            const refs = [r, ...candidatos().filter(x => r.tipo === 'PRODUCTO' && r.curva?.hash === x.hash)];
            descargar(`${r.nombre}-datos-tecnicos.json`, JSON.stringify(crearPaqueteTecnico(refs), null, 2), 'application/json');
        }
        if (a === 'exportar-proyecto')
            await ctx.exportarProyecto();
        if (a === 'importar') {
            cuerpo.innerHTML = `<h3>Importar datos técnicos</h3><p>JSON versionado, máximo 32 MiB. Se verifican estructura, unidades, dominio, dependencias y hashes antes de escribir.</p><input type="file" data-dt-archivo accept=".json"><button data-dt="cancelar-import">Cancelar</button><section data-dt-import-preview></section>`;
        }
        if (a === 'confirmar-import') {
            if (!importadas)
                throw new Error('Sin import preparado');
            aborto = new AbortController();
            mensaje('Validando y guardando catálogo…');
            const r = await ctx.repositorio.importar(importadas, { signal: aborto.signal, progreso: (n, t) => mensaje(`Validando ${n}/${t}…`) });
            aborto = undefined;
            importadas = undefined;
            await actualizarBiblioteca();
            vista = 'biblioteca';
            pintar();
            mensaje(`${r.nuevas} revisiones nuevas; ${r.existentes} idénticas. Ningún proyecto fue actualizado.`);
        }
        if (a === 'cancelar-import') {
            generacionImport++;
            aborto?.abort();
            importadas = undefined;
            vista = 'biblioteca';
            pintar();
            mensaje('Importación cancelada.');
        }
        if (a === 'borrar-catalogo') {
            const r = seleccionado();
            if (!r || !(await ctx.confirmar(`Borrar catálogo global ${r.catalogo.nombre}? Los proyectos conservarán su subconjunto congelado.`)))
                return;
            await ctx.repositorio.eliminarCatalogo(r.catalogo.id);
            await actualizarBiblioteca();
            pintar();
            mensaje('Catálogo global borrado. Los datos congelados de proyectos siguen intactos.');
        }
        if (a === 'revision-humana') {
            const r = seleccionado();
            if (!r)
                return;
            cuerpo.innerHTML = `<h3>Revisión humana local</h3><p>${esc(r.nombre)} r${r.revision}. Revisado no significa certificado. Esta evidencia NO se importa ni exporta como autenticación.</p>${input('responsable', 'Responsable')}${input('evidencia', 'Documento, sección y comprobación efectuada')}<button data-dt="guardar-revision-humana">Registrar revisión</button>`;
        }
        if (a === 'guardar-revision-humana') {
            const r = seleccionado()!;
            await ctx.repositorio.registrarRevisionHumana({ hash: r.hash, estado: 'REVISADO', responsable: leer('responsable'), evidencia: leer('evidencia'), fecha: new Date().toISOString() });
            await actualizarBiblioteca();
            vista = 'biblioteca';
            pintar();
            mensaje('Revisión humana local registrada para este hash exacto.');
        }
    }
    raiz.onclick = ev => {
        const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('button');
        if (!b)
            return;
        if (b.dataset.dtSelect) {
            seleccionHash = b.dataset.dtSelect;
            pintar();
            void actualizarBiblioteca().then(() => { if (vista === 'biblioteca') pintar(); }).catch(e => mensaje(String(e), true));
            return;
        }
        if (b.dataset.dtResolver) {
            entidadId = b.dataset.dtResolver;
            const p = ctx.proyecto(), v = p.datosTecnicos?.vinculos.find(x => x.entidadId === entidadId);
            if (v) {
                seleccionHash = v.producto.hash;
                vista = 'vinculo';
            }
            else
                vista = p.conductores.some(w => w.id === entidadId) ? 'instalacion' : 'biblioteca';
            pintar();
            return;
        }
        if (b.dataset.dtEditarCampo !== undefined) {
            editorCampo(Number(b.dataset.dtEditarCampo));
            return;
        }
        if (b.dataset.dtQuitarCampo !== undefined) {
            recogerEditor();
            borrador!.campos.splice(Number(b.dataset.dtQuitarCampo), 1);
            pintar();
            return;
        }
        if (b.dataset.dtQuitarOverride) {
            invalidarFormulario();
            const fila = b.closest('tr')!;
            fila.querySelector<HTMLSelectElement>('[data-dt-decision]')!.value = 'CATALOGO';
            fila.querySelector<HTMLInputElement>('[data-dt-override]')!.value = '';
            mensaje('Override quitado del candidato. Previsualiza y confirma para guardarlo.');
            return;
        }
        if (b.dataset.dtGuardarCampo !== undefined) {
            try {
                const campo = leer('campo') as CampoTecnico, regla = CAMPOS_TECNICOS[campo], raw = leer('valor');
                if (!raw.trim())
                    throw new Error('Valor vacío no equivale a cero.');
                const d: DatoTecnico = { campo, valor: regla.tipo === 'enum' ? raw : magnitud(raw), unidad: leer('unidad'), naturaleza: leer('naturaleza') as DatoTecnico['naturaleza'], procedencia: { ...borrador!.procedencia, origen: leer('campo-origen') as DatoTecnico['procedencia']['origen'], referencia: leer('campo-fuente') }, condiciones: recogerCondiciones(), ...(leer('canal') ? { canal: leer('canal') } : {}) };
                const copia = structuredClone(borrador!);
                if (b.dataset.dtGuardarCampo === 'nuevo')
                    copia.campos.push(d);
                else
                    copia.campos[Number(b.dataset.dtGuardarCampo)] = d;
                publicarRevision(copia);
                borrador = copia;
                pintar();
            }
            catch (e) {
                mensaje(String(e), true);
            }
            return;
        }
        if (b.dataset.dt)
            void accion(b.dataset.dt).catch(e => { mensaje(String(e), true); ctx.avisar(String(e), 'error'); });
    };
    raiz.oninput = () => invalidarFormulario();
    raiz.onchange = ev => {
        invalidarFormulario();
        const e = ev.target as HTMLInputElement;
        if (e.dataset.dtInput === 'entidad') {
            entidadId = e.value;
            pintarVinculo();
        }
        if (e.dataset.dtInput === 'conductor') {
            entidadId = e.value;
            tablaElegida = undefined;
            pintarInstalacion();
        }
        if (e.dataset.dtInput === 'tabla') {
            const valores = [...cuerpo.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-dt-input]')].map(x => [x.dataset.dtInput!, x.value]);
            tablaElegida = e.value; pintarInstalacion();
            for (const [k, valor] of valores) { const control = $<HTMLInputElement>(`[data-dt-input="${k}"]`); if (control) control.value = valor; }
        }
        if (e.dataset.dtInput === 'ambito') { ambitoCriterio = e.value; criterioElegido = undefined; overridesCriterio = undefined; pintarCriterios(); }
        if (e.dataset.dtInput === 'criterio') {
            try { overridesCriterio = recogerParametros(); criterioElegido = e.value; pintarCriterios(); }
            catch (error) { mensaje(String(error), true); }
        }
        if (e.dataset.dtInput === 'campo') {
            const regla = CAMPOS_TECNICOS[e.value as CampoTecnico];
            $<HTMLInputElement>('[data-dt-input="unidad"]').value = regla.unidad;
        }
        if (e.hasAttribute('data-dt-archivo')) {
            const generacion = ++generacionImport;
            aborto?.abort(); aborto = new AbortController();
            const signal = aborto.signal;
            importadas = undefined; $<HTMLElement>('[data-dt-import-preview]').replaceChildren();
            void (async () => {
                const file = e.files?.[0]; if (!file) return;
                if (file.size > LIMITES_TECNICOS.caracteres) throw new Error('Archivo supera 32 MiB.');
                mensaje('Leyendo y verificando…');
                const paquete = await leerPaqueteTecnicoAsync(await file.text(), { signal, progreso: (n, t) => mensaje(`Verificando integridad ${n}/${t}…`) });
                if (generacion !== generacionImport || destruido || raiz.hidden) return;
                importadas = paquete.revisiones;
                $<HTMLElement>('[data-dt-import-preview]').innerHTML = `<h4>Preview: ${paquete.revisiones.length} revisiones</h4><p>${esc(paquete.manifiesto.hash)}</p><p>Fuentes declaradas: ${esc([...new Set(paquete.revisiones.map(r => r.procedencia.origen))].join(', '))}. No se adopta en proyectos.</p>${boton('confirmar-import', 'Confirmar importación')}`;
                mensaje('Paquete verificado; falta confirmar la escritura.');
            })().catch(error => { if (generacion === generacionImport) mensaje(String(error), true); });
        }
    };
    function cambiarDocumento(identidad: string) {
        revisionVista = identidad;
        preview = undefined; vista = 'biblioteca'; entidadId = ''; seleccionHash = '';
        tablaElegida = undefined; criterioElegido = undefined; ambitoCriterio = ''; overridesCriterio = undefined;
        busqueda = ''; filtroFamilia = ''; generacionImport++; aborto?.abort(); importadas = undefined;
    }
    return { async abrir(id) { const identidad = ctx.identidad(); if (revisionVista !== identidad) cambiarDocumento(identidad);
        entidadId = id ?? entidadId;
        await actualizarBiblioteca(); if (id) { const v = ctx.proyecto().datosTecnicos?.vinculos.find(v => v.entidadId === id); if (v) { seleccionHash = v.producto.hash; vista = 'vinculo'; } else if (ctx.proyecto().conductores.some(c => c.id === id)) vista = 'instalacion'; } pintar(); abrirVentana(raiz.id, { titulo: 'Datos técnicos', alCerrar: () => { generacionImport++; aborto?.abort(); importadas = undefined; preview = undefined; } }); }, invalidar() { const habiaPreview = !!preview; preview = undefined; if (!raiz.hidden && revisionVista !== ctx.identidad()) {
            cambiarDocumento(ctx.identidad());
            pintar();
            mensaje('El documento cambió; el preview anterior ya no puede aplicarse.');
        } else if (!raiz.hidden && habiaPreview) { raiz.querySelector<HTMLButtonElement>('[data-dt="aplicar-preview"]')?.setAttribute('disabled', ''); mensaje('STALE_RESULT: BASE cambió. Recalcula el preview antes de aplicar.'); } }, destruir() { destruido = true; cerrarVentana(raiz.id); generacionImport++; aborto?.abort(); raiz.remove(); } };
}
