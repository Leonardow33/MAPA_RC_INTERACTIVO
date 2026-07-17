const _BASE_DATA = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'data/' : 'https://raw.githubusercontent.com/Leonardow33/MAPA_RC_INTERACTIVO/main/data/';
const PUNTOS_URL    = (_BASE_DATA + 'puntos.json');
const DISTRITOS_URL = 'https://raw.githubusercontent.com/Leonardow33/MAPA_RC_INTERACTIVO/main/data/distritos.geojson';

const BASEMAPS = {
    'Calles':    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',                                { attribution: '© OpenStreetMap', maxZoom: 19 }),
    'Claro':     L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',                  { attribution: '© CARTO', maxZoom: 19 }),
    'Oscuro':    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',                   { attribution: '© CARTO', maxZoom: 19 }),
    'Satélite':  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '© Esri', maxZoom: 19 }),
};

const map = L.map('map', { preferCanvas: true }).setView([-9.19, -75.0], 6);
BASEMAPS['Calles'].addTo(map);

// Control de mapa base
let basemapActual = 'Calles';
const bmControl = L.control({ position: 'topright' });
bmControl.onAdd = function() {
    const div = L.DomUtil.create('div', 'bm-control');
    div.innerHTML = Object.keys(BASEMAPS).map(name =>
        `<button class="bm-btn${name === basemapActual ? ' activo' : ''}" onclick="cambiarMapa('${name}')">${name}</button>`
    ).join('');
    L.DomEvent.disableClickPropagation(div);
    return div;
};
bmControl.addTo(map);

function cambiarMapa(name) {
    if (name === basemapActual) return;
    BASEMAPS[basemapActual].remove();
    BASEMAPS[name].addTo(map);
    basemapActual = name;
    document.querySelectorAll('.bm-btn').forEach(b => b.classList.toggle('activo', b.textContent === name));
}

const distritoLayer = L.layerGroup().addTo(map);
const markerLayer   = L.layerGroup().addTo(map);

let allData      = [];

function normalizePuntos(data) {
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
            dias };
    });
}

let distritosGeo = null;
let rcColorMap   = {};
let rcSelected   = null;
let diaSelected  = null;
let viewMode     = 'rc'; // 'rc' | 'dia'

const DIA_COLORS = {
    'LUNES':     '#1E88E5',
    'MARTES':    '#22c55e',
    'MIÉRCOLES': '#f97316',
    'MIERCOLES': '#f97316',
    'JUEVES':    '#a855f7',
    'VIERNES':   '#ef4444',
    'SÁBADO':    '#e91e63',
    'SABADO':    '#e91e63',
};
const DIAS_ORDEN = ['LUNES','MARTES','MIÉRCOLES','JUEVES','VIERNES','SÁBADO'];

function getDiaColor(p) {
    const dias = (p.dias || []).filter(d => d !== 'SIN RUTA');
    if (dias.length === 0) return '#475569';
    // Usar el primer día asignado como color principal
    for (const d of DIAS_ORDEN) {
        if (dias.includes(d) || dias.includes(d.replace('É','E').replace('Á','A'))) {
            return DIA_COLORS[d] || DIA_COLORS[d.replace('É','E').replace('Á','A')] || '#475569';
        }
    }
    return DIA_COLORS[dias[0]] || '#475569';
}

function elegirTipoZona(tipo) {
    document.getElementById('seleccionTipo').classList.add('oculto');
    document.getElementById('fTipo').value = tipo;
    rcSelected = null;
    repoblarSupRC();
    render();
    // Zoom a los puntos del tipo seleccionado
    if (tipo !== 'ALL' && allData.length) {
        const pts = allData.filter(p => matchFiltros(p, { sup:'ALL', rc:'ALL', dia:'ALL', tipo, zona:'ALL' }));
        if (pts.length) {
            const bounds = L.latLngBounds(pts.map(p => [p.lat, p.lng]));
            map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13, animate: true });
        }
    }
}

function setViewMode(mode) {
    viewMode    = mode;
    rcSelected  = null;
    diaSelected = null;
    document.getElementById('tabRC').classList.toggle('activo',  mode === 'rc');
    document.getElementById('tabDia').classList.toggle('activo', mode === 'dia');
    render();
}

