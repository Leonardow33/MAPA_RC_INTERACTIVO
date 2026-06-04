const _BASE_DATA = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'data/' : 'https://raw.githubusercontent.com/Leonardow33/MAPA_RC_INTERACTIVO/main/data/';
var map = L.map('map', { preferCanvas: true, closePopupOnClick: false }).setView([-9.19, -75.02], 6);

// 🗺️ CAPAS
var street = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © Esri'
}).addTo(map);

var satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}');
var dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png');

L.control.layers({
    "Calles": street,
    "Satélite": satellite,
    "Oscuro": dark
}, null, { position: 'bottomright' }).addTo(map);

let allData = [];
let sabado30 = {};
let currentFiltered = [];
let activeCluster = null;
let userLat = null, userLng = null;
let userMarker = null;
let routeLayer = null;
let routeMarkersLayer = L.layerGroup().addTo(map);
let markersLayer = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 45, removeOutsideVisibleBounds: false }).addTo(map);
let elotLayer  = L.layerGroup().addTo(map);
let elotMarker = null;
let routeMode = 'driving'; // 'driving' | 'foot'

// Centrar popup en pantalla sin perder el marcador
map.on('popupopen', function(e) {
    const marker = e.popup._source;
    if (!marker) return;
    const latlng = marker.getLatLng ? marker.getLatLng() : e.popup.getLatLng();
    if (!latlng) return;
    const mapH  = map.getSize().y;
    const popupH = (e.popup._container && e.popup._container.offsetHeight) || 260;
    const markerPx = map.latLngToContainerPoint(latlng);
    // mover el marcador al 70% inferior de la pantalla para que el popup quede centrado arriba
    const targetY = mapH * 0.70;
    const offsetY = markerPx.y - targetY;
    if (Math.abs(offsetY) > 20) {
        map.panBy([0, offsetY], { animate: true, duration: 0.25 });
    }
});

function toggleModo() {
    let btn = document.getElementById("btnModo");
    if (routeMode === 'driving') {
        routeMode = 'foot';
        btn.textContent = '🚶 A pie';
        btn.classList.add('pie');
    } else {
        routeMode = 'driving';
        btn.textContent = '🚗 Auto';
        btn.classList.remove('pie');
    }
}

// ICONOS
const PIN_BORDER = {
    "APUESTA TOTAL": "#FDD835",
    "TAMBO":         "#8E24AA",
    "TINBET":        "#43A047",
    "LIVESPORT":     "#1E88E5",
    "BODEGA":        "#29B6F6",
    "CENCOSUD":      "#FB8C00",
    "DEFAULT":       "#546E7A"
};

function getPinBorder(responsable) {
    if (!responsable) return PIN_BORDER["DEFAULT"];
    const r = responsable.trim().toUpperCase();
    if (r.includes("APUESTA TOTAL")) return PIN_BORDER["APUESTA TOTAL"];
    if (r.includes("TAMBO"))         return PIN_BORDER["TAMBO"];
    if (r.includes("TINBET"))        return PIN_BORDER["TINBET"];
    if (r.includes("LIVESPORT"))     return PIN_BORDER["LIVESPORT"];
    if (r.includes("CENCOSUD"))      return PIN_BORDER["CENCOSUD"];
    if (r.includes("BODEGA"))        return PIN_BORDER["BODEGA"];
    return PIN_BORDER["DEFAULT"];
}

function getIconUrl(responsable) {
    if (!responsable) return "icons/default.png";
    const r = responsable.trim().toUpperCase();
    if (r.includes("APUESTA TOTAL")) return "icons/apuesta.png";
    if (r.includes("TAMBO"))         return "icons/tambo.png";
    if (r.includes("TINBET"))        return "icons/tinbet.png";
    if (r.includes("LIVESPORT"))     return "icons/livesport.png";
    if (r.includes("AUR BODEGA") || r.includes("JS BODEGA") || r.includes("MCG BODEGA")) return "icons/bodega.png";
    return "icons/default.png";
}

function makePinIcon(responsable, estado) {
    const url = getIconUrl(responsable);
    let color, extraStyle = "", imgStyle = "width:100%;height:100%;object-fit:cover;";

    if (estado === "completado") {
        color    = "#9E9E9E";
        extraStyle = "opacity:0.45;";
        imgStyle  += "filter:grayscale(1);";
    } else if (estado === "en_visita") {
        color    = "#FF9800";
        extraStyle = "";
    } else {
        color = getPinBorder(responsable);
    }

    const html = `
        <div style="display:flex;flex-direction:column;align-items:center;width:34px;${extraStyle}">
            <div style="width:30px;height:30px;border-radius:50%;overflow:hidden;
                border:2.5px solid ${color};box-shadow:0 3px 8px rgba(0,0,0,0.45);">
                <img src="${url}" style="${imgStyle}" />
            </div>
            <div style="width:0;height:0;border-left:6px solid transparent;
                border-right:6px solid transparent;border-top:9px solid ${color};
                margin-top:-2px;filter:drop-shadow(0 2px 2px rgba(0,0,0,0.3));"></div>
        </div>`;
    return L.divIcon({ html, className: '', iconSize: [34,41], iconAnchor: [17,41], popupAnchor: [0,-41] });
}

function makeElotIcon() {
    const html = `
        <div style="display:flex;flex-direction:column;align-items:center;width:50px;">
            <div style="width:38px;height:38px;border-radius:50%;overflow:hidden;
                border:2.5px solid #FFD700;
                box-shadow:0 0 0 2px rgba(255,215,0,0.35),0 3px 10px rgba(0,0,0,0.45);
                background:#fffde7;display:flex;align-items:center;justify-content:center;">
                <img src="icons/llama.jpeg" style="width:100%;height:100%;object-fit:cover;"
                     onerror="this.style.display='none';this.nextElementSibling.style.display='block'"/>
                <span style="display:none;font-size:22px;line-height:1;">🦙</span>
            </div>
            <div style="width:0;height:0;border-left:7px solid transparent;
                border-right:7px solid transparent;border-top:10px solid #FFD700;
                margin-top:-2px;filter:drop-shadow(0 2px 2px rgba(0,0,0,0.3));"></div>
            <div style="background:#FFD700;color:#4a2e00;font-size:9px;font-weight:900;
                padding:2px 7px;border-radius:8px;margin-top:2px;
                box-shadow:0 2px 5px rgba(0,0,0,0.22);letter-spacing:0.8px;white-space:nowrap;">
                ELOT
            </div>
        </div>`;
    return L.divIcon({ html, className: '', iconSize: [50, 66], iconAnchor: [25, 52], popupAnchor: [0, -52] });
}

// HELPERS DE ORDENAMIENTO
const DIA_ORDER = ["LUNES","MARTES","MIERCOLES","MIÉRCOLES","JUEVES","VIERNES","SABADO","SÁBADO","DOMINGO","SIN RUTA"];

function sortedLast(arr, lastValues) {
    const lasts = lastValues.map(v => v.toUpperCase());
    return arr.sort((a, b) => {
        const aLast = lasts.includes((a || "").toUpperCase());
        const bLast = lasts.includes((b || "").toUpperCase());
        if (aLast && !bLast) return 1;
        if (!aLast && bLast) return -1;
        return (a || "").localeCompare(b || "", "es");
    });
}

function sortDias(arr) {
    return arr.sort((a, b) => {
        const ai = DIA_ORDER.indexOf((a || "").toUpperCase());
        const bi = DIA_ORDER.indexOf((b || "").toUpperCase());
        if (ai === -1 && bi === -1) return (a || "").localeCompare(b || "", "es");
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
    });
}

function filtrarPorTipo(data) {
    const ft = document.getElementById("tipoFilter").value;
    if (!ft || ft === "ALL") return data;
    if (ft === "TAMBO") {
        return data.filter(p => {
            const t = (p.tipo || "").toUpperCase();
            return t === "TAMBO" || t === "SUERTE";
        });
    }
    if (ft === "CASA DE APUESTA") {
        return data.filter(p => {
            const t = (p.tipo || "").toUpperCase();
            return t !== "TAMBO" && t !== "CENCOS" && t !== "BODEGA";
        });
    }
    return data;
}

