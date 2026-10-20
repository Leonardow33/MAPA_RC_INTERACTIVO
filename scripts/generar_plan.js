// Genera la versión semanal del plan de rutas por fechas (data/planes/plan_<lunes>.json)
// Uso: node scripts/generar_plan.js   (VIGENTE_DESDE=YYYY-MM-DD opcional, debe ser lunes)
const fs = require('fs');
const path = require('path');
const PLAN = require('../js/planificador.js');

const DATA = path.join(__dirname, '..', 'data');
const DIR  = path.join(DATA, 'planes');
const leer = (f, def) => {
    try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8').replace(/^﻿/, '')); }
    catch (e) { return def; }
};

const hoy = PLAN.hoyLima();
let vigente = (process.env.VIGENTE_DESDE || '').trim();
if (!vigente) vigente = PLAN.sumarDias(PLAN.lunesDe(hoy), 7);
if (PLAN.lunesDe(vigente) !== vigente) { console.error(`vigente_desde ${vigente} no es lunes`); process.exit(1); }
if (vigente < hoy) { console.error(`vigente_desde ${vigente} ya pasó`); process.exit(1); }

fs.mkdirSync(DIR, { recursive: true });
let indice = leer('planes/index.json', []);
const archivo = `plan_${vigente}.json`;
if (vigente <= hoy && indice.some(v => v.vigente_desde === vigente)) {
    console.error(`La versión ${vigente} ya está vigente y no se puede reescribir`);
    process.exit(1);
}

PLAN.setFeriados(leer('feriados.json', []));
const previoMeta = indice.filter(v => v.vigente_desde < vigente)
    .sort((a, b) => a.vigente_desde < b.vigente_desde ? -1 : 1).pop();
const previo = previoMeta ? leer('planes/' + previoMeta.archivo, null) : null;

const plan = PLAN.planificar({
    puntos: leer('puntos.json', []),
    top300: leer('top100_tambo.json', {}),
    previo,
    vigente_desde: vigente,
});

fs.writeFileSync(path.join(DIR, archivo), JSON.stringify(plan));
indice = indice.filter(v => v.vigente_desde !== vigente)
    .concat([{ vigente_desde: vigente, archivo, generado: plan.generado }])
    .sort((a, b) => a.vigente_desde < b.vigente_desde ? -1 : 1);
fs.writeFileSync(path.join(DIR, 'index.json'), JSON.stringify(indice, null, 1));

console.log(`Plan ${vigente} (previo: ${previoMeta ? previoMeta.vigente_desde : 'ninguno'})`);
Object.entries(plan.resumen).forEach(([rc, r]) => {
    const det = r.modo === 'REPLAN'
        ? `ciclo ${r.T} sem · ${r.estado} · máx ${r.maxF}/${r.maxI} (SharePoint ${r.maxF_sp}/${r.maxI_sp})`
        : `SharePoint · máx ${r.maxF}/${r.maxI}`;
    console.log(`  ${rc.padEnd(24)} ${String(r.tiendas).padStart(4)} tiendas · ${det}`);
});
