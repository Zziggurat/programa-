# Política CSV de los entregables M3

Los CSV de Documentación, Ingeniería, Diseño y parte de obra pasan por
`src/modelo/csv.ts`. Se emiten como texto UTF-8 con BOM, columnas separadas por
`;` y un registro por fila lógica. Cada campo que contiene `;`, comillas, CR o LF va
entre comillas dobles; las comillas interiores se duplican. El dato original
permanece en el proyecto y en JSON: la protección se aplica sólo al exportar.

Una hoja de cálculo puede ejecutar como fórmula un campo que empieza por `=`,
`+`, `-` o `@`; algunas también interpretan variantes de ancho completo o
ignoran espacios/caracteres de control iniciales. La exportación antepone un
apóstrofo al campo sospechoso, sin recortar su contenido. Los números decimales
con signo, incluidos valores con coma decimal y notación exponencial, se
conservan como números; también se conservan los que llevan sólo espacios
ordinarios iniciales. Un control inicial (tabulación, CR, LF o NUL) sí se
protege. Esta política cubre texto incorporado desde proyectos importados; la
aplicación no importa CSV como formato de proyecto.

El apóstrofo puede quedar visible según el importador. Ninguna codificación CSV
es universalmente segura si un tercero abre, guarda y vuelve a exportar la hoja:
antes de reexportar debe tratar los campos como entrada no fiable. Para
intercambio estructurado y fidelidad exacta del texto, se debe usar el JSON del
paquete. Véase [OWASP CSV Injection](https://community.owasp.org/attacks/CSV_Injection).