function repoblarSup() {
    const supSelect = document.getElementById("supFilter");
    const prev = supSelect.value;
    const opts = [...supSelect.options].filter(o => o.value === "ALL");
    supSelect.innerHTML = '<option value="ALL">Todos</option>';
    const supSet = new Set(filtrarPorTipo(allData).map(p => p.supervisor).filter(v => v && v.trim() !== ""));
    sortedLast([...supSet], ["SIN SUPERVISOR"]).forEach(sup => {
        const o = document.createElement("option");
        o.value = sup; o.text = sup;
        supSelect.appendChild(o);
    });
    supSelect.value = [...supSelect.options].some(o => o.value === prev) ? prev : "ALL";
}

function repoblarRC(sup) {
    const rcSelect = document.getElementById("rcFilter");
    const prevRC = rcSelect.value;
    rcSelect.innerHTML = '<option value="ALL">Todos</option>';
    const base = filtrarPorTipo(sup === "ALL" ? allData : allData.filter(p => p.supervisor === sup));
    const rcSet = new Set(base.map(p => p.rc).filter(v => v && v.trim() !== ""));
    sortedLast([...rcSet], ["SIN RC"]).forEach(rc => {
        const opt = document.createElement("option");
        opt.value = rc; opt.text = rc;
        rcSelect.appendChild(opt);
    });
    rcSelect.value = [...rcSelect.options].some(o => o.value === prevRC) ? prevRC : "ALL";
}

fetch((_BASE_DATA + 'sabado30.json?v=') + new Date().getTime())
.then(res => res.json()).then(data => { sabado30 = data; }).catch(() => {});

// FETCH
fetch((_BASE_DATA + 'puntos.json?v=') + new Date().getTime(), {cache: 'no-store'})
.then(res => res.json())
.then(data => { try {

    allData = data;

    // PIN ESPECIAL ELOT (nunca se agrupa)
    const elotPoint = data.find(p => (p.nombre || "").toUpperCase().includes("OFICINA ELOT"));
    if (elotPoint && !elotMarker) {
        elotMarker = L.marker([elotPoint.lat, elotPoint.lng], { icon: makeElotIcon(), zIndexOffset: 1000 });
        elotMarker.bindPopup(buildPopupContent(elotPoint), { autoPan: false });
        attachPopupOpen(elotMarker, elotPoint);
        elotMarker.on('click', function() {
            map.flyTo([elotPoint.lat, elotPoint.lng], map.getMaxZoom(), { duration: 1.4 });
        });
        elotLayer.addLayer(elotMarker);
    }

    let diaSet  = new Set();
    let zonaSet = new Set();

    data.forEach(p => {
        if (p.dias) p.dias.forEach(d => diaSet.add(d));
        if (p.zona) zonaSet.add(p.zona);
    });

    let diaSelect = document.getElementById("diaFilter");
    sortDias([...diaSet]).forEach(dia => {
        let option = document.createElement("option");
        option.value = dia; option.text = dia;
        diaSelect.appendChild(option);
    });

    let zonaSelect = document.getElementById("zonaFilter");
    [...zonaSet].sort().forEach(zona => {
        let option = document.createElement("option");
        option.value = zona; option.text = zona;
        zonaSelect.appendChild(option);
    });

    const _tipoActual = localStorage.getItem('geodor_tipo');
    if (_tipoActual) {
        document.getElementById("tipoFilter").value = _tipoActual;
    }
    repoblarSup();
    repoblarRC("ALL");
    repoblarPartner("ALL", "ALL");
    restoreFilters();
    updateFilters();

} catch(err) { console.error('ERROR en fetch puntos.json:', err); } })
.catch(err => console.error('FETCH puntos.json falló:', err));

// MAPA
// ── ESTADO DE VISITAS (localStorage por día) ──────────────────────────────
function getTodayKey() {
    const limaDate = new Date(Date.now() - 5 * 60 * 60 * 1000);
    return "visitas_mapa_" + limaDate.toISOString().slice(0, 10);
}
function getVisitasHoy() {
    return JSON.parse(localStorage.getItem(getTodayKey()) || "{}");
}
function getEstadoPunto(id) {
    const v = getVisitasHoy()[String(id)];
    if (!v)        return "libre";
    if (v.salida)  return "completado";
    return "en_visita";
}
function guardarEstadoLocal(id, tipo, hora) {
    const key = getTodayKey();
    const visitas = getVisitasHoy();
    if (!visitas[String(id)]) visitas[String(id)] = {};
    visitas[String(id)][tipo] = hora;
    localStorage.setItem(key, JSON.stringify(visitas));
}
// ──────────────────────────────────────────────────────────────────────────

function enviarAlSheet(p, tipo, distM) {
    const params = new URLSearchParams({
        hoja: "Visitas", tipo,
        tienda: p.nombre, id: p.ID,
        rc: p.rc || "", supervisor: p.supervisor || "",
        zona: p.zona || "", cluster: p.cluster || "",
        gz: p.gz || "", jz: p.jz || "",
        latT: p.lat, lngT: p.lng,
        latRC: userLat, lngRC: userLng,
        dist: Math.round(distM)
    });
    return fetch(SHEET_URL + "?" + params.toString(), { mode: 'no-cors' });
}

function registrarMovimiento(p, tipo, marker) {
    const safeId = String(p.ID).replace(/[^a-zA-Z0-9_-]/g, "_");
    const btn    = document.getElementById("btn-visita-" + safeId);
    const msg    = document.getElementById("msg-visita-" + safeId);
    const hora   = new Date().toTimeString().slice(0, 5);
    const distM  = haversine(userLat, userLng, p.lat, p.lng) * 1000;

    if (btn) { btn.textContent = "⏳ Registrando..."; btn.disabled = true; }

    guardarEstadoLocal(p.ID, tipo, hora);
    marker.setIcon(makePinIcon(p.responsable, getEstadoPunto(p.ID)));

    if ('vibrate' in navigator) navigator.vibrate([60, 40, 60]);
    const _mEl = marker.getElement ? marker.getElement() : null;
    if (_mEl) { _mEl.classList.add('marker-pulse'); setTimeout(() => _mEl.classList.remove('marker-pulse'), 500); }

    enviarAlSheet(p, tipo, distM)
        .then(() => {
            const estado = getEstadoPunto(p.ID);
            if (estado === "completado") {
                const v = getVisitasHoy()[String(p.ID)];
                if (btn) btn.style.display = "none";
                if (msg) {
                    msg.style.display = "block";
                    msg.style.color = "#388E3C";
                    msg.textContent = `✅ Visita completa · E: ${v.entrada} · S: ${v.salida}`;
                }
            } else {
                const v = getVisitasHoy()[String(p.ID)];
                if (btn) {
                    btn.textContent = `🔴 Registrar Salida`;
                    btn.style.background = "#E65100";
                    btn.disabled = false;
                    btn.onclick = () => registrarMovimiento(p, "salida", marker);
                }
                if (msg) {
                    msg.style.display = "block";
                    msg.style.color = "#E65100";
                    msg.textContent = `🟡 En visita · Entrada: ${v.entrada}`;
                }
            }
        })
        .catch(() => {
            guardarEstadoLocal(p.ID, tipo === "entrada" ? "_entrada_err" : "_salida_err", hora);
            if (btn) { btn.textContent = "❌ Error - reintentar"; btn.style.background = "#e53935"; btn.disabled = false; }
        });
}

