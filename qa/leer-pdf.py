"""
Saca el texto de un PDF generado por jsPDF, para poder comprobar en las pruebas QUÉ DICE.

Un dossier que se entrega a un cliente no se puede verificar mirando que «pesa lo suficiente»:
hay que leer lo que afirma. Esto extrae las cadenas de los operadores de texto (Tj/TJ) de los
flujos de contenido, comprimidos o no, que es lo único que hace falta para eso.

    python3 qa/leer-pdf.py archivo.pdf
"""
import re
import sys
import zlib

raw = open(sys.argv[1], 'rb').read()

partes = []
for m in re.finditer(rb'stream\r?\n(.*?)\r?\nendstream', raw, re.S):
    datos = m.group(1)
    try:
        partes.append(zlib.decompress(datos))
    except Exception:
        partes.append(datos)          # jsPDF no comprime por defecto

todo = b'\n'.join(partes)
cadenas = re.findall(rb'\(((?:[^()\\]|\\.)*)\)\s*T[jJ]', todo, re.S)
texto = ' '.join(c.decode('latin-1') for c in cadenas)
# Los paréntesis van escapados dentro de las cadenas PDF.
texto = texto.replace('\\(', '(').replace('\\)', ')')
sys.stdout.buffer.write(texto.encode('utf-8', 'replace'))
