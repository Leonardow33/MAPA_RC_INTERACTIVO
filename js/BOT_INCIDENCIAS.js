// ============================================================
// ASISTENTE DE INCIDENTES — Code.gs
// Pega este contenido en el editor de Google Apps Script.
// ============================================================

// Si el script vive DENTRO del mismo Spreadsheet, deja vacío.
// Si es un proyecto independiente, pon aquí el ID del Spreadsheet.
const SPREADSHEET_ID = '1mOgYRtxpWauT2Ej9wdf8B2S6LKYezSVw1JrtYMCt8UM';

const INCIDENTES_SHEET = 'incidentes en curso'; // ← cambia aquí si quieres otro nombre de salida

// URL de puntos.json en GitHub Pages — única fuente de verdad de tiendas
const PUNTOS_JSON_URL = 'https://leonardow33.github.io/MAPA_RC_INTERACTIVO/data/puntos.json';

// Nombre de la carpeta en Google Drive donde se guardan las fotos de evidencia.
// Se crea automáticamente si no existe.
const EVIDENCIAS_FOLDER_NAME = 'LOTOBOLA_EVIDENCIAS';

// ── Secrets desde GAS Script Properties ──────────────────────────────────────
// En el editor de GAS: Configuración del proyecto → Propiedades de script → Agregar:
//   SLACK_WEBHOOK_DEFAULT   → webhook canal general
//   SLACK_TAMBO             → webhook canal Tambo
//   SLACK_CENCOSUD          → webhook canal Cencosud
//   SLACK_CASA_DE_APUESTA   → webhook canal Casa de Apuesta
//   TEAMS_EMAIL             → email del canal de Teams
const _P = PropertiesService.getScriptProperties();

const SLACK_WEBHOOK_DEFAULT = _P.getProperty('SLACK_WEBHOOK_DEFAULT') || '';

const SLACK_WEBHOOKS_POR_PARTNER = {
  'CENCOSUD':        _P.getProperty('SLACK_CENCOSUD')          || '',
  'TAMBO':           _P.getProperty('SLACK_TAMBO')             || '',
  'CASA DE APUESTA': _P.getProperty('SLACK_CASA_DE_APUESTA')   || '',
  // BODEGA y SUERTE usarán el canal por defecto (SLACK_WEBHOOK_DEFAULT)
};

function _getWebhookSlack(partner) {
  var url = SLACK_WEBHOOKS_POR_PARTNER[_norm(partner).toUpperCase()];
  return (url && url.trim()) ? url.trim() : SLACK_WEBHOOK_DEFAULT;
}

const TEAMS_EMAIL = _P.getProperty('TEAMS_EMAIL') || '';

// Índices de columnas en CATALOGO (0-based), orden igual al Excel exportado
const C = {
  ORG_CODE: 0, ORD_ID: 1, TIENDA: 2, ANTIGUEDAD: 3, CLUSTER: 4,
  RC: 5, ZONAL: 6, DISTRITO: 7, DIRECCION: 8, DPTO: 9, PROVINCIA: 10,
  GZ: 11, JZ: 12, CAPACITADOR: 13, SUPERVISOR: 14, RESPONSABLE: 15,
  ZONAL_TIPO: 16, FREC_NORMAL: 17, TITULAR: 18, LAT: 19, LON: 20,
  FRECUENCIA: 21, CONSIDERAR: 22, ESTATUS: 23, USERNAME: 24,
  TIPO: 25, CLUSTER_INT: 26
};