function buildPopupContent(p) {
    const safeId  = String(p.ID).replace(/[^a-zA-Z0-9_-]/g, "_");
    const isElot  = (p.nombre || "").toUpperCase().includes("OFICINA ELOT");
    const color   = isElot ? "#B8860B" : getPinBorder(p.responsable);
    const visita  = sabado30[String(p.ID)];
    const visitaBanner = visita ? `
      <div class="popup-visita-sab">
        <span class="popup-visita-sab-titulo">Visita Sábado 30</span>
        <span class="popup-visita-sab-rep">${visita.representante}</span>
        <span class="popup-visita-sab-hora">${visita.horario}</span>
      </div>` : '';
    return `
    <div class="popup-card">
      ${visitaBanner}
      <div class="popup-header" style="background:${color}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px">
          <div>
            <span class="popup-nombre">${p.nombre}</span>
            <span class="popup-badge">${p.responsable || "Sin partner"}</span>
          </div>
          <a id="btn-maps-${safeId}"
             href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}"
             target="_blank" class="popup-btn-maps" title="Cómo llegar">🗺️</a>
        </div>
      </div>
      <div class="popup-body">
        <div class="popup-row"><span class="popup-lbl">ORG_CODE</span><span class="popup-val">${p.ID}</span></div>
        <div class="popup-row"><span class="popup-lbl">RC</span><span class="popup-val">${p.rc || "-"}</span></div>
        <div class="popup-row"><span class="popup-lbl">Usuario</span><span class="popup-val">${p.username || "-"}</span></div>
        <div class="popup-row"><span class="popup-lbl">Supervisor</span><span class="popup-val">${p.supervisor || "-"}</span></div>
        <div class="popup-row"><span class="popup-lbl">Cluster</span><span class="popup-val">${p.cluster || "-"}</span></div>
        <div class="popup-row"><span class="popup-lbl">Zona</span><span class="popup-val">${p.zona || "-"}</span></div>
        <div class="popup-row"><span class="popup-lbl">Distrito</span><span class="popup-val">${p.distrito || "-"}</span></div>
        <div class="popup-row"><span class="popup-lbl">GZ</span><span class="popup-val">${p.gz || "-"}</span></div>
        <div class="popup-row"><span class="popup-lbl">JZ</span><span class="popup-val">${p.jz || "-"}</span></div>
        <div id="sv-row-${safeId}" style="display:none;background:#fff3f3;border-radius:4px;margin-top:4px" class="popup-row"><span class="popup-lbl" style="color:#e53935">⚠️ Sin venta</span><span class="popup-val" id="sv-bi-${safeId}" style="color:#e53935"></span></div>
      </div>
      <button id="btn-visita-${safeId}" class="popup-btn-visita"></button>
      <div id="msg-visita-${safeId}" class="popup-msg-visita">📍 Acércate a 40m para registrar</div>
    </div>`;
}

function attachPopupOpen(marker, p) {
    const safeId = String(p.ID).replace(/[^a-zA-Z0-9_-]/g, "_");
    marker.on("popupopen", function() {
        const mapsBtn = document.getElementById('btn-maps-' + safeId);
        if (mapsBtn) {
            const org = (userLat && userLng) ? `&origin=${userLat},${userLng}` : '';
            mapsBtn.href = `https://www.google.com/maps/dir/?api=1${org}&destination=${p.lat},${p.lng}`;
        }
        const svRow = document.getElementById("sv-row-" + safeId);
        const svBi  = document.getElementById("sv-bi-"  + safeId);
        if (svRow && svBi) {
            if (sinVentaCodes.has(String(p.ID))) {
                svBi.textContent   = "BI: " + (sinVentaTimes[String(p.ID)] || '-');
                svRow.style.display = "";
            } else {
                svRow.style.display = "none";
            }
        }
        const btn = document.getElementById("btn-visita-" + safeId);
        const msg = document.getElementById("msg-visita-" + safeId);
        if (!btn || !msg) return;

        const estado = getEstadoPunto(p.ID);
        const v      = getVisitasHoy()[String(p.ID)];

        if (estado === "completado") {
            btn.style.display = "none";
            msg.style.display = "block";
            msg.style.color   = "#388E3C";
            msg.textContent   = `✅ Visita completa · E: ${v.entrada} · S: ${v.salida}`;
            return;
        }
        if (!userLat || !userLng) {
            btn.style.display = "none";
            msg.style.display = "block";
            msg.style.color   = "#999";
            msg.textContent   = "📍 Activa GPS para registrar";
            return;
        }
        const distM = haversine(userLat, userLng, p.lat, p.lng) * 1000;
        if (distM > 40) {
            btn.style.display = "none";
            msg.style.display = "block";
            msg.style.color   = "#999";
            msg.textContent   = `📍 Estás a ${Math.round(distM)}m (necesitas 40m)`;
            return;
        }
        msg.style.display = "block";
        btn.style.display = "block";
        if (estado === "libre") {
            btn.textContent       = "🟢 Registrar Entrada";
            btn.style.background  = "#1565C0";
            btn.disabled          = false;
            msg.style.color       = "#999";
            msg.textContent       = "";
            btn.onclick = () => registrarMovimiento(p, "entrada", marker);
        } else {
            btn.textContent       = "🔴 Registrar Salida";
            btn.style.background  = "#E65100";
            btn.disabled          = false;
            msg.style.color       = "#E65100";
            msg.textContent       = `🟡 En visita · Entrada: ${v.entrada}`;
            btn.onclick = () => registrarMovimiento(p, "salida", marker);
        }
    });
}

function renderMap(filterRC, filterDia, filterSup, filterPartner, filterZona, filterTipo) {

    markersLayer.clearLayers();

    const _supsCA = new Set(allData
        .filter(p => (p.tipo || "").toUpperCase() === "CASA DE APUESTA" && p.supervisor)
        .map(p => p.supervisor));

    let filtered = allData.filter(p => {
        const tipo = (p.tipo || "").toUpperCase();
        let tipoOk = true;
        if (filterTipo && filterTipo !== "ALL") {
            if (filterTipo === "TAMBO") {
                tipoOk = tipo === "TAMBO" || tipo === "SUERTE";
            } else if (filterTipo === "CASA DE APUESTA") {
                tipoOk = tipo !== "TAMBO" && tipo !== "CENCOS" && tipo !== "BODEGA";
            }
        }
        return (
            !(p.nombre || "").toUpperCase().includes("OFICINA ELOT") &&
            (p.estado || "").toUpperCase() === "ACTIVO" &&
            (filterSup     === "ALL" || p.supervisor  === filterSup) &&
            (filterRC      === "ALL" || p.rc          === filterRC) &&
            (filterDia     === "ALL" || (p.dias && p.dias.includes(filterDia))) &&
            (filterPartner === "ALL" || p.responsable === filterPartner) &&
            (filterZona    === "ALL" || p.zona        === filterZona) &&
            (activeCluster === null  || (p.cluster || "").toUpperCase() === activeCluster) &&
            tipoOk
        );
    });
    currentFiltered = filtered;

    let group = new L.featureGroup();

    filtered.forEach(p => {

    let icon = makePinIcon(p.responsable, getEstadoPunto(p.ID));

    let marker = L.marker([p.lat, p.lng], { icon: icon });
    marker.bindPopup(buildPopupContent(p), { autoPan: false });
    attachPopupOpen(marker, p);
    markersLayer.addLayer(marker);
    group.addLayer(marker);
});

if (filtered.length > 0 && (filterRC !== "ALL" || filterDia !== "ALL" || filterPartner !== "ALL" || filterSup !== "ALL")) {
    map.fitBounds(group.getBounds(), { padding: [30, 30] });
}

if (sinVentaActive) renderSinVentaLayer();

}

// PERSISTENCIA DE FILTROS
function saveFilters() {
    localStorage.setItem("filtros_mapa", JSON.stringify({
        sup:     document.getElementById("supFilter").value,
        rc:      document.getElementById("rcFilter").value,
        dia:     document.getElementById("diaFilter").value,
        partner: document.getElementById("partnerFilter").value,
        zona:    document.getElementById("zonaFilter").value
    }));
}

function restoreFilters() {
    const saved = JSON.parse(localStorage.getItem("filtros_mapa") || "{}");
    if (!saved.sup) return;

    const supSel = document.getElementById("supFilter");
    if ([...supSel.options].some(o => o.value === saved.sup)) {
        supSel.value = saved.sup;
        repoblarRC(saved.sup);
    }

    const rcSel = document.getElementById("rcFilter");
    if (saved.rc && [...rcSel.options].some(o => o.value === saved.rc))
        rcSel.value = saved.rc;

    const diaSel = document.getElementById("diaFilter");
    if (saved.dia && [...diaSel.options].some(o => o.value === saved.dia))
        diaSel.value = saved.dia;

    repoblarPartner(supSel.value, rcSel.value);

    const partnerSel = document.getElementById("partnerFilter");
    if (saved.partner && [...partnerSel.options].some(o => o.value === saved.partner))
        partnerSel.value = saved.partner;

    const zonaSel = document.getElementById("zonaFilter");
    if (saved.zona && [...zonaSel.options].some(o => o.value === saved.zona))
        zonaSel.value = saved.zona;
}

