const PUNTOS_URL = 'https://raw.githubusercontent.com/Leonardow33/MAPA_RC_INTERACTIVO/main/data/puntos.json';

const map = L.map('map', { preferCanvas: true }).setView([-9.19, -75.0], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 19
}).addTo(map);

const zonaLayer   = L.layerGroup().addTo(map);
const markerLayer = L.layerGroup().addTo(map);

let allData    = [];
let rcColorMap = {};
let rcSelected = null;

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

function makeIcon(color, dimmed) {
    const op = dimmed ? 0.12 : 1;
    return L.circleMarker([0,0], {
        radius: 5, fillColor: color, color: 'white',
        weight: 1.5, fillOpacity: op * 0.9, opacity: op
    });
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

function matchFiltros(p, f) {
    if (f.sup !== 'ALL' && p.supervisor !== f.sup) return false;
    if (f.rc  !== 'ALL' && p.rc         !== f.rc)  return false;
    if (f.dia !== 'ALL' && !(p.dias || []).includes(f.dia)) return false;
    if (f.tipo !== 'ALL') {
        const t = (p.tipo || '').toUpperCase();
        if (f.tipo === 'TAMBO'           && t === 'CASA DE APUESTA') return false;
        if (f.tipo === 'CASA DE APUESTA' && t !== 'CASA DE APUESTA') return false;
    }
    if (f.zona !== 'ALL' && (p.zonal_tipo || '').toUpperCase() !== f.zona) return false;
    return true;
}

function buildZone(pts, color, dimmed) {
    if (pts.length < 2) return null;
    const op = dimmed ? 0.04 : 0.18;
    const borderOp = dimmed ? 0.1 : 0.7;
    try {
        const fc = turf.featureCollection(
            pts.map(p => turf.point([p.lng, p.lat]))
        );
        // concave hull — maxEdge en km: más pequeño = más ajustado a los puntos
        let poly = null;
        if (pts.length >= 3) {
            poly = turf.concave(fc, { maxEdge: 1.5, units: 'kilometers' });
        }
        if (!poly) {
            poly = turf.convex(fc);
        }
        if (!poly) return null;

        return L.geoJSON(poly, {
            style: {
                fillColor: color,
                fillOpacity: op,
                color: color,
                weight: 2,
                opacity: borderOp,
                dashArray: dimmed ? '4 6' : null,
            }
        });
    } catch(e) {
        return null;
    }
}

function render() {
    const f = getFiltros();
    zonaLayer.clearLayers();
    markerLayer.clearLayers();

    const visible = allData.filter(p => matchFiltros(p, f));

    // Agrupar por RC
    const byRC = {};
    visible.forEach(p => {
        if (!byRC[p.rc]) byRC[p.rc] = [];
        byRC[p.rc].push(p);
    });

    // Dibujar zonas (polígonos) primero (capa inferior)
    Object.entries(byRC).forEach(([rc, pts]) => {
        const color  = getColor(rc);
        const dimmed = rcSelected && rc !== rcSelected;
        const zone   = buildZone(pts, color, dimmed);
        if (zone) {
            zone.on('click', () => seleccionarRC(rc));
            zonaLayer.addLayer(zone);
        }
    });

    // Dibujar puntos encima
    visible.forEach(p => {
        const color  = getColor(p.rc);
        const dimmed = rcSelected && p.rc !== rcSelected;
        const marker = L.circleMarker([p.lat, p.lng], {
            radius: 5,
            fillColor: color,
            color: 'white',
            weight: 1.5,
            fillOpacity: dimmed ? 0.12 : 0.9,
            opacity: dimmed ? 0.15 : 1,
        });
        marker.bindPopup(buildPopup(p), { maxWidth: 240 });
        markerLayer.addLayer(marker);
    });

    document.getElementById('contador').textContent = `${visible.length} puntos · ${Object.keys(byRC).length} RCs`;
    renderPanel(byRC);
}

function renderPanel(byRC) {
    const sorted = Object.entries(byRC).sort((a,b) => b[1].length - a[1].length);
    const list = document.getElementById('rcList');
    list.innerHTML = '';

    sorted.forEach(([rc, pts]) => {
        const color = getColor(rc);
        const div = document.createElement('div');
        div.className = 'rc-item' + (rcSelected === rc ? ' activo' : '');
        div.style.setProperty('--c', color);
        div.innerHTML = `
            <div class="rc-dot" style="background:${color}"></div>
            <span class="rc-nombre" title="${rc}">${rc}</span>
            <span class="rc-count">${pts.length}</span>`;
        div.onclick = () => seleccionarRC(rc);
        list.appendChild(div);
    });

    document.getElementById('panelHeader').textContent =
        `${sorted.length} RCs · ${Object.values(byRC).flat().length} puntos`;
}

function seleccionarRC(rc) {
    rcSelected = (rcSelected === rc) ? null : rc;
    render();
    if (rcSelected) {
        const pts = allData.filter(p => p.rc === rcSelected && matchFiltros(p, getFiltros()));
        if (pts.length) {
            const bounds = L.latLngBounds(pts.map(p => [p.lat, p.lng]));
            map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
        }
    }
}

function poblarFiltros() {
    const sups = [...new Set(allData.map(p => p.supervisor).filter(Boolean))].sort();
    const rcs  = [...new Set(allData.map(p => p.rc).filter(Boolean))].sort();
    const dias = ['LUNES','MARTES','MIÉRCOLES','JUEVES','VIERNES','SÁBADO'];
    function fill(id, items) {
        const sel = document.getElementById(id);
        items.forEach(v => { const o = document.createElement('option'); o.value = v; o.text = v; sel.appendChild(o); });
    }
    fill('fSup', sups);
    fill('fRC',  rcs);
    fill('fDia', dias);
}

function resetFiltros() {
    ['fSup','fRC','fDia','fTipo','fZona'].forEach(id => document.getElementById(id).value = 'ALL');
    rcSelected = null;
    render();
    map.setView([-9.19, -75.0], 6);
}

document.getElementById('fSup').addEventListener('change', function() {
    const sup = this.value;
    const rcSel = document.getElementById('fRC');
    const prev  = rcSel.value;
    rcSel.innerHTML = '<option value="ALL">Todos</option>';
    const base = sup === 'ALL' ? allData : allData.filter(p => p.supervisor === sup);
    [...new Set(base.map(p => p.rc).filter(Boolean))].sort().forEach(rc => {
        const o = document.createElement('option'); o.value = rc; o.text = rc; rcSel.appendChild(o);
    });
    rcSel.value = [...rcSel.options].some(o => o.value === prev) ? prev : 'ALL';
    rcSelected = null;
    render();
});

['fRC','fDia','fTipo','fZona'].forEach(id =>
    document.getElementById(id).addEventListener('change', () => { rcSelected = null; render(); })
);

fetch(PUNTOS_URL + '?v=' + Date.now())
    .then(r => r.json())
    .then(data => {
        allData = data.filter(p => p.lat && p.lng && (p.estado || '').toUpperCase() === 'ACTIVO');
        poblarFiltros();
        render();
    })
    .catch(e => console.error('Error:', e));
