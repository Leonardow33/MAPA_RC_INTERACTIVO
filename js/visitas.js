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
let sinVentaCodes = new Set();
let sinVentaActive = false;
let selectedDate = '';
const sinVentaLayer    = L.layerGroup().addTo(map);
const todosLosPointsLayer = L.layerGroup().addTo(map);
const rutaHoyLayer     = L.layerGroup().addTo(map);
const sinVisitarLayer  = L.layerGroup().addTo(map);
let todosLosPointsActive = true;
let rutaHoyActive        = false;
let selectedPartnerFilter = null;
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
let selectedRCFilter = null;

function matchRCFilter(p) {
    if (!selectedRCFilter) return true;
    return modoVista === 'cap'
        ? p.capacitador === selectedRCFilter
        : matchRCFilter(p);
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
        ? `📊 Cobertura · ${selectedRCFilter}`
        : '📊 Cobertura por partner';
    selectedPartnerFilter = null;
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
        (p.estado || '').toUpperCase() === 'ACTIVO' &&
        (zf === 'ALL' || (p.zonal_tipo || '').toUpperCase() === zf)
    );
    if (selectedRCFilter) activos = activos.filter(p => matchRCFilter(p));
    let visitados = 0;
    activos.forEach(p => {
        if (!p.lat || !p.lng) return;
        const id    = normalizeID(p.ID);
        const count = visitCountsSemana[id] || 0;
        if (count > 0) visitados++;
        const color = count > 0 ? '#43A047' : '#78909C';
        const visitaLabel = count > 0
            ? `<b style="color:#43A047">✅ ${count} visita${count > 1 ? 's' : ''} esta semana</b>`
            : `<span style="color:#aaa">Sin visitas esta semana</span>`;
        L.circleMarker([parseFloat(p.lat), parseFloat(p.lng)], {
            radius: 6, fillColor: color, color: '#fff',
            weight: 1, fillOpacity: count > 0 ? 0.85 : 0.65, opacity: 0.9
        }).addTo(todosLosPointsLayer)
          .bindPopup(`<b>${p.nombre}</b><br><small>ID: ${p.ID} · RC: ${p.rc || '-'} · ${p.zona || '-'}</small><br>${visitaLabel}`);
    });
    const pct = activos.length > 0 ? Math.round(visitados / activos.length * 100) : 0;
    const rcLabel = selectedRCFilter ? ` · ${selectedRCFilter}` : '';
    btn.textContent = `📍 ${visitados}/${activos.length} visitados (${pct}%)${rcLabel}`;
    renderCobertura();
}

