// Planificador de rutas por fechas (navegador: window.PLAN · node: require)
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.PLAN = api;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const TOPE = { fuerte: { obj: 14, max: 16 }, impulso: { obj: 6, max: 8 } };
const T_OPCIONES = [1, 1.5, 2];
const DIAS_JS    = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
const DIAS_ORDEN = DIAS_JS.slice(1);
const SEMANA_F   = ['LUNES', 'MARTES', 'JUEVES', 'VIERNES'];
const SEMANA_I   = ['MIÉRCOLES', 'SÁBADO'];
// Días fuertes / de impulso que hay antes de cada offset de la semana (0 = lunes … 6 = domingo)
const PREV_F = [0, 1, 2, 2, 3, 4, 4];
const PREV_I = [0, 0, 0, 1, 1, 1, 2];

const normDia = d => String(d || '').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const DIA_CANON = {};
DIAS_ORDEN.forEach(d => { DIA_CANON[normDia(d)] = d; });

// ── Fechas: siempre 'YYYY-MM-DD' evaluadas a mediodía (evita desfase UTC/Lima) ──
const pad = n => String(n).padStart(2, '0');
function iso(f) {
    if (typeof f === 'string') return f.slice(0, 10);
    return `${f.getFullYear()}-${pad(f.getMonth() + 1)}-${pad(f.getDate())}`;
}
const fechaD    = s => new Date(iso(s) + 'T12:00:00');
const diasEntre = (a, b) => Math.round((fechaD(b) - fechaD(a)) / 864e5);
const mod       = (a, n) => ((a % n) + n) % n;
function sumarDias(s, n) { const d = fechaD(s); d.setDate(d.getDate() + n); return iso(d); }
function lunesDe(s) { const d = fechaD(s); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return iso(d); }
function hoyLima() { return new Date().toLocaleDateString('sv', { timeZone: 'America/Lima' }); }

// ── Estado: feriados y versiones publicadas del plan ──────────────────────
let _feriados = new Set(), _feriadosLista = [];
let _versiones = [];   // [{ vigente_desde, plan }] ordenado ascendente
let _indice = [];
let _base = 'data/';

function setFeriados(lista) {
    _feriadosLista = Array.isArray(lista) ? lista : [];
    _feriados = new Set(_feriadosLista.map(f => typeof f === 'string' ? f : f.fecha));
}
function agregarPlan(plan) {
    if (!plan || !plan.vigente_desde) return;
    _versiones = _versiones.filter(v => v.vigente_desde !== plan.vigente_desde);
    _versiones.push({ vigente_desde: plan.vigente_desde, plan });
    _versiones.sort((a, b) => a.vigente_desde < b.vigente_desde ? -1 : 1);
}
function planVigente(f) {
    const s = iso(f);
    let r = null;
    for (const v of _versiones) { if (v.vigente_desde <= s) r = v.plan; else break; }
    return r;
}