// ---- Entry point ----
// ▼ ÚNICO CAMBIO: inyecta window.GAS_PARAMS cuando llega org_code en la URL ▼
function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};

  // ── API de datos (GET) — usada desde incidencias.html ───────────────
  if (params.action === 'consultar') {
    var ticket = consultarTicket(String(params.ticket || ''));
    return ContentService
      .createTextOutput(JSON.stringify(ticket || { error: 'Ticket no encontrado' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (params.action === 'historial') {
    var hist = getHistorialTienda(String(params.orgCode || ''));
    return ContentService
      .createTextOutput(JSON.stringify(hist))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (params.action === 'resumen_mapa') {
    var resumen = getResumenMapa();
    return ContentService
      .createTextOutput(JSON.stringify(resumen))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ── Bot conversacional (HTML) ────────────────────────────────────────
  var html = HtmlService.createHtmlOutputFromFile('Index');

  if (params.org_code) {
    var inject = '<script>window.GAS_PARAMS='
      + JSON.stringify({ org_code: String(params.org_code), partner: String(params.partner || '') })
      + ';<\/script>';
    html.setContent(inject + html.getContent());
  }

  return html
    .setTitle('Asistente de Incidentes')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ---- Internos ----
function _ss() {
  return SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

// Cache en memoria — una sola petición HTTP por ejecución del script
var _catalogoMemo = null;

function _catalogo() {
  if (_catalogoMemo) return _catalogoMemo;

  var resp = UrlFetchApp.fetch(PUNTOS_JSON_URL, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) {
    throw new Error('No se pudo cargar puntos.json — HTTP ' + resp.getResponseCode());
  }

  var stores = JSON.parse(resp.getContentText());

  _catalogoMemo = stores
    .filter(function(s) { return !s.estado || s.estado === 'ACTIVO'; })
    .map(function(s) {
      var row = new Array(27).fill('');
      row[C.ORG_CODE]    = s.ID          || '';
      row[C.TIENDA]      = s.nombre      || '';
      row[C.DISTRITO]    = s.distrito    || '';
      row[C.DIRECCION]   = s.direccion   || '';
      row[C.CLUSTER]     = s.cluster     || '';
      row[C.GZ]          = s.gz          || '';
      row[C.JZ]          = s.jz          || '';
      row[C.CAPACITADOR] = s.capacitador || '';
      row[C.SUPERVISOR]  = s.supervisor  || '';
      row[C.RESPONSABLE] = s.responsable || '';
      row[C.ESTATUS]     = s.estado      || '';
      row[C.USERNAME]    = s.username    || '';
      row[C.TIPO]        = s.tipo        || '';
      row[C.LAT]         = s.lat         || '';
      row[C.LON]         = s.lng         || '';
      row[C.FRECUENCIA]  = s.frecuencia  || '';
      return row;
    });

  return _catalogoMemo;
}

function _unique(rows, col) {
  return [...new Set(rows.map(r => r[col]).filter(Boolean))].sort();
}

// ---- API pública (llamada desde Index.html) ----

// Normaliza el valor de una celda para comparaciones seguras
function _norm(v) { return String(v == null ? '' : v).trim(); }

// Búsqueda directa por nombre o código de tienda (mín. 2 caracteres, máx. 50 resultados)
// partner opcional — si se pasa, filtra solo ese tipo
function buscarTiendas(query, partner) {
  var q = _norm(query).toLowerCase();
  if (q.length < 2) return [];
  var p = _norm(partner).toUpperCase();
  return _catalogo()
    .filter(function(r) {
      var matchPartner = !p || _norm(r[C.TIPO]).toUpperCase() === p;
      var matchQuery   = _norm(r[C.TIENDA]).toLowerCase().indexOf(q) > -1 ||
                         String(r[C.ORG_CODE]).indexOf(q) > -1;
      return matchPartner && matchQuery;
    })
    .map(_mapTienda)
    .sort(function(a, b) { return a.nombre.localeCompare(b.nombre); })
    .slice(0, 50);
}

function _mapTienda(r) {
  return {
    orgCode:     String(r[C.ORG_CODE]),
    nombre:      String(r[C.TIENDA]),
    distrito:    String(r[C.DISTRITO]),
    direccion:   String(r[C.DIRECCION]),
    supervisor:  String(r[C.SUPERVISOR]),
    capacitador: String(r[C.CAPACITADOR]),
    gz:          String(r[C.GZ]),
    jz:          String(r[C.JZ]),
    posId:       String(r[C.USERNAME])
  };
}

// ---- Evidencias (fotos) ----
function _getEvidenciasFolder() {
  var folders = DriveApp.getFoldersByName(EVIDENCIAS_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(EVIDENCIAS_FOLDER_NAME);
}

// archivos = [{base64, mimeType, ext}, ...]  — máx. 4
function subirEvidencias(archivos) {
  if (!archivos || !archivos.length) return [];
  var folder = _getEvidenciasFolder();
  var ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  return archivos.map(function(a, i) {
    var bytes = Utilities.base64Decode(a.base64);
    var blob  = Utilities.newBlob(bytes, a.mimeType, ts + '_' + (i + 1) + '.' + (a.ext || 'jpg'));
    var file  = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  });
}

// ---- Slack ----
function notificarSlack(datos, ticketId, evUrls) {
  var webhookUrl = _getWebhookSlack(datos.partner);
  if (!webhookUrl) return;

  var prio = datos.prioridad || '';
  const prioColor = prio.startsWith('Alta')  ? '#e53935' :
                    prio.startsWith('Media') ? '#f9a825' : '#43a047';

  const f = function(label, val) {
    return { type: 'mrkdwn', text: '*' + label + '*\n' + (val || '-') };
  };

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '🎱 LOTOBOLA · ' + ticketId, emoji: true }
    },
    {
      type: 'section',
      fields: [
        f('Partner',       datos.partner),
        f('Tienda',        datos.tienda.nombre + ' (#' + datos.tienda.orgCode + ')'),
        f('Distrito',      datos.tienda.distrito),
        f('Gerente Zonal', datos.gz),
        f(datos.supervisor ? 'Supervisor' : 'Jefe Zonal', datos.jz),
        f('Tipo',          datos.tipoIncidente)
      ]
    },
    {
      type: 'section',
      fields: [
        f('Afecta',      datos.afecta),
        f('POS ID',      datos.posId),
        f('Versión app', datos.appVersion),
        f('Inicio',      datos.inicio),
        f('Prioridad',   datos.prioridad),
        datos.juego ? f('Juego', datos.juego) : f('Juego', 'General'),
        f('Celular',     datos.celular || '-')
      ]
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*Descripción*\n' + datos.descripcion }
    }
  ];

  if (datos.observaciones) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*Observaciones*\n' + datos.observaciones }
    });
  }
  if (evUrls && evUrls.length) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*📎 Fotos (' + evUrls.length + ')*\n' +
          evUrls.map(function(u, i) { return '<' + u + '|foto ' + (i + 1) + '>'; }).join('  ·  ')
      }
    });
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: 'Reportado por *' + datos.nombre + '*  ·  LOTOBOLA' }]
  });
  blocks.push({ type: 'divider' });

  if (datos.resolucion) {
    // Incidente ya resuelto en campo — sin botones, banner de cierre
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '✅ *Solucionado en campo con soluciones típicas*\n' + datos.resolucion }
    });
  } else {
    blocks.push({
      type: 'actions',
      block_id: 'acciones_' + ticketId,
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '🔄 En proceso', emoji: true },
          action_id: 'estado_en_proceso',
          value: ticketId
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅ Atendido', emoji: true },
          style: 'primary',
          action_id: 'estado_atendido',
          value: ticketId
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '📤 Derivado a área especializada', emoji: true },
          action_id: 'estado_derivado',
          value: ticketId
        }
      ]
    });
  }

  const payload = JSON.stringify({
    text: 'Nuevo incidente: ' + ticketId,
    attachments: [{
      color:  prioColor,
      blocks: blocks
    }]
  });

  try {
    const resp = UrlFetchApp.fetch(webhookUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: payload,
      muteHttpExceptions: true
    });
    const code = resp.getResponseCode();
    const body = resp.getContentText();
    if (code !== 200 || body !== 'ok') {
      console.error('Slack respondió ' + code + ': ' + body);
    } else {
      console.log('Slack OK — ' + ticketId);
    }
  } catch(e) {
    console.error('Slack fetch falló:', e);
  }
}