const PALETTE = [
    '#E53935','#8E24AA','#1E88E5','#43A047','#FB8C00',
    '#6D4C41','#F4511E','#3949AB','#00897B','#FDD835',
    '#D81B60','#5E35B1','#7CB342','#FF7043','#AB47BC',
    '#66BB6A','#EF5350','#EC407A','#26A69A','#FF6D00',
    '#78909C','#F9A825','#558B2F','#AD1457','#1565C0'
];

function getColor(rc) {
    if (!rcColorMap[rc]) {
        const idx = Object.keys(rcColorMap).length % PALETTE.length;
        rcColorMap[rc] = PALETTE[idx];
    }
    return rcColorMap[rc];
}

function makePinIcon(color, dimmed, rcDot) {
    const op = dimmed ? 0.12 : 1;
    const dot = rcDot ? `<circle cx="6" cy="0" r="4" fill="${rcDot}" stroke="white" stroke-width="1.5" opacity="${op}"/>` : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="22" viewBox="0 0 12 22">
        <path d="M6 4C2.7 4 0 6.7 0 10C0 15.5 6 22 6 22S12 15.5 12 10C12 6.7 9.3 4 6 4Z"
              fill="${color}" opacity="${op}" stroke="rgba(0,0,0,0.3)" stroke-width="0.7"/>
        <circle cx="6" cy="10" r="2.2" fill="white" opacity="${op * 0.9}"/>
        ${dot}
    </svg>`;
    return L.divIcon({
        className: '',
        html: svg,
        iconSize: [12, 22],
        iconAnchor: [6, 22],
        popupAnchor: [0, -22]
    });
}

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${alpha})`;
}

function buildPopup(p) {
    const color = getColor(p.rc);
    const tipoColor = p.tipo === 'TAMBO' ? '#1E88E5'
        : p.tipo === 'CASA DE APUESTA' ? '#8E24AA' : '#607D8B';
    const dias = (p.dias || []).filter(d => d !== 'SIN RUTA').join(', ');
    return `<div>
        <div class="pz-nombre">${p.nombre}</div>
        <div class="pz-row"><b>RC:</b> <span style="color:${color};font-weight:700">${p.rc || '—'}</span></div>
        <div class="pz-row"><b>Supervisor:</b> ${p.supervisor || '—'}</div>
        <div class="pz-row"><b>Partner:</b> ${p.responsable || '—'}</div>
        ${dias ? `<div class="pz-row"><b>Días:</b> ${dias}</div>` : ''}
        <div class="pz-row"><b>Distrito:</b> ${p.distrito || '—'}</div>
        <span class="pz-tag" style="background:${tipoColor}">${p.tipo || 'BODEGA'}</span>
    </div>`;
}

function getFiltros() {
    return {
        sup:  document.getElementById('fSup').value,
        rc:   document.getElementById('fRC').value,
        dia:  document.getElementById('fDia').value,
        tipo: document.getElementById('fTipo').value,
        zona: document.getElementById('fZona').value,
    };
}

function getSupervisoresCA() {
    return new Set(allData
        .filter(p => (p.tipo || '').toUpperCase() === 'CASA DE APUESTA' && p.supervisor)
        .map(p => p.supervisor));
}

function matchFiltros(p, f) {
    if (f.sup !== 'ALL' && p.supervisor !== f.sup) return false;
    if (f.rc  !== 'ALL' && p.rc         !== f.rc)  return false;
    if (f.dia !== 'ALL' && !(p.dias || []).includes(f.dia)) return false;

    const t = (p.tipo || '').toUpperCase();
    const mostrarBodegas   = document.getElementById('chkBodegas')?.checked;
    const mostrarInactivos = document.getElementById('chkInactivos')?.checked;

    // Inactivos: ocultar si no está el checkbox marcado
    if (!mostrarInactivos && (p.estado||'').toUpperCase() === 'INACTIVO') return false;

    // Bodegas y Cencos: ocultar por defecto
    if (!mostrarBodegas && (t === 'BODEGA' || t === 'CENCOS')) return false;

    if (f.tipo !== 'ALL') {
        if (f.tipo === 'TAMBO'           && t !== 'TAMBO' && t !== 'SUERTE' && t !== 'BODEGA' && t !== 'CENCOS') return false;
        if (f.tipo === 'CASA DE APUESTA' && t !== 'CASA DE APUESTA' && t !== 'BODEGA' && t !== 'CENCOS') return false;
    }
    if (f.zona !== 'ALL' && (p.zonal_tipo || '').toUpperCase() !== f.zona) return false;
    return true;
}

