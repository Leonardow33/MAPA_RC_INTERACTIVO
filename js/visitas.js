const _BASE_DATA = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'data/' : 'https://raw.githubusercontent.com/Leonardow33/MAPA_RC_INTERACTIVO/main/data/';
// Auth / PWA redirect
(function() {
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
        window.location.replace('mapa.html');
    }
    const stored = localStorage.getItem('rc_auth');
    if (stored === 'rc' || stored === 'cap' || stored === '1') {
        window._authModo = (stored === 'cap') ? 'cap' : 'rc';
        document.addEventListener('DOMContentLoaded', () => {
            document.getElementById('authOverlay').style.display = 'none';
        });
    }
})();
function checkAuth() {
    const val = document.getElementById('authInput').value;
    if (val === 'Geodor2026-1' || val === 'Geodor2026-2') {
        const modo = val === 'Geodor2026-2' ? 'cap' : 'rc';
        localStorage.setItem('rc_auth', modo);
        window._authModo = modo;
        document.getElementById('authOverlay').style.display = 'none';
        if (typeof _aplicarModoVista === 'function') _aplicarModoVista(modo);
    } else {
        document.getElementById('authError').style.display = 'block';
        document.getElementById('authInput').value = '';
        document.getElementById('authInput').focus();
    }
}

// Lógica principal
const SHEET_URL    = "https://script.google.com/macros/s/AKfycby2f2uW9E2_CUBr9OiKVT4Sp-ubP2sRIXlWig-GPuKTGyDxi-zx724ZGtkOFaWW0jnqjw/exec";
let modoVista = (window._authModo === 'cap') ? 'cap' : 'rc';
const SIN_VENTA_URL = "https://raw.githubusercontent.com/Leonardow33/MAPA_RC_INTERACTIVO/main/sinventa.txt";

const COLORES = [
    "#E53935","#8E24AA","#1E88E5","#43A047","#FB8C00",
    "#00ACC1","#6D4C41","#F4511E","#3949AB","#00897B",
    "#FDD835","#D81B60","#5E35B1","#039BE5","#7CB342"
];

const map = L.map('map', { preferCanvas: true }).setView([-9.19, -75.0152], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
}).addTo(map);

let rcMarkers = {};
let rcPolylines = {};
let tiendaLayers = {};
let rcColores = {};
let todosRCs = [];

let puntosData = [];

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

let sinVentaCodes = new Set();
let sinVentaActive = false;
let selectedDate = '';
const sinVentaLayer    = L.layerGroup().addTo(map);
const todosLosPointsLayer = L.layerGroup().addTo(map);
const rutaHoyLayer     = L.layerGroup().addTo(map);
const sinVisitarLayer  = L.layerGroup().addTo(map);
let todosLosPointsActive = true;
let rutaHoyActive        = false;
let selectedPartnerFilter = null; // mantenido por compatibilidad
let selectedDiaFilter = null;
const DIAS_SEMANA = ['DOMINGO','LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO'];
function normDia(d) {
    return d.trim().toUpperCase()
        .replace(/[ÁÀÂÃ]/g,'A').replace(/[ÉÈÊË]/g,'E').replace(/[ÍÌÎÏ]/g,'I')
        .replace(/[ÓÒÔÕ]/g,'O').replace(/[ÚÙÛÜ]/g,'U');
}
let visitedIDs = new Set();
let visitCountsSemana = {};
let visitsByRC = {};
let visitsByRCToday = {};
let visitsByDate   = {};  // { fecha: Set<id> }
let visitsByDateRC = {};  // { fecha: { rcName: Set<id> } }
let weekDates      = [];  // ['YYYY-MM-DD', ...] en orden lun-sáb
let selectedRCFilter = null;

function matchRCFilter(p) {
    if (!selectedRCFilter) return true;
    return modoVista === 'cap'
        ? p.capacitador === selectedRCFilter
        : p.rc === selectedRCFilter;
}
let semanaKeyCache = '';
let selectedSemanaMonday = null;

renderTodosLosPuntos();

function getColor(rc) {
    if (!rcColores[rc]) {
        const idx = Object.keys(rcColores).length % COLORES.length;
        rcColores[rc] = COLORES[idx];
    }
    return rcColores[rc];
}

function makeRCIcon(rc, color) {
    const initials = rc.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
    return L.divIcon({
        html: `<div style="width:34px;height:34px;border-radius:50%;background:${color};
                    color:white;font-weight:800;font-size:12px;display:flex;
                    align-items:center;justify-content:center;
                    border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4)">
                    ${initials}
               </div>`,
        className: '', iconSize: [34,34], iconAnchor: [17,17], popupAnchor: [0,-17]
    });
}

function makeStartIcon(color) {
    return L.divIcon({
        html: `<div style="width:14px;height:14px;border-radius:50%;background:white;
                    border:3px solid ${color};box-shadow:0 1px 4px rgba(0,0,0,0.3)"></div>`,
        className: '', iconSize: [14,14], iconAnchor: [7,7]
    });
}

function limpiarCapas() {
    Object.values(rcMarkers).forEach(m => map.removeLayer(m));
    Object.values(rcPolylines).forEach(p => p.forEach(l => map.removeLayer(l)));
    Object.values(tiendaLayers).forEach(arr => arr.forEach(m => map.removeLayer(m)));
    rcMarkers = {};
    rcPolylines = {};
    tiendaLayers = {};
}

function toHora(val) {
    if (!val) return '-';
    const s = String(val);
    const m = s.match(/(\d{1,2}:\d{2}(:\d{2})?)/);
    return m ? m[1] : s;
}

function calcHoraEntrada(salida, duracion) {
    const s = toHora(salida);
    const d = toHora(duracion);
    if (s === '-' || d === '-') return '-';
    try {
        const [sh, sm, ss] = s.split(':').map(Number);
        const [dh, dm, ds] = d.split(':').map(Number);
        if (isNaN(sh) || isNaN(dh)) return '-';
        let total = sh * 3600 + sm * 60 + (ss || 0) - (dh * 3600 + dm * 60 + (ds || 0));
        if (total < 0) total += 86400;
        const rh = Math.floor(total / 3600);
        const rm = Math.floor((total % 3600) / 60);
        const rs = total % 60;
        return String(rh).padStart(2,'0') + ':' + String(rm).padStart(2,'0') + ':' + String(rs).padStart(2,'0');
    } catch(e) { return '-'; }
}

function buildRCPopup(rc, color) {
    return `<div class="rc-popup">
        <div class="rc-popup-nombre" style="color:${color}">${rc.rc}</div>
        <div class="rc-popup-row"><span class="rc-popup-lbl">Supervisor</span><span class="rc-popup-val">${rc.supervisor || '-'}</span></div>
        <div class="rc-popup-row"><span class="rc-popup-lbl">Primera visita</span><span class="rc-popup-val">${toHora(rc.primeraVisita)}</span></div>
        <div class="rc-popup-row"><span class="rc-popup-lbl">Ultima marca</span><span class="rc-popup-val">${toHora(rc.horaActual)}</span></div>
        <div class="rc-popup-row"><span class="rc-popup-lbl">Tiendas visitadas</span><span class="rc-popup-val">${rc.totalTiendas || 0}</span></div>
        <div class="rc-popup-row"><span class="rc-popup-lbl">Ultima tienda</span><span class="rc-popup-val">${rc.ultimaTienda || '-'}</span></div>
    </div>`;
}

function buildStorePopup(v, rcNombre, color) {
    const num = v.numVisita || '-';
    return `<div class="rc-popup">
        <div class="rc-popup-nombre" style="color:${color}">Visita #${num} · ${v.tienda || '-'}</div>
        <div class="rc-popup-row"><span class="rc-popup-lbl">ID</span><span class="rc-popup-val">${v.id || '-'}</span></div>
        <div class="rc-popup-row"><span class="rc-popup-lbl">Hora entrada</span><span class="rc-popup-val">${calcHoraEntrada(v.hora, v.tiempoTienda)}</span></div>
        <div class="rc-popup-row"><span class="rc-popup-lbl">Hora salida</span><span class="rc-popup-val">${toHora(v.hora)}</span></div>
        <div class="rc-popup-row"><span class="rc-popup-lbl">Tiempo en tienda</span><span class="rc-popup-val">${toHora(v.tiempoTienda)}</span></div>
        <div class="rc-popup-row"><span class="rc-popup-lbl">Tipo</span><span class="rc-popup-val">${v.tipo || '-'}</span></div>
        <div class="rc-popup-row"><span class="rc-popup-lbl">Zona</span><span class="rc-popup-val">${v.zona || '-'}</span></div>
        <div class="rc-popup-row"><span class="rc-popup-lbl">Cluster</span><span class="rc-popup-val">${v.cluster || '-'}</span></div>
        <div class="rc-popup-row"><span class="rc-popup-lbl">RC</span><span class="rc-popup-val">${rcNombre}</span></div>
    </div>`;
}