// Recibe los clics de botones de Slack
function doPost(e) {
  try {
    // ── Plataforma de campo (GitHub Pages) ──────────────────────────────────
    var postBody = (e && e.postData) ? e.postData.contents : null;
    if (postBody) {
      try {
        var ext = JSON.parse(postBody);
        if (ext && ext.action === 'guardar') {
          var ticketIdExt = guardarIncidente(ext.datos);
          return ContentService
            .createTextOutput(JSON.stringify({ ok: true, id: ticketIdExt }))
            .setMimeType(ContentService.MimeType.JSON);
        }
      } catch(pe) { /* no es nuestro formato, continuar con Slack */ }
    }
    // ── Botones de Slack ────────────────────────────────────────────────────
    if (e && e.parameter && e.parameter.payload) {
      var slackPayload = JSON.parse(e.parameter.payload);
      if (slackPayload.type === 'block_actions' && slackPayload.actions && slackPayload.actions.length) {
        var action = slackPayload.actions[0];
        var ticketId = action.value;
        var estadoMap = {
          'estado_en_proceso': '🔄 En proceso',
          'estado_atendido':   '✅ Atendido',
          'estado_derivado':   '📤 Derivado a área especializada'
        };
        var nuevoEstado = estadoMap[action.action_id];
        if (nuevoEstado && ticketId) {
          var resultado = actualizarEstado(ticketId, nuevoEstado);
          if (slackPayload.response_url && resultado.estadoFinal) {
            // Siempre actualiza el mensaje con el estado real del spreadsheet
            // Si ya estaba Atendido, esto quitará los botones para quien intentó cambiar
            _actualizarMensajeSlack(slackPayload.response_url, ticketId, resultado.estadoFinal, slackPayload.message);
          }
        }
      }
    }
  } catch(err) {
    console.error('doPost error:', err);
  }
  return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT);
}