// Calcula el RC dominante por distrito y la distribución completa
function calcDistritoInfo(visible) {
    const info = {};
    visible.forEach(p => {
        const dist = (p.distrito || '').toUpperCase().trim();
        if (!dist) return;
        if (!info[dist]) info[dist] = {};
        info[dist][p.rc] = (info[dist][p.rc] || 0) + 1;
    });
    return info;
}

function render() {
    const f = getFiltros();
    distritoLayer.clearLayers();
    markerLayer.clearLayers();

    const visible = allData.filter(p => matchFiltros(p, f));
    const distInfo = calcDistritoInfo(visible);

    // Dibujar distritos (desactivado)
    if (false && distritosGeo) {
        L.geoJSON(distritosGeo, {
            style: function(feature) {
                const dist = (feature.properties.distrito || '').toUpperCase().trim();
                const rcs  = distInfo[dist];
                if (!rcs || Object.keys(rcs).length === 0) {
                    return { fillColor: '#1e293b', fillOpacity: 0.3, color: '#334155', weight: 0.5, opacity: 0.5 };
                }
                const dominante = Object.entries(rcs).sort((a,b) => b[1]-a[1])[0][0];
                const totalPts  = Object.values(rcs).reduce((a,b) => a+b, 0);
                const maxPts    = Math.max(...Object.values(rcs));
                const domRatio  = maxPts / totalPts;
                const dimmed    = rcSelected && dominante !== rcSelected;
                const color     = getColor(dominante);
                return {
                    fillColor:   color,
                    fillOpacity: dimmed ? 0.03 : (0.15 + domRatio * 0.3),
                    color:       color,
                    weight:      dimmed ? 0.5 : 1.5,
                    opacity:     dimmed ? 0.2 : 0.8,
                    dashArray:   Object.keys(rcs).length > 1 ? '4 3' : null,
                };
            },
            onEachFeature: function(feature, layer) {
                const dist = (feature.properties.distrito || '').toUpperCase().trim();
                const rcs  = distInfo[dist];
                if (!rcs) return;
                const sorted = Object.entries(rcs).sort((a,b) => b[1]-a[1]);
                const total  = Object.values(rcs).reduce((a,b)=>a+b,0);
                const rows   = sorted.map(([rc, n]) =>
                    `<div style="display:flex;align-items:center;gap:6px;margin:2px 0">
                        <div style="width:9px;height:9px;border-radius:50%;background:${getColor(rc)};flex-shrink:0"></div>
                        <span style="font-size:11px;color:#1e293b">${rc}</span>
                        <span style="font-size:11px;color:#64748b;margin-left:auto">${n}</span>
                    </div>`
                ).join('');
                layer.bindPopup(`
                    <div style="min-width:180px">
                        <div style="font-weight:800;font-size:13px;margin-bottom:6px;color:#1e293b">📍 ${feature.properties.distrito}</div>
                        <div style="font-size:11px;color:#64748b;margin-bottom:5px">${total} puntos · ${sorted.length} RC${sorted.length>1?'s':''}</div>
                        ${rows}
                    </div>`, { maxWidth: 240 });
                layer.on('click', () => {
                    const dom = sorted[0][0];
                    seleccionarRC(dom);
                });
            }
        }).addTo(distritoLayer);
    }

    // Puntos encima
    visible.forEach(p => {
        let color, dimmed;
        if (viewMode === 'dia') {
            color  = getDiaColor(p);
            dimmed = diaSelected && !( (p.dias||[]).includes(diaSelected) || (p.dias||[]).includes(diaSelected.replace('É','E').replace('Á','A')) );
        } else {
            color  = getColor(p.rc);
            dimmed = rcSelected && p.rc !== rcSelected;
        }
        const inactivo = (p.estado||'').toUpperCase() === 'INACTIVO';
        const pinColor = inactivo ? '#78909C' : color;
        const marker = L.marker([p.lat, p.lng], { icon: makePinIcon(pinColor, dimmed) });
        marker.bindPopup(buildPopup(p), { maxWidth: 240 });
        markerLayer.addLayer(marker);
    });

    document.getElementById('contador').textContent = `${visible.length} puntos`;

    if (viewMode === 'dia') {
        const byDia = {};
        visible.forEach(p => {
            (p.dias || []).filter(d => d !== 'SIN RUTA').forEach(d => {
                byDia[d] = (byDia[d] || 0) + 1;
            });
        });
        renderPanelDia(byDia);
    } else {
        const byRC = {};
        visible.forEach(p => { byRC[p.rc] = (byRC[p.rc] || 0) + 1; });
        renderPanel(byRC);
    }
}