function _getJSON(url) {
    return fetch(url + (url.includes('?') ? '&' : '?') + 'v=' + Date.now(), { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null).catch(() => null);
}
async function cargar(base) {
    _base = base || 'data/';
    const [fer, idx] = await Promise.all([_getJSON(_base + 'feriados.json'), _getJSON(_base + 'planes/index.json')]);
    setFeriados(Array.isArray(fer) ? fer : []);
    _indice = Array.isArray(idx) ? idx : [];
    const hoy = hoyLima();
    await asegurarRango(sumarDias(hoy, -7), sumarDias(hoy, 14));
}
// Carga las versiones necesarias para medir/mostrar un rango de fechas
async function asegurarRango(desde, hasta) {
    const ord = _indice.slice().sort((a, b) => a.vigente_desde < b.vigente_desde ? -1 : 1);
    const need = [];
    let previa = null;
    ord.forEach(v => {
        if (v.vigente_desde <= desde) previa = v;
        else if (v.vigente_desde <= hasta) need.push(v);
    });
    if (previa) need.unshift(previa);
    const faltan = need.filter(v => !_versiones.some(x => x.vigente_desde === v.vigente_desde));
    const planes = await Promise.all(faltan.map(v => _getJSON(_base + 'planes/' + v.archivo)));
    planes.forEach(agregarPlan);
}

// ── Calendario ────────────────────────────────────────────────────────────
function esFeriado(f) { return _feriados.has(iso(f)); }
function feriadoNombre(f) {
    const s = iso(f), x = _feriadosLista.find(e => (typeof e === 'string' ? e : e.fecha) === s);
    return x ? (x.nombre || 'Feriado') : '';
}
function tipoDia(f) {
    const s = iso(f), dow = fechaD(s).getDay();
    if (dow === 0) return 'DOMINGO';
    if (_feriados.has(s)) return 'FERIADO';
    return (dow === 3 || dow === 6) ? 'IMPULSO' : 'FUERTE';
}
// Contadores en forma cerrada desde el ancla (un lunes); los feriados también avanzan
function contadores(ancla, f) {
    const dias = diasEntre(ancla, f), w = Math.floor(dias / 7), r = dias - 7 * w;
    return { f: 4 * w + PREV_F[r], i: 2 * w + PREV_I[r] };
}
function slotDe(cfg, f) {
    const dow = fechaD(f).getDay();
    if (dow === 0) return null;
    const c = contadores(cfg.ancla, f);
    return (dow === 3 || dow === 6) ? { tipo: 'i', slot: mod(c.i, cfg.M) } : { tipo: 'f', slot: mod(c.f, cfg.N) };
}
function diaDeSlot(T, tipo, slot) {
    if (T !== 1 && T !== 2) return null;
    return tipo === 'f' ? SEMANA_F[slot % 4] : SEMANA_I[slot % 2];
}
function etiquetaSlot(cfg, tipo, slot) {
    const dia = diaDeSlot(cfg.T, tipo, slot);
    if (cfg.T === 1) return dia;
    if (cfg.T === 2) return `${dia} S${Math.floor(slot / (tipo === 'f' ? 4 : 2)) + 1}`;
    return tipo === 'f' ? `RUTA ${slot + 1}` : `IMPULSO ${slot + 1}`;
}

// ── Programación de visitas ───────────────────────────────────────────────
function diasActuales(p) {
    let d = p.dias;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = d.split(/[,-]/); } }
    return [...new Set((Array.isArray(d) ? d : []).map(x => DIA_CANON[normDia(x)]).filter(Boolean))];
}
function asignacion(plan, p) {
    return plan && plan.tiendas ? plan.tiendas[String(p.ID)] || null : null;
}
// ¿Le toca visita en la fecha según el plan dado? (no considera feriados)
function programadaEn(plan, p, f) {
    const s = iso(f), dow = fechaD(s).getDay();
    if (dow === 0) return false;
    if (plan) {
        const a = asignacion(plan, p);
        const cfg = a && plan.rcs[a.rc];
        if (cfg) {
            const sl = slotDe(cfg, s);
            return (sl.tipo === 'f' ? a.f : a.i).includes(sl.slot);
        }
        if (plan.rcs[p.rc]) return false;   // RC replanificado: tienda aún sin plan
    }
    return diasActuales(p).includes(DIAS_JS[dow]);
}
function tocaVisita(p, f) {
    const s = iso(f);
    return tipoDia(s) !== 'FERIADO' && programadaEn(planVigente(s), p, s);
}
function ordenVisita(p, f) {
    const s = iso(f), plan = planVigente(s), a = asignacion(plan, p), cfg = a && plan.rcs[a.rc];
    if (!cfg) return null;
    const sl = slotDe(cfg, s);
    if (!sl) return null;
    const arr = sl.tipo === 'f' ? a.f : a.i, ords = sl.tipo === 'f' ? a.of : a.oi;
    const k = arr.indexOf(sl.slot);
    return k < 0 || !ords ? null : ords[k];
}
function infoRC(rc, f) {
    const plan = planVigente(f || hoyLima());
    return plan && plan.rcs[rc] ? plan.rcs[rc] : null;
}
const rcReplanificado = (rc, f) => !!infoRC(rc, f);
function rcDeTienda(p, f) {
    const plan = planVigente(f || hoyLima()), a = asignacion(plan, p);
    return a && plan.rcs[a.rc] ? a.rc : (p.rc || '');
}
function proximasVisitas(p, desde, n, maxDias) {
    const out = [];
    for (let k = 0; k < (maxDias || 28) && out.length < (n || 2); k++) {
        const s = sumarDias(desde || hoyLima(), k);
        if (tocaVisita(p, s)) out.push(s);
    }
    return out;
}