function renderCobertura() {
    const list = document.getElementById('coberturaList');
    if (!puntosData.length) return;

    const zf = getZonalFiltro();
    let activos = puntosData.filter(p =>
        (p.estado || '').toUpperCase() === 'ACTIVO' &&
        (zf === 'ALL' || (p.zonal_tipo || '').toUpperCase() === zf)
    );
    if (selectedRCFilter) {
        activos = activos.filter(p => matchRCFilter(p));
    }

    const todayNorm = normDia(DIAS_SEMANA[new Date().getDay()]);
    if (rutaHoyActive && selectedRCFilter) {
        activos = activos.filter(p => Array.isArray(p.dias) && p.dias.some(d => normDia(d) === todayNorm));
    }

    const visitedSet = rutaHoyActive && selectedRCFilter
        ? (visitsByRCToday[selectedRCFilter] || new Set())
        : selectedRCFilter
            ? (visitsByRC[selectedRCFilter] || new Set())
            : null;

    const byPartner = {};
    activos.forEach(p => {
        const partner = p.responsable || 'Sin partner';
        if (!byPartner[partner]) byPartner[partner] = { total: 0, visitados: 0 };
        byPartner[partner].total++;
        const id = normalizeID(p.ID);
        const visitado = visitedSet
            ? visitedSet.has(id)
            : (visitCountsSemana[id] || 0) > 0;
        if (visitado) byPartner[partner].visitados++;
    });

    const rows = Object.entries(byPartner)
        .map(([nombre, d]) => ({ nombre, ...d, pct: d.total > 0 ? d.visitados / d.total : 0 }))
        .sort((a, b) => b.pct - a.pct);

    // Resumen general
    const totalGral     = activos.length;
    const visitadosGral = activos.filter(p => {
        const id = normalizeID(p.ID);
        return visitedSet ? visitedSet.has(id) : (visitCountsSemana[id] || 0) > 0;
    }).length;
    const pctGral = totalGral > 0 ? Math.round(visitadosGral / totalGral * 100) : 0;
    const colorGral = pctGral >= 60 ? '#43A047' : pctGral >= 30 ? '#FB8C00' : '#E53935';
    const resTexto = document.getElementById('resumenTexto');
    const resBar   = document.getElementById('resumenBar');
    if (resTexto) resTexto.innerHTML = `<span style="color:${colorGral}">${visitadosGral} / ${totalGral} visitados &nbsp;·&nbsp; <b>${pctGral}%</b></span>`;
    if (resBar)   { resBar.style.width = pctGral + '%'; resBar.style.background = colorGral; }

    list.innerHTML = '';
    if (!rows.length) {
        list.innerHTML = '<div style="padding:16px;color:#aaa;font-size:12px;text-align:center">Sin datos</div>';
        return;
    }
    rows.forEach(r => {
        const pct = Math.round(r.pct * 100);
        const color = pct >= 60 ? '#43A047' : pct >= 30 ? '#FB8C00' : '#E53935';
        const esSeleccionado = selectedPartnerFilter === r.nombre;
        const div = document.createElement('div');
        div.className = 'partner-row' + (esSeleccionado ? ' seleccionado' : '');
        div.style.cursor = 'pointer';
        if (esSeleccionado) div.style.background = '#fff3e0';
        div.innerHTML = `
            <div class="partner-nombre">${r.nombre}${esSeleccionado ? ' <span style="color:#FB8C00;font-size:10px">● filtrado</span>' : ''}</div>
            <div class="partner-stats">${r.visitados} de ${r.total} puntos &nbsp;·&nbsp; <b style="color:${color}">${pct}%</b></div>
            <div class="partner-bar"><div class="partner-bar-fill" style="width:${pct}%;background:${color}"></div></div>`;
        div.addEventListener('click', () => {
            selectedPartnerFilter = selectedPartnerFilter === r.nombre ? null : r.nombre;
            renderSinVisitar();
            renderCobertura();
            if (rutaHoyActive) renderRutaHoy();
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
    const fetches = [];
    for (let i = 0; i < 6; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        if (d > today) continue;
        const fecha = formatFecha(d);
        fetches.push(
            fetch(SHEET_URL + `?action=${modoVista === 'cap' ? 'getVisitasMapa2' : 'getVisitas'}&fecha=${fecha}`)
                .then(r => r.json()).catch(() => [])
        );
    }

    const results = await Promise.all(fetches);
    visitCountsSemana = {};
    visitsByRC = {};
    results.forEach(dayData => {
        if (!Array.isArray(dayData)) return;
        dayData.forEach(rcEntry => {
            const rcName = rcEntry.rc || '';
            if (rcName && !visitsByRC[rcName]) visitsByRC[rcName] = new Set();
            (rcEntry.visitas || []).forEach(v => {
                if (v.id) {
                    const id = normalizeID(v.id);
                    visitCountsSemana[id] = (visitCountsSemana[id] || 0) + 1;
                    if (rcName) visitsByRC[rcName].add(id);
                }
            });
        });
    });

    scheduleFullRender();
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
    if (!selectedPartnerFilter) return;

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
        (p.estado || '').toUpperCase() === 'ACTIVO' &&
        !fueVisitado(normalizeID(p.ID)) &&
        (selectedRCFilter ? matchRCFilter(p) : true) &&
        p.responsable === selectedPartnerFilter &&
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
        (p.estado || '').toUpperCase() === 'ACTIVO' &&
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
        if ((p.estado || '').toUpperCase() !== 'ACTIVO') return;
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

document.getElementById('supFilter').addEventListener('change', () => renderRC(todosRCs));
document.getElementById('zonalTipoFilter').addEventListener('change', () => { scheduleFullRender(); if (sinVentaActive) renderSinVentaLayer(); });

function _getActivosConFiltros() {
    const zf  = getZonalFiltro();
    const sup = document.getElementById('supFilter').value;
    let activos = puntosData.filter(p =>
        (p.estado || '').toUpperCase() === 'ACTIVO' &&
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
fetch('data/puntos.json?v=' + new Date().getTime())
    .then(r => r.json())
    .then(data => { puntosData = data; cargarDatos(); cargarDatosSemanales(); })
    .catch(e => console.error('Error cargando puntos.json:', e));