function renderPanel(byRC) {
    const sorted = Object.entries(byRC).sort((a,b) => b[1]-a[1]);
    const list = document.getElementById('rcList');
    list.innerHTML = '';
    sorted.forEach(([rc, n]) => {
        const color = getColor(rc);
        const div = document.createElement('div');
        div.className = 'rc-item' + (rcSelected === rc ? ' activo' : '');
        div.style.setProperty('--c', color);
        div.innerHTML = `
            <div class="rc-dot" style="background:${color}"></div>
            <span class="rc-nombre" title="${rc}">${rc}</span>
            <span class="rc-count">${n}</span>`;
        div.onclick = () => seleccionarRC(rc);
        list.appendChild(div);
    });
    document.getElementById('panelHeader').textContent =
        `${sorted.length} RCs · ${Object.values(byRC).reduce((a,b)=>a+b,0)} puntos`;
}

function renderPanelDia(byDia) {
    const list = document.getElementById('rcList');
    list.innerHTML = '';
    const total = Object.values(byDia).reduce((a,b)=>a+b,0);

    DIAS_ORDEN.forEach(dia => {
        const n = byDia[dia] || byDia[dia.replace('É','E').replace('Á','A')] || 0;
        if (!n) return;
        const color = DIA_COLORS[dia] || '#475569';
        const esActivo = diaSelected === dia;
        const div = document.createElement('div');
        div.className = 'rc-item' + (esActivo ? ' activo' : '');
        div.style.setProperty('--c', color);
        div.innerHTML = `
            <div class="rc-dot" style="background:${color}"></div>
            <span class="rc-nombre">${dia.charAt(0) + dia.slice(1).toLowerCase()}</span>
            <span class="rc-count">${n}</span>`;
        div.onclick = () => seleccionarDia(dia);
        list.appendChild(div);
    });

    // Sin día
    const sinDia = byDia['SIN RUTA'] || 0;
    if (sinDia) {
        const div = document.createElement('div');
        div.className = 'rc-item';
        div.innerHTML = `<div class="rc-dot" style="background:#475569"></div><span class="rc-nombre">Sin ruta</span><span class="rc-count">${sinDia}</span>`;
        list.appendChild(div);
    }

    document.getElementById('panelHeader').textContent = `${Object.keys(byDia).length} días · ${total} asignaciones`;
}

function seleccionarDia(dia) {
    diaSelected = (diaSelected === dia) ? null : dia;
    render();
    if (diaSelected) {
        const f = getFiltros();
        const pts = allData.filter(p => matchFiltros(p, f) && (p.dias||[]).includes(diaSelected));
        if (pts.length) {
            map.fitBounds(L.latLngBounds(pts.map(p => [p.lat, p.lng])), { padding: [60,60], maxZoom: 13 });
        }
    }
}