// ── Excepciones (texto libre del Sheet → códigos) ─────────────────────────
const CODIGOS_EXC = [
    ['FERIADO',    /feriad/i],
    ['DESCANSO',   /descanso|m[eé]dic|salud|enferm/i],
    ['VACACIONES', /vacacion/i],
    ['LICENCIA',   /licencia|maternidad|paternidad|duelo/i],
    ['PERMISO',    /permiso/i],
    ['VACANTE',    /vacant/i],
    ['TARDANZA',   /tardanza/i],
];
const EXC_EXCLUYE = new Set(['FERIADO', 'DESCANSO', 'VACACIONES', 'LICENCIA', 'PERMISO', 'VACANTE']);
function codigoExcepcion(e) {
    for (const [c, re] of CODIGOS_EXC) if (re.test(e.tipo || '')) return c;
    for (const [c, re] of CODIGOS_EXC) if (re.test(e.obs || '')) return c;
    return null;
}

// ── Cumplimiento para comisión ────────────────────────────────────────────
// Visita planificada cumplida si la tienda se visitó algún día (lun–sáb) de esa semana:
// por tienda y semana, cumplidas = min(planificadas efectivas, días distintos con visita).
// Feriados y excepciones del RC no cuentan. Las visitas se asignan en orden cronológico.
function cumplimiento(o) {
    const hoy = o.hoy || hoyLima();
    const desde = iso(o.desde), fin = iso(o.hasta) < hoy ? iso(o.hasta) : hoy;
    const exc = new Map(), noReconocidas = [];
    (o.excepciones || []).forEach(e => {
        if (!e || !e.fecha) return;
        const c = codigoExcepcion(e);
        if (!c) { noReconocidas.push(e); return; }
        if (EXC_EXCLUYE.has(c)) exc.set(normDia(e.nombre) + '|' + iso(e.fecha), c);
    });
    const porRC = {};
    const fila = rc => porRC[rc] || (porRC[rc] = {
        rc, planificadas: 0, feriado: 0, excepcion: 0, efectivas: 0, cumplidas: 0, carga: {}
    });
    const activos = (o.puntos || []).filter(p =>
        (p.estado || '').toUpperCase() === 'ACTIVO' && p.rc && p.rc !== 'SIN RC' &&
        (!o.filtro || o.filtro(p)));

    for (let lunes = lunesDe(desde); lunes <= fin; lunes = sumarDias(lunes, 7)) {
        const semana = [0, 1, 2, 3, 4, 5].map(k => sumarDias(lunes, k)).filter(s => s <= fin);
        activos.forEach(p => {
            const id = String(p.ID), efect = [];
            semana.forEach(s => {
                const plan = planVigente(s);
                if (!programadaEn(plan, p, s)) return;
                const a = asignacion(plan, p);
                const rc = a && plan.rcs[a.rc] ? a.rc : p.rc;
                const enRango = s >= desde;
                const r = enRango ? fila(rc) : null;
                if (enRango) r.planificadas++;
                if (tipoDia(s) === 'FERIADO') { if (enRango) r.feriado++; return; }
                if (enRango) r.carga[s] = (r.carga[s] || 0) + 1;
                if (exc.has(normDia(rc) + '|' + s)) { if (enRango) r.excepcion++; return; }
                efect.push({ rc, enRango });
            });
            if (!efect.length) return;
            const visitas = semana.filter(s => o.fueVisitada(id, s)).length;
            efect.forEach((e, k) => {
                if (!e.enRango) return;
                const r = fila(e.rc);
                r.efectivas++;
                if (k < visitas) r.cumplidas++;
            });
        });
    }

    const total = { rc: 'TOTAL', planificadas: 0, feriado: 0, excepcion: 0, efectivas: 0, cumplidas: 0 };
    Object.values(porRC).forEach(r => {
        r.maxFuerte = 0; r.maxImpulso = 0;
        Object.entries(r.carga).forEach(([s, c]) => {
            if (tipoDia(s) === 'IMPULSO') r.maxImpulso = Math.max(r.maxImpulso, c);
            else r.maxFuerte = Math.max(r.maxFuerte, c);
        });
        const cfg = infoRC(r.rc, fin);
        r.modo = cfg ? `Ciclo ${cfg.T} sem` : 'SharePoint';
        r.pct = r.efectivas ? Math.round(r.cumplidas / r.efectivas * 100) : null;
        ['planificadas', 'feriado', 'excepcion', 'efectivas', 'cumplidas'].forEach(k => { total[k] += r[k]; });
    });
    total.pct = total.efectivas ? Math.round(total.cumplidas / total.efectivas * 100) : null;
    return { desde, hasta: fin, porRC, total, noReconocidas };
}

