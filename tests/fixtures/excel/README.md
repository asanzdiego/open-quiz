# Fixtures XLSX

Estos libros pequeños prueban la lectura real desde `Buffer`. No requieren Nextcloud.

| Archivo                 | Caso                                                    |
| ----------------------- | ------------------------------------------------------- |
| `valid-header.xlsx`     | Dos preguntas, cabecera canónica y respuestas numéricas |
| `valid-no-header.xlsx`  | Las mismas preguntas sin cabecera                       |
| `incomplete-row.xlsx`   | Falta la tercera respuesta incorrecta en E2             |
| `ambiguous-header.xlsx` | Cabecera con coincidencia parcial                       |
| `multiple-sheets.xlsx`  | Primera hoja, hoja Preguntas y una hoja de resultados   |
| `formula.xlsx`          | Fórmula en B2 con un resultado numérico almacenado      |

Para regenerarlos:

```sh
npm run fixtures:excel
```

El generador solo escribe en esta carpeta de pruebas. Los casos adicionales se crean en memoria en `tests/excel-import.test.ts`.