// ── POLÍGONO MANUAL ────────────────────────────────────────────────────────
const ZONAS_URL = 'https://raw.githubusercontent.com/Leonardow33/MAPA_RC_INTERACTIVO/main/data/zonas-manuales.json';
const zonasManuales = new L.FeatureGroup().addTo(map);
let drawHandler = null;
let dibujando = false;
let colorDibujo = '#22c55e';
let zonasData = []; // [{coords, color, label}]

function agregarPoligonoVisual(z) {
    const poly = L.polygon(z.coords, {
        color: z.color || '#22c55e', weight: 2.5,
        fillColor: z.color || '#22c55e', fillOpacity: 0.1
    });
    if (z.label) poly.bindTooltip(z.label, { permanent: true, direction: 'center', className: 'zona-label' });
    poly.on('click', () => {
        if (confirm(`¿Eliminar zona "${z.label || 'sin nombre'}"?`)) {
            zonasManuales.removeLayer(poly);
            zonasData = zonasData.filter(x => x !== z);
            guardarZonasLocal();
        }
    });
    zonasManuales.addLayer(poly);
    return poly;
}

function guardarZonasLocal() {
    localStorage.setItem('zonas_manuales_v2', JSON.stringify(zonasData));
}

function exportarZonas() {
    const json = JSON.stringify(zonasData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'zonas-manuales.json'; a.click();
    URL.revokeObjectURL(url);
    alert('Guardado como zonas-manuales.json\nCópialo a la carpeta data/ y sube a GitHub para que aparezca en la web.');
}

// Cargar zonas: primero desde GitHub, luego completa con localStorage
fetch(ZONAS_URL + '?v=' + Date.now())
    .then(r => r.ok ? r.json() : [])
    .catch(() => [])
    .then(remote => {
        const local = JSON.parse(localStorage.getItem('zonas_manuales_v2') || '[]');
        // Unir: local tiene prioridad (puede tener más nuevas)
        zonasData = local.length >= remote.length ? local : remote;
        zonasData.forEach(z => agregarPoligonoVisual(z));
    });

function toggleDibujo() {
    const btn = document.getElementById('btnDibujar');
    if (dibujando) {
        if (drawHandler) { drawHandler.disable(); drawHandler = null; }
        dibujando = false;
        btn.classList.remove('activo');
        btn.textContent = '✏ Dibujar zona';
        return;
    }

    // Pedir color y nombre antes de dibujar
    const picker = document.getElementById('colorZona');
    colorDibujo = picker ? picker.value : '#22c55e';

    dibujando = true;
    btn.classList.add('activo');
    btn.textContent = '⏹ Cancelar';

    drawHandler = new L.Draw.Polygon(map, {
        shapeOptions: { color: colorDibujo, weight: 2.5, fillColor: colorDibujo, fillOpacity: 0.1 },
        showArea: false, allowIntersection: false,
    });
    drawHandler.enable();

    map.once(L.Draw.Event.CREATED, function(e) {
        const coords = e.layer.getLatLngs()[0].map(ll => [ll.lat, ll.lng]);
        const label  = prompt('Nombre para esta zona (opcional):') || '';
        const z      = { coords, color: colorDibujo, label };
        zonasData.push(z);
        agregarPoligonoVisual(z);
        guardarZonasLocal();
        dibujando = false; drawHandler = null;
        btn.classList.remove('activo');
        btn.textContent = '✏ Dibujar zona';
    });
}
// ──────────────────────────────────────────────────────────────────────────

function onBuscar(q) {
    const box = document.getElementById('buscarSugerencias');
    q = q.trim().toUpperCase();
    if (q.length < 2) { box.classList.remove('visible'); box.innerHTML = ''; return; }

    const matches = allData.filter(p =>
        (p.nombre || '').toUpperCase().includes(q) ||
        String(p.ID || '').toUpperCase().includes(q)
    ).slice(0, 12);

    if (!matches.length) { box.classList.remove('visible'); box.innerHTML = ''; return; }

    box.innerHTML = matches.map(p => {
        const hl = (txt) => txt.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'gi'),
            m => `<span class="sug-match">${m}</span>`);
        return `<div class="sug-item" onmousedown="seleccionarTienda('${p.ID}')">
            <div class="sug-nombre">${hl(p.nombre || '')}</div>
            <div class="sug-meta">Código: <b>${p.ID}</b> · RC: ${p.rc || '—'} · ${p.distrito || '—'}</div>
        </div>`;
    }).join('');
    box.classList.add('visible');
}