function renderRC(rcs) {
    limpiarCapas();
    const supFiltro = document.getElementById('supFilter').value;
    let filtrados = rcs.filter(rc =>
        supFiltro === 'ALL' || rc.supervisor === supFiltro
    );
    if (selectedRCFilter) filtrados = filtrados.filter(rc => rc.rc === selectedRCFilter);

    filtrados.forEach(rc => {
        const color = getColor(rc.rc);
        const visitas = rc.visitas || [];

        const puntos = visitas
            .filter(v => v.latRC && v.lngRC && parseFloat(v.latRC) !== 0)
            .map(v => [parseFloat(v.latRC), parseFloat(v.lngRC)]);

        const lineas = [];

        if (puntos.length > 0) {
            if (puntos.length > 1) {
                const poly = L.polyline(puntos, {
                    color: color, weight: 2.5, opacity: 0.6, dashArray: '6,4'
                }).addTo(map);
                lineas.push(poly);
            }
            const startM = L.marker(puntos[0], { icon: makeStartIcon(color) }).addTo(map);
            lineas.push(startM);

            const ultima = puntos[puntos.length - 1];
            const marker = L.marker(ultima, { icon: makeRCIcon(rc.rc, color), zIndexOffset: 100 })
                .addTo(map)
                .bindPopup(buildRCPopup(rc, color));
            rcMarkers[rc.rc] = marker;
        }

        rcPolylines[rc.rc] = lineas;

        const tiendas = [];
        visitas.forEach(v => {
            const lat = parseFloat(v.latT) || parseFloat(v.latRC);
            const lng = parseFloat(v.lngT) || parseFloat(v.lngRC);
            if (!lat || !lng) return;
            const num = v.numVisita || '?';
            const icon = L.divIcon({
                html: `<div style="width:22px;height:22px;border-radius:50%;background:${color};
                            color:white;font-weight:800;font-size:11px;display:flex;
                            align-items:center;justify-content:center;
                            border:2px solid white;box-shadow:0 1px 5px rgba(0,0,0,0.35)">
                            ${num}
                       </div>`,
                className: '', iconSize: [22,22], iconAnchor: [11,11], popupAnchor: [0,-11]
            });
            const m = L.marker([lat, lng], { icon })
                .addTo(map)
                .bindPopup(buildStorePopup(v, rc.rc, color));
            tiendas.push(m);
        });
        tiendaLayers[rc.rc] = tiendas;
    });

    renderPanel(filtrados);
}

function renderPanel(rcs) {
    const list = document.getElementById('rcList');
    if (rcs.length === 0) {
        list.innerHTML = '<div id="noData">Sin registros hoy</div>';
        return;
    }

    const activos = rcs.filter(r => r.totalTiendas > 0).sort((a,b) => (b.totalTiendas||0)-(a.totalTiendas||0));
    const inactivos = rcs.filter(r => !r.totalTiendas || r.totalTiendas === 0);

    list.innerHTML = '';
    [...activos, ...inactivos].forEach(rc => {
        const color = getColor(rc.rc);
        const initials = rc.rc.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
        const card = document.createElement('div');
        card.className = `rc-card ${rc.totalTiendas > 0 ? 'activo' : 'inactivo'}`;
        card.innerHTML = `
            <div class="rc-dot" style="background:${color}">${initials}</div>
            <div class="rc-info">
                <div class="rc-nombre">${rc.rc}</div>
                <div class="rc-sup">${rc.supervisor || ''}</div>
                <div class="rc-stats">
                    <span class="rc-stat">&#9200; ${toHora(rc.primeraVisita)}</span>
                    <span class="rc-stat">&#127978; ${rc.totalTiendas || 0} tiendas</span>
                </div>
                <div class="rc-ultima">Ultima: ${rc.ultimaTienda || 'Sin registro'} · ${toHora(rc.horaActual)}</div>
            </div>`;
        card.onclick = () => enfocarRC(rc.rc);
        list.appendChild(card);
    });
}

function enfocarRC(nombre) {
    const esMismoRC = selectedRCFilter === nombre;
    selectedRCFilter = esMismoRC ? null : nombre;

    document.querySelectorAll('.rc-card').forEach(c => c.classList.remove('seleccionado'));
    if (!esMismoRC) {
        const marker = rcMarkers[nombre];
        if (marker) { map.setView(marker.getLatLng(), 13); marker.openPopup(); }
        document.querySelectorAll('.rc-card').forEach(c => {
            if (c.querySelector('.rc-nombre')?.textContent === nombre) c.classList.add('seleccionado');
        });
    }

    document.querySelector('#coberturaHeader span').textContent = selectedRCFilter
        ? `📅 Días de visita · ${selectedRCFilter}`
        : '📅 Días de visita';
    selectedPartnerFilter = null;
    selectedDiaFilter = null;
    rutaHoyActive = false;
    document.getElementById('btnRutaHoy').classList.remove('activo');
    renderRC(todosRCs);
    scheduleFullRender();
    if (sinVentaActive) renderSinVentaLayer();
}

function poblarSupervisores(rcs) {
    const sel = document.getElementById('supFilter');
    const actual = sel.value;
    const sups = [...new Set(rcs.map(r => r.supervisor).filter(Boolean))].sort();
    sel.innerHTML = '<option value="ALL">Todos los supervisores</option>';
    sups.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s; opt.text = s;
        sel.appendChild(opt);
    });
    if ([...sel.options].some(o => o.value === actual)) sel.value = actual;
}

