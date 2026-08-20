// ── CONFIGURACIÓN DE COLUMNAS ──────────────────────────────────────────────
const COL_FECHA     = 1;   // A: FECHA DE MARCADO
const COL_HORA      = 2;   // B: HORA DE MARCADO
const COL_TIPO      = 3;   // C: TIPO (ENTRADA / SALIDA)
const COL_RC        = 6;   // F: RC / NOMBRE
const COL_LAT_RC    = 14;  // N: LAT RC
const COL_LNG_RC    = 15;  // O: LNG RC
const COL_UBICACION = 17;  // Q: UBICACION (calculada)
const COL_TIEMPO    = 18;  // R: TIEMPO EN TIENDA (calculada)
const COL_VISITA    = 19;  // S: NUMERO DE VISITA (calculada)
const NOMBRE_HOJA       = "Visitas";
const NOMBRE_HOJA_MAPA2 = "Visitas_Mapa2";
const NOMBRE_HOJA_SUP   = "Visitas_Supervisores";
const SPREADSHEET_ID    = "1OMLQto7r0O2prWGrCdX7VGAadJxSPdAjVWNyz7AI4ek";
// ──────────────────────────────────────────────────────────────────────────

function getHojaPorNombre(nombre) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
}

function getHoja() {
  return getHojaPorNombre(NOMBRE_HOJA);
}

function mismoDia(d1, d2) {
  if (!d1 || !d2) return false;
  const a = new Date(d1), b = new Date(d2);
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth()    &&
         a.getDate()     === b.getDate();
}