function cerrarSugerencias() {
    const box = document.getElementById('buscarSugerencias');
    box.classList.remove('visible');
}

function seleccionarTienda(id) {
    const p = allData.find(x => String(x.ID) === String(id));
    if (!p) return;
    cerrarSugerencias();
    document.getElementById('buscarInput').value = p.nombre;
    map.setView([p.lat, p.lng], 16, { animate: true });
    // Abrir popup del marker correspondiente
    markerLayer.eachLayer(m => {
        if (m.getLatLng && Math.abs(m.getLatLng().lat - p.lat) < 0.0001 && Math.abs(m.getLatLng().lng - p.lng) < 0.0001) {
            m.openPopup();
        }
    });
}

function fitToVisible() {
    const f = getFiltros();
    const pts = allData.filter(p => matchFiltros(p, f));
    if (pts.length > 0) {
        map.fitBounds(L.latLngBounds(pts.map(p => [p.lat, p.lng])), { padding: [40, 40], maxZoom: 13, animate: true });
    }
}

function seleccionarRC(rc) {
    rcSelected = (rcSelected === rc) ? null : rc;
    render();
    const f = getFiltros();
    const pts = allData.filter(p => matchFiltros(p, f) && (rcSelected ? p.rc === rcSelected : true));
    if (pts.length) {
        map.fitBounds(L.latLngBounds(pts.map(p => [p.lat, p.lng])), { padding: [60,60], maxZoom: 13 });
    }
}

function getBaseConFiltrosGlobales() {
    const tipo = document.getElementById('fTipo').value;
    const zona = document.getElementById('fZona').value;
    const dia  = document.getElementById('fDia').value;
    return allData.filter(p =>
        matchFiltros(p, { sup:'ALL', rc:'ALL', dia, tipo, zona })
    );
}

function repoblarSupRC() {
    const base    = getBaseConFiltrosGlobales();
    const supSel  = document.getElementById('fSup');
    const prevSup = supSel.value;

    supSel.innerHTML = '<option value="ALL">Todos</option>';
    [...new Set(base.map(p => p.supervisor).filter(Boolean))].sort().forEach(v => {
        const o = document.createElement('option'); o.value = v; o.text = v; supSel.appendChild(o);
    });
    supSel.value = [...supSel.options].some(o => o.value === prevSup) ? prevSup : 'ALL';

    const rcSel    = document.getElementById('fRC');
    const prevRC   = rcSel.value;
    const supActual = supSel.value;
    const baseRC   = supActual === 'ALL' ? base : base.filter(p => p.supervisor === supActual);
    rcSel.innerHTML = '<option value="ALL">Todos</option>';
    [...new Set(baseRC.map(p => p.rc).filter(Boolean))].sort().forEach(v => {
        const o = document.createElement('option'); o.value = v; o.text = v; rcSel.appendChild(o);
    });
    rcSel.value = [...rcSel.options].some(o => o.value === prevRC) ? prevRC : 'ALL';
}

function poblarFiltros() {
    const dias = ['LUNES','MARTES','MIÉRCOLES','JUEVES','VIERNES','SÁBADO'];
    const sel = document.getElementById('fDia');
    dias.forEach(v => { const o = document.createElement('option'); o.value = v; o.text = v.charAt(0)+v.slice(1).toLowerCase(); sel.appendChild(o); });
    repoblarSupRC();
}

function resetFiltros() {
    ['fSup','fRC','fDia','fTipo','fZona'].forEach(id => document.getElementById(id).value = 'ALL');
    rcSelected = null; diaSelected = null;
    document.getElementById('buscarInput').value = '';
    cerrarSugerencias();
    repoblarSupRC();
    render();
    map.setView([-9.19, -75.0], 6);
}