// ── Planificación (cercanía + topes) ──────────────────────────────────────
function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371, toR = Math.PI / 180;
    const dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(a));
}

// Ruta cerrada por vecino más cercano + mejora 2-opt; devuelve índices en orden de visita
function rutaCercania(pts) {
    const n = pts.length;
    if (n <= 3) return pts.map((_, i) => i);
    const D = pts.map(a => pts.map(b => haversineKm(a.lat, a.lng, b.lat, b.lng)));
    const usado = new Array(n).fill(false);
    const t = [0]; usado[0] = true;
    for (let k = 1; k < n; k++) {
        const u = t[t.length - 1];
        let b = -1, bd = Infinity;
        for (let v = 0; v < n; v++) if (!usado[v] && D[u][v] < bd) { bd = D[u][v]; b = v; }
        usado[b] = true; t.push(b);
    }
    let mejora = true, it = 0;
    while (mejora && it++ < 50) {
        mejora = false;
        for (let i = 0; i < n - 1; i++) {
            for (let j = i + 2; j < n; j++) {
                const a = t[i], b = t[i + 1], c = t[j], d = t[(j + 1) % n];
                if (a === d) continue;
                if (D[a][c] + D[b][d] < D[a][b] + D[c][d] - 1e-9) {
                    for (let x = i + 1, y = j; x < y; x++, y--) { const tmp = t[x]; t[x] = t[y]; t[y] = tmp; }
                    mejora = true;
                }
            }
        }
    }
    return t;
}

// Recorrido abierto: la ruta cerrada se corta en su tramo más largo
function ordenAbierto(pts) {
    const t = rutaCercania(pts);
    if (t.length < 3) return t;
    let corte = 0, max = -1;
    for (let k = 0; k < t.length; k++) {
        const a = pts[t[k]], b = pts[t[(k + 1) % t.length]];
        const d = haversineKm(a.lat, a.lng, b.lat, b.lng);
        if (d > max) { max = d; corte = k; }
    }
    return t.slice(corte + 1).concat(t.slice(0, corte + 1));
}

// Grupos del ciclo: pares fuertes (s, s+N/2) para Top 300; impulso en pares o slots simples
function gruposDeCiclo(T) {
    const N = Math.round(4 * T), M = Math.round(2 * T), grupos = [];
    for (let s = 0; s < N / 2; s++) grupos.push({ tipo: 'f', slots: [s, s + N / 2] });
    if (M % 2 === 0) for (let s = 0; s < M / 2; s++) grupos.push({ tipo: 'i', slots: [s, s + M / 2] });
    else for (let s = 0; s < M; s++) grupos.push({ tipo: 'i', slots: [s] });
    grupos.forEach(g => { g.cap = (g.tipo === 'f' ? TOPE.fuerte.obj : TOPE.impulso.obj) * g.slots.length; });
    return { N, M, grupos };
}

function permutaciones(arr) {
    if (arr.length <= 1) return [arr.slice()];
    const out = [];
    arr.forEach((x, i) => permutaciones(arr.slice(0, i).concat(arr.slice(i + 1))).forEach(r => out.push([x, ...r])));
    return out;
}

function nuevoEstado(mov, N, M) {
    return { mov, N, M, asig: new Array(mov.length), carga: { f: new Array(N).fill(0), i: new Array(M).fill(0) } };
}
function ponerAsig(st, i, a) {
    const prev = st.asig[i];
    if (prev) { prev.f.forEach(s => st.carga.f[s]--); prev.i.forEach(s => st.carga.i[s]--); }
    st.asig[i] = a;
    a.f.forEach(s => st.carga.f[s]++); a.i.forEach(s => st.carga.i[s]++);
}
function centroide(st, tipo, slot) {
    let la = 0, ln = 0, n = 0;
    st.mov.forEach((m, i) => { const a = st.asig[i]; if (a && a[tipo].includes(slot)) { la += m.p.lat; ln += m.p.lng; n++; } });
    return n ? { lat: la / n, lng: ln / n } : null;
}