// FILTROS
function repoblarPartner(sup, rc) {
    const sel = document.getElementById("partnerFilter");
    const prev = sel.value;
    sel.innerHTML = '<option value="ALL">Todos</option>';
    const base = filtrarPorTipo(allData.filter(p =>
        (sup === "ALL" || p.supervisor === sup) &&
        (rc  === "ALL" || p.rc === rc)
    ));
    const partners = [...new Set(base.map(p => p.responsable).filter(v => v && v.trim() !== ""))].sort();
    partners.forEach(v => {
        const o = document.createElement("option");
        o.value = v; o.text = v;
        sel.appendChild(o);
    });
    sel.value = [...sel.options].some(o => o.value === prev) ? prev : "ALL";
}

document.getElementById("supFilter").addEventListener("change", function() {
    repoblarRC(this.value);
    repoblarPartner(this.value, document.getElementById("rcFilter").value);
    updateFilters();
});
document.getElementById("rcFilter").addEventListener("change", function() {
    repoblarPartner(document.getElementById("supFilter").value, this.value);
    updateFilters();
});
document.getElementById("diaFilter").addEventListener("change", updateFilters);
document.getElementById("zonaFilter").addEventListener("change", updateFilters);
document.getElementById("partnerFilter").addEventListener("change", function() {
    updateClusterButtons();
    updateFilters();
});
document.getElementById("tipoFilter").addEventListener("change", updateFilters);

function toggleCluster(btn) {
    const cluster = btn.dataset.cluster;
    if (activeCluster === cluster) {
        activeCluster = null;
        btn.classList.remove("activo");
    } else {
        document.querySelectorAll(".btn-cluster").forEach(b => b.classList.remove("activo"));
        activeCluster = cluster;
        btn.classList.add("activo");
    }
    updateFilters();
}

function updateClusterButtons() {
    const partner = (document.getElementById("partnerFilter").value || "").toUpperCase();
    const tamboGroup = document.getElementById("tamboClusterGroup");
    const atGroup    = document.getElementById("atClusterGroup");
    const container  = document.getElementById("clusterBtns");
    activeCluster = null;
    document.querySelectorAll(".btn-cluster").forEach(b => b.classList.remove("activo"));
    if (partner.includes("TAMBO")) {
        tamboGroup.style.display = "flex";
        atGroup.style.display    = "none";
        container.classList.add("visible");
    } else if (partner.includes("APUESTA TOTAL")) {
        tamboGroup.style.display = "none";
        atGroup.style.display    = "flex";
        container.classList.add("visible");
    } else {
        tamboGroup.style.display = "none";
        atGroup.style.display    = "none";
        container.classList.remove("visible");
    }
}