// Retorna { aplicado: true, estadoFinal } si se actualizó,
// o { aplicado: false, estadoFinal } si ya estaba Atendido (bloqueado).
function actualizarEstado(ticketId, estado) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ss().getSheetByName(INCIDENTES_SHEET);
    if (!sh) return { aplicado: false, estadoFinal: null };
    var data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(ticketId)) {
        var estadoActual = String(data[i][22]);
        if (estadoActual.indexOf('Atendido') > -1) {
          // Ticket ya cerrado — no se toca el spreadsheet
          console.log('Bloqueado: ' + ticketId + ' ya está Atendido');
          return { aplicado: false, estadoFinal: estadoActual };
        }
        sh.getRange(i + 1, 23).setValue(estado);
        console.log('Estado actualizado: ' + ticketId + ' → ' + estado);
        return { aplicado: true, estadoFinal: estado };
      }
    }
  } finally {
    lock.releaseLock();
  }
  return { aplicado: false, estadoFinal: null };
}

function _actualizarMensajeSlack(responseUrl, ticketId, estado, originalMessage) {
  try {
    var att = originalMessage && originalMessage.attachments && originalMessage.attachments[0];
    var blocks = (att && att.blocks) ? att.blocks : [];

    // Quita el bloque de estado anterior (si ya se había cambiado antes)
    var filtered = blocks.filter(function(b) {
      return !(b.type === 'section' && b.text &&
               typeof b.text.text === 'string' &&
               b.text.text.indexOf('📋') === 0);
    });

    // Si ya está atendido, eliminar el bloque de botones (ya no hay nada que cambiar)
    var esAtendido = estado.indexOf('Atendido') > -1;
    if (esAtendido) {
      filtered = filtered.filter(function(b) { return b.type !== 'actions'; });
    }

    // Inserta el nuevo estado justo ANTES del bloque de botones (o al final si fue eliminado)
    var newBlocks = [];
    var insertado = false;
    filtered.forEach(function(b) {
      if (b.type === 'actions' && !insertado) {
        newBlocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: '📋 *Estado actual:* ' + estado }
        });
        insertado = true;
      }
      newBlocks.push(b);
    });
    if (!insertado) {
      newBlocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '📋 *Estado actual:* ' + estado }
      });
    }

    UrlFetchApp.fetch(responseUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        replace_original: true,
        attachments: [{ color: att ? att.color : '#e91e8c', blocks: newBlocks }]
      }),
      muteHttpExceptions: true
    });
  } catch(err) {
    console.error('Error actualizando mensaje Slack:', err);
  }
}

