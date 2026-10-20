// Verifica invariantes del plan de rutas con datos reales. Uso: node scripts/test_plan.js
const fs = require('fs');
const path = require('path');
const PLAN = require('../js/planificador.js');

const DATA = path.join(__dirname, '..', 'data');
const leer = f => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8').replace(/^﻿/, ''));
let fallos = 0;
const check = (ok, msg) => { if (!ok) { fallos++; if (fallos <= 30) console.log('  ✗ ' + msg); } };

const puntos = leer('puntos.json').map(p => ({ ...p, lat: +p.lat, lng: +p.lng }));
const top300 = leer('top100_tambo.json');
PLAN.setFeriados(leer('feriados.json'));
const INICIO = '2026-10-26';
const plan = PLAN.planificar({ puntos, top300, previo: null, vigente_desde: INICIO });
PLAN.agregarPlan(plan);
const fechas = [...Array(26 * 7).keys()].map(k => PLAN.sumarDias(INICIO, k));

console.log('1. Topes por día, domingos y feriados');
Object.keys(plan.rcs).forEach(rc => {
    const tiendas = puntos.filter(p => plan.tiendas[String(p.ID)] && plan.tiendas[String(p.ID)].rc === rc);
    fechas.forEach(s => {
        const n = tiendas.filter(p => PLAN.tocaVisita(p, s)).length;
        const t = PLAN.tipoDia(s);
        if (t === 'DOMINGO' || t === 'FERIADO') check(n === 0, `${rc} ${s} ${t} con ${n} visitas`);
        else if (t === 'FUERTE') check(n <= PLAN.TOPE.fuerte.max, `${rc} ${s} fuerte con ${n}`);
        else check(n <= PLAN.TOPE.impulso.max, `${rc} ${s} impulso con ${n}`);
    });
});

console.log('2. Frecuencia por ciclo y separación de Top 300');
Object.entries(plan.tiendas).forEach(([id, a]) => {
    const cfg = plan.rcs[a.rc];
    const esTop = !!top300[id];
    check(a.f.length + a.i.length === (esTop ? 2 : 1), `${id} tiene ${a.f.length + a.i.length} visitas por ciclo`);
    if (esTop) {
        check(a.f.length === 2 && !a.i.length, `Top ${id} fuera de días fuertes`);
        check(a.f[1] - a.f[0] === cfg.N / 2, `Top ${id} slots ${a.f} no separados medio ciclo`);
    }
    const p = puntos.find(x => String(x.ID) === id);
    // Cada rotación se recorre sobre sus propios días: N días fuertes y M días de impulso
    let n = 0, nf = 0, ni = 0;
    for (let s = cfg.ancla; nf < cfg.N || ni < cfg.M; s = PLAN.sumarDias(s, 1)) {
        const dow = new Date(s + 'T12:00:00').getDay();
        if (dow === 0) continue;
        const esImp = dow === 3 || dow === 6;
        if (esImp ? ni++ >= cfg.M : nf++ >= cfg.N) continue;
        if (PLAN.programadaEn(plan, p, s)) n++;
    }
    check(n === (esTop ? 2 : 1), `${id} programada ${n} veces en el primer ciclo`);
});

console.log('3. Toda tienda activa de un RC replanificado tiene plan');
puntos.forEach(p => {
    if ((p.estado || '').toUpperCase() !== 'ACTIVO' || (p.zonal_tipo || '').toUpperCase() !== 'LIMA') return;
    if (!plan.rcs[p.rc] || !p.lat || !p.lng) return;
    check(!!plan.tiendas[String(p.ID)], `${p.ID} (${p.rc}) sin plan`);
});

console.log('4. RC que siguen SharePoint: igual al día de la semana');
const DJS = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
puntos.filter(p => !plan.rcs[p.rc]).slice(0, 400).forEach(p => {
    fechas.slice(0, 14).forEach(s => {
        const dia = DJS[new Date(s + 'T12:00:00').getDay()];
        const esperado = PLAN.tipoDia(s) !== 'FERIADO' && PLAN.diasActuales(p).includes(dia);
        check(PLAN.tocaVisita(p, s) === esperado, `${p.ID} ${s} SharePoint distinto`);
    });
});