function debounce(fn, ms) {
    let t;
    return function(...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}
const _debouncedRenderMap = debounce(renderMap, 150);

function elegirTipo(tipo) {
    localStorage.setItem('geodor_tipo', tipo);
    const sel = document.getElementById("seleccionTipo");
    sel.style.display = "none";
    sel.style.pointerEvents = "none";
    document.getElementById("tipoFilter").value = tipo;
    document.getElementById("tipoFilterGroup").style.display = "none";
    repoblarSup();
    repoblarRC("ALL");
    repoblarPartner("ALL", "ALL");
    updateFilters();
}

// Ocultar pantalla y filtro tipo si ya hay tipo guardado
const _selTipo = document.getElementById("seleccionTipo");
if (localStorage.getItem('geodor_tipo')) {
    _selTipo.style.display = "none";
    _selTipo.style.pointerEvents = "none";
    document.getElementById("tipoFilterGroup").style.display = "none";
}

function updateFilters() {
    let rc      = document.getElementById("rcFilter").value;
    let sup     = document.getElementById("supFilter").value;
    let partner = document.getElementById("partnerFilter").value;
    let zona    = document.getElementById("zonaFilter").value;
    let btnRuta = document.getElementById("btnRuta");
    if (rc !== "ALL") {
        btnRuta.classList.add("activo");
    } else {
        btnRuta.classList.remove("activo");
        limpiarRuta();
    }
    _debouncedRenderMap(rc, document.getElementById("diaFilter").value, sup, partner, zona, document.getElementById("tipoFilter").value);
    if (sinVentaActive) renderSinVentaLayer();
    updateChips();
    saveFilters();
}

function updateChips() {
    const container = document.getElementById("filtro-chips");
    container.innerHTML = "";

    const defs = [
        {
            id: "supFilter", label: "Supervisor",
            clear: () => {
                document.getElementById("supFilter").value = "ALL";
                repoblarRC("ALL");
                repoblarPartner("ALL", document.getElementById("rcFilter").value);
                updateFilters();
            }
        },
        {
            id: "rcFilter", label: "RC",
            clear: () => {
                document.getElementById("rcFilter").value = "ALL";
                repoblarPartner(document.getElementById("supFilter").value, "ALL");
                updateFilters();
            }
        },
        {
            id: "diaFilter", label: "Día",
            clear: () => { document.getElementById("diaFilter").value = "ALL"; updateFilters(); }
        },
        {
            id: "zonaFilter", label: "Zona",
            clear: () => { document.getElementById("zonaFilter").value = "ALL"; updateFilters(); }
        },
        {
            id: "partnerFilter", label: "Partner",
            clear: () => { document.getElementById("partnerFilter").value = "ALL"; updateFilters(); }
        }
    ];

    defs.forEach(({ id, label, clear }) => {
        const sel = document.getElementById(id);
        if (!sel || sel.value === "ALL") return;
        const chip = document.createElement("div");
        chip.className = "chip";
        chip.innerHTML = `<span>${label}: ${sel.value}</span><button class="chip-x">✕</button>`;
        chip.querySelector(".chip-x").onclick = clear;
        container.appendChild(chip);
    });
}

function irAUbicacion() {
    if (!userLat || !userLng) {
        mostrarGPSBanner('prompt');
        startWatchPosition();
        return;
    }
    map.flyTo([userLat, userLng], 16, { duration: 1.2 });
    if (userMarker) userMarker.openPopup();
}

// 📍 GEOLOCALIZACIÓN
function startWatchPosition() {
    navigator.geolocation.watchPosition(pos => {
        userLat = pos.coords.latitude;
        userLng = pos.coords.longitude;
        ocultarGPSBanner();
        if (userMarker) {
            userMarker.setLatLng([userLat, userLng]);
        } else {
            userMarker = L.circleMarker([userLat, userLng], {
                radius: 10,
                fillColor: '#2196F3',
                color: 'white',
                weight: 3,
                fillOpacity: 1
            }).addTo(map).bindPopup("Estás aquí");
        }
    }, (err) => {
        if (err.code === 1) mostrarGPSBanner('denied');
    }, { enableHighAccuracy: true });
}

function mostrarGPSBanner(tipo) {
    const banner = document.getElementById('gpsBanner');
    const msg    = document.getElementById('gpsBannerMsg');
    const btn    = document.getElementById('gpsBannerBtn');
    if (tipo === 'denied') {
        banner.classList.add('denied');
        msg.textContent = '📍 Ubicación bloqueada. Ve a Configuración del navegador → Permisos del sitio → Ubicación → Permitir.';
        btn.textContent = '🔄 Reintentar';
        btn.onclick = () => startWatchPosition();
    } else {
        banner.classList.remove('denied');
        msg.textContent = '📍 Activa tu ubicación para registrar visitas y generar rutas.';
        btn.textContent = '📍 Activar GPS';
        btn.onclick = () => startWatchPosition();
    }
    banner.style.display = 'block';
    setTimeout(() => { if (tipo !== 'denied') ocultarGPSBanner(); }, 8000);
}

function ocultarGPSBanner() {
    document.getElementById('gpsBanner').style.display = 'none';
}

async function initGeolocation() {
    if (!navigator.geolocation) return;
    if (navigator.permissions) {
        try {
            const result = await navigator.permissions.query({ name: 'geolocation' });
            if (result.state === 'granted') {
                startWatchPosition();
            } else if (result.state === 'denied') {
                mostrarGPSBanner('denied');
            } else {
                mostrarGPSBanner('prompt');
                startWatchPosition();
            }
            result.onchange = () => {
                if (result.state === 'granted') { ocultarGPSBanner(); startWatchPosition(); }
                else if (result.state === 'denied') mostrarGPSBanner('denied');
            };
            return;
        } catch(e) {}
    }
    startWatchPosition();
}

initGeolocation();

// ─── API KEY GRATUITA ──────────────────────────────────────────────────────
// Regístrate gratis en https://openrouteservice.org/dev/#/signup
// Copia tu API key y pégala entre las comillas:
const ORS_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjZmZTFlYjBiMDM1YjQxMDRhOWJkNGFiNjM0MTg4ZmZhIiwiaCI6Im11cm11cjY0In0=';

// ── GOOGLE SHEET (reemplaza con tu URL de Apps Script desplegado) ──────────
const SHEET_URL = "https://script.google.com/macros/s/AKfycby2f2uW9E2_CUBr9OiKVT4Sp-ubP2sRIXlWig-GPuKTGyDxi-zx724ZGtkOFaWW0jnqjw/exec";
const SIN_VENTA_URL = "https://raw.githubusercontent.com/Leonardow33/MAPA_RC_INTERACTIVO/main/sinventa.txt";
const REUNION_PIN = "0810"; // ← cambia este código cada mes
// ─────────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────

const ORS_PROFILE = { driving: 'driving-car', foot: 'foot-walking' };

async function fetchChunk(pts, mode) {
    // Intento 1: OSRM
    try {
        let coordStr = pts.map(p => `${p.lng},${p.lat}`).join(';');
        let res = await fetch(`https://router.project-osrm.org/route/v1/${mode}/${coordStr}?overview=full&geometries=geojson`);
        if (res.ok) {
            let data = await res.json();
            if (data.code === 'Ok' && data.routes[0]) return data.routes[0].geometry;
        }
    } catch(e) { console.warn('OSRM error:', e.message); }

    // Intento 2: OpenRouteService (requiere ORS_KEY)
    if (ORS_KEY) {
        try {
            let profile = ORS_PROFILE[mode] || 'driving-car';
            let res = await fetch(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`, {
                method: 'POST',
                headers: { 'Authorization': ORS_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ coordinates: pts.map(p => [p.lng, p.lat]) })
            });
            if (res.ok) {
                let data = await res.json();
                if (data.features?.[0]) return data.features[0].geometry;
            }
        } catch(e) { console.warn('ORS error:', e.message); }
    }

    return null;
}

async function fetchRutaOSRM(waypoints, mode) {
    const CHUNK = 15;
    let allCoords = [];
    let algunPuntoOmitido = false;

    for (let i = 0; i < waypoints.length - 1; i += CHUNK - 1) {
        let slice = waypoints.slice(i, Math.min(i + CHUNK, waypoints.length));
        if (slice.length < 2) break;

        let geom = await fetchChunk(slice, mode);
        if (!geom) {
            // Sin cobertura: ignorar tramo, continuar sin línea recta
            algunPuntoOmitido = true;
            continue;
        }

        let coords = geom.coordinates;
        if (allCoords.length > 0) coords = coords.slice(1);
        allCoords = allCoords.concat(coords);
    }

    if (allCoords.length < 2) return null;
    return { type: 'LineString', coordinates: allCoords, parcial: algunPuntoOmitido };
}

// UTILIDADES DE RUTA
function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function nearestNeighborAlgo(startLat, startLng, puntos) {
    let remaining = [...puntos];
    let ordered = [];
    let curLat = startLat, curLng = startLng;
    while (remaining.length > 0) {
        let minDist = Infinity, minIdx = 0;
        remaining.forEach((p, i) => {
            let d = haversine(curLat, curLng, p.lat, p.lng);
            if (d < minDist) { minDist = d; minIdx = i; }
        });
        ordered.push(remaining[minIdx]);
        curLat = remaining[minIdx].lat;
        curLng = remaining[minIdx].lng;
        remaining.splice(minIdx, 1);
    }
    return ordered;
}

// 2-opt: elimina cruces mejorando el orden iterativamente
// pts[0] = ubicación del usuario (fijo), resto = tiendas
function twoOpt(pts) {
    let n = pts.length;
    let improved = true;
    let maxIter = 300;
    while (improved && maxIter-- > 0) {
        improved = false;
        for (let i = 0; i < n - 2; i++) {
            for (let j = i + 2; j < n; j++) {
                let d1 = haversine(pts[i].lat, pts[i].lng, pts[i+1].lat, pts[i+1].lng)
                       + (j+1 < n ? haversine(pts[j].lat, pts[j].lng, pts[j+1].lat, pts[j+1].lng) : 0);
                let d2 = haversine(pts[i].lat, pts[i].lng, pts[j].lat, pts[j].lng)
                       + (j+1 < n ? haversine(pts[i+1].lat, pts[i+1].lng, pts[j+1].lat, pts[j+1].lng) : 0);
                if (d2 < d1 - 1e-9) {
                    pts = [...pts.slice(0, i+1), ...pts.slice(i+1, j+1).reverse(), ...pts.slice(j+1)];
                    improved = true;
                }
            }
        }
    }
    return pts.slice(1); // devuelve sin el punto de inicio
}

// OSRM /trip: resuelve TSP + calcula ruta por calles en una sola llamada
async function fetchTripOSRM(allWaypoints, mode) {
    try {
        let coordStr = allWaypoints.map(p => `${p.lng},${p.lat}`).join(';');
        let res = await fetch(
            `https://router.project-osrm.org/trip/v1/${mode}/${coordStr}?source=first&roundtrip=false&geometries=geojson&overview=full`
        );
        if (!res.ok) { console.warn('OSRM trip HTTP:', res.status); return null; }
        let data = await res.json();
        if (data.code !== 'Ok' || !data.trips || !data.trips[0]) {
            console.warn('OSRM trip code:', data.code); return null;
        }
        // Reconstruir orden óptimo desde waypoint_index
        let ordered = data.waypoints
            .map((wp, i) => ({ wp, i }))
            .filter(x => x.i > 0)
            .sort((a, b) => a.wp.waypoint_index - b.wp.waypoint_index)
            .map(x => allWaypoints[x.i]);
        return { geom: data.trips[0].geometry, ordered };
    } catch(e) {
        console.warn('OSRM trip error:', e.message); return null;
    }
}

function dibujarMarcadoresYPanel(ordered, geom) {
    // Marcadores numerados
    ordered.forEach((p, i) => {
        let numIcon = L.divIcon({
            html: `<div style="background:#1565C0;color:white;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.45)">${i+1}</div>`,
            className: '', iconSize: [28, 28], iconAnchor: [14, 14]
        });
        L.marker([p.lat, p.lng], { icon: numIcon })
            .bindPopup(`<b>#${i+1} ${p.nombre}</b><br>ID: ${p.ID}<br>RC: ${p.rc}`)
            .addTo(routeMarkersLayer);
    });

    // Trazar ruta
    if (geom) {
        routeLayer = L.geoJSON(geom, { style: { color: '#1565C0', weight: 5, opacity: 0.9 } }).addTo(map);
    } else {
        let coords = [[userLat, userLng], ...ordered.map(p => [p.lat, p.lng])];
        routeLayer = L.polyline(coords, { color: '#1565C0', weight: 4, opacity: 0.8, dashArray: '10,6' }).addTo(map);
    }

    // Panel lateral
    let distTotal = 0, prevLat = userLat, prevLng = userLng;
    ordered.forEach(p => {
        distTotal += haversine(prevLat, prevLng, p.lat, p.lng);
        prevLat = p.lat; prevLng = p.lng;
    });

    let estado = !geom
        ? `<span style="color:#FF9800;font-weight:600">⚠️ Sin cobertura vial</span>`
        : geom.parcial
            ? `<span style="color:#FF9800;font-weight:600">⚠️ Algunos puntos omitidos por falta de cobertura</span>`
            : `<span style="color:#388E3C;font-weight:600">✅ Ruta optimizada por calles</span>`;

    let lista = document.getElementById("listaRuta");
    lista.innerHTML = `<div style="font-size:12px;color:#666;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #eee">
        <b>${ordered.length} paradas</b> · ~${distTotal.toFixed(1)} km<br>${estado}
    </div>`;

    ordered.forEach((p, i) => {
        let navUrl = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
        lista.innerHTML += `
            <div class="stop-item">
                <div style="display:flex;align-items:center">
                    <span class="stop-num">${i+1}</span>
                    <span style="font-weight:600">${p.nombre}</span>
                </div>
                <div style="font-size:11px;color:#888;margin-top:3px;margin-left:30px">${p.ID} · ${p.rc || ''}</div>
                <a class="stop-nav" href="${navUrl}" target="_blank" style="margin-left:30px">Navegar →</a>
            </div>`;
    });

    document.getElementById("panelRuta").style.display = "block";
    document.getElementById("btnLimpiarRuta").style.display = "inline-block";
    if (routeLayer) map.fitBounds(routeLayer.getBounds(), { padding: [30, 30] });
}

async function generarRuta() {
    if (!document.getElementById("btnRuta").classList.contains("activo")) return;
    if (!userLat || !userLng) {
        alert("Esperando señal GPS. Asegúrate de haber dado permiso de ubicación.");
        return;
    }
    if (currentFiltered.length === 0) {
        alert("No hay puntos visibles en el mapa.");
        return;
    }

    limpiarRuta();

    let btnRuta = document.getElementById("btnRuta");
    btnRuta.textContent = "⏳ Optimizando...";
    btnRuta.classList.remove("activo");

    try {
        // Paso 1: vecino más cercano + 2-opt (rápido, síncrono)
        let puntos = currentFiltered.slice(0, 99);
        let nnOrdered = nearestNeighborAlgo(userLat, userLng, puntos);
        let ordered = twoOpt([{ lat: userLat, lng: userLng }, ...nnOrdered]);

        // Paso 2: OSRM /trip — orden óptimo TSP + calles en una llamada
        let allWaypoints = [{ lat: userLat, lng: userLng }, ...puntos];
        let tripResult = await fetchTripOSRM(allWaypoints, routeMode);

        let geom = null;
        if (tripResult) {
            ordered = tripResult.ordered;
            geom = tripResult.geom;
        } else {
            // Paso 3: 2-opt como orden + /route con snap automático para zonas aisladas
            geom = await fetchRutaOSRM([{ lat: userLat, lng: userLng }, ...ordered], routeMode);
        }

        dibujarMarcadoresYPanel(ordered, geom);
    } catch(e) {
        console.error('Error generando ruta:', e);
        document.getElementById("listaRuta").innerHTML =
            `<div style="color:#c62828;padding:12px;font-size:13px">❌ Error inesperado al calcular la ruta.<br>Revisa la consola para más detalles.</div>`;
        document.getElementById("panelRuta").style.display = "block";
    } finally {
        btnRuta.textContent = "🗺️ Generar Ruta";
        btnRuta.classList.add("activo");
    }
}

function limpiarRuta() {
    if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
    routeMarkersLayer.clearLayers();
    document.getElementById("panelRuta").style.display = "none";
    document.getElementById("btnLimpiarRuta").style.display = "none";
}

// 🔍 BUSCADOR
const buscador = document.getElementById("buscador");
const resultadosDiv = document.getElementById("resultados");

buscador.addEventListener("input", function () {

    let texto = this.value.toLowerCase();
    resultadosDiv.innerHTML = "";

    if (texto.length < 2) {
        if (texto.length === 0) updateFilters();
        return;
    }

    let resultados = allData.filter(p =>
        (p.estado || "").toUpperCase() === "ACTIVO" &&
        (p.nombre.toLowerCase().includes(texto) ||
        p.ID.toString().includes(texto))
    ).slice(0, 10);

    resultados.forEach(p => {

        let item = document.createElement("div");
        item.className = "item-resultado";
        item.innerHTML = `<b>${p.nombre}</b><br>${p.ID}`;

        item.onclick = () => {

    resultadosDiv.innerHTML = "";
    buscador.value = p.nombre;

    // 🔥 filtrar SOLO esa tienda
    let resultadoUnico = [p];

    markersLayer.clearLayers();

    resultadoUnico.forEach(p => {

        let icon = makePinIcon(p.responsable, getEstadoPunto(p.ID));
        let marker = L.marker([p.lat, p.lng], { icon: icon });
        marker.bindPopup(buildPopupContent(p), { autoPan: false });
        attachPopupOpen(marker, p);
        marker.addTo(markersLayer);
        marker.openPopup();

        markersLayer.addLayer(marker);
    });

    map.setView([p.lat, p.lng], 16);
};

        resultadosDiv.appendChild(item);
    });
});

// ── REUNIÓN MENSUAL ────────────────────────────────────────────────────────
function abrirModalReunion() {
    const rc = document.getElementById("rcFilter").value;
    if (rc === "ALL") return;
    document.getElementById("modalRCNombre").textContent = "RC: " + rc;
    document.querySelectorAll(".pin-digit").forEach(el => { el.value = ""; el.style.borderColor = "#ccc"; });
    document.getElementById("pinError").textContent = "";
    document.getElementById("modalReunion").classList.add("visible");
    document.querySelectorAll(".pin-digit")[0].focus();
}

function cerrarModalReunion() {
    document.getElementById("modalReunion").classList.remove("visible");
}

function validarPinReunion() {
    const digits = [...document.querySelectorAll(".pin-digit")].map(el => el.value.trim());
    const pin = digits.join("");
    if (pin.length < 4) {
        document.getElementById("pinError").textContent = "Ingresá los 4 dígitos";
        return;
    }
    if (pin !== REUNION_PIN) {
        document.getElementById("pinError").textContent = "PIN incorrecto";
        document.querySelectorAll(".pin-digit").forEach(el => el.style.borderColor = "#e53935");
        return;
    }
    const rc   = document.getElementById("rcFilter").value;
    const hora = new Date().toTimeString().slice(0, 5);
    const fecha = new Date().toLocaleDateString("es-PE");
    const btn  = document.getElementById("btnPinConfirm");
    btn.textContent = "⏳ Registrando...";
    btn.disabled = true;
    const params = new URLSearchParams({
        hoja: "Reunion",
        tipo: "reunion_mensual",
        rc, fecha, hora,
        latRC: userLat  || "",
        lngRC: userLng  || ""
    });
    fetch(SHEET_URL + "?" + params.toString(), { mode: "no-cors" })
        .finally(() => {
            cerrarModalReunion();
            btn.textContent = "✔ Confirmar";
            btn.disabled = false;
            alert(`✅ Reunión registrada\nRC: ${rc}\n${fecha} · ${hora}`);
        });
}

// avance automático entre cajas del PIN
document.querySelectorAll(".pin-digit").forEach((el, i, all) => {
    el.addEventListener("input", function() {
        this.value = this.value.slice(-1);
        if (this.value && i < all.length - 1) all[i + 1].focus();
    });
    el.addEventListener("keydown", function(e) {
        if (e.key === "Backspace" && !this.value && i > 0) all[i - 1].focus();
        if (e.key === "Enter") validarPinReunion();
    });
});

// cerrar modal al tocar fuera
document.getElementById("modalReunion").addEventListener("click", function(e) {
    if (e.target === this) cerrarModalReunion();
});

// === SIN VENTA LAYER ===
let sinVentaCodes = new Set();
let sinVentaActive = false;
let sinVentaTimes = {};
let svTimestamp = '';
const sinVentaLayer = L.layerGroup().addTo(map);

function fetchSinVenta() {
    return fetch(SIN_VENTA_URL + '?t=' + Date.now(), { cache: 'no-store' })
        .then(r => r.text())
        .then(text => {
            // Formato: "2026-05-20 10:27|{[C]:"122",[U]:"10:08:58"}[C]{...}"
            const pipeIdx = text.indexOf('|');
            svTimestamp   = pipeIdx >= 0 ? text.slice(0, pipeIdx).trim() : '';
            const records = pipeIdx >= 0 ? text.slice(pipeIdx + 1) : text;

            sinVentaCodes = new Set();
            sinVentaTimes = {};
            (records.match(/\{[^}]+\}/g) || []).forEach(m => {
                try {
                    const r    = JSON.parse(m);
                    const code = String(r['[C]'] || '').trim();
                    if (code) {
                        sinVentaCodes.add(code);
                        sinVentaTimes[code] = String(r['[U]'] || '').trim();
                    }
                } catch(e) {}
            });

            const tsEl = document.getElementById("sinVentaTs");
            if (tsEl) tsEl.textContent = (svTimestamp.slice(11) || svTimestamp) + ` (${sinVentaCodes.size} cód.)`;

            if (sinVentaActive) renderSinVentaLayer();
            console.log(`SinVenta: ${sinVentaCodes.size} tiendas | ${svTimestamp}`);
        })
        .catch(e => console.warn('SinVenta error:', e));
}

function renderSinVentaLayer() {
    sinVentaLayer.clearLayers();
    if (!sinVentaActive || sinVentaCodes.size === 0) return;
    const rc      = document.getElementById("rcFilter").value;
    const sup     = document.getElementById("supFilter").value;
    const partner = document.getElementById("partnerFilter").value;
    const zona    = document.getElementById("zonaFilter").value;
    let count = 0;
    allData.forEach(p => {
        if (!sinVentaCodes.has(String(p.ID))) return;
        if (!p.lat || !p.lng) return;
        if ((p.estado || '').toUpperCase() !== 'ACTIVO') return;
        if (sup     !== 'ALL' && p.supervisor !== sup)    return;
        if (rc      !== 'ALL' && p.rc         !== rc)     return;
        if (partner !== 'ALL' && p.responsable !== partner) return;
        if (zona    !== 'ALL' && p.zona        !== zona)  return;
        const hora = sinVentaTimes[String(p.ID)] || '-';
        L.circleMarker([p.lat, p.lng], {
            radius: 7,
            color: '#e53935',
            weight: 2,
            fill: false,
            opacity: 0.85,
            interactive: true
        }).bindPopup(`
            <div style="font-family:sans-serif;min-width:200px">
                <div style="background:#e53935;padding:8px 12px;border-radius:8px 8px 0 0">
                    <span style="color:white;font-weight:700;font-size:14px">⚠️ SIN VENTA HOY</span>
                </div>
                <div style="padding:8px 12px;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px">
                    <b>${p.nombre}</b><br>
                    <span style="color:#888;font-size:12px">Código: ${p.ID}</span><br>
                    <span style="color:#888;font-size:12px">Partner: ${p.responsable || '-'}</span><br>
                    <span style="font-size:11px;color:#aaa">🕐 Últ. dato BI: ${hora}</span><br>
                    <span style="font-size:11px;color:#aaa">📅 Flujo: ${svTimestamp}</span>
                </div>
            </div>`)
            .addTo(sinVentaLayer);
        count++;
    });
    const countEl = document.getElementById("sinVentaCount");
    if (countEl) countEl.textContent = count;
}

function toggleSinVenta() {
    sinVentaActive = !sinVentaActive;
    document.getElementById("btnSinVenta").classList.toggle("activo", sinVentaActive);
    document.getElementById("sinVentaBar").classList.toggle("visible", sinVentaActive);
    if (sinVentaActive) {
        if (sinVentaCodes.size === 0) fetchSinVenta(); else renderSinVentaLayer();
    } else {
        sinVentaLayer.clearLayers();
    }
}

function initSinVenta() {
    const peruHour = () => (new Date().getUTCHours() - 5 + 24) % 24;
    const btn = document.getElementById("btnSinVenta");
    const h = peruHour();

    // ── [DESACTIVADO] Bloquear botón antes de las 14:00 ──
    // if (h < 14) {
    //     btn.disabled = true;
    //     const now = new Date();
    //     const msUntil14 = ((14 - h) * 60 - now.getUTCMinutes()) * 60000 - now.getUTCSeconds() * 1000;
    //     setTimeout(() => { btn.disabled = false; fetchSinVenta(); }, Math.max(0, msUntil14));
    // } else {
    //     fetchSinVenta();
    // }
    fetchSinVenta();

    // Actualizar cada 15 min
    setInterval(fetchSinVenta, 15 * 60 * 1000);

    // ── [DESACTIVADO] Auto-activación a las 15:00 ──
    // if (h < 15) {
    //     const now = new Date();
    //     const msUntil15 = ((15 - h) * 60 - now.getUTCMinutes()) * 60000 - now.getUTCSeconds() * 1000;
    //     setTimeout(() => {
    //         fetchSinVenta().then(() => {
    //             if (!sinVentaActive && sinVentaCodes.size > 0) toggleSinVenta();
    //         });
    //     }, Math.max(0, msUntil15));
    // }
}

initSinVenta();
// ──────────────────────────────────────────────────────────────────────────

// activar/desactivar botón según RC seleccionado
function actualizarBtnReunion() {
    const btn = document.getElementById("btnReunion");
    const rc  = document.getElementById("rcFilter").value;
    if (rc !== "ALL") {
        btn.classList.add("activo");
        btn.disabled = false;
    } else {
        btn.classList.remove("activo");
        btn.disabled = true;
    }
}
document.getElementById("rcFilter").addEventListener("change", actualizarBtnReunion);
// ──────────────────────────────────────────────────────────────────────────

// === WIDGET PARTIDOS IMPORTANTES ==========================================
const PARTIDOS_URL = 'https://raw.githubusercontent.com/Leonardow33/CALENDARIO-INTERACTIVO-PARTIDOS/main/partidos.json';
const LIGA_COLOR = {
    'Mundial 2026':     '#C8A000',
    'Amistosos':        '#7B5EA7',
    'Roland Garros':    '#C8471B',
    'Wimbledon':        '#006633',
    'US Open':          '#003087',
    'Australian Open':  '#0072CE',
    'Liga 1 Perú':      '#D4001A',
    'Libertadores':     '#1A3A6B',
    'Sudamericana':     '#0D7A4E',
    'Champions League': '#001E62',
    'Europa League':    '#FF6600',
    'Premier League':   '#3D195B'
};

const FUTBOL_LIGAS = new Set([
    'Mundial 2026','Amistosos','Liga 1 Perú','Liga 1 Peru',
    'Libertadores','Sudamericana','Champions League',
    'Europa League','Premier League'
]);

let partidosLoaded = false;
let ppTabActual = 'futbol';
let ppAllMatchesRaw = [];

function setPPTab(tab) {
    ppTabActual = tab;
    document.getElementById('ppTabFutbol').classList.toggle('active', tab === 'futbol');
    document.getElementById('ppTabTenis').classList.toggle('active', tab === 'tenis');
    const filtered = ppAllMatchesRaw.filter(m =>
        tab === 'futbol' ? FUTBOL_LIGAS.has(m.liga) : !FUTBOL_LIGAS.has(m.liga)
    );
    buildPPDrum(filtered);
}

function getWeekRange() {
    const today = new Date(); today.setHours(0,0,0,0);
    const dow = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23,59,59,999);
    return { start: monday, end: sunday };
}

