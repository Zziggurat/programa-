#!/usr/bin/env python3
"""
Extrae de un plano de instalaciones (DWG/DXF) un modelo de infraestructura para el visor 3D.

POR QUÉ ES UN PASO APARTE Y NO PARTE DE LA APLICACIÓN
-----------------------------------------------------
El plano de la cubierta son 21 MB de DWG que al convertirse quedan en 164 MB de DXF con
331.000 entidades. Eso no se abre en un navegador: se procesa una vez aquí y se guarda un JSON
de unos pocos cientos de KB con lo que de verdad hace falta. Cuando llegue un plano nuevo se
vuelve a correr esto y se sustituye el JSON.

CÓMO SE USA
-----------
    # 1) DWG → DXF (una vez, con LibreDWG o con «Guardar como» de AutoCAD/DWG TrueView)
    dwg2dxf -o Cubierta.dxf Cubierta.dwg

    # 2) DXF → modelo del visor
    pip install ezdxf
    python3 herramientas/extraer-planta.py Cubierta.dxf datos/cubierta.json

LO QUE EL PLANO SÍ DA Y LO QUE NO
--------------------------------
Sí da, y es la parte cara: el RECORRIDO en planta de cada conducto, cañería y bandeja, la
huella de cada equipo, y —esto fue la sorpresa— el diagrama de puntos de control de cada UMA
con su controlador y con qué señales van cableadas en el tablero.

No da NINGUNA cota Z: de 85.475 puntos de las capas de clima, cero tienen altura. Así que la
tercera dimensión se ASIGNA aquí por reglas (`ALTURAS`), y el JSON marca esas alturas como
supuestas para que el visor pueda decirlo. Cuando haya un plano de secciones o un modelo BIM,
se sustituyen por las de verdad.
"""
from __future__ import annotations
import sys, json, re, math, collections
from typing import Any

try:
    import ezdxf
except ImportError:
    sys.exit("Falta ezdxf.  Instálalo con:  pip install ezdxf")

# ---------------------------------------------------------------------------
# Reglas de interpretación del plano. Es lo único que hay que tocar si cambia
# el criterio de capas del proyectista.
# ---------------------------------------------------------------------------

SISTEMAS = [
    # (id, patrón de capa, altura supuesta en mm, sección supuesta an×al en mm)
    ('inyeccion',  re.compile(r'INYECC|inyecci', re.I),                     4200, (600, 400)),
    ('extraccion', re.compile(r'EXTR|AIRE-EXTERIOR|AIRE_EXTERIOR|TF-ext', re.I), 4600, (500, 350)),
    ('agua-fria',  re.compile(r'cañ-fria|CAÑ-FRIA', re.I),                  3600, (160, 160)),
    ('agua',       re.compile(r'CAÑERIA|cañerias|CAÑ', re.I),               3700, (160, 160)),
    ('bandeja',    re.compile(r'CANALIZ|Escalerilla', re.I),                3200, (300, 100)),
    ('bus',        re.compile(r'BUS-LON', re.I),                            3000, (50, 50)),
]
CAPAS_EQUIPO = re.compile(r'TF-UMA|EQUIPOS.?AIRE|Ventilador', re.I)
CAPAS_CONTROL = re.compile(r'CONTROL CENTRALIZADO|BUS-LON|EXTR NVA', re.I)

