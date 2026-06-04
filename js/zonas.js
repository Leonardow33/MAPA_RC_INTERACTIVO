const PUNTOS_URL    = 'https://raw.githubusercontent.com/Leonardow33/MAPA_RC_INTERACTIVO/main/data/puntos.json';
const DISTRITOS_URL = 'https://raw.githubusercontent.com/Leonardow33/MAPA_RC_INTERACTIVO/main/data/distritos.geojson';

const map = L.map('map', { preferCanvas: true }).setView([-9.19, -75.0], 6);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap © CARTO', maxZoom: 19
}).addTo(map);
// Capa de etiquetas encima de todo
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
    attribution: '', maxZoom: 19, pane: 'shadowPane'
}).addTo(map);

const distritoLayer = L.layerGroup().addTo(map);
const markerLayer   = L.layerGroup().addTo(map);

let allData      = [];
let distritosGeo = null;
let rcColorMap   = {};
let rcSelected   = null;
let diaSelected  = null;
let viewMode     = 'rc'; // 'rc' | 'dia'

const DIA_COLORS = {
    'LUNES':     '#3b82f6',
    'MARTES':    '#22c55e',
    'MIÉRCOLES': '#f97316',
    'MIERCOLES': '#f97316',
    'JUEVES':    '#a855f7',
    'VIERNES':   '#ef4444',
    'SÁBADO':    '#06b6d4',
    'SABADO':    '#06b6d4',
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
    '#00ACC1','#6D4C41','#F4511E','#3949AB','#00897B',
    '#FDD835','#D81B60','#5E35B1','#039BE5','#7CB342',
    '#FF7043','#26C6DA','#AB47BC','#66BB6A','#EF5350',
    '#42A5F5','#EC407A','#26A69A','#FF6D00','#78909C'
];

function getColor(rc) {
    if (!rcColorMap[rc]) {
        const idx = Object.keys(rcColorMap).length % PALETTE.length;
        rcColorMap[rc] = PALETTE[idx];
    }
    return rcColorMap[rc];
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
    if (f.tipo !== 'ALL') {
        const t = (p.tipo || '').toUpperCase();
        if (f.tipo === 'TAMBO') {
            if (t !== 'TAMBO' && t !== 'SUERTE') return false;
        }
        if (f.tipo === 'CASA DE APUESTA') {
            if (t !== 'CASA DE APUESTA') return false;
        }
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
        const marker = L.circleMarker([p.lat, p.lng], {
            radius: 4, fillColor: color, color: 'rgba(0,0,0,0.4)',
            weight: 1, fillOpacity: dimmed ? 0.08 : 0.85, opacity: dimmed ? 0.1 : 1,
        });
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

function seleccionarRC(rc) {
    rcSelected = (rcSelected === rc) ? null : rc;
    render();
    if (rcSelected) {
        const f = getFiltros();
        const pts = allData.filter(p => p.rc === rcSelected && matchFiltros(p, f));
        if (pts.length) {
            map.fitBounds(L.latLngBounds(pts.map(p => [p.lat, p.lng])), { padding: [60,60], maxZoom: 13 });
        }
    }
}

function getBasePorTipo() {
    const tipo = document.getElementById('fTipo').value;
    if (tipo === 'ALL') return allData;
    return allData.filter(p => matchFiltros(p, { sup:'ALL', rc:'ALL', dia:'ALL', tipo, zona:'ALL' }));
}

function repoblarSupRC() {
    const base = getBasePorTipo();
    const sup  = document.getElementById('fSup').value;

    // Supervisores filtrados por tipo
    const supSel  = document.getElementById('fSup');
    const prevSup = supSel.value;
    supSel.innerHTML = '<option value="ALL">Todos</option>';
    [...new Set(base.map(p => p.supervisor).filter(Boolean))].sort().forEach(v => {
        const o = document.createElement('option'); o.value = v; o.text = v; supSel.appendChild(o);
    });
    supSel.value = [...supSel.options].some(o => o.value === prevSup) ? prevSup : 'ALL';

    // RCs filtrados por tipo + supervisor
    const rcSel  = document.getElementById('fRC');
    const prevRC = rcSel.value;
    const supActual = supSel.value;
    const baseRC = supActual === 'ALL' ? base : base.filter(p => p.supervisor === supActual);
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
    rcSelected = null;
    render();
    map.setView([-9.19, -75.0], 6);
}

document.getElementById('fTipo').addEventListener('change', () => {
    rcSelected = null; repoblarSupRC(); render();
});

document.getElementById('fSup').addEventListener('change', () => {
    rcSelected = null; repoblarSupRC(); render();
});

['fRC','fDia','fZona'].forEach(id =>
    document.getElementById(id).addEventListener('change', () => { rcSelected = null; render(); })
);

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
    allData      = puntos.filter(p => p.lat && p.lng && (p.estado||'').toUpperCase() === 'ACTIVO');
    distritosGeo = distritos;
    poblarFiltros();
    render();
}).catch(e => console.error('Error:', e));