function parseMatchDay(dayStr) {
    const months = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
    const [d, m] = dayStr.trim().split(' ');
    return new Date(new Date().getFullYear(), months[m], parseInt(d));
}

function formatDayLabel(dayStr) {
    const labels = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    const d = parseMatchDay(dayStr);
    return `${labels[d.getDay()]} ${dayStr}`;
}

// === PP DRUM PICKER (horizontal) ===
const PP_DRUM_STEP = 26;
const PP_DRUM_R    = 130;
const PP_DAYS_ES   = ['DOM','LUN','MAR','MIÉ','JUE','VIE','SÁB'];
const PP_MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

let ppDrumIdx      = 0;
let ppDrumDragging = false;
let ppDrumStartX   = 0;
let ppDrumRawIdx   = 0;
let ppDrumDays     = [];
let ppAllMatches   = [];

function ppDayLabel(d) { return `${d.getDate()} ${PP_MONTHS_ES[d.getMonth()]}`; }

function ppGetWeekDays() {
    const today = new Date(); today.setHours(0,0,0,0);
    const dow = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
    return Array.from({length:7}, (_,i) => { const d = new Date(monday); d.setDate(monday.getDate()+i); return d; });
}

function ppApplyDrumTransform(idx) {
    const t = document.getElementById('ppDrumTrack');
    if (t) t.style.transform = `rotateY(${-idx * PP_DRUM_STEP}deg)`;
}