# ---------------------------------------------------------------------------
# LA OBRA QUE HAY ALREDEDOR DE LAS MÁQUINAS
#
# El plano no es solo clima. Debajo de las capas de conductos está dibujada la cubierta entera:
# sus columnas, sus barandas, sus lucernarios, sus escaleras y sus muros. Sin eso, el visor
# enseñaba máquinas y tubos flotando sobre una losa lisa, que no se parece en nada a subir a la
# cubierta de un aeropuerto. Con eso, se reconoce el sitio.
#
# El RECORRIDO EN PLANTA de todo esto sale del plano y es exacto; los RADIOS de las columnas,
# también. Las ALTURAS no: igual que en las capas de clima, aquí tampoco hay ni una cota Z, así
# que se asignan por reglas de proyecto y el visor no deja de decirlo.
# ---------------------------------------------------------------------------
ARQUITECTURA = [
    # (familia, patrón de capa, altura supuesta mm, grosor supuesto mm, largo mínimo mm)
    ('borde',      re.compile(r'^ROOF\d?$', re.I),            400, 260, 2500),
    ('baranda',    re.compile(r'^BARANDA$', re.I),           1100,  60, 1500),
    ('muro',       re.compile(r'^(WALL\d?|TABIQUE)$', re.I), 2400, 180, 1500),
    ('lucernario', re.compile(r'^(TERMOP|LUCARNA)$', re.I),   250, 220, 1200),
    ('escalera',   re.compile(r'^STAIR$', re.I),             1000, 120, 1200),
    ('acero',      re.compile(r'^ACERO\d?$', re.I),          3200, 140, 2000),
]
# Columnas: los círculos de las capas de estructura. El radio es el del plano.
CAPAS_COLUMNA = re.compile(r'^(STRU-COLUMNA|STRU)$', re.I)
ALTO_COLUMNA = 7800          # supuesta: altura libre bajo la cubierta de un terminal
RADIO_COLUMNA = (90, 700)    # fuera de esto un círculo no es una columna

# Altura de los equipos sobre la cubierta (mm). Una UMA de aeropuerto es una caja grande.
ALTO_UMA = 2200
ALTO_VEX = 900

# Qué significa cada bloque del diagrama de control. Sale de la propia nomenclatura del
# proyecto (SERMAN) y de lo que se lee en los textos que acompañan a cada bloque.
PUNTOS_BMS = {
    'E':   ('Marcha / Automático',      'salida digital'),
    'EF':  ('Estado de funcionamiento', 'entrada digital'),
    'PP':  ('Partir / Parar',           'salida digital'),
    'A':   ('Alarma / falla',           'entrada digital'),
    'VAF': ('Válvula de agua FRÍA',     'salida analógica'),
    'VAC': ('Válvula de agua CALIENTE', 'salida analógica'),
    'CD':  ('Compuerta / damper',       'salida analógica'),
    'STI': ('Sensor temperatura de inyección', 'entrada analógica'),
    'STD': ('Sensor temperatura de ducto',     'entrada analógica'),
    'SHD': ('Sensor humedad de ducto',         'entrada analógica'),
    'STE': ('Sensor temperatura exterior',     'entrada analógica'),
    'TCC': ('Controlador de zona (TCC)',       'controlador'),
    'STR': ('Repetidor / router del bus LON',  'red'),
}
# Sondas que aparecen como TEXTO junto al equipo, no como bloque.
SONDAS_TEXTO = {
    'TAE': ('Temperatura de aire EXTERIOR', 'entrada analógica'),
    'TAR': ('Temperatura de aire de RETORNO', 'entrada analógica'),
    'TAS': ('Temperatura de aire de SUMINISTRO', 'entrada analógica'),
}

RE_TAG = re.compile(r'\b(UMA|VEX)[\s\-]?(\d{1,2})[\s\-](\d{2,3})\b', re.I)
RE_CTRL = re.compile(r'\b(XL\d{2,3}|TCC)_?([A-Z0-9_]+)\b')
RE_FALLA = re.compile(r'\bFALLA[\s\-]', re.I)
RE_EN_TABLERO = re.compile(r'EN\s+TDFC', re.I)

# Radio (mm) alrededor del tag para considerar que un bloque o texto le pertenece.
RADIO_PUNTO = 4500
# Distancia (mm) por debajo de la cual dos trozos de geometría son el mismo equipo.
UNION_EQUIPO = 2500