// ---- Teams (vía email al canal) ----
function notificarTeams(datos, ticketId, evUrls) {
  if (!TEAMS_EMAIL) return;

  const filas = [
    ['Reportado por',  datos.nombre || '-'],
    ['Celular',        datos.celular || '-'],
    ['Partner',        datos.partner || '-'],
    ['Tienda',         datos.tienda.nombre + ' (#' + datos.tienda.orgCode + ')'],
    ['Distrito',       datos.tienda.distrito || '-'],
    ['Gerente Zonal',  datos.gz || '-'],
    [datos.supervisor ? 'Supervisor' : 'Jefe Zonal', datos.jz || '-'],
    ['Afecta',         datos.afecta || '-'],
    ['POS ID',         datos.posId || '-'],
    ['Versión app',    datos.appVersion || '-'],
    ['Inicio',         datos.inicio || '-'],
    ['Prioridad',      datos.prioridad]
  ];
  if (datos.juego) filas.push(['Juego', datos.juego]);

  const tabla = '<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">'
    + filas.map(function(f) {
        return '<tr>'
          + '<td style="padding:5px 12px 5px 0;color:#555;white-space:nowrap"><b>' + f[0] + '</b></td>'
          + '<td style="padding:5px 0">' + f[1] + '</td>'
          + '</tr>';
      }).join('')
    + '</table>';

  var html = '<h2 style="color:#ad1457">🎱 Nuevo incidente LOTOBOLA — ' + ticketId + '</h2>'
    + '<h3 style="margin-top:0">' + datos.tipoIncidente + '</h3>'
    + tabla
    + '<p><b>Descripción:</b><br>' + datos.descripcion + '</p>';

  if (datos.observaciones) {
    html += '<p><b>Observaciones:</b><br>' + datos.observaciones + '</p>';
  }
  if (evUrls && evUrls.length) {
    html += '<p><b>Fotos (' + evUrls.length + '):</b> '
      + evUrls.map(function(u, i) {
          return '<a href="' + u + '">foto ' + (i + 1) + '</a>';
        }).join(' · ')
      + '</p>';
  }
  html += '<p style="color:#888;font-size:12px">Reportado por ' + datos.nombre + ' · LOTOBOLA</p>';

  try {
    MailApp.sendEmail({ to: TEAMS_EMAIL, subject: '🎱 LOTOBOLA — ' + ticketId + ' — ' + datos.tipoIncidente, htmlBody: html });
    console.log('Teams email OK — ' + ticketId);
  } catch(e) {
    console.error('Teams email falló:', e);
  }
}

// Función de prueba — ejecútala manualmente desde el editor de GAS
// para verificar que el webhook funciona sin necesitar un reporte real.
function testSlack() {
  var datos = {
    nombre: 'Test Usuario', celular: '987654321', partner: 'TAMBO', casaApuestas: '',
    gz: 'GZ-01', jz: 'JZ-A',
    tienda: { nombre: 'Tienda Prueba', orgCode: '99999', distrito: 'Lima', supervisor: '-', capacitador: '-' },
    tipoIncidente: 'La app no abre',
    posId: 'POS-TEST', appVersion: '3.0.0', afecta: 'Solo Loterias', juego: '',
    inicio: 'Ahora', descripcion: 'Mensaje de prueba desde GAS', observaciones: '',
    prioridad: 'Alta 🔴 — No puedo trabajar'
  };
  notificarSlack(datos, 'TKT-TEST-0001', []);
  notificarTeams(datos, 'TKT-TEST-0001', []);
}

// Encabezados actuales (v4) — 26 columnas
const HEADERS_V2 = [
  'ID_TICKET','FECHA','HORA','REPORTADO_POR','CELULAR','PARTNER','CASA_APUESTAS','GZ','JZ',
  'ORG_CODE','TIENDA','DISTRITO','SUPERVISOR','CAPACITADOR',
  'POS_ID','APP_VERSION','AFECTA','JUEGO',
  'TIPO_INCIDENTE','INICIO_PROBLEMA','DESCRIPCION',
  'PRIORIDAD','ESTADO','OBSERVACIONES','EVIDENCIAS','RECORDATORIOS'
];