// Corta la ruta en segmentos contiguos (uno por grupo) proporcionales a la capacidad
function cortarRuta(orden, mov, gc, ord, total, T) {
    const { N, M, grupos } = gc;
    const capTot = ord.reduce((s, gi) => s + grupos[gi].cap, 0);
    const cortes = []; let acc = 0;
    ord.forEach(gi => { acc += grupos[gi].cap; cortes.push(total * acc / capTot); });
    const segs = ord.map(() => []);
    let cum = 0, k = 0;
    orden.forEach(i => {
        const f = mov[i].frec;
        while (k < ord.length - 1 && cum + f / 2 > cortes[k]) k++;
        segs[k].push(i); cum += f;
    });
    const st = nuevoEstado(mov, N, M);
    let kept = 0, topsImpulso = 0;
    segs.forEach((seg, k) => {
        const g = grupos[ord[k]];
        const sueltos = seg.filter(i => mov[i].frec === 1);
        const mitad = Math.ceil(sueltos.length / 2);
        let mejor = null;
        const orient = g.slots.length === 2 ? [[g.slots[0], g.slots[1]], [g.slots[1], g.slots[0]]] : [[g.slots[0], g.slots[0]]];
        orient.forEach(([s1, s2]) => {
            let sc = 0; const slot = {};
            sueltos.forEach((i, j) => {
                slot[i] = j < mitad ? s1 : s2;
                if (mov[i].act.includes(diaDeSlot(T, g.tipo, slot[i]))) sc++;
            });
            if (!mejor || sc > mejor.sc) mejor = { sc, slot };
        });
        kept += mejor.sc;
        seg.forEach(i => {
            const slots = mov[i].frec === 2 ? g.slots.slice() : [mejor.slot[i]];
            if (mov[i].frec === 2) {
                if (g.tipo === 'i') topsImpulso++;
                kept += slots.filter(s => mov[i].act.includes(diaDeSlot(T, g.tipo, s))).length;
            }
            ponerAsig(st, i, g.tipo === 'f' ? { f: slots, i: [] } : { f: [], i: slots });
        });
    });
    let exceso = 0;
    st.carga.f.forEach(c => { exceso += Math.max(0, c - TOPE.fuerte.obj); });
    st.carga.i.forEach(c => { exceso += Math.max(0, c - TOPE.impulso.obj); });
    st.score = -(exceso + 3 * topsImpulso) * 100 + kept;
    st.orden = orden;
    return st;
}

// Top 300 solo en días fuertes: se intercambian con el suelto más cercano de un par fuerte
function sacarTopsDeImpulso(st) {
    const { mov, N } = st;
    mov.forEach((m, i) => {
        if (m.frec !== 2 || !st.asig[i].i.length) return;
        let best = -1, bd = Infinity;
        mov.forEach((x, j) => {
            if (x.frec !== 1 || !st.asig[j].f.length) return;
            const d = haversineKm(m.p.lat, m.p.lng, x.p.lat, x.p.lng);
            if (d < bd) { bd = d; best = j; }
        });
        if (best < 0) return;
        const base = st.asig[best].f[0] % (N / 2);
        const viejos = st.asig[i].i.slice();
        ponerAsig(st, i, { f: [base, base + N / 2], i: [] });
        const destino = viejos.reduce((a, b) => st.carga.i[b] < st.carga.i[a] ? b : a, viejos[0]);
        ponerAsig(st, best, { f: [], i: [destino] });
    });
}

