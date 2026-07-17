const _BASE_DATA = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'data/' : 'https://raw.githubusercontent.com/Leonardow33/MAPA_RC_INTERACTIVO/main/data/';
var map = L.map('map', { preferCanvas: true }).setView([-9.19, -75.02], 6);

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

function normalizePuntos(data) {
    const toNum = v => {
        if (v === null || v === undefined || v === '') return null;
        if (typeof v === 'number') return isNaN(v) ? null : v;
        const n = parseFloat(String(v));
        return isNaN(n) ? null : n;
    };
    return data.map(p => {
        let dias = p.dias;
        if (!Array.isArray(dias)) {
            const s = typeof dias === 'string' ? dias.trim() : '';
            if (!s) { dias = ['SIN RUTA']; }
            else {
                try { dias = JSON.parse(s); } catch(e) {
                    dias = s.split(',').map(x => x.trim()).filter(Boolean);
                }
                if (!Array.isArray(dias)) dias = [String(dias)];
            }
        }
        return { ...p,
            lat: typeof p.lat === 'string' ? parseFloat(p.lat) : p.lat,
            lng: typeof p.lng === 'string' ? parseFloat(p.lng) : p.lng,
            dias,
            meta_diaria:  toNum(p.meta_diaria),
            meta_pp:      toNum(p.meta_pp),
            meta_ppgo:    toNum(p.meta_ppgo),
            meta_lakidey: toNum(p.meta_lakidey),
            meta_sc_e3:   toNum(p.meta_sc_e3),
            meta_turbito: toNum(p.meta_turbito) };
    });
}

let currentFiltered = [];
let userLat = null, userLng = null;
let userMarker = null;
let geoWatchId = null;
let accuracyCircle = null;
let routeLayer = null;
let routeMarkersLayer = L.layerGroup().addTo(map);
let markersLayer = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 45 }).addTo(map);
let elotLayer  = L.layerGroup().addTo(map);
let elotMarker = null;
let routeMode = 'driving'; // 'driving' | 'foot'

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
    "APUESTA TOTAL": "#E53935",
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
        color     = "#9E9E9E";
        extraStyle = "opacity:0.45;";
        imgStyle  += "filter:grayscale(1);";
    } else if (estado === "en_visita") {
        color = "#FF9800";
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

function repoblarNombre(rol) {
    const sel = document.getElementById("nombreFilter");
    const prev = sel.value;
    sel.innerHTML = '<option value="ALL">Todos</option>';
    const campo = rol === "capacitador" ? "capacitador" : "supervisor";
    const nombres = new Set(allData.map(p => p[campo]).filter(v => v && v !== ""));
    sortedLast([...nombres], ["SIN SUPERVISOR", "SIN CAPACITADOR"]).forEach(n => {
        const opt = document.createElement("option");
        opt.value = n; opt.text = n;
        sel.appendChild(opt);
    });
    sel.value = [...sel.options].some(o => o.value === prev) ? prev : "ALL";
}

function repoblarPartner(nombre, rol) {
    const sel = document.getElementById("partnerFilter");
    const prev = sel.value;
    sel.innerHTML = '<option value="ALL">Todos</option>';
    let base = allData;
    if (nombre !== "ALL") {
        const campo = rol === "capacitador" ? "capacitador" : "supervisor";
        base = allData.filter(p => p[campo] === nombre);
    }
    const partners = [...new Set(base.map(p => p.responsable).filter(Boolean))].sort();
    partners.forEach(v => {
        const o = document.createElement("option");
        o.value = v; o.text = v;
        sel.appendChild(o);
    });
    sel.value = [...sel.options].some(o => o.value === prev) ? prev : "ALL";
}

// FETCH
fetch((_BASE_DATA + 'puntos.json?v=') + new Date().getTime(), {cache: 'no-store'})
.then(res => res.json())
.then(data => {

    allData = normalizePuntos(data);

    // PIN ESPECIAL ELOT (nunca se agrupa)
    const elotPoint = data.find(p => (p.nombre || "").toUpperCase().includes("OFICINA ELOT"));
    if (elotPoint && !elotMarker) {
        elotMarker = L.marker([elotPoint.lat, elotPoint.lng], { icon: makeElotIcon(), zIndexOffset: 1000 });
        elotMarker.bindPopup(buildPopupContent(elotPoint));
        attachPopupOpen(elotMarker, elotPoint);
        elotMarker.on('click', function() {
            map.flyTo([elotPoint.lat, elotPoint.lng], map.getMaxZoom(), { duration: 1.4 });
        });
        elotLayer.addLayer(elotMarker);
    }

    repoblarPartner("ALL", "capacitador");

    repoblarNombre("capacitador");
    document.getElementById("zonaWrap").style.display = "inline-flex";
    restoreFilters();
    updateFilters();
});

// ── ESTADO DE VISITAS (localStorage por día) ──────────────────────────────
function getTodayKey() {
    return "visitas_supycap_" + new Date().toISOString().slice(0, 10);
}
function getVisitasHoy() {
    return JSON.parse(localStorage.getItem(getTodayKey()) || "{}");
}
function getEstadoPunto(id) {
    const v = getVisitasHoy()[String(id)];
    if (!v)       return "libre";
    if (v.salida) return "completado";
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
    const rolActivo    = document.getElementById("rolFilter").value;
    const nombreActivo = document.getElementById("nombreFilter").value;
    const params = new URLSearchParams({
        hoja: SHEET_HOJA, tipo,
        tienda: p.nombre, id: p.ID,
        rol:    rolActivo,
        nombre: nombreActivo !== "ALL" ? nombreActivo : "",
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
                    msg.style.color   = "#388E3C";
                    const _dk = getTodayKey().replace('visitas_mapa_','').split('-'); msg.textContent = `✅ Visita completa · ${_dk[2]}/${_dk[1]} · E: ${v.entrada} · S: ${v.salida}`;
                }
            } else {
                const v = getVisitasHoy()[String(p.ID)];
                if (btn) {
                    btn.textContent      = "🔴 Registrar Salida";
                    btn.style.background = "#E65100";
                    btn.disabled         = false;
                    btn.onclick = () => registrarMovimiento(p, "salida", marker);
                }
                if (msg) {
                    msg.style.display = "block";
                    msg.style.color   = "#E65100";
                    msg.textContent   = `🟡 En visita · Entrada: ${v.entrada}`;
                }
            }
        })
        .catch(() => {
            if (btn) { btn.textContent = "❌ Error - reintentar"; btn.style.background = "#e53935"; btn.disabled = false; }
        });
}