function _crearHojaIncidentes(ss) {
  const sh = ss.insertSheet(INCIDENTES_SHEET);
  sh.getRange(1, 1, 1, HEADERS_V2.length).setValues([HEADERS_V2]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setColumnWidth(20, 320);
  return sh;
}

function guardarIncidente(datos) {
  // Subir fotos ANTES del candado (puede tardar varios segundos)
  const evUrls = subirEvidencias(datos.evFiles || []);

  // id se declara aquí para que sea accesible después del lock
  let id;

  // LockService evita IDs duplicados si dos personas envían al mismo tiempo
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    const ss = _ss();
    let sh = ss.getSheetByName(INCIDENTES_SHEET);

    if (!sh) {
      sh = _crearHojaIncidentes(ss);
    } else {
      const ultimaCol = String(sh.getRange(1, HEADERS_V2.length).getValue()).trim();
      if (ultimaCol !== HEADERS_V2[HEADERS_V2.length - 1]) {
        const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmm');
        sh.setName(INCIDENTES_SHEET + '_OLD_' + ts);
        sh = _crearHojaIncidentes(ss);
      }
    }

    const tz  = Session.getScriptTimeZone();
    const now = new Date();
    var esTambo = datos.partner && datos.partner.toUpperCase() === 'TAMBO';
    id = esTambo
      ? 'TMB-' + Utilities.formatDate(now, tz, 'MMdd') + '-' + String(sh.getLastRow()).padStart(3, '0')
      : 'TKT-' + Utilities.formatDate(now, tz, 'yyyyMMdd') + '-' + String(sh.getLastRow()).padStart(4, '0');

    // Si el problema fue resuelto antes de reportar, incluir la resolución en observaciones
    var obsValue = datos.observaciones || '';
    if (datos.resolucion) {
      obsValue = '[RESOLUCIÓN: ' + datos.resolucion + ']' + (obsValue ? ' | ' + obsValue : '');
    }

    sh.appendRow([
      id,
      Utilities.formatDate(now, tz, 'dd/MM/yyyy'),
      Utilities.formatDate(now, tz, 'HH:mm:ss'),
      datos.nombre,
      datos.celular      || '',
      datos.partner      || '',
      datos.casaApuestas || '',
      datos.gz           || '',
      datos.jz           || '',
      datos.tienda.orgCode     || '',
      datos.tienda.nombre      || '',
      datos.tienda.distrito    || '',
      datos.tienda.supervisor  || '',
      datos.tienda.capacitador || '',
      datos.posId        || '',
      datos.appVersion   || '',
      datos.afecta       || '',
      datos.juego        || '',
      datos.tipoIncidente,
      datos.inicio       || '',
      datos.descripcion  || '',
      datos.prioridad,
      datos.resolucion ? '✅ Atendido' : 'No atendido',
      obsValue,
      evUrls.join(' | '),
      0  // RECORDATORIOS — contador de alertas enviadas
    ]);
  } finally {
    lock.releaseLock();
  }

  // Notificaciones FUERA del candado — otros usuarios no esperan mientras envía
  notificarSlack(datos, id, evUrls);
  notificarTeams(datos, id, evUrls);
  return id;
}

// ---- Consulta de ticket (llamada desde Index.html) ----
function consultarTicket(ticketId) {
  var sh = _ss().getSheetByName(INCIDENTES_SHEET);
  if (!sh) return null;
  var rows = sh.getDataRange().getValues();
  var id = String(ticketId).trim().toUpperCase();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toUpperCase() === id) {
      var r = rows[i];
      return {
        id:        String(r[0]),
        fecha:     String(r[1]),
        hora:      String(r[2]),
        nombre:    String(r[3]),
        partner:   String(r[5]),
        tienda:    String(r[10]),
        tipo:      String(r[18]),
        prioridad: String(r[21]),
        estado:    String(r[22])
      };
    }
  }
  return null;
}