function formatFecha(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function updateSinVentaBtn() {
    const today = new Date(); today.setHours(0,0,0,0);
    const todayStr = formatFecha(today);
    const monday = selectedSemanaMonday;
    const saturday = new Date(monday); saturday.setDate(monday.getDate() + 5);
    const isCurrentWeek = today >= monday && today <= saturday;
    const isTodaySelected = selectedDate === todayStr;
    const btn = document.getElementById('btnSinVenta');
    const ok = isCurrentWeek && isTodaySelected;
    btn.disabled = !ok;
    btn.style.opacity = ok ? '1' : '0.45';
    btn.title = ok ? '' : 'Solo disponible para la semana y día de hoy';
    if (!ok && sinVentaActive) {
        sinVentaActive = false;
        btn.classList.remove('activo');
        sinVentaLayer.clearLayers();
    }
}

function buildDayFilter(monday) {
    const today = new Date(); today.setHours(0,0,0,0);
    const todayStr = formatFecha(today);
    const diasNombre = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const sel = document.getElementById('fechaFilter');
    sel.innerHTML = '';

    // Placeholder sin selección
    const ph = document.createElement('option');
    ph.value = ''; ph.textContent = 'Día';
    sel.appendChild(ph);

    for (let i = 0; i < 6; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        if (d > today) break;
        const dateStr = formatFecha(d);
        const esHoy = dateStr === todayStr;
        const opt = document.createElement('option');
        opt.value = dateStr;
        opt.textContent = `${diasNombre[d.getDay()]} ${d.getDate()}/${d.getMonth()+1}${esHoy ? ' (hoy)' : ''}`;
        sel.appendChild(opt);
    }

    // Siempre default al placeholder
    sel.selectedIndex = 0;
    selectedDate = '';
    document.getElementById('panelHeader').textContent = modoVista === 'cap' ? 'Capacitadores activos hoy' : 'RCs activos hoy';

    sel.onchange = function() {
        selectedDate = this.value;
        const defaultLbl = modoVista === 'cap' ? 'Capacitadores activos hoy' : 'RCs activos hoy';
        const prefijo    = modoVista === 'cap' ? 'Capacitadores' : 'RCs';
        document.getElementById('panelHeader').textContent = !this.value ? defaultLbl : `${prefijo} visitando · ${this.options[this.selectedIndex].textContent}`;
        document.getElementById('rcList').innerHTML = '<div style="padding:16px;color:#aaa;font-size:12px;text-align:center">⏳ Cargando...</div>';
        updateSinVentaBtn();
        showDashLoading();
        cargarDatos();
    };
}

function getZonalFiltro() {
    return (document.getElementById('zonalTipoFilter')?.value || 'ALL');
}

function debounce(fn, ms) {
    let t;
    return function(...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}
const scheduleFullRender = debounce(function() {
    renderTodosLosPuntos();
    renderSinVisitar();
    renderRutaHoy();
}, 150);

function renderTodosLosPuntos() {
    todosLosPointsLayer.clearLayers();
    const btn = document.getElementById('btnTodosPuntos');
    if (!todosLosPointsActive) { btn.textContent = '📍 Todos los puntos'; renderCobertura(); return; }
    const zf = getZonalFiltro();
    let activos = puntosData.filter(p =>
        (p.estado || '').toUpperCase() !== 'CERRADO' &&
        (zf === 'ALL' || (p.zonal_tipo || '').toUpperCase() === zf)
    );
    if (selectedRCFilter) activos = activos.filter(p => matchRCFilter(p));
    // Filtrar por día si hay uno seleccionado en el panel
    if (selectedDiaFilter) {
        activos = activos.filter(p => (p.dias || []).some(d => normDia(d) === selectedDiaFilter));
    }
    let visitados = 0;
    const visitedSet = selectedRCFilter ? (visitsByRC[selectedRCFilter] || new Set()) : null;
    activos.forEach(p => {
        if (!p.lat || !p.lng) return;
        const id    = normalizeID(p.ID);
        const fueVisit = visitedSet ? visitedSet.has(id) : (visitCountsSemana[id] || 0) > 0;
        if (fueVisit) visitados++;
        const color = fueVisit ? '#43A047' : '#E53935';
        const visitaLabel = fueVisit
            ? `<b style="color:#43A047">✅ Visitado</b>`
            : `<span style="color:#E53935">⚠️ Sin visitar</span>`;
        L.circleMarker([parseFloat(p.lat), parseFloat(p.lng)], {
            radius: 7, fillColor: color, color: '#fff',
            weight: 1.5, fillOpacity: 0.88, opacity: 1
        }).addTo(todosLosPointsLayer)
          .bindPopup(`<b>${p.nombre}</b><br><small>ID: ${p.ID} · RC: ${p.rc || '-'}</small><br>${visitaLabel}`);
    });
    const pct = activos.length > 0 ? Math.round(visitados / activos.length * 100) : 0;
    const rcLabel = selectedRCFilter ? ` · ${selectedRCFilter}` : '';
    btn.textContent = `📍 ${visitados}/${activos.length} visitados (${pct}%)${rcLabel}`;
    renderCobertura();
}

const DIA_COLORES_VIS = {
    'LUNES':     '#1E88E5',
    'MARTES':    '#43A047',
    'MIÉRCOLES': '#F4511E', 'MIERCOLES': '#F4511E',
    'JUEVES':    '#8E24AA',
    'VIERNES':   '#E53935',
    'SÁBADO':    '#FDD835', 'SABADO': '#FDD835',
};
const DIAS_ORDEN_VIS = ['LUNES','MARTES','MIÉRCOLES','JUEVES','VIERNES','SÁBADO'];

function renderCobertura() {
    const list = document.getElementById('coberturaList');
    if (!puntosData.length) return;

    const zf = getZonalFiltro();
    let activos = puntosData.filter(p =>
        (p.estado || '').toUpperCase() !== 'CERRADO' &&
        (zf === 'ALL' || (p.zonal_tipo || '').toUpperCase() === zf)
    );
    if (selectedRCFilter) activos = activos.filter(p => matchRCFilter(p));

    const todayNorm = normDia(DIAS_SEMANA[new Date().getDay()]);
    if (rutaHoyActive && selectedRCFilter) {
        activos = activos.filter(p => Array.isArray(p.dias) && p.dias.some(d => normDia(d) === todayNorm));
    }

    const visitedSet = rutaHoyActive && selectedRCFilter
        ? (visitsByRCToday[selectedRCFilter] || new Set())
        : selectedRCFilter
            ? (visitsByRC[selectedRCFilter] || new Set())
            : null;

    // Agrupar por DÍA de visita
    const byDia = {};
    activos.forEach(p => {
        const dias = (p.dias || []).filter(d => d !== 'SIN RUTA');
        if (!dias.length) dias.push('SIN RUTA');
        dias.forEach(d => {
            const dn = normDia(d);
            if (!byDia[dn]) byDia[dn] = { label: d.toUpperCase(), total: 0, visitados: 0 };
            byDia[dn].total++;
            const id = normalizeID(p.ID);
            const visitado = visitedSet ? visitedSet.has(id) : (visitCountsSemana[id] || 0) > 0;
            if (visitado) byDia[dn].visitados++;
        });
    });

    // Ordenar por semana
    const rows = DIAS_ORDEN_VIS
        .map(d => byDia[normDia(d)] ? { dia: normDia(d), ...byDia[normDia(d)] } : null)
        .filter(Boolean);
    if (byDia['SIN RUTA']) rows.push({ dia: 'SIN RUTA', ...byDia['SIN RUTA'] });

    // Resumen general
    const totalGral     = activos.length;
    const visitadosGral = activos.filter(p => {
        const id = normalizeID(p.ID);
        return visitedSet ? visitedSet.has(id) : (visitCountsSemana[id] || 0) > 0;
    }).length;
    const pctGral  = totalGral > 0 ? Math.round(visitadosGral / totalGral * 100) : 0;
    const colorGral = pctGral >= 60 ? '#43A047' : pctGral >= 30 ? '#FB8C00' : '#E53935';
    const resTexto  = document.getElementById('resumenTexto');
    const resBar    = document.getElementById('resumenBar');
    if (resTexto) resTexto.innerHTML = `<span style="color:${colorGral}">${visitadosGral} / ${totalGral} visitados &nbsp;·&nbsp; <b>${pctGral}%</b></span>`;
    if (resBar)   { resBar.style.width = pctGral + '%'; resBar.style.background = colorGral; }

    list.innerHTML = '';
    if (!rows.length) {
        list.innerHTML = '<div style="padding:16px;color:#aaa;font-size:12px;text-align:center">Sin datos</div>';
        return;
    }

    rows.forEach(r => {
        const pct     = r.total > 0 ? Math.round(r.visitados / r.total * 100) : 0;
        const barColor = pct >= 60 ? '#43A047' : pct >= 30 ? '#FB8C00' : '#E53935';
        const dotColor = DIA_COLORES_VIS[r.dia] || '#78909C';
        const esSel   = selectedDiaFilter === r.dia;
        const div = document.createElement('div');
        div.className = 'partner-row' + (esSel ? ' seleccionado' : '');
        div.style.cursor = 'pointer';
        if (esSel) div.style.background = '#0f2040';
        div.innerHTML = `
            <div class="partner-nombre" style="display:flex;align-items:center;gap:6px">
                <span style="width:9px;height:9px;border-radius:50%;background:${dotColor};flex-shrink:0;display:inline-block"></span>
                ${r.label}${esSel ? ' <span style="color:#FB8C00;font-size:10px">● filtrado</span>' : ''}
            </div>
            <div class="partner-stats">${r.visitados} de ${r.total} puntos &nbsp;·&nbsp; <b style="color:${barColor}">${pct}%</b></div>
            <div class="partner-bar"><div class="partner-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>`;
        div.addEventListener('click', () => {
            selectedDiaFilter = selectedDiaFilter === r.dia ? null : r.dia;
            renderTodosLosPuntos();
            renderSinVisitar();
            renderCobertura();
            // Zoom a los puntos del día seleccionado
            if (selectedDiaFilter && selectedRCFilter) {
                const pts = activos.filter(p => (p.dias||[]).some(d => normDia(d) === selectedDiaFilter));
                if (pts.length) {
                    const bounds = L.latLngBounds(pts.map(p => [p.lat, p.lng]));
                    map.fitBounds(bounds, { padding: [40,40], maxZoom: 14 });
                }
            }
        });
        list.appendChild(div);
    });
}

function setLoadingState(loading) {
    const btn = document.getElementById('btnTodosPuntos');
    if (loading) {
        if (btn) btn.textContent = '📍 Actualizando...';
        document.getElementById('coberturaList').innerHTML =
            '<div style="padding:16px;color:#aaa;font-size:12px;text-align:center">⏳ Cargando...</div>';
    }
}

async function cargarDatosSemanales() {
    if (!selectedSemanaMonday) return;
    const monday = selectedSemanaMonday;
    const semanaKey = formatFecha(monday);
    if (semanaKey === semanaKeyCache) return;
    semanaKeyCache = semanaKey;

    setLoadingState(true);

    const today = new Date(); today.setHours(0,0,0,0);
    const accion = modoVista === 'cap' ? 'getVisitasMapa2' : 'getVisitas';
    const fetchTasks = [];
    for (let i = 0; i < 6; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        if (d > today) continue;
        const fecha = formatFecha(d);
        fetchTasks.push({ fecha,
            prom: fetch(SHEET_URL + `?action=${accion}&fecha=${fecha}`).then(r => r.json()).catch(() => [])
        });
    }

    const results = await Promise.all(fetchTasks.map(t => t.prom));
    visitCountsSemana = {};
    visitsByRC        = {};
    visitsByDate      = {};
    visitsByDateRC    = {};
    weekDates         = fetchTasks.map(t => t.fecha);

    fetchTasks.forEach(({ fecha }, idx) => {
        const dayData = results[idx];
        if (!Array.isArray(dayData)) return;
        visitsByDate[fecha]   = new Set();
        visitsByDateRC[fecha] = {};
        dayData.forEach(rcEntry => {
            const rcName = rcEntry.rc || '';
            if (rcName && !visitsByRC[rcName]) visitsByRC[rcName] = new Set();
            if (rcName && !visitsByDateRC[fecha][rcName]) visitsByDateRC[fecha][rcName] = new Set();
            (rcEntry.visitas || []).forEach(v => {
                if (v.id) {
                    const id = normalizeID(v.id);
                    visitCountsSemana[id] = (visitCountsSemana[id] || 0) + 1;
                    if (rcName) { visitsByRC[rcName].add(id); visitsByDateRC[fecha][rcName].add(id); }
                    visitsByDate[fecha].add(id);
                }
            });
        });
    });

    scheduleFullRender();
    if (activeTab === 'dash') renderDashboard();
}

function toggleTodosPuntos() {
    todosLosPointsActive = !todosLosPointsActive;
    document.getElementById('btnTodosPuntos').classList.toggle('activo', todosLosPointsActive);
    renderTodosLosPuntos();
}

function normalizeID(val) {
    return String(val).trim().replace(/\.0$/, '');
}

function renderSinVisitar() {
    sinVisitarLayer.clearLayers();
    if (!selectedDiaFilter) return;

    const zf = getZonalFiltro();
    const todayNorm = normDia(DIAS_SEMANA[new Date().getDay()]);
    const fueVisitado = rutaHoyActive && selectedRCFilter
        ? (id) => (visitsByRCToday[selectedRCFilter] || new Set()).has(id)
        : selectedRCFilter
            ? (id) => (visitsByRC[selectedRCFilter] || new Set()).has(id)
            : selectedDate
                ? (id) => visitedIDs.has(id)
                : (id) => (visitCountsSemana[id] || 0) > 0;

    const noVisitados = puntosData.filter(p =>
        (p.estado || '').toUpperCase() !== 'CERRADO' &&
        !fueVisitado(normalizeID(p.ID)) &&
        (selectedRCFilter ? matchRCFilter(p) : true) &&
        (p.dias || []).some(d => normDia(d) === selectedDiaFilter) &&
        (zf !== 'ALL' ? (p.zonal_tipo || '').toUpperCase() === zf : true) &&
        (!rutaHoyActive || (Array.isArray(p.dias) && p.dias.some(d => normDia(d) === todayNorm)))
    );

    const bounds = [];
    noVisitados.forEach(p => {
        if (!p.lat || !p.lng) return;
        bounds.push([p.lat, p.lng]);
        L.circleMarker([p.lat, p.lng], {
            radius: 8, fillColor: '#FB8C00', color: 'white',
            weight: 1.5, fillOpacity: 0.85, opacity: 1
        }).addTo(sinVisitarLayer)
          .bindPopup(`<b style="color:#FB8C00">⚠️ Sin visita</b><br>${p.nombre}<br><small>ID: ${p.ID} · RC: ${p.rc || '-'} · Partner: ${p.responsable || '-'}</small>`);
    });

    if (bounds.length > 0) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
}

function renderRutaHoy() {
    rutaHoyLayer.clearLayers();
    const btn = document.getElementById('btnRutaHoy');
    if (!selectedRCFilter) { btn.disabled = true; btn.textContent = '📅 Ruta Hoy'; return; }
    btn.disabled = false;
    if (!rutaHoyActive) return;

    const todayAbbr = normDia(DIAS_SEMANA[new Date().getDay()]);
    const visitados  = visitsByRCToday[selectedRCFilter] || new Set();
    const zf         = getZonalFiltro();

    const rutaHoy = puntosData.filter(p =>
        (p.estado || '').toUpperCase() !== 'CERRADO' &&
        matchRCFilter(p) &&
        Array.isArray(p.dias) && p.dias.some(d => normDia(d) === todayAbbr) &&
        (zf !== 'ALL' ? (p.zonal_tipo || '').toUpperCase() === zf : true)
    );

    let visitadasHoy = 0;
    const bounds = [];
    rutaHoy.forEach(p => {
        if (!p.lat || !p.lng) return;
        bounds.push([p.lat, p.lng]);
        const visitado = visitados.has(normalizeID(p.ID));
        if (visitado) visitadasHoy++;
        const color = visitado ? '#43A047' : '#E53935';
        const label = visitado ? '✅ Visitado hoy' : '⚠️ Pendiente hoy';
        const esPartner = !selectedPartnerFilter || p.responsable === selectedPartnerFilter;
        const size    = esPartner ? 18 : 11;
        const opacity = esPartner ? '1' : '0.25';
        const border  = esPartner ? '3px solid #1565C0' : '2px solid #888';
        const shadow  = esPartner ? '0 0 0 2px white,0 2px 8px rgba(0,0,0,0.45)' : 'none';
        const icon = L.divIcon({
            html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};
                        border:${border};box-shadow:${shadow};opacity:${opacity};"></div>`,
            className: '', iconSize: [size,size], iconAnchor: [size/2,size/2], popupAnchor: [0,-size/2]
        });
        L.marker([p.lat, p.lng], { icon }).addTo(rutaHoyLayer)
          .bindPopup(`<b style="color:${color}">${label}</b><br>${p.nombre}<br><small>ID: ${p.ID} · ${p.responsable || '-'} · RC: ${p.rc}</small>`);
    });

    btn.textContent = `📅 Ruta Hoy (${visitadasHoy}/${rutaHoy.length})`;
    if (bounds.length > 0) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
}

function toggleRutaHoy() {
    if (!selectedRCFilter) return;
    rutaHoyActive = !rutaHoyActive;
    document.getElementById('btnRutaHoy').classList.toggle('activo', rutaHoyActive);
    renderRutaHoy();
    renderCobertura();
    renderSinVisitar();
}

let _modoSolicitado = null;

function setModoVista(modo) {
    if (modo === modoVista) return;
    _modoSolicitado = modo;
    const nombre = modo === 'cap' ? 'Capacitadores' : 'RCs';
    document.getElementById('switchTitle').textContent = `Cambiar a ${nombre}`;
    document.getElementById('switchDesc').textContent = `Ingresa la contraseña de ${nombre} para continuar`;
    document.getElementById('switchInput').value = '';
    document.getElementById('switchError').style.display = 'none';
    document.getElementById('switchOverlay').style.display = 'flex';
    setTimeout(() => document.getElementById('switchInput').focus(), 50);
}

function confirmarSwitch() {
    const val  = document.getElementById('switchInput').value;
    const pass = _modoSolicitado === 'cap' ? 'Geodor2026-2' : 'Geodor2026-1';
    if (val === pass) {
        localStorage.setItem('rc_auth', _modoSolicitado);
        document.getElementById('switchOverlay').style.display = 'none';
        _aplicarModoVista(_modoSolicitado);
    } else {
        document.getElementById('switchError').style.display = 'block';
        document.getElementById('switchInput').value = '';
        document.getElementById('switchInput').focus();
    }
}

function cancelarSwitch() {
    document.getElementById('switchOverlay').style.display = 'none';
    _modoSolicitado = null;
    document.getElementById('btnModoRC').classList.toggle('activo', modoVista === 'rc');
    document.getElementById('btnModoCap').classList.toggle('activo', modoVista === 'cap');
}

function _aplicarModoVista(modo) {
    modoVista = modo;
    document.getElementById('btnModoRC').classList.toggle('activo', modo === 'rc');
    document.getElementById('btnModoCap').classList.toggle('activo', modo === 'cap');
    const btnRuta = document.getElementById('btnRutaHoy');
    btnRuta.style.display = modo === 'cap' ? 'none' : '';
    if (modo === 'cap' && rutaHoyActive) {
        rutaHoyActive = false;
        btnRuta.classList.remove('activo');
        rutaHoyLayer.clearLayers();
    }
    selectedRCFilter = null;
    selectedDate = '';
    document.getElementById('fechaFilter').selectedIndex = 0;
    document.getElementById('supFilter').value = 'ALL';
    semanaKeyCache = null;
    document.getElementById('panelHeader').textContent = modo === 'cap' ? 'Capacitadores activos hoy' : 'RCs activos hoy';
    document.getElementById('rcList').innerHTML = '<div style="padding:16px;color:#aaa;font-size:12px;text-align:center">⏳ Cargando...</div>';
    cargarDatos();
    cargarDatosSemanales();
}

async function cargarDatos() {
    try {
        const accion = modoVista === 'cap' ? 'getVisitasMapa2' : 'getVisitas';
        const url = SHEET_URL + `?action=${accion}` + (selectedDate ? `&fecha=${selectedDate}` : '');
        const res = await fetch(url);
        const data = await res.json();
        todosRCs = Array.isArray(data) ? data : [];
        visitedIDs = new Set();
        visitsByRCToday = {};
        todosRCs.forEach(rc => {
            const rcName = rc.rc || '';
            if (rcName && !visitsByRCToday[rcName]) visitsByRCToday[rcName] = new Set();
            (rc.visitas || []).forEach(v => {
                if (v.id) {
                    visitedIDs.add(normalizeID(v.id));
                    if (rcName) visitsByRCToday[rcName].add(normalizeID(v.id));
                }
            });
        });
        poblarSupervisores(todosRCs);
        renderRC(todosRCs);
        renderSinVisitar();
        const hora = new Date().toTimeString().slice(0,5);
        document.getElementById('lastUpdate').textContent = `Actualizado: ${hora}`;
        if (activeTab === 'dash') renderDashboard();
    } catch(e) {
        console.warn('Error cargando visitas:', e);
        document.getElementById('noData').textContent = 'Error al cargar datos';
    }
}

let sinVentaTimes = {};

let svTimestamp = '';

function fetchSinVenta() {
    return fetch(SIN_VENTA_URL + '?t=' + Date.now(), { cache: 'no-store' })
        .then(r => r.text())
        .then(text => {
            // Formato: "2026-05-20 10:27|{[C]:"122",[U]:"10:08:58"}[C]{...}"
            const pipeIdx  = text.indexOf('|');
            svTimestamp    = pipeIdx >= 0 ? text.slice(0, pipeIdx).trim() : '';
            const records  = pipeIdx >= 0 ? text.slice(pipeIdx + 1) : text;

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
            console.log(`SinVenta: ${sinVentaCodes.size} tiendas | ${svTimestamp}`);
            if (sinVentaActive) renderSinVentaLayer();
        })
        .catch(e => console.warn('sinVenta fetch:', e));
}

function renderSinVentaLayer() {
    sinVentaLayer.clearLayers();
    if (!sinVentaActive || sinVentaCodes.size === 0) return;
    const zf = getZonalFiltro();
    puntosData.forEach(p => {
        if (!sinVentaCodes.has(String(p.ID))) return;
        if (!p.lat || !p.lng) return;
        if ((p.estado || '').toUpperCase() === 'CERRADO') return;
        if (selectedRCFilter && p.rc !== selectedRCFilter) return;
        if (zf !== 'ALL' && (p.zonal_tipo || '').toUpperCase() !== zf) return;
        const hora = sinVentaTimes[String(p.ID)] || '-';
        L.circleMarker([parseFloat(p.lat), parseFloat(p.lng)], {
            radius: 7, color: '#e53935', weight: 2, fill: false, opacity: 0.85
        }).bindPopup(`
            <div style="font-family:sans-serif;min-width:180px">
                <div style="background:#e53935;padding:6px 10px;border-radius:8px 8px 0 0">
                    <span style="color:white;font-weight:700;font-size:13px">⚠️ SIN VENTA HOY</span>
                </div>
                <div style="padding:8px 10px;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px">
                    <b>${p.nombre}</b><br>
                    <span style="color:#888;font-size:12px">Código: ${p.ID}</span><br>
                    <span style="color:#888;font-size:12px">Partner: ${p.responsable || '-'}</span><br>
                    <span style="font-size:11px;color:#aaa">🕐 Últ. dato BI: ${hora}</span><br>
                    <span style="font-size:11px;color:#aaa">📅 Flujo: ${svTimestamp}</span>
                </div>
            </div>`)
            .addTo(sinVentaLayer);
    });
}

function toggleSinVenta() {
    sinVentaActive = !sinVentaActive;
    document.getElementById('btnSinVenta').classList.toggle('activo', sinVentaActive);
    if (sinVentaActive) {
        if (sinVentaCodes.size === 0) fetchSinVenta(); else renderSinVentaLayer();
    } else {
        sinVentaLayer.clearLayers();
    }
}

function togglePanel() {
    const panel = document.getElementById('panel');
    const btn   = document.getElementById('panelToggle');
    const abierto = panel.classList.toggle('abierto');
    btn.classList.toggle('abierto', abierto);
    btn.textContent = abierto ? '✕ Cerrar' : '👤 Ver RCs';
}

document.getElementById('supFilter').addEventListener('change', () => { renderRC(todosRCs); if (activeTab === 'dash') renderDashboard(); });
document.getElementById('zonalTipoFilter').addEventListener('change', () => { scheduleFullRender(); if (sinVentaActive) renderSinVentaLayer(); if (activeTab === 'dash') renderDashboard(); });

function _getActivosConFiltros() {
    const zf  = getZonalFiltro();
    const sup = document.getElementById('supFilter').value;
    let activos = puntosData.filter(p =>
        (p.estado || '').toUpperCase() !== 'CERRADO' &&
        (zf === 'ALL' || (p.zonal_tipo || '').toUpperCase() === zf) &&
        (sup === 'ALL' || p.supervisor === sup)
    );
    if (selectedRCFilter) {
        const campo = modoVista === 'cap' ? 'capacitador' : 'rc';
        const antes = activos.length;
        activos = activos.filter(p => (p[campo] || '').trim().toUpperCase() === selectedRCFilter.trim().toUpperCase());
        console.log(`Filtro RC: "${selectedRCFilter}" campo=${campo} antes=${antes} después=${activos.length}`);
    }
    if (selectedPartnerFilter) activos = activos.filter(p => p.responsable === selectedPartnerFilter);
    return activos;
}

function _descargarCSV(puntos, filename) {
    if (!puntos.length) { alert('No hay puntos para exportar con los filtros actuales.'); return; }
    const rows = [['Org ID', 'Partner', 'Nombre Tienda', 'RC', 'Supervisor']];
    puntos.forEach(p => rows.push([p.ID || '', p.responsable || '', p.nombre || '', p.rc || '', p.supervisor || '']));
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
}

function descargarSinVisita() {
    const visitedSet = selectedRCFilter ? (visitsByRC[selectedRCFilter] || new Set()) : null;
    const activos = _getActivosConFiltros();
    const sinVisita = activos.filter(p => {
        const id = normalizeID(p.ID);
        return visitedSet ? !visitedSet.has(id) : !(visitCountsSemana[id] > 0);
    });
    const semLabel = document.getElementById('semanaFilter').options[document.getElementById('semanaFilter').selectedIndex]?.textContent || 'semana';
    _descargarCSV(sinVisita, `sin_visita_${semLabel.replace(/[^a-zA-Z0-9]/g, '_')}.csv`);
}

function descargarVisitados() {
    const visitedSet = selectedRCFilter ? (visitsByRC[selectedRCFilter] || new Set()) : null;
    const activos = _getActivosConFiltros();
    const visitados = activos.filter(p => {
        const id = normalizeID(p.ID);
        return visitedSet ? visitedSet.has(id) : (visitCountsSemana[id] > 0);
    });
    const semLabel = document.getElementById('semanaFilter').options[document.getElementById('semanaFilter').selectedIndex]?.textContent || 'semana';
    _descargarCSV(visitados, `visitados_${semLabel.replace(/[^a-zA-Z0-9]/g, '_')}.csv`);
}

function buildSemanaFilter() {
    const today = new Date(); today.setHours(0,0,0,0);
    const primerDiaMes = new Date(today.getFullYear(), today.getMonth(), 1);
    const dow = primerDiaMes.getDay();
    const firstMonday = new Date(primerDiaMes);
    firstMonday.setDate(primerDiaMes.getDate() - (dow === 0 ? 6 : dow - 1));

    const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    const sel = document.getElementById('semanaFilter');
    sel.innerHTML = '';

    let semNum = 1;
    let cur = new Date(firstMonday);
    while (cur <= today) {
        const monday = new Date(cur);
        const saturday = new Date(cur);
        saturday.setDate(monday.getDate() + 5);
        const displayEnd = saturday > today ? today : saturday;

        const opt = document.createElement('option');
        opt.value = formatFecha(monday);
        const ini = `${monday.getDate()} ${meses[monday.getMonth()]}`;
        const fin = `${displayEnd.getDate()} ${meses[displayEnd.getMonth()]}`;
        opt.textContent = `Sem ${semNum} · ${ini}–${fin}`;
        sel.appendChild(opt);
        semNum++;
        cur.setDate(cur.getDate() + 7);
    }

    sel.selectedIndex = sel.options.length - 1;
    selectedSemanaMonday = new Date(sel.value + 'T00:00:00');

    sel.addEventListener('change', function() {
        semanaKeyCache = '';
        selectedSemanaMonday = new Date(this.value + 'T00:00:00');
        buildDayFilter(selectedSemanaMonday);
        updateSinVentaBtn();
        showDashLoading();
        cargarDatos();
        cargarDatosSemanales();
    });
}

buildSemanaFilter();
buildDayFilter(selectedSemanaMonday);
updateSinVentaBtn();
document.getElementById('btnModoRC').classList.toggle('activo', modoVista === 'rc');
document.getElementById('btnModoCap').classList.toggle('activo', modoVista === 'cap');
document.getElementById('btnRutaHoy').style.display = modoVista === 'cap' ? 'none' : '';
fetch((_BASE_DATA + 'puntos.json?v=') + new Date().getTime(), {cache: 'no-store'})
    .then(r => r.json())
    .then(data => { puntosData = normalizePuntos(data); cargarDatos(); cargarDatosSemanales(); })
    .catch(e => console.error('Error cargando puntos.json:', e));

// ── TAB: MAPA / DASHBOARD ─────────────────────────────────────────────────
let activeTab    = 'mapa';
let dashRCFilter = null;

function onDashRCChange() {
    dashRCFilter = document.getElementById('dashRCSelect')?.value || null;
    renderDashboard();
}

function showDashLoading() {
    if (activeTab !== 'dash') return;
    const c = document.getElementById('dashboardView');
    if (!c) return;
    c.innerHTML = '<div style="flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;color:#475569"><div class="dash-spin"></div><div style="font-size:13px;font-weight:600">Cargando datos...</div></div>';
}

function switchTab(tab) {
    activeTab = tab;
    const content = document.getElementById('content');
    const dash    = document.getElementById('dashboardView');
    document.getElementById('btnTabMapa').classList.toggle('tab-activo', tab === 'mapa');
    document.getElementById('btnTabDash').classList.toggle('tab-activo', tab === 'dash');
    // botones exclusivos del mapa: ocultar en dashboard
    ['btnTodosPuntos','btnSinVenta'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = tab === 'mapa' ? '' : 'none';
    });
    const btnRuta = document.getElementById('btnRutaHoy');
    if (btnRuta) btnRuta.style.display = tab === 'dash' ? 'none' : (modoVista === 'cap' ? 'none' : '');
    if (tab === 'mapa') {
        content.style.display = 'flex';
        dash.style.display    = 'none';
    } else {
        content.style.display = 'none';
        dash.style.display    = 'flex';
        renderDashboard();
    }
}

