/**
 * Google Apps Script — Material POP
 * Desplegarlo como Web App desde la hoja "Inventario - Material POP (respuestas)"
 * Acceso: Cualquier persona (anónimos) | Ejecutar como: Yo
 *
 * Devuelve JSON con los rog_codes que YA tienen respuesta en el formulario
 */

function doGet(e) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Respuestas de formulario 1");

  const lastRow = sheet.getLastRow();
  const codes   = new Set();

  if (lastRow > 1) {
    // Columna D = índice 4, desde fila 2 hasta la última
    const colD = sheet.getRange(2, 4, lastRow - 1, 1).getValues();
    colD.forEach(function(row) {
      var code = String(row[0]).trim();
      if (code && code !== "" && code.toLowerCase() !== "undefined") {
        codes.add(code);
      }
    });
  }

  var result = {
    codes:   Array.from(codes),
    total:   codes.size,
    updated: new Date().toISOString()
  };

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}