function procesarFila(sheet, row) {
  const datos  = sheet.getRange(row, 1, 1, COL_LNG_RC).getValues()[0];
  const tipo   = String(datos[COL_TIPO   - 1]).trim().toUpperCase();
  const latRC  = datos[COL_LAT_RC - 1];
  const lngRC  = datos[COL_LNG_RC - 1];

  // Q: UBICACION
  if (latRC && lngRC) {
    sheet.getRange(row, COL_UBICACION).setValue(`${latRC},${lngRC}`);
  }

  if (tipo !== "SALIDA") return;

  const fecha      = datos[COL_FECHA - 1];
  const horaSalida = datos[COL_HORA  - 1];
  const rc         = String(datos[COL_RC - 1]).trim();

  if (!fecha || !horaSalida || !rc) return;

  const historico = row > 2
    ? sheet.getRange(2, 1, row - 2, COL_LNG_RC).getValues()
    : [];

  // R: TIEMPO EN TIENDA — última ENTRADA del mismo RC
  let ultimaEntrada = null;
  for (let i = historico.length - 1; i >= 0; i--) {
    const hTipo = String(historico[i][COL_TIPO - 1]).trim().toUpperCase();
    const hRC   = String(historico[i][COL_RC   - 1]).trim();
    if (hRC === rc && hTipo === "ENTRADA") {
      ultimaEntrada = historico[i][COL_HORA - 1];
      break;
    }
  }
  if (ultimaEntrada !== null) {
    const diffMs = new Date(horaSalida) - new Date(ultimaEntrada);
    if (diffMs >= 0) {
      const seg = Math.floor(diffMs / 1000);
      const h   = Math.floor(seg / 3600);
      const m   = Math.floor((seg % 3600) / 60);
      const s   = seg % 60;
      sheet.getRange(row, COL_TIEMPO).setValue(
        `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
      );
    }
  }

  // S: NUMERO DE VISITA — cuántas SALIDAS del mismo RC en el mismo día
  let visita = 1;
  for (let i = 0; i < historico.length; i++) {
    const hTipo = String(historico[i][COL_TIPO  - 1]).trim().toUpperCase();
    const hRC   = String(historico[i][COL_RC    - 1]).trim();
    if (hRC === rc && hTipo === "SALIDA" && mismoDia(historico[i][COL_FECHA - 1], fecha)) {
      visita++;
    }
  }
  sheet.getRange(row, COL_VISITA).setValue(visita);
}

// ── Lógica compartida de procesarPendientes ────────────────────────────────
function procesarPendientesEnHoja(nombreHoja) {
  const sheet = getHojaPorNombre(nombreHoja);
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const numRows  = lastRow - 1;
  const allData  = sheet.getRange(2, 1, numRows, COL_LNG_RC).getValues();
  const calcData = sheet.getRange(2, COL_UBICACION, numRows, 3).getValues();

  for (let i = 0; i < numRows; i++) {
    const fecha = allData[i][COL_FECHA - 1];
    const tipo  = String(allData[i][COL_TIPO - 1]).trim().toUpperCase();
    const qVal  = calcData[i][0];
    const rVal  = calcData[i][1];

    if (!fecha) continue;

    if (!qVal || (tipo === "SALIDA" && !rVal)) {
      procesarFila(sheet, i + 2);
    }
  }
}

// ── TRIGGER 1: ediciones manuales ─────────────────────────────────────────
function onEdit(e) {
  const row       = e.range.getRow();
  const sheetName = e.range.getSheet().getName();
  if (row < 2) return;
  if (sheetName === NOMBRE_HOJA) {
    procesarFila(getHoja(), row);
  } else if (sheetName === NOMBRE_HOJA_MAPA2) {
    procesarFila(getHojaPorNombre(NOMBRE_HOJA_MAPA2), row);
  } else if (sheetName === NOMBRE_HOJA_SUP) {
    procesarFila(getHojaPorNombre(NOMBRE_HOJA_SUP), row);
  }
}

// ── TRIGGER 2: filas escritas por el web app ───────────────────────────────
function procesarPendientes() {
  procesarPendientesEnHoja(NOMBRE_HOJA);
}

function procesarPendientesMapa2() {
  procesarPendientesEnHoja(NOMBRE_HOJA_MAPA2);
}

function procesarPendientesSup() {
  procesarPendientesEnHoja(NOMBRE_HOJA_SUP);
}

// ── Ejecuta UNA sola vez para instalar los triggers de 5 minutos ──────────
function instalarTrigger() {
  const funciones = ['procesarPendientes', 'procesarPendientesMapa2', 'procesarPendientesSup'];

  ScriptApp.getProjectTriggers()
    .filter(t => funciones.includes(t.getHandlerFunction()))
    .forEach(t => ScriptApp.deleteTrigger(t));

  funciones.forEach(fn => {
    ScriptApp.newTrigger(fn).timeBased().everyMinutes(5).create();
    Logger.log(`Trigger instalado: ${fn} cada 5 minutos`);
  });
}

// ── WEB APP ────────────────────────────────────────────────────────────────
function doGet(e) {
  const p  = e.parameter;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // ── LECTURA: Visitas (RCs) ───────────────────────────────────────────────
  if (p.action === "getVisitas") {
    const sheet = ss.getSheetByName("Visitas");
    if (!sheet || sheet.getLastRow() < 2) {
      return ContentService.createTextOutput(JSON.stringify([]))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const hoy      = p.fecha || Utilities.formatDate(new Date(), "America/Lima", "yyyy-MM-dd");
    const numRows  = sheet.getLastRow() - 1;
    const rawRows  = sheet.getRange(2, 1, numRows, 19).getValues();
    const dispRows = sheet.getRange(2, 1, numRows, 19).getDisplayValues();

    const rcData = {};
    rawRows.forEach((r, i) => {
      const fecha = r[0] ? Utilities.formatDate(new Date(r[0]), "America/Lima", "yyyy-MM-dd") : "";
      if (fecha !== hoy) return;
      const rc = r[5] || "Sin RC";
      if (!rcData[rc]) rcData[rc] = {
        rc: rc, supervisor: r[6] || "",
        visitas: [], primeraVisita: null,
        horaActual: null, ultimaTienda: null, totalTiendas: 0
      };
      rcData[rc].visitas.push({
        hora:         dispRows[i][1],
        tipo:         r[2],
        tienda:       r[3],
        id:           r[4],
        zona:         r[7],
        cluster:      r[8],
        latT:         r[11],
        lngT:         r[12],
        latRC:        r[13],
        lngRC:        r[14],
        dist:         r[15] || 0,
        tiempoTienda: dispRows[i][17],
        numVisita:    r[18]
      });
      if (r[13] && r[14] && parseFloat(r[13]) !== 0) {
        rcData[rc].horaActual   = dispRows[i][1];
        rcData[rc].ultimaTienda = r[3];
      }
    });
    Object.values(rcData).forEach(rc => {
      if (rc.visitas.length > 0) {
        rc.primeraVisita = rc.visitas[0].hora;
        rc.totalTiendas  = new Set(rc.visitas.map(v => v.id)).size;
      }
    });
    return ContentService.createTextOutput(JSON.stringify(Object.values(rcData)))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ── LECTURA: Visitas_Mapa2 (Capacitadores) ───────────────────────────────
  if (p.action === "getVisitasMapa2") {
    const sheet = ss.getSheetByName("Visitas_Mapa2");
    if (!sheet || sheet.getLastRow() < 2) {
      return ContentService.createTextOutput(JSON.stringify([]))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const hoy      = p.fecha || Utilities.formatDate(new Date(), "America/Lima", "yyyy-MM-dd");
    const numRows  = sheet.getLastRow() - 1;
    const rawRows  = sheet.getRange(2, 1, numRows, 19).getValues();
    const dispRows = sheet.getRange(2, 1, numRows, 19).getDisplayValues();

    const capData = {};
    rawRows.forEach((r, i) => {
      const fecha = r[0] ? Utilities.formatDate(new Date(r[0]), "America/Lima", "yyyy-MM-dd") : "";
      if (fecha !== hoy) return;
      const nombre = r[6] || r[5] || "Sin Capacitador"; // col G = Nombre
      if (!capData[nombre]) capData[nombre] = {
        rc: nombre, supervisor: r[5] || "",              // col F = Rol
        visitas: [], primeraVisita: null,
        horaActual: null, ultimaTienda: null, totalTiendas: 0
      };
      capData[nombre].visitas.push({
        hora:         dispRows[i][1],
        tipo:         r[2],
        tienda:       r[3],
        id:           r[4],
        zona:         r[7],
        cluster:      r[8],
        latT:         r[11],
        lngT:         r[12],
        latRC:        r[13],
        lngRC:        r[14],
        dist:         r[15] || 0,
        tiempoTienda: dispRows[i][17],
        numVisita:    r[18]
      });
      if (r[13] && r[14] && parseFloat(r[13]) !== 0) {
        capData[nombre].horaActual   = dispRows[i][1];
        capData[nombre].ultimaTienda = r[3];
      }
    });
    Object.values(capData).forEach(cap => {
      if (cap.visitas.length > 0) {
        cap.primeraVisita = cap.visitas[0].hora;
        cap.totalTiendas  = new Set(cap.visitas.map(v => v.id)).size;
      }
    });
    return ContentService.createTextOutput(JSON.stringify(Object.values(capData)))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ── REGISTRO DE VISITA ───────────────────────────────────────────────────
  const hoja = p.hoja || "Visitas";
  let sheet = ss.getSheetByName(hoja);
  if (!sheet) sheet = ss.insertSheet(hoja);

  if (sheet.getLastRow() === 0) {
    if (hoja === "Visitas") {
      sheet.appendRow(["Fecha","Hora","Tipo","Tienda","ID","RC","Supervisor",
                       "Zona","Cluster","GZ","JZ","Lat Tienda","Lng Tienda",
                       "Lat RC","Lng RC","Distancia (m)"]);
    } else {
      sheet.appendRow(["Fecha","Hora","Tipo","Tienda","ID","Rol","Nombre",
                       "Zona","Cluster","GZ","JZ","Lat Tienda","Lng Tienda",
                       "Lat RC","Lng RC","Distancia (m)"]);
    }
  }

  const ahora = new Date();
  const fecha = Utilities.formatDate(ahora, "America/Lima", "yyyy-MM-dd");
  const hora  = Utilities.formatDate(ahora, "America/Lima", "HH:mm:ss");

  if (hoja === "Visitas") {
    sheet.appendRow([fecha, hora, p.tipo||"", p.tienda||"", p.id||"",
      p.rc||"", p.supervisor||"", p.zona||"", p.cluster||"",
      p.gz||"", p.jz||"", p.latT||"", p.lngT||"", p.latRC||"", p.lngRC||"", p.dist||""]);
  } else {
    sheet.appendRow([fecha, hora, p.tipo||"", p.tienda||"", p.id||"",
      p.rol||"", p.nombre||"", p.zona||"", p.cluster||"",
      p.gz||"", p.jz||"", p.latT||"", p.lngT||"", p.latRC||"", p.lngRC||"", p.dist||""]);
  }

  return ContentService.createTextOutput("ok");
}