function renderDashboard() {
    const container = document.getElementById('dashboardView');
    if (!container) return;

    function parseTiempoSeg(t) {
        if (!t || t === '-') return null;
        const p = String(t).split(':').map(Number);
        if (p.length < 2 || isNaN(p[0])) return null;
        const v = p[0] * 3600 + p[1] * 60 + (p[2] || 0);
        return v > 0 ? v : null;
    }
    function fmtMin(secs) {
        if (!secs) return '-';
        const m = Math.floor(secs / 60), s = secs % 60;
        return m > 0 ? `${m}m ${s < 10 ? '0' : ''}${s}s` : `${s}s`;
    }
    function colorPct(pct) {
        return pct >= 60 ? '#10B981' : pct >= 30 ? '#F59E0B' : '#EF4444';
    }

    // ── Filtros activos ────────────────────────────────────────────────────
    const supFiltro = document.getElementById('supFilter')?.value || 'ALL';
    const zonFiltro = document.getElementById('zonalTipoFilter')?.value || 'ALL';

    // RCs para el selector (filtrados por supervisor, sin filtro de RC aún)
    const rcsParaSel = todosRCs
        .filter(r => supFiltro === 'ALL' || r.supervisor === supFiltro)
        .sort((a,b) => a.rc.localeCompare(b.rc));

    // Si el RC seleccionado ya no está en la lista visible, limpiar
    if (dashRCFilter && !rcsParaSel.some(r => r.rc === dashRCFilter)) dashRCFilter = null;

    let rcs = rcsParaSel;
    if (dashRCFilter) rcs = rcs.filter(r => r.rc === dashRCFilter);
    const allVisitas = rcs.flatMap(r => (r.visitas || []).map(v => ({ ...v, _rc: r.rc, _sup: r.supervisor })));
    const salidas    = allVisitas.filter(v => String(v.tipo).toUpperCase() === 'SALIDA');

    // puntos filtrados por zona
    const puntosActivos = puntosData.filter(p =>
        (p.estado||'').toUpperCase() !== 'CERRADO' &&
        (zonFiltro === 'ALL' || (p.zonal_tipo||'').toUpperCase() === zonFiltro)
    );

    // ── KPIs ──────────────────────────────────────────────────────────────
    const kpiRCs    = rcs.filter(r => (r.totalTiendas || 0) > 0).length;
    const kpiTiend  = new Set(allVisitas.filter(v => v.id).map(v => String(v.id))).size;
    const tiempos   = salidas.map(v => parseTiempoSeg(v.tiempoTienda)).filter(Boolean);
    const avgSeg    = tiempos.length ? Math.round(tiempos.reduce((a,b)=>a+b,0)/tiempos.length) : 0;
    const totalActivos = puntosActivos.length;

    // ── Distribución horaria ──────────────────────────────────────────────
    const porHora = {};
    allVisitas.forEach(v => {
        const h = parseInt((v.hora||'').split(':')[0]);
        if (!isNaN(h) && h >= 7 && h <= 20) porHora[h] = (porHora[h]||0) + 1;
    });
    const HORAS  = Array.from({length: 14}, (_,i) => i+7);
    const maxH   = Math.max(...HORAS.map(h => porHora[h]||0), 1);
    const picoH  = HORAS.reduce((a,h) => (porHora[h]||0) >= (porHora[a]||0) ? h : a, 7);

    // ── RC Ranking ────────────────────────────────────────────────────────
    const rcRanking = rcs.map(r => {
        const vis    = r.visitas || [];
        const sal    = vis.filter(v => String(v.tipo).toUpperCase() === 'SALIDA');
        const times  = sal.map(v => parseTiempoSeg(v.tiempoTienda)).filter(Boolean);
        const tProm  = times.length ? Math.round(times.reduce((a,b)=>a+b,0) / times.length) : 0;
        const dists  = vis.map(v => parseFloat(v.dist)||0).filter(d => d > 0);
        const dProm  = dists.length ? Math.round(dists.reduce((a,b)=>a+b,0)/dists.length) : 0;
        return { rc: r.rc, sup: r.supervisor||'-', tiendas: r.totalTiendas||0,
                 primera: r.primeraVisita||'-', tProm, dProm };
    }).sort((a,b) => b.tiendas - a.tiendas);

    // ── Cobertura por zona (semanal) ──────────────────────────────────────
    const byZona = {};
    puntosActivos.forEach(p => {
        const z = (p.zona||'Sin zona').trim();
        if (!byZona[z]) byZona[z] = { total:0, visitados:0 };
        byZona[z].total++;
        if ((visitCountsSemana[normalizeID(p.ID)]||0) > 0) byZona[z].visitados++;
    });
    const zonas = Object.entries(byZona)
        .filter(([,v]) => v.total > 0)
        .sort((a,b) => (b[1].visitados/b[1].total) - (a[1].visitados/a[1].total));

    // ── Cobertura por tipo de tienda (semanal) ────────────────────────────
    const byTipo = {};
    puntosActivos.forEach(p => {
        const t = (p.tipo || 'Sin tipo').trim();
        if (!byTipo[t]) byTipo[t] = { total: 0, visit: 0 };
        byTipo[t].total++;
        if ((visitCountsSemana[normalizeID(p.ID)] || 0) > 0) byTipo[t].visit++;
    });
    const tipoStats = Object.entries(byTipo)
        .filter(([,v]) => v.total > 0)
        .sort((a,b) => b[1].total - a[1].total);

    const modoLabel   = modoVista === 'cap' ? 'Capacitadores' : 'RCs';
    const fechaLabel  = selectedDate ? selectedDate : 'Hoy';

    container.innerHTML = `<div class="dash-inner">
        <div class="dash-header">
            <div>
                <div class="dash-header-title">Dashboard de Visitas</div>
                <div class="dash-header-sub">${fechaLabel} &nbsp;·&nbsp; ${modoLabel}${dashRCFilter ? ' &nbsp;·&nbsp; ' + dashRCFilter : ''}</div>
            </div>
            <select id="dashRCSelect" onchange="onDashRCChange()" style="padding:6px 10px;border-radius:8px;border:1px solid #334155;background:#1E293B;color:#CBD5E1;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;outline:none;max-width:220px">
                <option value="">Todos los RCs</option>
                ${rcsParaSel.map(r => `<option value="${r.rc}"${dashRCFilter===r.rc?' selected':''}>${r.rc}</option>`).join('')}
            </select>
        </div>

        <div class="dash-kpi-row">
            <div class="dash-kpi">
                <div class="dash-kpi-label">${modoLabel} activos</div>
                <div class="dash-kpi-value">${kpiRCs}</div>
                <div class="dash-kpi-sub">de ${rcs.length} en total</div>
            </div>
            <div class="dash-kpi">
                <div class="dash-kpi-label">Tiendas visitadas</div>
                <div class="dash-kpi-value">${kpiTiend}</div>
                <div class="dash-kpi-sub">${totalActivos} activas en base</div>
            </div>
            <div class="dash-kpi">
                <div class="dash-kpi-label">Marcaciones</div>
                <div class="dash-kpi-value">${allVisitas.length}</div>
                <div class="dash-kpi-sub">${salidas.length} salidas registradas</div>
            </div>
            <div class="dash-kpi">
                <div class="dash-kpi-label">Tiempo promedio</div>
                <div class="dash-kpi-value" style="font-size:20px;padding-top:3px">${fmtMin(avgSeg)}</div>
                <div class="dash-kpi-sub">por tienda · ${tiempos.length} visitas</div>
            </div>
        </div>

        ${(function() {
            // ── Gráfica de líneas: Visitadas vs Meta por día ──────────────
            const rcNamesChart = new Set(
                todosRCs.filter(r => supFiltro === 'ALL' || r.supervisor === supFiltro).map(r => r.rc)
            );
            const DAY_S = ['Lun','Mar','Mié','Jue','Vie','Sáb'];

            const lineData = weekDates.map(fecha => {
                const d       = new Date(fecha + 'T12:00:00');
                const dayNorm = normDia(DIAS_SEMANA[d.getDay()]);
                const dowIdx  = (d.getDay() + 6) % 7;

                // META: tiendas asignadas para ese día con filtros activos
                const meta = puntosActivos.filter(p => {
                    if (dashRCFilter && (p.rc||'').trim() !== dashRCFilter) return false;
                    if (supFiltro !== 'ALL' && !rcNamesChart.has(p.rc||'')) return false;
                    return (p.dias||[]).some(dia => normDia(dia) === dayNorm);
                }).length;

                // REAL: tiendas efectivamente visitadas ese día
                let real = 0;
                if (dashRCFilter) {
                    real = ((visitsByDateRC[fecha]||{})[dashRCFilter]||new Set()).size;
                } else if (supFiltro !== 'ALL') {
                    const st = new Set();
                    Object.entries(visitsByDateRC[fecha]||{}).forEach(([rc,ids]) => {
                        if (rcNamesChart.has(rc)) ids.forEach(id => st.add(id));
                    });
                    real = st.size;
                } else {
                    real = (visitsByDate[fecha]||new Set()).size;
                }

                return { fecha, dia: DAY_S[dowIdx]||'', label: `${DAY_S[dowIdx]} ${d.getDate()}/${d.getMonth()+1}`, meta, real };
            });

            if (lineData.length === 0) return '';

            // SVG
            const W=580, H=150, ML=38, MR=16, MT=18, MB=38;
            const CW=W-ML-MR, CH=H-MT-MB;
            const n = lineData.length;
            const maxY = Math.max(...lineData.flatMap(d=>[d.meta,d.real]), 1);
            const xP = i => ML + (n>1 ? i/(n-1) : 0.5)*CW;
            const yP = v => MT + CH*(1 - v/maxY);

            const gridVals = [0,.25,.5,.75,1].map(f => Math.round(maxY*f));
            const gridH = gridVals.map(v =>
                `<line x1="${ML}" y1="${yP(v).toFixed(1)}" x2="${ML+CW}" y2="${yP(v).toFixed(1)}" stroke="#1B2A42" stroke-width="1"/>
                 <text x="${ML-5}" y="${(yP(v)+3).toFixed(1)}" text-anchor="end" fill="#334155" font-size="9">${v}</text>`
            ).join('');

            const metaPts = lineData.map((d,i)=>`${xP(i).toFixed(1)},${yP(d.meta).toFixed(1)}`).join(' ');
            const realPts = lineData.map((d,i)=>`${xP(i).toFixed(1)},${yP(d.real).toFixed(1)}`).join(' ');
            const areaFill= `${xP(0).toFixed(1)},${(MT+CH).toFixed(1)} ${realPts} ${xP(n-1).toFixed(1)},${(MT+CH).toFixed(1)}`;

            const metaDots = lineData.map((d,i) => {
                const cx=xP(i).toFixed(1), cy=yP(d.meta).toFixed(1);
                return `<circle cx="${cx}" cy="${cy}" r="3.5" fill="#10B981" stroke="#0B1120" stroke-width="1.5"/>
                        <text x="${cx}" y="${(yP(d.meta)-7).toFixed(1)}" text-anchor="middle" fill="#10B981" font-size="9" font-weight="700">${d.meta}</text>`;
            }).join('');

            const realDots = lineData.map((d,i) => {
                const cx=xP(i).toFixed(1);
                const labelY = d.real <= d.meta ? (yP(d.real)+14).toFixed(1) : (yP(d.real)-7).toFixed(1);
                return `<circle cx="${cx}" cy="${yP(d.real).toFixed(1)}" r="3.5" fill="#6366F1" stroke="#0B1120" stroke-width="1.5"/>
                        <text x="${cx}" y="${labelY}" text-anchor="middle" fill="#818CF8" font-size="9" font-weight="700">${d.real}</text>`;
            }).join('');

            const xLabels = lineData.map((d,i)=>
                `<text x="${xP(i).toFixed(1)}" y="${H-5}" text-anchor="middle" fill="#475569" font-size="10">${d.label}</text>`
            ).join('');

            const pctHoy = lineData.length > 0 && lineData[lineData.length-1].meta > 0
                ? Math.round(lineData[lineData.length-1].real / lineData[lineData.length-1].meta * 100) : null;

            return `<div class="dash-card" style="margin-bottom:12px">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
                    <div class="dash-card-title" style="margin-bottom:0">Evolución de visitas · tiendas visitadas vs asignadas</div>
                    <div style="display:flex;gap:14px;font-size:10px;font-weight:700">
                        <span style="color:#10B981">── Asignadas</span>
                        <span style="color:#6366F1">── Visitadas</span>
                        ${pctHoy !== null ? `<span style="color:${colorPct(pctHoy)};padding:2px 8px;background:rgba(99,102,241,.1);border-radius:8px">${pctHoy}% último día</span>` : ''}
                    </div>
                </div>
                <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;overflow:visible">
                    ${gridH}
                    <line x1="${ML}" y1="${MT}" x2="${ML}" y2="${MT+CH}" stroke="#334155" stroke-width="1"/>
                    <line x1="${ML}" y1="${MT+CH}" x2="${ML+CW}" y2="${MT+CH}" stroke="#334155" stroke-width="1"/>
                    <polygon points="${areaFill}" fill="#6366F1" opacity="0.06"/>
                    <polyline points="${metaPts}" fill="none" stroke="#10B981" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.7"/>
                    <polyline points="${realPts}" fill="none" stroke="#6366F1" stroke-width="2.5"/>
                    ${metaDots}${realDots}${xLabels}
                </svg>
            </div>`;
        })()}

        ${(function() {
            const rcCumpl = rcs.map(r => {
                const asign  = puntosActivos.filter(p => (p.rc||'').trim() === r.rc.trim());
                const visSet = visitsByRC[r.rc] || new Set();
                const visit  = asign.filter(p => visSet.has(normalizeID(p.ID))).length;
                const pct    = asign.length > 0 ? Math.round(visit / asign.length * 100) : 0;
                return { rc: r.rc, sup: r.supervisor||'-', asign: asign.length, visit, pct };
            }).filter(r => r.asign > 0).sort((a,b) => b.pct - a.pct || b.visit - a.visit);
            if (!rcCumpl.length) return '';
            return `<div class="dash-card" style="margin-bottom:12px">
                <div class="dash-card-title">Cumplimiento de ruta semanal · por RC</div>
                <div class="dash-zona-grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">
                    ${rcCumpl.map(r => {
                        const color = colorPct(r.pct);
                        return `<div>
                            <div style="display:flex;justify-content:space-between;align-items:baseline">
                                <div class="dash-zona-name" style="font-size:12px">${r.rc}</div>
                                <div style="font-size:10px;color:${color};font-weight:700">${r.pct}%</div>
                            </div>
                            <div class="dash-zona-stat" style="color:#475569">${r.visit}/${r.asign} tiendas asignadas</div>
                            <div class="dash-zona-bg"><div class="dash-zona-fill" style="width:${r.pct}%;background:${color}"></div></div>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        })()}

        <div class="dash-grid">
            <div class="dash-card">
                <div class="dash-card-title">Ranking de ${modoLabel.toLowerCase()}</div>
                ${rcRanking.length === 0
                    ? '<div style="color:#475569;font-size:12px;text-align:center;padding:24px 0">Sin registros</div>'
                    : `<div style="overflow-x:auto"><table class="dash-table">
                        <thead><tr>
                            <th class="td-num">#</th>
                            <th>Nombre</th>
                            <th>Tiendas</th>
                            <th>Prom./tienda</th>
                            <th>Dist.</th>
                        </tr></thead>
                        <tbody>${rcRanking.map((r,i) => `<tr>
                            <td class="td-num">${i+1}</td>
                            <td>
                                <div class="td-name">${r.rc}</div>
                                <div class="td-sup">${r.sup} &nbsp;·&nbsp; ⏰ ${r.primera}</div>
                            </td>
                            <td><span class="td-badge">${r.tiendas}</span></td>
                            <td>${fmtMin(r.tProm)}</td>
                            <td>${r.dProm > 0 ? r.dProm+'m' : '—'}</td>
                        </tr>`).join('')}</tbody>
                    </table></div>`}
            </div>

            <div style="display:flex;flex-direction:column;gap:12px">
                <div class="dash-card">
                    <div class="dash-card-title">Marcaciones por hora</div>
                    <div class="dash-hora-wrap">
                        ${HORAS.map(h => {
                            const cnt  = porHora[h]||0;
                            const barH = Math.max(Math.round(cnt/maxH*60), cnt>0?4:2);
                            const cls  = h===picoH && cnt>0 ? 'peak' : cnt > maxH*0.5 ? 'hi' : '';
                            return `<div class="dash-hora-col">
                                <div class="dash-hora-bar ${cls}" style="height:${barH}px" title="${cnt}"></div>
                                <div class="dash-hora-lbl">${h}</div>
                            </div>`;
                        }).join('')}
                    </div>
                    ${allVisitas.length > 0 ? `<div style="margin-top:10px;font-size:10px;color:#475569;text-align:right">
                        Pico: ${picoH}:00 &nbsp;·&nbsp; ${porHora[picoH]||0} marcaciones
                    </div>` : '<div style="color:#475569;font-size:11px;text-align:center;padding:12px 0">Sin marcaciones</div>'}
                </div>
                <div class="dash-card">
                    <div class="dash-card-title">Cobertura por tipo · semanal</div>
                    ${tipoStats.length === 0
                        ? '<div style="color:#475569;font-size:12px;text-align:center;padding:16px 0">Sin datos</div>'
                        : `<div style="display:flex;flex-direction:column;gap:9px;margin-top:4px">
                            ${tipoStats.map(([tipo, d]) => {
                                const pct   = d.total > 0 ? Math.round(d.visit/d.total*100) : 0;
                                const color = colorPct(pct);
                                return `<div>
                                    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:1px">
                                        <div style="font-size:11px;font-weight:600;color:#CBD5E1">${tipo}</div>
                                        <div style="font-size:10px;color:${color};font-weight:700">${pct}%</div>
                                    </div>
                                    <div style="font-size:10px;color:#475569;margin-bottom:3px">${d.visit}/${d.total} tiendas</div>
                                    <div class="dash-zona-bg"><div class="dash-zona-fill" style="width:${pct}%;background:${color}"></div></div>
                                </div>`;
                            }).join('')}
                        </div>`}
                </div>
            </div>
        </div>

        ${(function() {
            // ── Evolución semanal ──────────────────────────────────────────
            const DAY_NAMES  = ['Lun','Mar','Mié','Jue','Vie','Sáb'];
            const DAY_LONG   = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
            const rcNamesSet = new Set(rcs.map(r => r.rc));

            const dayStats = weekDates.map(fecha => {
                const rcMap  = visitsByDateRC[fecha] || {};
                const stores = new Set();
                const rcAct  = new Set();
                if (dashRCFilter) {
                    const ids = rcMap[dashRCFilter] || new Set();
                    ids.forEach(id => stores.add(id));
                    if (ids.size > 0) rcAct.add(dashRCFilter);
                } else {
                    Object.entries(rcMap).forEach(([rcName, ids]) => {
                        if (supFiltro === 'ALL' || rcNamesSet.has(rcName)) {
                            ids.forEach(id => stores.add(id));
                            if (ids.size > 0) rcAct.add(rcName);
                        }
                    });
                }
                const d      = new Date(fecha + 'T12:00:00');
                const dowIdx = ((d.getDay() + 6) % 7);
                return {
                    fecha,
                    dia:     DAY_NAMES[dowIdx]  || '',
                    diaLong: DAY_LONG[dowIdx]   || '',
                    label:   `${d.getDate()}/${d.getMonth()+1}`,
                    stores:  stores.size,
                    rcs:     rcAct.size
                };
            });

            const maxStores = Math.max(...dayStats.map(d => d.stores), 1);

            return `
            <div class="dash-grid" style="margin-bottom:12px">
                <!-- Por día de semana: visual -->
                <div class="dash-card">
                    <div class="dash-card-title">Evolución · por día de semana</div>
                    ${dayStats.length === 0
                        ? '<div style="color:#475569;font-size:12px;text-align:center;padding:24px 0">Sin datos semanales</div>'
                        : `<div style="display:flex;align-items:flex-end;gap:6px;height:80px;margin-bottom:8px">
                            ${dayStats.map(d => {
                                const barH = Math.max(Math.round(d.stores / maxStores * 68), d.stores > 0 ? 6 : 2);
                                const color = d.stores === 0 ? '#243447'
                                    : d.stores === Math.max(...dayStats.map(x=>x.stores)) ? '#6366F1' : '#334155';
                                return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px">
                                    <div style="font-size:9px;color:#64748B;font-weight:700">${d.stores||''}</div>
                                    <div style="width:100%;border-radius:3px 3px 0 0;background:${color};height:${barH}px;transition:height .3s"></div>
                                    <div style="font-size:10px;color:#475569;font-weight:600">${d.dia}</div>
                                </div>`;
                            }).join('')}
                        </div>
                        <div style="font-size:10px;color:#334155;border-top:1px solid #1B2A42;padding-top:8px;display:flex;gap:8px;flex-wrap:wrap">
                            ${dayStats.map(d => `<span style="color:#475569">${d.diaLong}: <b style="color:#94A3B8">${d.rcs} RC${d.rcs!==1?'s':''}</b></span>`).join(' · ')}
                        </div>`}
                </div>
                <!-- Por fecha: tabla -->
                <div class="dash-card">
                    <div class="dash-card-title">Detalle · por fecha</div>
                    ${dayStats.length === 0
                        ? '<div style="color:#475569;font-size:12px;text-align:center;padding:24px 0">Sin datos</div>'
                        : `<div style="overflow-x:auto"><table class="dash-table">
                            <thead><tr>
                                <th>Día</th><th>Fecha</th><th>Tiendas</th><th>RCs</th>
                            </tr></thead>
                            <tbody>${dayStats.map(d => `<tr>
                                <td style="font-weight:700;color:#CBD5E1">${d.dia}</td>
                                <td style="color:#64748B">${d.label}</td>
                                <td><span style="font-weight:700;color:#${d.stores>0?'F1F5F9':'475569'}">${d.stores}</span></td>
                                <td style="color:#64748B">${d.rcs}</td>
                            </tr>`).join('')}</tbody>
                        </table></div>`}
                </div>
            </div>`;
        })()}

        <div class="dash-card" style="margin-bottom:12px">
            <div class="dash-card-title">Cobertura semanal por zona</div>
            ${zonas.length === 0
                ? '<div style="color:#475569;font-size:12px;text-align:center;padding:24px 0">Sin datos de puntos</div>'
                : `<div class="dash-zona-grid">${zonas.map(([zona,d]) => {
                    const pct   = d.total>0 ? Math.round(d.visitados/d.total*100) : 0;
                    const color = colorPct(pct);
                    return `<div>
                        <div class="dash-zona-name">${zona}</div>
                        <div class="dash-zona-stat" style="color:${color}">${d.visitados}/${d.total} &nbsp;·&nbsp; ${pct}%</div>
                        <div class="dash-zona-bg"><div class="dash-zona-fill" style="width:${pct}%;background:${color}"></div></div>
                    </div>`;
                }).join('')}</div>`}
        </div>
    </div>`;
}
// ──────────────────────────────────────────────────────────────────────────

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
                            puntosData = normalizePuntos(data);
                            scheduleFullRender();
                            console.log('Datos actualizados automaticamente:', d.v);
                        }).catch(() => {});
                }
            }).catch(() => {});
    }, 5 * 60 * 1000);
})();
// ──────────────────────────────────────────────────────────────────────────