// Baja la carga de los slots que pasan el tope moviendo sueltos al slot con espacio más cercano
function repararTopes(st, capF, capI) {
    const cap = t => t === 'f' ? capF : capI;
    for (let it = 0; it < 600; it++) {
        let peor = null, exc = 0;
        ['f', 'i'].forEach(t => st.carga[t].forEach((c, s) => { if (c - cap(t) > exc) { exc = c - cap(t); peor = { t, s }; } }));
        if (!peor) return true;
        const cand = [];
        st.mov.forEach((m, i) => { if (m.frec === 1 && st.asig[i][peor.t].includes(peor.s)) cand.push(i); });
        const destinos = [];
        ['f', 'i'].forEach(t => st.carga[t].forEach((c, s) => { if (c < cap(t)) destinos.push({ t, s }); }));
        if (!cand.length || !destinos.length) return false;
        let best = null, bd = Infinity;
        destinos.forEach(d => {
            const c = centroide(st, d.t, d.s);
            cand.forEach(i => {
                const p = st.mov[i].p;
                const dist = c ? haversineKm(p.lat, p.lng, c.lat, c.lng) : 0;
                if (dist < bd) { bd = dist; best = { i, d }; }
            });
        });
        ponerAsig(st, best.i, best.d.t === 'f' ? { f: [best.d.s], i: [] } : { f: [], i: [best.d.s] });
    }
    return false;
}

function cerrarEstado(st, T, reparar = true) {
    if (reparar && !repararTopes(st, TOPE.fuerte.obj, TOPE.impulso.obj)) repararTopes(st, TOPE.fuerte.max, TOPE.impulso.max);
    // Orden de visita de cada día: ruta propia por cercanía (no depende de cómo se cortó la ruta del RC)
    const ordenSlot = {};
    ['f', 'i'].forEach(t => {
        const n = t === 'f' ? st.N : st.M;
        for (let s = 0; s < n; s++) {
            const miembros = st.mov.map((m, i) => i).filter(i => st.asig[i][t].includes(s));
            ordenAbierto(miembros.map(i => st.mov[i].p)).forEach((k, pos) => { ordenSlot[`${miembros[k]}|${t}|${s}`] = pos + 1; });
        }
    });
    const tiendas = st.mov.map((m, i) => {
        const f = st.asig[i].f.slice().sort((x, y) => x - y);
        const im = st.asig[i].i.slice().sort((x, y) => x - y);
        return { f, i: im, of: f.map(s => ordenSlot[`${i}|f|${s}`]), oi: im.map(s => ordenSlot[`${i}|i|${s}`]) };
    });
    return {
        T, N: st.N, M: st.M, tiendas,
        maxF: Math.max(0, ...st.carga.f), maxI: Math.max(0, ...st.carga.i),
        visitas: st.mov.reduce((s, m) => s + m.frec, 0),
    };
}

function asignarCiclo(mov, ruta, T) {
    const gc = gruposDeCiclo(T);
    const n = mov.length, G = gc.grupos.length;
    const total = mov.reduce((s, m) => s + m.frec, 0);
    const ordenes = permutaciones([...Array(G).keys()].slice(1)).map(r => [0, ...r]);
    const paso = Math.max(1, Math.floor(n / 16));
    let mejor = null;
    for (let r = 0; r < Math.max(n, 1); r += paso) {
        const orden = ruta.slice(r).concat(ruta.slice(0, r));
        for (const ord of ordenes) {
            const st = cortarRuta(orden, mov, gc, ord, total, T);
            if (!mejor || st.score > mejor.score) mejor = st;
        }
    }
    sacarTopsDeImpulso(mejor);
    return cerrarEstado(mejor, T);
}