function ppUpdateDrumStyles(currentIdx) {
    document.querySelectorAll('.pp-drum-item').forEach((el, i) => {
        const diff = Math.abs(i - currentIdx);
        const isActive = diff < 0.5;
        el.querySelector('.pp-drum-dday').style.color    = isActive ? '#1A3A6B' : diff < 1.5 ? '#333' : '#ccc';
        el.querySelector('.pp-drum-dday').style.fontSize = isActive ? '15px' : diff < 1.5 ? '12px' : '10px';
        el.querySelector('.pp-drum-ddate').style.opacity = diff < 2 ? '1' : '0.25';
    });
}

function ppSetDrumDay(idx) {
    ppDrumIdx = Math.max(0, Math.min(ppDrumDays.length - 1, Math.round(idx)));
    document.getElementById('ppDrumTrack').style.transition = 'transform 0.35s cubic-bezier(.25,.46,.45,.94)';
    ppApplyDrumTransform(ppDrumIdx);
    ppUpdateDrumStyles(ppDrumIdx);
    ppRenderDayMatches(ppDrumIdx);
}

function ppRenderDayMatches(idx) {
    const body    = document.getElementById('ppBody');
    const day     = ppDrumDays[idx];
    const dateStr = ppDayLabel(day);
    const matches = ppAllMatches.filter(m => m.day === dateStr)
                                .sort((a,b) => a.time.localeCompare(b.time));
    body.style.transition = 'none';
    body.style.opacity    = '0';
    body.style.transform  = 'translateY(6px)';
    setTimeout(() => {
        const _now = new Date();
        const _todayMid = new Date(); _todayMid.setHours(0,0,0,0);
        const isToday = day.getTime() === _todayMid.getTime();
        body.innerHTML = matches.length
            ? matches.map(m => {
                const color = LIGA_COLOR[m.liga] || '#888';
                const star  = m.importante ? ' ⭐' : '';
                let finHtml = '';
                if (isToday) {
                    const [timePart, ampm] = m.time.split(' ');
                    const [hh, mm] = timePart.split(':').map(Number);
                    let h = hh + (ampm === 'PM' && hh !== 12 ? 12 : 0) + (ampm === 'AM' && hh === 12 ? -12 : 0);
                    const matchDate = new Date(_todayMid); matchDate.setHours(h, mm, 0, 0);
                    matchDate.setMinutes(matchDate.getMinutes() + 120); // partido ~2h
                    if (_now > matchDate) finHtml = '<span class="pp-fin">FIN</span>';
                }
                return `<div class="pp-match">
                    <div class="pp-bar" style="background:${color}"></div>
                    <div class="pp-info">
                        <div class="pp-teams">${m.home}<span class="pp-vs">vs</span>${m.away}${star}</div>
                        <div class="pp-meta"><span class="pp-time">${m.time}</span><span class="pp-liga">${m.liga}</span>${finHtml}</div>
                    </div>
                </div>`;
              }).join('')
            : '<div class="pp-empty">Sin partidos este día 🏖️</div>';
        body.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        body.style.opacity    = '1';
        body.style.transform  = 'translateY(0)';
    }, 140);
}