// Resumen por tienda para el mapa de incidencias
function getResumenMapa() {
  var sh = _ss().getSheetByName(INCIDENTES_SHEET);
  if (!sh) return [];
  var rows = sh.getDataRange().getValues();
  var mapa = {};
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var orgCode = String(r[9]).trim();
    if (!orgCode) continue;
    if (!mapa[orgCode]) {
      mapa[orgCode] = { orgCode: orgCode, total: 0, pendientes: 0, alta: false, media: false, ultimaFecha: '' };
    }
    mapa[orgCode].total++;
    mapa[orgCode].ultimaFecha = String(r[1]);
    var esAtendido = String(r[22]).toLowerCase().indexOf('atendido') > -1;
    if (!esAtendido) {
      mapa[orgCode].pendientes++;
      var prio = String(r[21]).toLowerCase();
      if (prio.indexOf('alta') > -1) mapa[orgCode].alta = true;
      else if (prio.indexOf('media') > -1) mapa[orgCode].media = true;
    }
  }
  return Object.values(mapa);
}

// Historial de incidencias de una tienda por orgCode — usado desde incidencias.html
function getHistorialTienda(orgCode) {
  var sh = _ss().getSheetByName(INCIDENTES_SHEET);
  if (!sh || !orgCode) return [];
  var rows = sh.getDataRange().getValues();
  var oc = String(orgCode).trim().toUpperCase();
  var result = [];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][9]).trim().toUpperCase() === oc) {
      var r = rows[i];
      result.push({
        id:          String(r[0]),
        fecha:       String(r[1]),
        hora:        String(r[2]),
        nombre:      String(r[3]),
        tipo:        String(r[18]),
        afecta:      String(r[16]),
        juego:       String(r[17]),
        prioridad:   String(r[21]),
        estado:      String(r[22]),
        descripcion: String(r[20])
      });
    }
  }
  return result.reverse(); // más reciente primero
}

// ── RECORDATORIOS AUTOMÁTICOS ────────────────────────────────────────────────
// Índices de columnas en la hoja de incidentes (0-based)
const COL = {
  ID: 0, FECHA: 1, HORA: 2, NOMBRE: 3, PARTNER: 5, TIENDA: 10, TIPO: 18,
  PRIORIDAD: 21, ESTADO: 22, RECORDATORIOS: 25
};

// Ejecuta cada 30 minutos via trigger. Revisa tickets pendientes y escala.
function verificarTicketsPendientes() {
  var sh = _ss().getSheetByName(INCIDENTES_SHEET);
  if (!sh) return;
  var data = sh.getDataRange().getValues();
  var now  = new Date();

  for (var i = 1; i < data.length; i++) {
    var row    = data[i];
    var estado = String(row[COL.ESTADO]);
    if (estado === '✅ Atendido') continue;

    // Calcular edad del ticket en minutos
    var fechaStr = String(row[COL.FECHA]); // dd/MM/yyyy
    var horaStr  = String(row[COL.HORA]);  // HH:mm:ss
    var p = fechaStr.split('/');
    if (p.length < 3) continue;
    var ticketDate = new Date(
      parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]),
      parseInt(horaStr.split(':')[0] || 0),
      parseInt(horaStr.split(':')[1] || 0), 0
    );
    var minutos = (now - ticketDate) / 60000;
    if (minutos < 0) continue;

    var enviados = parseInt(row[COL.RECORDATORIOS]) || 0;

    if (minutos > 60 && enviados === 0) {
      _enviarRecordatorioSlack(row, 1, minutos);
      sh.getRange(i + 1, COL.RECORDATORIOS + 1).setValue(1);
    } else if (minutos > 180 && enviados === 1) {
      _enviarRecordatorioSlack(row, 2, minutos);
      sh.getRange(i + 1, COL.RECORDATORIOS + 1).setValue(2);
    }
  }
}