['fTipo','fZona','fDia'].forEach(id =>
    document.getElementById(id).addEventListener('change', () => { rcSelected = null; diaSelected = null; repoblarSupRC(); render(); fitToVisible(); })
);

document.getElementById('fSup').addEventListener('change', () => {
    rcSelected = null; diaSelected = null; repoblarSupRC(); render(); fitToVisible();
});

document.getElementById('fRC').addEventListener('change', () => { rcSelected = null; diaSelected = null; render(); fitToVisible(); });

function districtOfPoint(pt, polyMap, centroids) {
    // 1. Point-in-polygon exacto
    for (const [d, feat] of Object.entries(polyMap)) {
        try { if (turf.booleanPointInPolygon(pt, feat)) return d; } catch(e) {}
    }
    // 2. Fallback: distrito más cercano por centroide
    let minDist = Infinity, nearest = '—';
    for (const [d, c] of Object.entries(centroids)) {
        const dist = turf.distance(pt, c, { units: 'kilometers' });
        if (dist < minDist) { minDist = dist; nearest = d; }
    }
    return minDist < 3 ? nearest : '—'; // solo si está a menos de 3km del centroide
}

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371, toR = Math.PI/180;
    const dLat = (lat2-lat1)*toR, dLng = (lng2-lng1)*toR;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*toR)*Math.cos(lat2*toR)*Math.sin(dLng/2)**2;
    return R * 2 * Math.asin(Math.sqrt(a));
}

function descargarSugerenciasRC() {
    if (!allData.length) { alert('Cargando datos, intenta en un momento.'); return; }
    const btn = document.getElementById('btnSugerencias');
    btn.textContent = '⏳ Calculando...'; btn.disabled = true;

    setTimeout(() => {
        const f = getFiltros();

        // PDV con RC: pool de referencia completo (sin filtrar por RC/sup para no limitar opciones)
        const conRC = allData.filter(p => p.rc && p.rc !== 'SIN RC');

        // PDV sin RC: aplica filtros activos de zona/tipo/día pero ignora filtro de RC y supervisor
        const fSinRC = { ...f, rc: 'ALL', sup: 'ALL' };
        const sinRC  = allData.filter(p => (!p.rc || p.rc === 'SIN RC') && matchFiltros(p, fSinRC));

        if (!sinRC.length) {
            alert('No hay PDV sin RC en la selección actual.');
            btn.textContent = '⬇ Sin asignar'; btn.disabled = false;
            return;
        }

        const cols = ['ID','Nombre','Tipo','Distrito','Zona','RC Sugerido','Código RC','Supervisor',
                      'Capacitador','Días Visita (ref)','Tienda Referencia','Distancia km','Lat','Lng'];
        const data = [];

        sinRC.forEach(p => {
            const tipoP = (p.tipo || '').toUpperCase();
            const pool  = conRC.filter(r => (r.tipo||'').toUpperCase() === tipoP);
            const base  = pool.length ? pool : conRC;
            let mejor = null, minDist = Infinity;
            base.forEach(r => {
                const d = haversineKm(p.lat, p.lng, r.lat, r.lng);
                if (d < minDist) { minDist = d; mejor = r; }
            });
            if (!mejor) return;
            const dias = Array.isArray(mejor.dias)
                ? mejor.dias.filter(d => d !== 'SIN RUTA').join(' - ')
                : (mejor.frecuencia || '');
            data.push([
                p.ID, p.nombre, p.tipo || '', p.distrito || '', p.zonal_tipo || '',
                mejor.rc, mejor.rc_codigo || '', mejor.supervisor || '', mejor.capacitador || '',
                dias, mejor.nombre, parseFloat(minDist.toFixed(2)), p.lat, p.lng
            ]);
        });

        // Ordenar por distancia ascendente (más cercano primero), luego por nombre PDV
        data.sort((a, b) => a[11] - b[11] || String(a[1]).localeCompare(String(b[1])));

        // ── Excel SpreadsheetML ──────────────────────────────────────────
        const esc      = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const numCols  = new Set([11, 12, 13]); // Distancia km, Lat, Lng (índices desplazados +1)
        const hdrXml   = cols.map(h => `<Cell ss:StyleID="H"><Data ss:Type="String">${esc(h)}</Data></Cell>`).join('');
        const rowsXml  = data.map(row =>
            '<Row>' + row.map((v, i) =>
                `<Cell><Data ss:Type="${numCols.has(i)?'Number':'String'}">${esc(v)}</Data></Cell>`
            ).join('') + '</Row>'
        ).join('');

        const xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>` +
            `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">` +
            `<Styles><Style ss:ID="H"><Font ss:Bold="1"/><Interior ss:Color="#D9E1F2" ss:Pattern="Solid"/></Style></Styles>` +
            `<Worksheet ss:Name="PDV Sin Asignar">` +
            `<Table><Row>${hdrXml}</Row>${rowsXml}</Table>` +
            `</Worksheet></Workbook>`;

        // Nombre dinámico según filtros activos
        const zonaNombre = f.zona === 'ALL'      ? 'Todos'
                         : f.zona === 'LIMA'     ? 'Lima'
                         : 'Provincia';
        const tipoSufijo = f.tipo !== 'ALL' ? `_${f.tipo.replace(/\s+/g,'_')}` : '';
        const diaSufijo  = f.dia  !== 'ALL' ? `_${f.dia}` : '';

        const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url;
        a.download = `SinAsignar_RC_${zonaNombre}${tipoSufijo}${diaSufijo}.xls`;
        a.click();
        URL.revokeObjectURL(url);

        btn.textContent = '⬇ Sin asignar'; btn.disabled = false;
    }, 50);
}