// Mantiene la asignación previa e inserta solo tiendas nuevas o que cambiaron de frecuencia.
// reparar=false (modo diario): ninguna tienda ya asignada cambia de fecha
function asignarIncremental(mov, ruta, cfgPrev, tiendasPrev, rc, reparar = true) {
    const T = cfgPrev.T, { N, M } = gruposDeCiclo(T);
    const st = nuevoEstado(mov, N, M);
    st.orden = ruta;
    const nuevos = [];
    mov.forEach((m, i) => {
        const pa = tiendasPrev[m.id];
        const ok = pa && pa.rc === rc && pa.f.every(s => s < N) && pa.i.every(s => s < M) &&
            (m.frec === 2 ? (pa.f.length === 2 && !pa.i.length) : (pa.f.length + pa.i.length === 1));
        if (ok) ponerAsig(st, i, { f: pa.f.slice(), i: pa.i.slice() });
        else nuevos.push(i);
    });
    nuevos.forEach(i => {
        const p = mov[i].p;
        const dist = (t, s) => { const c = centroide(st, t, s); return c ? haversineKm(p.lat, p.lng, c.lat, c.lng) : 0; };
        if (mov[i].frec === 2) {
            let best = 0, bv = Infinity;
            for (let s = 0; s < N / 2; s++) {
                const lleno = Math.max(st.carga.f[s], st.carga.f[s + N / 2]) >= TOPE.fuerte.obj ? 1000 : 0;
                const v = lleno + dist('f', s);
                if (v < bv) { bv = v; best = s; }
            }
            ponerAsig(st, i, { f: [best, best + N / 2], i: [] });
        } else {
            let best = null, bv = Infinity;
            ['f', 'i'].forEach(t => st.carga[t].forEach((c, s) => {
                const v = (c >= (t === 'f' ? TOPE.fuerte.obj : TOPE.impulso.obj) ? 1000 : 0) + dist(t, s);
                if (v < bv) { bv = v; best = { t, s }; }
            }));
            ponerAsig(st, i, best.t === 'f' ? { f: [best.s], i: [] } : { f: [], i: [best.s] });
        }
    });
    const res = cerrarEstado(st, T, reparar);
    res.nuevas = nuevos.length;
    return res;
}

const dentroDe = (r, nivel) => r.maxF <= TOPE.fuerte[nivel] && r.maxI <= TOPE.impulso[nivel];

function planificarRC(rc, pts, top300, cfgPrev, tiendasPrev) {
    const mov = pts.map(p => ({ p, id: String(p.ID), act: diasActuales(p), frec: top300[String(p.ID)] ? 2 : 1 }));
    const ruta = rutaCercania(mov.map(m => m.p));
    let inc = null;
    if (cfgPrev && tiendasPrev) {
        inc = asignarIncremental(mov, ruta, cfgPrev, tiendasPrev, rc);
        if (dentroDe(inc, 'obj')) return { mov, res: inc, estado: 'OBJETIVO' };
    }
    const res = T_OPCIONES.map(T => asignarCiclo(mov, ruta, T));
    const obj = res.find(r => dentroDe(r, 'obj'));
    if (obj) return { mov, res: obj, estado: 'OBJETIVO' };
    if (inc && dentroDe(inc, 'max')) return { mov, res: inc, estado: 'SOBRE_OBJETIVO' };
    const max = res.find(r => dentroDe(r, 'max'));
    if (max) return { mov, res: max, estado: 'SOBRE_OBJETIVO' };
    return { mov, res: res[res.length - 1], estado: 'REQUIERE_REASIGNACION' };
}

// Modo diario: solo altas, bajas y cambios de frecuencia; si se pasa el tope queda como alerta para el lunes
function actualizarRC(rc, pts, top300, cfgPrev, tiendasPrev) {
    const mov = pts.map(p => ({ p, id: String(p.ID), act: diasActuales(p), frec: top300[String(p.ID)] ? 2 : 1 }));
    const res = asignarIncremental(mov, rutaCercania(mov.map(m => m.p)), cfgPrev, tiendasPrev || {}, rc, false);
    const estado = dentroDe(res, 'obj') ? 'OBJETIVO' : dentroDe(res, 'max') ? 'SOBRE_OBJETIVO' : 'REQUIERE_REASIGNACION';
    return { mov, res, estado };
}

function cargaSharePoint(pts) {
    const c = {};
    DIAS_ORDEN.forEach(d => { c[d] = 0; });
    pts.forEach(p => diasActuales(p).forEach(d => { c[d]++; }));
    return {
        porDia: c,
        maxF: Math.max(...SEMANA_F.map(d => c[d])),
        maxI: Math.max(...SEMANA_I.map(d => c[d])),
    };
}