def texto_de(e) -> str:
    return e.plain_text() if e.dxftype() == 'MTEXT' else (e.dxf.get('text', '') or '')


def punto_de(e):
    """Un punto representativo de la entidad, o None."""
    t = e.dxftype()
    try:
        if t == 'LINE':
            return ((e.dxf.start[0] + e.dxf.end[0]) / 2, (e.dxf.start[1] + e.dxf.end[1]) / 2)
        if t in ('CIRCLE', 'ARC'):
            return (e.dxf.center[0], e.dxf.center[1])
        if t in ('INSERT', 'TEXT', 'MTEXT'):
            return (e.dxf.insert[0], e.dxf.insert[1])
        if t == 'LWPOLYLINE':
            pts = list(e.get_points('xy'))
            return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)) if pts else None
    except Exception:
        return None
    return None


def polilineas_de(e):
    """Devuelve la(s) polilínea(s) de la entidad como listas de (x, y)."""
    t = e.dxftype()
    try:
        if t == 'LINE':
            return [[(e.dxf.start[0], e.dxf.start[1]), (e.dxf.end[0], e.dxf.end[1])]]
        if t == 'LWPOLYLINE':
            pts = [(p[0], p[1]) for p in e.get_points('xy')]
            return [pts] if len(pts) >= 2 else []
        if t == 'ARC':
            c, r = e.dxf.center, e.dxf.radius
            a0, a1 = math.radians(e.dxf.start_angle), math.radians(e.dxf.end_angle)
            if a1 < a0:
                a1 += 2 * math.pi
            n = max(3, int((a1 - a0) / 0.25))
            return [[(c[0] + r * math.cos(a0 + (a1 - a0) * i / n),
                      c[1] + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]]
    except Exception:
        return []
    return []


def agrupar(puntos: list[tuple[float, float]], radio: float) -> list[list[int]]:
    """Agrupación por rejilla: barata y suficiente para separar equipos que están a metros."""
    celda = radio
    rej: dict[tuple[int, int], list[int]] = collections.defaultdict(list)
    for i, (x, y) in enumerate(puntos):
        rej[(int(x // celda), int(y // celda))].append(i)
    visto = [False] * len(puntos)
    grupos = []
    for clave in list(rej):
        for i in rej[clave]:
            if visto[i]:
                continue
            pila, grupo = [i], []
            visto[i] = True
            while pila:
                j = pila.pop()
                grupo.append(j)
                cx, cy = int(puntos[j][0] // celda), int(puntos[j][1] // celda)
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        for k in rej.get((cx + dx, cy + dy), ()):
                            if visto[k]:
                                continue
                            if (puntos[k][0] - puntos[j][0]) ** 2 + (puntos[k][1] - puntos[j][1]) ** 2 <= radio ** 2:
                                visto[k] = True
                                pila.append(k)
            grupos.append(grupo)
    return grupos


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    entrada, salida = sys.argv[1], sys.argv[2]
    print(f"Leyendo {entrada} …")
    doc = ezdxf.readfile(entrada)
    msp = doc.modelspace()

    unidades = doc.header.get('$INSUNITS', 4)
    if unidades != 4:
        print(f"  ⚠ el plano no está en milímetros ($INSUNITS={unidades}); revisa la escala")

    # ---------------- 1. Diagramas de control: los puntos de cada equipo ----------------
    # Cada equipo tiene su bloque de control dibujado, con su tag repetido varias veces, los
    # bloques de sus puntos alrededor y el controlador que lo gobierna.
    tags: list[dict[str, Any]] = []
    for e in msp.query('TEXT MTEXT'):
        p = punto_de(e)
        if p is None:
            continue
        t = texto_de(e).strip()
        m = RE_TAG.search(t)
        if not m:
            continue
        tags.append({
            'tag': f"{m.group(1).upper()}-{m.group(2)}-{m.group(3)}",
            'x': p[0], 'y': p[1],
            'enTablero': bool(RE_EN_TABLERO.search(t)),
            'falla': bool(RE_FALLA.search(t)),
        })
    print(f"  {len(tags)} menciones de equipo, {len({t['tag'] for t in tags})} equipos distintos")

    bloques, textos = [], []
    for e in msp:
        p = punto_de(e)
        if p is None:
            continue
        capa = e.dxf.get('layer', '')
        if e.dxftype() == 'INSERT' and CAPAS_CONTROL.search(capa) and e.dxf.name in PUNTOS_BMS:
            bloques.append((e.dxf.name, p))
        elif e.dxftype() in ('TEXT', 'MTEXT'):
            textos.append((texto_de(e).strip(), p))

    # Centro de cada equipo en el DIAGRAMA (no en la planta): la media de sus menciones.
    porTag: dict[str, list[dict]] = collections.defaultdict(list)
    for t in tags:
        porTag[t['tag']].append(t)
    diagramas: dict[str, dict[str, Any]] = {}
    for tag, ms in porTag.items():
        cx = sum(m['x'] for m in ms) / len(ms)
        cy = sum(m['y'] for m in ms) / len(ms)
        puntos, vistos = [], set()
        for nombre, (bx, by) in bloques:
            if (bx - cx) ** 2 + (by - cy) ** 2 <= RADIO_PUNTO ** 2 and nombre not in vistos:
                vistos.add(nombre)
                desc, clase = PUNTOS_BMS[nombre]
                puntos.append({'sigla': nombre, 'que': desc, 'clase': clase})
        for sigla, (desc, clase) in SONDAS_TEXTO.items():
            if any(txt == sigla and (px - cx) ** 2 + (py - cy) ** 2 <= RADIO_PUNTO ** 2
                   for txt, (px, py) in textos):
                puntos.append({'sigla': sigla, 'que': desc, 'clase': clase})
        controlador = None
        for txt, (px, py) in textos:
            if (px - cx) ** 2 + (py - cy) ** 2 > RADIO_PUNTO ** 2:
                continue
            m = RE_CTRL.search(txt)
            if m and m.group(1).upper().startswith('XL'):
                controlador = txt.strip()
                break
        diagramas[tag] = {
            'puntos': sorted(puntos, key=lambda p: p['sigla']),
            'controlador': controlador,
            'enTablero': any(m['enTablero'] for m in ms),
            'tieneFalla': any(m['falla'] for m in ms),
        }
    conPuntos = sum(1 for d in diagramas.values() if d['puntos'])
    print(f"  {conPuntos} equipos con lista de puntos de control")

    # ---------------- 2. La planta: dónde está cada cosa de verdad ----------------
    # Los diagramas de control y la planta viven en zonas distintas del modelspace. La planta es
    # la zona donde hay geometría de conductos, que es lo que se quiere dibujar en 3D.
    trazas: list[dict[str, Any]] = []
    for e in msp:
        capa = e.dxf.get('layer', '')
        sis = next(((sid, z, sec) for sid, pat, z, sec in SISTEMAS if pat.search(capa)), None)
        if sis is None:
            continue
        sid, z, (an, al) = sis
        for pts in polilineas_de(e):
            largo = sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
            if largo < 400:      # trocitos de detalle: no aportan al mundo 3D
                continue
            trazas.append({'sistema': sid, 'z': z, 'ancho': an, 'alto': al,
                           'puntos': [[round(x, 1), round(y, 1)] for x, y in pts], 'largo': largo})
    print(f"  {len(trazas)} trazas de conducto/cañería/bandeja")

    # Zona de la planta: la ventana donde se concentran las trazas.
    if trazas:
        xs = [p[0] for t in trazas for p in t['puntos']]
        h = collections.Counter(int(x // 20000) for x in xs)
        centro = h.most_common(1)[0][0] * 20000 + 10000
        VENT = 140_000
        x0, x1 = centro - VENT, centro + VENT
        trazas = [t for t in trazas if all(x0 <= p[0] <= x1 for p in t['puntos'])]
        ys = [p[1] for t in trazas for p in t['puntos']]
        xs = [p[0] for t in trazas for p in t['puntos']]
        zona = {'x0': min(xs), 'y0': min(ys), 'x1': max(xs), 'y1': max(ys)}
    else:
        zona = {'x0': 0, 'y0': 0, 'x1': 0, 'y1': 0}
    print(f"  zona de planta: {(zona['x1']-zona['x0'])/1000:.0f} × {(zona['y1']-zona['y0'])/1000:.0f} m")

    # Equipos en planta: se agrupa la geometría de las capas de equipo y cada racimo es una máquina.
    centros, cajas = [], []
    for e in msp:
        if not CAPAS_EQUIPO.search(e.dxf.get('layer', '')):
            continue
        for pts in polilineas_de(e):
            for x, y in pts:
                if zona['x0'] - 5000 <= x <= zona['x1'] + 5000 and zona['y0'] - 5000 <= y <= zona['y1'] + 5000:
                    centros.append((x, y))
    grupos = agrupar(centros, UNION_EQUIPO)
    grupos = [g for g in grupos if len(g) >= 12]      # un racimo diminuto no es una máquina
    print(f"  {len(grupos)} racimos de equipo en planta")

    # A cada racimo se le pone el tag más cercano que exista en la planta; si no hay ninguno, se
    # numera por su posición. Se marca cuál es cuál: un tag inventado sería una mentira.
    tagsEnPlanta = [t for t in tags
                    if zona['x0'] - 20000 <= t['x'] <= zona['x1'] + 20000
                    and zona['y0'] - 20000 <= t['y'] <= zona['y1'] + 20000]
    equipos = []
    usados: set[str] = set()
    for i, g in enumerate(sorted(grupos, key=lambda g: -sum(centros[j][1] for j in g) / len(g))):
        xs = [centros[j][0] for j in g]
        ys = [centros[j][1] for j in g]
        cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        an, fo = max(1200, max(xs) - min(xs)), max(1200, max(ys) - min(ys))
        cerca = sorted(((math.dist((cx, cy), (t['x'], t['y'])), t) for t in tagsEnPlanta
                        if t['tag'] not in usados), key=lambda r: r[0])
        tag, seguro = None, False
        if cerca and cerca[0][0] < 15000:
            tag = cerca[0][1]['tag']
            usados.add(tag)
            seguro = True
        if tag is None:
            tag = f'UMA-S{i + 1:02d}'
        esVex = tag.startswith('VEX') or (an * fo) < 4_000_000
        d = diagramas.get(tag, {})
        equipos.append({
            'tag': tag,
            'tagSeguro': seguro,          # False = colocado por posición, no leído del plano
            'tipo': 'vex' if esVex else 'uma',
            'x': round(cx, 1), 'y': round(cy, 1),
            'ancho': round(an, 1), 'fondo': round(fo, 1),
            'alto': ALTO_VEX if esVex else ALTO_UMA,
            'puntos': d.get('puntos', []),
            'controlador': d.get('controlador'),
            'enTablero': d.get('enTablero', False),
        })

    # Equipos que tienen diagrama de control pero no se han podido situar en la planta: se
    # incluyen igual, sin posición, para que su lista de puntos no se pierda.
    situados = {e['tag'] for e in equipos}
    sinSituar = [{'tag': tag, 'tagSeguro': True, 'tipo': 'vex' if tag.startswith('VEX') else 'uma',
                  'x': None, 'y': None, 'ancho': None, 'fondo': None, 'alto': None,
                  'puntos': d['puntos'], 'controlador': d['controlador'],
                  'enTablero': d['enTablero']}
                 for tag, d in sorted(diagramas.items()) if tag not in situados and d['puntos']]
    print(f"  {len(equipos)} equipos situados en planta, {len(sinSituar)} solo con diagrama")

    # ---------------- 4. La obra: columnas, barandas, bordes, muros, lucernarios ----------------
    # Solo lo que cae dentro de la zona modelada, y solo tramos con largo suficiente: el plano
    # está lleno de detalles de despiece de dos centímetros que en el mundo 3D son ruido.
    MARGEN = 8000
    def en_zona(x: float, y: float) -> bool:
        return (zona['x0'] - MARGEN <= x <= zona['x1'] + MARGEN
                and zona['y0'] - MARGEN <= y <= zona['y1'] + MARGEN)

    obra: list[dict[str, Any]] = []
    columnas: list[dict[str, Any]] = []
    for e in msp:
        capa = e.dxf.get('layer', '')
        if e.dxftype() == 'CIRCLE' and CAPAS_COLUMNA.search(capa):
            c = e.dxf.center
            r = e.dxf.radius
            if en_zona(c.x, c.y) and RADIO_COLUMNA[0] <= r <= RADIO_COLUMNA[1]:
                # La altura viaja con cada pilar para que TODAS las cotas supuestas queden
                # declaradas aquí, en el extractor, y no repartidas por el visor.
                columnas.append({'x': round(c.x, 1), 'y': round(c.y, 1), 'r': round(r, 1),
                                 'alto': ALTO_COLUMNA})
            continue
        fam = next(((f, z, g, lm) for f, pat, z, g, lm in ARQUITECTURA if pat.search(capa)), None)
        if fam is None:
            continue
        familia, alto, grosor, largo_min = fam
        for pts in polilineas_de(e):
            if not any(en_zona(x, y) for x, y in pts):
                continue
            largo = sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
            if largo < largo_min:
                continue
            obra.append({'familia': familia, 'alto': alto, 'grosor': grosor,
                         'puntos': [[round(x, 1), round(y, 1)] for x, y in pts]})
    # Columnas duplicadas: la estructura suele dibujar dos círculos concéntricos por pilar.
    vistas: set[tuple[int, int]] = set()
    unicas = []
    for c in sorted(columnas, key=lambda c: -c['r']):
        clave = (int(c['x'] // 400), int(c['y'] // 400))
        if clave in vistas:
            continue
        vistas.add(clave)
        unicas.append(c)
    columnas = unicas
    porFamilia = collections.Counter(o['familia'] for o in obra)
    print(f"  obra: {len(columnas)} columnas, "
          + ', '.join(f'{n} de {f}' for f, n in porFamilia.most_common()))

    modelo = {
        'formato': 'tablero-studio-infraestructura',
        'version': 1,
        'nombre': 'Cubierta del aeropuerto',
        'unidades': 'mm',
        'origen': {
            'archivo': entrada.split('/')[-1],
            'entidades': sum(1 for _ in msp),
            'capas': len(doc.layers),
        },
        'alturasSupuestas': True,   # el plano no trae cotas Z: las de arriba son de proyecto
        'zona': {k: round(v, 1) for k, v in zona.items()},
        'leyendaPuntos': {k: {'que': v[0], 'clase': v[1]} for k, v in
                          {**PUNTOS_BMS, **{k: v for k, v in SONDAS_TEXTO.items()}}.items()},
        'equipos': equipos + sinSituar,
        'trazas': [{k: v for k, v in t.items() if k != 'largo'} for t in trazas],
        'columnas': columnas,
        'obra': obra,
    }
    with open(salida, 'w', encoding='utf-8') as f:
        json.dump(modelo, f, ensure_ascii=False, separators=(',', ':'))
    import os
    print(f"\n✅ {salida}  ({os.path.getsize(salida)/1024:.0f} KB)")
    print(f"   equipos: {len(modelo['equipos'])}   trazas: {len(modelo['trazas'])}")


if __name__ == '__main__':
    main()