function buildPopupContent(p) {
    const safeId  = String(p.ID).replace(/[^a-zA-Z0-9_-]/g, "_");
    const isElot  = (p.nombre || "").toUpperCase().includes("OFICINA ELOT");
    const color   = isElot ? "#B8860B" : getPinBorder(p.responsable);
    return `
    <div class="popup-card">
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
        <div class="popup-row"><span class="popup-lbl">Capacitador</span><span class="popup-val">${p.capacitador || "-"}</span></div>
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
                svBi.textContent    = "BI: " + (sinVentaTimes[String(p.ID)] || '-');
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
            const _dk = getTodayKey().replace('visitas_mapa_','').split('-'); msg.textContent = `✅ Visita completa · ${_dk[2]}/${_dk[1]} · E: ${v.entrada} · S: ${v.salida}`;
            return;
        }
        const nombreSel = document.getElementById("nombreFilter").value;
        if (nombreSel === "ALL") {
            btn.style.display = "none";
            msg.style.display = "block";
            msg.style.color   = "#E65100";
            msg.textContent   = "⚠️ Selecciona tu nombre para registrar";
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
            btn.textContent      = "🟢 Registrar Entrada";
            btn.style.background = "#1565C0";
            btn.disabled         = false;
            msg.textContent      = "";
            btn.onclick = () => registrarMovimiento(p, "entrada", marker);
        } else {
            btn.textContent      = "🔴 Registrar Salida";
            btn.style.background = "#E65100";
            btn.disabled         = false;
            msg.style.color      = "#E65100";
            msg.textContent      = `🟡 En visita · Entrada: ${v.entrada}`;
            btn.onclick = () => registrarMovimiento(p, "salida", marker);
        }
    });
}

function renderMap(filterNombre, filterDia, filterRol, filterPartner, filterZona) {
    markersLayer.clearLayers();
    let filtered = allData.filter(p =>
        !(p.nombre || "").toUpperCase().includes("OFICINA ELOT") &&
        (p.estado || "").toUpperCase() !== "CERRADO" &&
        (filterRol !== "supervisor"   || filterNombre === "ALL" || p.supervisor  === filterNombre) &&
        (filterRol !== "capacitador"  || filterNombre === "ALL" || filterZona !== "su_zona" || p.capacitador === filterNombre) &&
        (filterDia === "ALL" || (p.dias && p.dias.includes(filterDia))) &&
        (filterPartner === "ALL" || !filterPartner || p.responsable === filterPartner)
    );
    currentFiltered = filtered;

    let group = new L.featureGroup();
    filtered.forEach(p => {
        let marker = L.marker([p.lat, p.lng], { icon: makePinIcon(p.responsable, getEstadoPunto(p.ID)) });
        marker.bindPopup(buildPopupContent(p));
        attachPopupOpen(marker, p);
        markersLayer.addLayer(marker);
        group.addLayer(marker);
    });

    if (filtered.length > 0 && filterNombre !== "ALL") {
        map.fitBounds(group.getBounds());
    }
}

// PERSISTENCIA DE FILTROS
function saveFilters() {
    localStorage.setItem("filtros_supycap", JSON.stringify({
        rol:      document.getElementById("rolFilter").value,
        nombre:   document.getElementById("nombreFilter").value,
        zona:     document.getElementById("zonaFilter").value,
        partner:  document.getElementById("partnerFilter").value
    }));
}

function restoreFilters() {
    const saved = JSON.parse(localStorage.getItem("filtros_supycap") || "{}");
    if (!saved.rol) return;

    const rol = saved.rol;
    document.getElementById("rolFilter").value = rol;
    repoblarNombre(rol);
    document.getElementById("zonaWrap").style.display = rol === "capacitador" ? "inline-flex" : "none";

    const nombreSel = document.getElementById("nombreFilter");
    if (saved.nombre && [...nombreSel.options].some(o => o.value === saved.nombre))
        nombreSel.value = saved.nombre;

    repoblarPartner(nombreSel.value, rol);

    if (saved.zona)
        document.getElementById("zonaFilter").value = saved.zona;

    const partnerSel = document.getElementById("partnerFilter");
    if (saved.partner && [...partnerSel.options].some(o => o.value === saved.partner))
        partnerSel.value = saved.partner;

}

// FILTROS
document.getElementById("rolFilter").addEventListener("change", function() {
    repoblarNombre(this.value);
    repoblarPartner("ALL", this.value);
    document.getElementById("zonaWrap").style.display = this.value === "capacitador" ? "inline-flex" : "none";
    document.getElementById("zonaFilter").value = "otra_zona";
    updateFilters();
});
document.getElementById("nombreFilter").addEventListener("change", function() {
    const rol = document.getElementById("rolFilter").value;
    repoblarPartner(this.value, rol);
    if (this.value !== "ALL" && rol === "capacitador") {
        document.getElementById("zonaFilter").value = "su_zona";
    }
    updateFilters();
});
document.getElementById("partnerFilter").addEventListener("change", updateFilters);
document.getElementById("zonaFilter").addEventListener("change", updateFilters);

function debounce(fn, ms) {
    let t;
    return function(...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}
const _debouncedRenderMap = debounce(renderMap, 150);

function updateFilters() {
    const nombre  = document.getElementById("nombreFilter").value;
    const rol     = document.getElementById("rolFilter").value;
    const partner = document.getElementById("partnerFilter").value;
    const zona    = document.getElementById("zonaFilter").value;
    const btnRuta = document.getElementById("btnRuta");
    if (nombre !== "ALL") {
        btnRuta.classList.add("activo");
    } else {
        btnRuta.classList.remove("activo");
        limpiarRuta();
    }
    _debouncedRenderMap(nombre, "ALL", rol, partner, zona);
    if (sinVentaActive) renderSinVentaLayer();
    updateChips();
    saveFilters();
}

function updateChips() {
    const container = document.getElementById("filtro-chips");
    container.innerHTML = "";

    const nombre  = document.getElementById("nombreFilter").value;
    const partner = document.getElementById("partnerFilter").value;
    const zona    = document.getElementById("zonaFilter").value;
    const rol     = document.getElementById("rolFilter").value;

    function makeChip(label, value, onClear) {
        const chip = document.createElement("div");
        chip.className = "chip";
        chip.innerHTML = `<span>${label}: ${value}</span><button class="chip-x">✕</button>`;
        chip.querySelector(".chip-x").onclick = onClear;
        container.appendChild(chip);
    }

    if (nombre !== "ALL") {
        const labelRol = rol === "capacitador" ? "Capacitador" : "Supervisor";
        makeChip(labelRol, nombre, () => {
            document.getElementById("nombreFilter").value = "ALL";
            updateFilters();
        });
    }
    if (zona === "su_zona") {
        makeChip("Zona", "Su zona", () => {
            document.getElementById("zonaFilter").value = "otra_zona";
            updateFilters();
        });
    }
    if (partner !== "ALL") {
        makeChip("Partner", partner, () => {
            document.getElementById("partnerFilter").value = "ALL";
            updateFilters();
        });
    }
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
    if (geoWatchId !== null) {
        navigator.geolocation.clearWatch(geoWatchId);
        geoWatchId = null;
    }
    geoWatchId = navigator.geolocation.watchPosition(pos => {
        userLat = pos.coords.latitude;
        userLng = pos.coords.longitude;
        const acc = Math.round(pos.coords.accuracy);
        ocultarGPSBanner();
        if (userMarker) {
            userMarker.setLatLng([userLat, userLng]);
            userMarker.setPopupContent(`Estás aquí (±${acc}m)`);
        } else {
            userMarker = L.circleMarker([userLat, userLng], {
                radius: 10,
                fillColor: '#2196F3',
                color: 'white',
                weight: 3,
                fillOpacity: 1
            }).addTo(map).bindPopup(`Estás aquí (±${acc}m)`);
        }
        if (accuracyCircle) {
            accuracyCircle.setLatLng([userLat, userLng]).setRadius(pos.coords.accuracy);
        } else {
            accuracyCircle = L.circle([userLat, userLng], {
                radius: pos.coords.accuracy,
                color: '#2196F3',
                fillColor: '#2196F3',
                fillOpacity: 0.08,
                weight: 1
            }).addTo(map);
        }
    }, (err) => {
        if (err.code === 1) {
            mostrarGPSBanner('denied');
        } else if (err.code === 2 || err.code === 3) {
            mostrarGPSBanner('prompt');
        }
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
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
            result.addEventListener('change', () => {
                if (result.state === 'granted') { ocultarGPSBanner(); startWatchPosition(); }
                else if (result.state === 'denied') mostrarGPSBanner('denied');
            });
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

// ── SIN VENTA ─────────────────────────────────────────────────────────────
const SIN_VENTA_URL = "https://raw.githubusercontent.com/Leonardow33/MAPA_RC_INTERACTIVO/main/sinventa.txt";
let sinVentaCodes  = new Set();
let sinVentaTimes  = {};
let sinVentaActive = false;
let svTimestamp    = '';
const sinVentaLayer = L.layerGroup().addTo(map);

function fetchSinVenta() {
    return fetch(SIN_VENTA_URL + '?t=' + Date.now(), { cache: 'no-store' })
        .then(r => r.text())
        .then(text => {
            const pipeIdx = text.indexOf('|');
            svTimestamp = pipeIdx >= 0 ? text.slice(0, pipeIdx).trim() : '';
            const records = pipeIdx >= 0 ? text.slice(pipeIdx + 1) : text;
            sinVentaCodes = new Set();
            sinVentaTimes = {};
            (records.match(/\{[^}]+\}/g) || []).forEach(m => {
                try {
                    const r = JSON.parse(m);
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
        })
        .catch(e => console.warn('SinVenta error:', e));
}

function renderSinVentaLayer() {
    sinVentaLayer.clearLayers();
    if (!sinVentaActive || sinVentaCodes.size === 0) return;
    const partner = document.getElementById("partnerFilter").value;
    const nombre  = document.getElementById("nombreFilter").value;
    const rol     = document.getElementById("rolFilter").value;
    let count = 0;
    allData.forEach(p => {
        if (!sinVentaCodes.has(String(p.ID))) return;
        if (!p.lat || !p.lng) return;
        if ((p.estado || '').toUpperCase() === 'CERRADO') return;
        if (partner !== 'ALL' && p.responsable  !== partner) return;
        if (nombre  !== 'ALL' && rol === 'supervisor'  && p.supervisor  !== nombre) return;
        if (nombre  !== 'ALL' && rol === 'capacitador' && p.capacitador !== nombre) return;
        const hora = sinVentaTimes[String(p.ID)] || '-';
        L.circleMarker([p.lat, p.lng], {
            radius: 7, color: '#e53935', weight: 2, fill: false, opacity: 0.85, interactive: true
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

fetchSinVenta();
// ─────────────────────────────────────────────────────────────────────────

// ── GOOGLE SHEET ──────────────────────────────────────────────────────────
const SHEET_URL  = "https://script.google.com/macros/s/AKfycby2f2uW9E2_CUBr9OiKVT4Sp-ubP2sRIXlWig-GPuKTGyDxi-zx724ZGtkOFaWW0jnqjw/exec";
const SHEET_HOJA = "Visitas_Mapa2";
// ─────────────────────────────────────────────────────────────────────────

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

    if (texto.length < 2) return;

    let resultados = allData.filter(p =>
        p.nombre.toLowerCase().includes(texto) ||
        p.ID.toString().includes(texto)
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
        marker.bindPopup(buildPopupContent(p));
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
                            allData = normalizePuntos(data);
                            updateFilters();
                            console.log('Datos actualizados automaticamente:', d.v);
                        }).catch(() => {});
                }
            }).catch(() => {});
    }, 5 * 60 * 1000);
})();
// ──────────────────────────────────────────────────────────────────────────