// Plan por fechas: RC de Lima que pasan el tope (o ya replanificados) pasan a ciclo.
// modo 'semanal' (lunes, para la semana siguiente): puede rearmar rutas completas.
// modo 'diario' (desde mañana): solo altas/bajas sin mover tiendas; los excesos quedan como alerta.
function planificar(o) {
    const top300 = o.top300 || {}, previo = o.previo || null, diario = o.modo === 'diario';
    const pts = (o.puntos || []).map(p => ({ ...p, lat: +p.lat, lng: +p.lng }));
    const porRC = {};
    pts.forEach(p => {
        if ((p.estado || '').toUpperCase() !== 'ACTIVO') return;
        if ((p.zonal_tipo || '').toUpperCase() !== 'LIMA') return;
        if (!p.rc || p.rc === 'SIN RC' || !p.lat || !p.lng || !isFinite(p.lat) || !isFinite(p.lng)) return;
        (porRC[p.rc] = porRC[p.rc] || []).push(p);
    });
    const plan = {
        version: o.vigente_desde, vigente_desde: o.vigente_desde, generado: new Date().toISOString(),
        parametros: { TOPE, T_OPCIONES }, rcs: {}, tiendas: {}, resumen: {},
    };
    Object.keys(porRC).sort().forEach(rc => {
        const lista = porRC[rc];
        const sp = cargaSharePoint(lista);
        const top = lista.filter(p => top300[String(p.ID)]).length;
        let cfgPrev = previo && previo.rcs[rc], tiendasPrev = previo && previo.tiendas, heredaDe = null;
        // Si recibe la cartera completa de un RC replanificado que ya no existe (vacante cubierta), hereda su plan
        if (previo && !cfgPrev) {
            const cuenta = {};
            lista.forEach(p => { const pa = previo.tiendas[String(p.ID)]; if (pa && previo.rcs[pa.rc]) cuenta[pa.rc] = (cuenta[pa.rc] || 0) + 1; });
            const [origen, n] = Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0] || [];
            if (origen && n * 2 >= lista.length && !porRC[origen]) {
                heredaDe = origen;
                cfgPrev = previo.rcs[origen];
                tiendasPrev = {};
                lista.forEach(p => {
                    const pa = previo.tiendas[String(p.ID)];
                    if (pa && pa.rc === origen) tiendasPrev[String(p.ID)] = { ...pa, rc };
                });
            }
        }
        const excede = sp.maxF > TOPE.fuerte.max || sp.maxI > TOPE.impulso.max;
        if (!cfgPrev && (!excede || diario)) {
            plan.resumen[rc] = { modo: 'SHAREPOINT', tiendas: lista.length, top, maxF: sp.maxF, maxI: sp.maxI, cargaSP: sp.porDia };
            if (excede) plan.resumen[rc].alerta = 'Excede el tope en SharePoint: se replanifica el lunes para la semana siguiente';
            return;
        }
        const { mov, res, estado } = diario
            ? actualizarRC(rc, lista, top300, cfgPrev, tiendasPrev)
            : planificarRC(rc, lista, top300, cfgPrev, tiendasPrev);
        plan.rcs[rc] = { ancla: cfgPrev ? cfgPrev.ancla : lunesDe(o.vigente_desde), T: res.T, N: res.N, M: res.M, estado };
        mov.forEach((m, i) => { plan.tiendas[m.id] = { rc, ...res.tiendas[i] }; });
        plan.resumen[rc] = {
            modo: 'REPLAN', tiendas: lista.length, top, T: res.T, estado, visitas: res.visitas,
            maxF: res.maxF, maxI: res.maxI, maxF_sp: sp.maxF, maxI_sp: sp.maxI, cargaSP: sp.porDia,
        };
        if (heredaDe) plan.resumen[rc].heredaDe = heredaDe;
        if (diario && estado !== 'OBJETIVO') plan.resumen[rc].alerta = 'Pasa el objetivo por tiendas nuevas: se rearma el lunes para la semana siguiente';
    });
    return plan;
}

return {
    TOPE, T_OPCIONES, DIAS_ORDEN, normDia, iso, sumarDias, lunesDe, hoyLima, diasEntre,
    setFeriados, feriados: () => _feriadosLista.slice(), agregarPlan, planVigente, versiones: () => _versiones.slice(),
    cargar, asegurarRango, esFeriado, feriadoNombre, tipoDia, contadores, slotDe, diaDeSlot, etiquetaSlot,
    diasActuales, asignacion, programadaEn, tocaVisita, ordenVisita, infoRC, rcReplanificado, rcDeTienda,
    proximasVisitas, codigoExcepcion, cumplimiento, haversineKm, rutaCercania, gruposDeCiclo, planificar,
};
});