function buildPPDrum(allMatches) {
    ppDrumDays   = ppGetWeekDays();
    ppAllMatches = allMatches;
    const track  = document.getElementById('ppDrumTrack');
    if (!track) return;
    track.innerHTML = '';
    const today = new Date(); today.setHours(0,0,0,0);
    ppDrumDays   = ppDrumDays.filter(d => d >= today);
    ppDrumDays.forEach((day, i) => {
        const el = document.createElement('div');
        el.className = 'pp-drum-item';
        el.style.transform = `rotateY(${i * PP_DRUM_STEP}deg) translateZ(${PP_DRUM_R}px)`;
        el.innerHTML = `<span class="pp-drum-dday">${PP_DAYS_ES[day.getDay()]}</span><span class="pp-drum-ddate">${ppDayLabel(day)}</span>`;
        track.appendChild(el);
    });
    ppDrumIdx    = 0;
    ppDrumRawIdx = ppDrumIdx;
    track.style.transition = 'none';
    ppApplyDrumTransform(ppDrumIdx);
    ppUpdateDrumStyles(ppDrumIdx);
    ppRenderDayMatches(ppDrumIdx);

    const vp = document.getElementById('ppDrumVP');
    if (vp._bound) return;
    vp._bound = true;

    vp.addEventListener('touchstart', e => {
        ppDrumDragging = true;
        ppDrumStartX   = e.touches[0].clientX;
        ppDrumRawIdx   = ppDrumIdx;
        document.getElementById('ppDrumTrack').style.transition = 'none';
    }, { passive: true });
    vp.addEventListener('touchmove', e => {
        if (!ppDrumDragging) return;
        const clamped = Math.max(0, Math.min(ppDrumDays.length - 1, ppDrumRawIdx + (ppDrumStartX - e.touches[0].clientX) / 55));
        ppApplyDrumTransform(clamped);
        ppUpdateDrumStyles(clamped);
    }, { passive: true });
    vp.addEventListener('touchend', e => {
        if (!ppDrumDragging) return;
        ppDrumDragging = false;
        ppSetDrumDay(Math.round(Math.max(0, Math.min(ppDrumDays.length - 1, ppDrumRawIdx + (ppDrumStartX - e.changedTouches[0].clientX) / 55))));
    }, { passive: true });
    vp.addEventListener('mousedown', e => {
        ppDrumDragging = true; ppDrumStartX = e.clientX; ppDrumRawIdx = ppDrumIdx;
        document.getElementById('ppDrumTrack').style.transition = 'none';
    });
    document.addEventListener('mousemove', e => {
        if (!ppDrumDragging) return;
        const clamped = Math.max(0, Math.min(ppDrumDays.length - 1, ppDrumRawIdx + (ppDrumStartX - e.clientX) / 55));
        ppApplyDrumTransform(clamped); ppUpdateDrumStyles(clamped);
    });
    document.addEventListener('mouseup', e => {
        if (!ppDrumDragging) return;
        ppDrumDragging = false;
        ppSetDrumDay(Math.round(Math.max(0, Math.min(ppDrumDays.length - 1, ppDrumRawIdx + (ppDrumStartX - e.clientX) / 55))));
    });
}

async function loadPartidos() {
    const body = document.getElementById('ppBody');
    try {
        const res   = await fetch(PARTIDOS_URL + '?v=' + Date.now());
        const json  = await res.json();
        const today = new Date(); today.setHours(0,0,0,0);
        const { end } = getWeekRange();
        ppAllMatchesRaw = (json.matches || []).filter(m => {
            const d = parseMatchDay(m.day);
            return d >= today && d <= end;
        });
        if (!ppAllMatchesRaw.length) {
            body.innerHTML = '<div class="pp-empty">No hay más partidos esta semana.</div>';
            return;
        }
        const imp = ppAllMatchesRaw.filter(m => m.importante).length;
        const badge = document.getElementById('badgePartidos');
        badge.textContent = imp || '';
        badge.style.display = imp ? 'block' : 'none';
        partidosLoaded = true;
        setPPTab(ppTabActual);
    } catch(e) {
        body.innerHTML = '<div class="pp-empty">No se pudieron cargar los partidos.</div>';
    }
}

function togglePanelPartidos() {
    const panel = document.getElementById('panelPartidos');
    const visible = panel.classList.toggle('visible');
    if (visible) loadPartidos();
}

// Pre-cargar en background para mostrar el badge sin que el usuario abra el panel
loadPartidos();
// =========================================================================

// ── AUTO-REFRESH cuando cambia version.json ────────────────────────────────
(function() {
    const VERSION_URL = (_BASE_DATA + 'version.json');
    let _vActual = null;
    fetch(VERSION_URL).then(r => r.json()).then(d => { _vActual = d.v; }).catch(() => {});
    setInterval(function() {
        fetch(VERSION_URL + '?t=' + Date.now())
            .then(r => r.json())
            .then(d => {
                if (_vActual && d.v !== _vActual) {
                    _vActual = d.v;
                    fetch((_BASE_DATA + 'puntos.json?v=') + Date.now(), {cache: 'no-store'})
                        .then(r => r.json())
                        .then(data => {
                            allData = data;
                            updateFilters();
                            console.log('Datos actualizados automaticamente:', d.v);
                        }).catch(() => {});
                }
            }).catch(() => {});
    }, 5 * 60 * 1000);
})();
// ──────────────────────────────────────────────────────────────────────────