console.log('5. Estabilidad: replanificar con el plan previo no mueve tiendas');
const siguiente = PLAN.planificar({ puntos, top300, previo: plan, vigente_desde: PLAN.sumarDias(INICIO, 7) });
Object.entries(plan.tiendas).forEach(([id, a]) => {
    const b = siguiente.tiendas[id];
    check(b && JSON.stringify(a.f) === JSON.stringify(b.f) && JSON.stringify(a.i) === JSON.stringify(b.i), `${id} cambió de slot`);
});
Object.entries(plan.rcs).forEach(([rc, c]) => check(siguiente.rcs[rc] && siguiente.rcs[rc].ancla === c.ancla, `${rc} cambió de ancla`));

console.log('6. Cumplimiento: casos fijos');
(function () {
    PLAN.setFeriados([{ fecha: '2027-01-04', nombre: 'Feriado de prueba' }]);
    const p1 = { ID: 'A', rc: 'RCX', estado: 'ACTIVO', dias: ['LUNES', 'JUEVES'] };
    const p2 = { ID: 'B', rc: 'RCX', estado: 'ACTIVO', dias: ['MARTES'] };
    const vis = new Set(['A|2027-01-05', 'B|2027-01-12', 'B|2027-01-12', 'A|2027-01-14', 'A|2027-01-15']);
    const fue = (id, s) => vis.has(id + '|' + s);
    const exc = [{ fecha: '2027-01-19', nombre: 'RCX', tipo: 'Descanso médico' }, { fecha: '2027-01-20', nombre: 'RCX', tipo: 'algo raro' }];
    const r = PLAN.cumplimiento({ puntos: [p1, p2], desde: '2027-01-04', hasta: '2027-01-23', fueVisitada: fue, excepciones: exc, hoy: '2027-01-30' });
    const x = r.porRC.RCX;
    // Sem 1: A lun(feriado)+jue, B mar → efectivas 2; A visitada mar → 1 cumplida (jue); B no → 0
    // Sem 2: A lun+jue (visitas jue,vie → 2), B mar (visita mar) → 3/3
    // Sem 3: A lun+jue, B mar (19 = excepción) → efectivas 2, 0 cumplidas
    check(x.feriado === 1, `feriado=${x.feriado}`);
    check(x.excepcion === 1, `excepcion=${x.excepcion}`);
    check(x.efectivas === 7, `efectivas=${x.efectivas}`);
    check(x.cumplidas === 4, `cumplidas=${x.cumplidas}`);
    check(r.noReconocidas.length === 1, `noReconocidas=${r.noReconocidas.length}`);
    // Semana partida por mes: planificado mar 1 dic, visitado lun 30 nov → cuenta en diciembre
    const p3 = { ID: 'C', rc: 'RCY', estado: 'ACTIVO', dias: ['MARTES'] };
    const r2 = PLAN.cumplimiento({ puntos: [p3], desde: '2026-12-01', hasta: '2026-12-31', fueVisitada: (id, s) => s === '2026-11-30', hoy: '2027-01-05' });
    check(r2.porRC.RCY.cumplidas >= 1, 'semana partida por mes no asignó la visita');
    PLAN.setFeriados(leer('feriados.json'));
})();

console.log('7. Zona horaria');
const firma = fechas.slice(0, 28).map(s => puntos.slice(0, 300).map(p => PLAN.tocaVisita(p, s) ? 1 : 0).join('')).join('|');
console.log('  firma ' + require('crypto').createHash('md5').update(firma).digest('hex') + ' (TZ=' + (process.env.TZ || 'local') + ')');

console.log(fallos ? `\n${fallos} fallos` : '\nOK: todos los invariantes se cumplen');
process.exit(fallos ? 1 : 0);
