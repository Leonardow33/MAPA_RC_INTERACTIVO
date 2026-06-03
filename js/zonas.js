const PUNTOS_URL = 'https://raw.githubusercontent.com/Leonardow33/MAPA_RC_INTERACTIVO/main/data/puntos.json';

const map = L.map('map', { preferCanvas: true }).setView([-9.19, -75.0], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 19
}).addTo(map);

const cluster = L.markerClusterGroup({
    chunkedLoading: true, maxClusterRadius: 40,
    removeOutsideVisibleBounds: false
});
map.addLayer(cluster);

let allData = [];
let rcColorMap = {};
let rcSelected = null;
let allMarkers = [];

const PALETTE = [
    '#E53935','#8E24AA','#1E88E5','#43A047','#FB8C00',
    '#00ACC1','#6D4C41','#F4511E','#3949AB','#00897B',
    '#FDD835','#D81B60','#5E35B1','#039BE5','#7CB342',
    '#FF7043','#26C6DA','#AB47BC','#66BB6A','#EF5350',
    '#42A5F5','#EC407A','#26A69A','#FF7043','#78909C'
];

function getColor(rc) {
    if (!rcColorMap[rc]) {
        const idx = Object.keys(rcColorMap).length % PALETTE.length;
        rcColorMap[rc] = PALETTE[idx];
    }
    return rcColorMap[rc];
}

function makeIcon(color, dimmed) {
    const op = dimmed ? 0.15 : 1;
    return L.divIcon({
        className: '',
        html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};
               border:2px solid rgba(255,255,255,0.7);opacity:${op};
               box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>`,
        iconSize: [12, 12], iconAnchor: [6, 6], popupAnchor: [0, -8]
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

function render() {
    const f = getFiltros();
    cluster.clearLayers();
    allMarkers = [];

    const visible = allData.filter(p => matchFiltros(p, f));

    visible.forEach(p => {
        const color  = getColor(p.rc);
        const dimmed = rcSelected && p.rc !== rcSelected;
        const marker = L.marker([p.lat, p.lng], { icon: makeIcon(color, dimmed) });
        marker.bindPopup(buildPopup(p), { maxWidth: 240 });
        allMarkers.push({ marker, p });
        cluster.addLayer(marker);
    });

    document.getElementById('contador').textContent = `${visible.length} puntos`;
    renderPanel(visible);
}

function renderPanel(visible) {
    const rcCounts = {};
    visible.forEach(p => {
        if (!p.rc) return;
        rcCounts[p.rc] = (rcCounts[p.rc] || 0) + 1;
    });

    const sorted = Object.entries(rcCounts).sort((a, b) => b[1] - a[1]);
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
        `${sorted.length} RCs · ${visible.length} puntos`;
}

function seleccionarRC(rc) {
    rcSelected = (rcSelected === rc) ? null : rc;
    render();
    if (rcSelected) {
        const pts = allMarkers.filter(m => m.p.rc === rcSelected);
        if (pts.length) {
            const bounds = L.latLngBounds(pts.map(m => m.marker.getLatLng()));
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
        }
    }
}

function poblarFiltros() {
    const sups = [...new Set(allData.map(p => p.supervisor).filter(Boolean))].sort();
    const rcs  = [...new Set(allData.map(p => p.rc).filter(Boolean))].sort();
    const dias = ['LUNES','MARTES','MIÉRCOLES','JUEVES','VIERNES','SÁBADO'];

    function fill(id, items) {
        const sel = document.getElementById(id);
        items.forEach(v => {
            const o = document.createElement('option');
            o.value = v; o.text = v; sel.appendChild(o);
        });
    }
    fill('fSup', sups);
    fill('fRC',  rcs);
    fill('fDia', dias);
}

function resetFiltros() {
    ['fSup','fRC','fDia','fTipo','fZona'].forEach(id => {
        document.getElementById(id).value = 'ALL';
    });
    rcSelected = null;
    render();
    map.setView([-9.19, -75.0], 6);
}

document.getElementById('fSup').addEventListener('change', function() {
    const sup = this.value;
    const rcSel = document.getElementById('fRC');
    const prev = rcSel.value;
    rcSel.innerHTML = '<option value="ALL">Todos</option>';
    const base = sup === 'ALL' ? allData : allData.filter(p => p.supervisor === sup);
    [...new Set(base.map(p => p.rc).filter(Boolean))].sort().forEach(rc => {
        const o = document.createElement('option');
        o.value = rc; o.text = rc; rcSel.appendChild(o);
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
