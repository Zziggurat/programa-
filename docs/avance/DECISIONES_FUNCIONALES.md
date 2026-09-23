# Decisiones de frontera de la campaña funcional

1. **Rama y promoción.** Se trabaja en `roadmap/1.0-functional` desde V9 verificado; `main` no se usa como área de desarrollo. Checkpoints y CI en la rama no son releases ni aprobación de Diego.
2. **Una conectividad.** Aparato, borne y conductor conservan identidad eléctrica estable. Esquema, 3D, documentos y mundo referencian el mismo proyecto; no crear otra red para facilitar una vista.
3. **Bibliotecas existentes.** M1 mejora «Mis Tableros» y «Mis Componentes» en sus paneles actuales, sin crear un tercer catálogo. Un filtro afecta solo la vista, no IndexedDB ni selección del proyecto.
4. **Borrador de componente.** Al volver a la biblioteca se conserva en memoria el formulario sin guardar; no se afirma que un borrador resista cerrar la aplicación. Reemplazarlo requiere confirmación; el guardado sigue siendo la transacción durable existente.
5. **CAD privado.** `Cubierta.dwg` local coincide en bytes/hash con el archivo descrito en el contrato. No se incorpora al repositorio ni artifacts. `datos/cubierta.json` ya estaba versionado, pero carece de hash fuente y permiso de redistribución documentados; no afirmar equivalencia con este DWG ni ampliar su publicación sin aclarar derechos.
6. **Evidencia proporcional.** Typecheck y tests focales durante incrementos; navegador para gestos reales; campaña total sobre candidato integrado. Un pase anterior no acredita código modificado después.