function _enviarRecordatorioSlack(row, nivel, minutos) {
  var partner   = String(row[COL.PARTNER] || '');
  var recWebhook = _getWebhookSlack(partner);
  if (!recWebhook) return;
  var ticketId  = String(row[COL.ID]);
  var tienda    = String(row[COL.TIENDA]);
  var tipo      = String(row[COL.TIPO]);
  var estado    = String(row[COL.ESTADO]);
  var nombre    = String(row[COL.NOMBRE]);
  var prioridad = String(row[COL.PRIORIDAD]);
  var horas     = Math.floor(minutos / 60);
  var mins      = Math.round(minutos % 60);

  var titulo = nivel === 1
    ? '⏰ *Recordatorio* — ticket sin resolver hace ' + horas + 'h ' + mins + 'min'
    : '🚨 *ESCALACIÓN* — ticket lleva ' + horas + ' horas sin resolver';
  var color = nivel === 1 ? '#f9a825' : '#e53935';

  var blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: titulo } },
    { type: 'section', fields: [
      { type: 'mrkdwn', text: '*Ticket*\n`' + ticketId + '`' },
      { type: 'mrkdwn', text: '*Estado actual*\n' + estado },
      { type: 'mrkdwn', text: '*Tienda*\n' + tienda },
      { type: 'mrkdwn', text: '*Problema*\n' + tipo },
      { type: 'mrkdwn', text: '*Prioridad*\n' + prioridad },
      { type: 'mrkdwn', text: '*Reportado por*\n' + nombre }
    ]}
  ];

  try {
    UrlFetchApp.fetch(recWebhook, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({
        text: (nivel === 1 ? '⏰' : '🚨') + ' Ticket pendiente: `' + ticketId + '`',
        attachments: [{ color: color, blocks: blocks }]
      }),
      muteHttpExceptions: true
    });
    console.log('Recordatorio nivel ' + nivel + ' enviado: ' + ticketId);
  } catch(e) {
    console.error('Error recordatorio:', e);
  }
}

// Ejecuta esta función UNA SOLA VEZ desde el editor de GAS para activar el sistema.
// Después el trigger corre solo cada 30 minutos.
function crearTriggerRecordatorios() {
  // Elimina triggers previos del mismo tipo para evitar duplicados
  ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === 'verificarTicketsPendientes'; })
    .forEach(function(t) { ScriptApp.deleteTrigger(t); });

  ScriptApp.newTrigger('verificarTicketsPendientes')
    .timeBased()
    .everyMinutes(30)
    .create();

  console.log('✅ Trigger creado: verificarTicketsPendientes cada 30 min');
}

// ── MÉTRICAS ─────────────────────────────────────────────────────────────────
// Ejecuta manualmente desde el editor de GAS para generar un resumen de fallas.
// Crea (o actualiza) una hoja "METRICAS" con conteos por partner y tipo.
function generarResumenMetricas() {
  var ss = _ss();
  var sh = ss.getSheetByName(INCIDENTES_SHEET);
  if (!sh) { console.log('Hoja de incidentes no encontrada'); return; }

  var data = sh.getDataRange().getValues();
  var PARTNER_COL = 5, TIPO_COL = 18, ESTADO_COL = 22, FECHA_COL = 1;

  var counts = {};
  var estados = {};
  for (var i = 1; i < data.length; i++) {
    var partner = String(data[i][PARTNER_COL] || '').trim();
    var tipo    = String(data[i][TIPO_COL]    || '').trim();
    var estado  = String(data[i][ESTADO_COL]  || '').trim();
    if (!partner || !tipo) continue;

    var key = partner + '|||' + tipo;
    counts[key] = (counts[key] || 0) + 1;

    var eKey = partner + '|||' + estado;
    estados[eKey] = (estados[eKey] || 0) + 1;
  }

  var msName = 'METRICAS';
  var ms = ss.getSheetByName(msName) || ss.insertSheet(msName);
  ms.clearContents();

  // Tabla de fallas por tipo
  var rows = [['PARTNER', 'TIPO INCIDENTE', 'CANTIDAD']];
  Object.keys(counts).sort().forEach(function(k) {
    var p = k.split('|||');
    rows.push([p[0], p[1], counts[k]]);
  });
  rows.push(['', '', '']);

  // Tabla de estados
  rows.push(['PARTNER', 'ESTADO', 'CANTIDAD']);
  Object.keys(estados).sort().forEach(function(k) {
    var p = k.split('|||');
    rows.push([p[0], p[1], estados[k]]);
  });

  ms.getRange(1, 1, rows.length, 3).setValues(rows);
  ms.getRange(1, 1, 1, 3).setFontWeight('bold');
  ms.getRange(rows.indexOf(['PARTNER', 'ESTADO', 'CANTIDAD']) + 1, 1, 1, 3).setFontWeight('bold');
  ms.autoResizeColumns(1, 3);

  console.log('✅ Métricas generadas: ' + Object.keys(counts).length + ' tipos de falla');
}