function descargarMalUbicados() {
    if (!distritosGeo || !allData.length) { alert('Cargando datos, intenta en un momento.'); return; }

    const btn = document.getElementById('btnMalUbicados');
    btn.textContent = '⏳ Analizando...';
    btn.disabled = true;

    setTimeout(() => {
        const polyMap  = {};
        const centroids = {};
        distritosGeo.features.forEach(f => {
            const d = (f.properties.distrito || '').toUpperCase().trim();
            if (!d) return;
            polyMap[d] = f;
            try { centroids[d] = turf.centroid(f); } catch(e) {}
        });

        const malUbicados = [];
        allData.forEach(p => {
            const dist = (p.distrito || '').toUpperCase().trim();
            if (!dist || !polyMap[dist]) return;
            const pt = turf.point([p.lng, p.lat]);
            try {
                if (!turf.booleanPointInPolygon(pt, polyMap[dist])) {
                    const distReal = districtOfPoint(pt, polyMap, centroids);
                    malUbicados.push({
                        ID: p.ID, nombre: p.nombre,
                        rc: p.rc, supervisor: p.supervisor,
                        distrito_excel: dist, distrito_real: distReal,
                        lat: p.lat, lng: p.lng
                    });
                }
            } catch(e) {}
        });

        btn.textContent = '⚠ Mal ubicados';
        btn.disabled = false;

        if (!malUbicados.length) { alert('No se detectaron puntos fuera de su distrito.'); return; }

        const rows = [['Org ID','Nombre','RC','Supervisor','Distrito Excel','Distrito Real (por coord)','Lat','Lng']];
        malUbicados.forEach(m => rows.push([m.ID, m.nombre, m.rc, m.supervisor, m.distrito_excel, m.distrito_real, m.lat, m.lng]));
        const csv = rows.map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = 'tiendas_mal_ubicadas.csv'; a.click();
        URL.revokeObjectURL(url);
        alert(`${malUbicados.length} tiendas con posible distrito incorrecto descargadas.`);
    }, 50);
}

// Cargar datos y distritos en paralelo
Promise.all([
    fetch(PUNTOS_URL   + '?v=' + Date.now()).then(r => r.json()),
    fetch(DISTRITOS_URL + '?v=' + Date.now()).then(r => r.json()),
]).then(([puntos, distritos]) => {
    allData      = normalizePuntos(puntos).filter(p => p.lat && p.lng && (p.estado||'').toUpperCase() !== 'CERRADO');
    distritosGeo = distritos;
    poblarFiltros();
    render();
}).catch(e => console.error('Error:', e));
