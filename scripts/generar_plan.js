// Genera versiones del plan de rutas por fechas en data/planes/plan_<fecha>.json
//   MODO=diario  → si cambiaron las tiendas, versión desde mañana (sin mover tiendas ya asignadas)
//   MODO=semanal → versión del próximo lunes; puede rearmar rutas de RC que pasan el tope
//   VIGENTE_DESDE=YYYY-MM-DD (solo semanal) fecha futura manual, p.ej. inicio de un piloto
// En ambos modos se recalculan las versiones futuras ya publicadas para que hereden los cambios.
const fs = require('fs');
const path = require('path');
const PLAN = require('../js/planificador.js');

const DATA = path.join(__dirname, '..', 'data');
const DIR  = path.join(DATA, 'planes');
const leer = (f, def) => {
    try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8').replace(/^﻿/, '')); }
    catch (e) { return def; }
};
const asc = (a, b) => a.vigente_desde < b.vigente_desde ? -1 : 1;
const igual = (a, b) => !!a && !!b &&
    JSON.stringify({ r: a.rcs, t: a.tiendas }) === JSON.stringify({ r: b.rcs, t: b.tiendas });

const MODO = (process.env.MODO || 'semanal').trim();
const hoy = PLAN.hoyLima();
const puntos = leer('puntos.json', []);
const top300 = leer('top100_tambo.json', {});
PLAN.setFeriados(leer('feriados.json', []));
fs.mkdirSync(DIR, { recursive: true });
let indice = leer('planes/index.json', []).sort(asc);
const cargarVersion = v => leer('planes/' + v.archivo, null);

function guardar(plan) {
    const archivo = `plan_${plan.vigente_desde}.json`;
    fs.writeFileSync(path.join(DIR, archivo), JSON.stringify(plan));
    indice = indice.filter(v => v.vigente_desde !== plan.vigente_desde)
        .concat([{ vigente_desde: plan.vigente_desde, archivo, generado: plan.generado }]).sort(asc);
    fs.writeFileSync(path.join(DIR, 'index.json'), JSON.stringify(indice, null, 1));
}

function resumir(plan, titulo) {
    console.log(titulo);
    Object.entries(plan.resumen).forEach(([rc, r]) => {
        const det = r.modo === 'REPLAN'
            ? `ciclo ${r.T} sem · ${r.estado} · máx ${r.maxF}/${r.maxI} (SharePoint ${r.maxF_sp}/${r.maxI_sp})`
            : `SharePoint · máx ${r.maxF}/${r.maxI}`;
        console.log(`  ${rc.padEnd(24)} ${String(r.tiendas).padStart(4)} tiendas · ${det}${r.heredaDe ? ' · hereda el plan de ' + r.heredaDe : ''}${r.alerta ? ' · ⚠ ' + r.alerta : ''}`);
    });
}

// Recalcula en cadena las versiones posteriores a `desde`, partiendo del plan `base`
function cascada(desde, base) {
    let prev = base;
    indice.filter(v => v.vigente_desde > desde).forEach(v => {
        const viejo = cargarVersion(v);
        const nuevo = PLAN.planificar({ puntos, top300, previo: prev, vigente_desde: v.vigente_desde, modo: 'semanal' });
        if (!igual(nuevo, viejo)) { guardar(nuevo); console.log(`Versión futura ${v.vigente_desde} actualizada`); }
        prev = igual(nuevo, viejo) ? viejo : nuevo;
    });
}

if (MODO === 'diario') {
    const vigente = PLAN.sumarDias(hoy, 1);
    const baseMeta = indice.filter(v => v.vigente_desde <= vigente).pop();
    if (!baseMeta) { console.log('Aún no hay plan publicado: todas las rutas siguen SharePoint'); process.exit(0); }
    const base = cargarVersion(baseMeta);
    const plan = PLAN.planificar({ puntos, top300, previo: base, vigente_desde: vigente, modo: 'diario' });
    if (igual(plan, base)) {
        console.log(`Sin cambios en tiendas: se mantiene el plan vigente desde ${baseMeta.vigente_desde}`);
        cascada(vigente, base);
    } else {
        const nuevas = Object.keys(plan.tiendas).filter(id => !base.tiendas[id]);
        const bajas  = Object.keys(base.tiendas).filter(id => !plan.tiendas[id]);
        guardar(plan);
        resumir(plan, `Plan desde ${vigente} (base ${baseMeta.vigente_desde}) · altas ${nuevas.length} · bajas ${bajas.length}`);
        cascada(vigente, plan);
    }
} else {
    let vigente = (process.env.VIGENTE_DESDE || '').trim();
    if (!vigente) vigente = PLAN.sumarDias(PLAN.lunesDe(hoy), 7);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vigente)) { console.error(`vigente_desde inválido: ${vigente}`); process.exit(1); }
    if (vigente <= hoy) { console.error(`vigente_desde ${vigente} debe ser posterior a hoy (${hoy})`); process.exit(1); }
    const previoMeta = indice.filter(v => v.vigente_desde < vigente).pop();
    const previo = previoMeta ? cargarVersion(previoMeta) : null;
    const plan = PLAN.planificar({ puntos, top300, previo, vigente_desde: vigente, modo: 'semanal' });
    const actual = indice.find(v => v.vigente_desde === vigente);
    if (actual && igual(plan, cargarVersion(actual))) console.log(`Plan ${vigente} sin cambios`);
    else guardar(plan);
    resumir(plan, `Plan ${vigente} (previo: ${previoMeta ? previoMeta.vigente_desde : 'ninguno'})`);
    cascada(vigente, plan);
}
