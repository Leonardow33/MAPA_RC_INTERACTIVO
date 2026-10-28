# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

**Geodor** — sitio estático (HTML + JS vanilla, sin bundler ni package.json) para Elot Group Perú: mapas de visitas de RC (Representantes Comerciales), planificación de rutas, bonos por partner y dashboards de ventas. Se publica en GitHub Pages desde la rama `dist`; los datos se actualizan solos con GitHub Actions.

Responde siempre en español. El usuario escribe mensajes cortos, a veces con errores tipográficos: interpreta el contexto técnico.

## Comandos

No hay build local ni linter. Para probar, abre los HTML con un servidor estático desde la raíz (las páginas hacen `fetch` a `data/*.json` con rutas relativas, por lo que `file://` no funciona):

```bash
python -m http.server 8000
```

- Pruebas del planificador de rutas (invariantes sobre datos reales): `node scripts/test_plan.js`
- Generar plan de rutas: `MODO=diario node scripts/generar_plan.js` o `MODO=semanal node scripts/generar_plan.js` (opcional `VIGENTE_DESDE=YYYY-MM-DD` en modo semanal). Escribe `data/planes/plan_<fecha>.json` y `data/planes/index.json`.
- `js/planificador.js` se usa en el navegador y también con `require()` en Node: mantenlo compatible con ambos.

## Flujo de datos

```
Power BI → Power Automate (DAX diario → JSON en SharePoint)
  → actualizar_ventas.yml (Playwright descarga, lanzado por cron-job.org)
  → data/ventas_mes.json · ventas_raspes.json · ventas_loteria.json
  → build-dist.yml → rama dist (visitas.html y mapa.html ofuscados) → GitHub Pages
```

- **SharePoint solo se descarga con Playwright** (curl o requests devuelven la página de login). La descarga tiene 3 intentos de respaldo en `actualizar_ventas.yml`.
- `build-dist.yml` se dispara con un `push` a `main` **solo si cambian los paths de su lista**. Si agregas un HTML o un JSON nuevo que deba publicarse, añádelo a esa lista. Los pushes hechos con `GITHUB_TOKEN` desde otros workflows no disparan workflows.
- `dist` se recrea con force push a partir de `main`: nunca edites `dist` directamente.
- `purge-cdn.yml` purga jsDelivr cuando cambian `data/puntos.json`, `data/version.json`, `js/**` o `css/**`.
- `data/version.json` (`{"v": timestamp, "n": contador}`) lo actualiza Power Automate junto con `puntos.json`.
- **Los 5 DAX de Power Automate** (mes, raspes, lotería, LakiDey y Turbito) definen "hoy" como la fecha de Lima: `UTCNOW() - TIME(5,0,0)`. **No uses `TODAY()`**: va en UTC, y el último día del mes la consulta saldría vacía desde las 19:00 de Lima, así que se perderían las ventas de la noche. Los DAX no están en el repo; `scripts/fetch_ventas.py` todavía usa `TODAY()`, pero ningún workflow lo ejecuta.
- **Cierre de mes**: `actualizar_ventas.yml` copia el archivo a `*_prev.json` solo cuando el mes descargado es **posterior** al guardado. Si una descarga trae un mes anterior, se ignora. Si trae 0 registros, tampoco sobrescribe el archivo. El mismo workflow sincroniza los JSON de ventas con `dist`.

### Workflows con horario (hora de Lima = UTC-5)
| Workflow | Cuándo | Qué hace |
|---|---|---|
| `actualizar_ventas.yml` | `workflow_dispatch` lanzado por cron-job.org cada 25 min | Descarga los 5 JSON de ventas, crea los `_prev` al cambiar de mes y sincroniza `dist` |
| `findemes_noche.yml` | cron-job.org a diario a las 23:30 | Descarga extra solo el último día del mes (input `forzar` para lanzarlo a mano). Su `schedule` de GitHub es solo un respaldo: suele llegar 4–8 h tarde, cuando ya es día 1 |
| `safety_snapshot_findemes.yml` | 11:00 | Respaldo del snapshot de la semana Tambo el último día (Power BI se reinicia el día 1) |
| `snapshot_bonos.yml` | jueves 9:00 | Agrega la semana Tambo cerrada a `historico_bonos.json` (input `semanas_atras`) |
| `actualizar_puntos.yml` / `plan_rutas.yml` | lunes 8:00 / al cambiar puntos | Ejecutan `generar_plan.js` |
| `update-sinventa.yml` | cada 15 min | Actualiza `sinventa.txt` |
| `enviar_claves_diarias.yml` | diario 7:00 | Envía las claves diarias |

## Modelo de datos (reglas que rompen cosas si se ignoran)

- **`data/puntos.json`** es el maestro de tiendas: `ID`, `responsable` (partner), `estado` (ACTIVO/INACTIVO/CERRADO), `cluster_bono`, `rc`, `supervisor`, `gz`, `jz`, `lat`, `lng`, y las metas (`meta_diaria`, `meta_pp`, `meta_ppgo`, `meta_lakidey`, `meta_sc_e3`, `meta_turbito`). Las páginas de bonos filtran **solo `estado === 'ACTIVO'`**.
- Los registros de ventas se cruzan con la tienda así: `String(v.org_code) === String(p.ID)`. Campos: `org_code`, `nombre`, `total`, `tipo_juego`, `fecha`, `partner`.
- **La clave de nivel superior varía**: `ventas_mes.json` usa `body` y raspes/lotería usan `ventas`. Lee siempre con `data.body || data.ventas || []`.
- **El total de la tienda sale de `tipo_juego === 'TOTAL'`** en `ventas_mes.json`. No lo calcules sumando juegos.
- **Nombre del juego Go**: es `"Go"` en ventas y `"PozoPowerGo"` en premios/DMS. Acepta ambos.
- **Unidades**: PozoPower viene en soles y 1 ticket = S/5, así que usa `Math.floor(soles / 5)` antes de comparar con `keys_bonos.json`, que está en unidades. LakiDey: S/1 = 1 unidad.
- **Semana Tambo**: de jueves a miércoles (`juevesDe(fecha)`). Las fechas se parsean como `new Date(fecha + 'T12:00:00')` para evitar desfases de zona horaria.
- **Semana de incentivo de Apuesta Total**: de miércoles a martes (`miercolesDe` en `bonus_at.html`). Cuando la semana cruza de mes, la página también carga `ventas_mes_prev.json` (array `ventasSemana`) para no perder los días del mes anterior.
- **Cencosud con 2 POS**: algunas tiendas tienen un 2do POS con otro `org_code` (4043–4056). `bonus_cencosud.html` lo reasigna al ID principal con `POS2_MAP` (el código original queda en `pos_code`) y muestra la venta separada por POS. Si se agrega un 2do POS, hay que sumarlo a `POS2_MAP`.
- Los archivos `*_prev.json` contienen el mes anterior.
- Algunos JSON traen BOM: los scripts de Node lo quitan con `.replace(/^﻿/, '')`.
- Los JSON de datos son de una sola línea y pesan varios MB: para inspeccionarlos usa `node -e`, no `grep`. Para ver cómo cambiaron a lo largo del día, compara versiones con `git show <commit>:data/...`. El campo `updated` cambia en cada descarga aunque los datos no cambien.

## Páginas

- Raíz: `visitas.html` (tracking de visitas RC, que lee Google Sheets en tiempo real), `mapa.html`, `bonus.html` (bonos Tambo con descarga del Excel FORMATO_1_TAMBO), `zonas.html`, `SUPYCAP.html`, `logistica.html`, `admin_claves.html` (incluye el resumen gerencial de ventas), `progreso.html`, `incidencias.html`, `activacion.html`.
- `BONOS PARTNERS/bonus_<partner>.html`: una página por partner, todas con el mismo patrón (`const PARTNER = '...'` + `Promise.all` de puntos y los 3 JSON de ventas + `renderStore`). Un cambio en una casi siempre aplica a las 7. `bonus_cencosud.html` además carga `metas_cencosud.json`.
- La lógica compartida grande vive en `js/` (`mapa.js`, `visitas.js`, `planificador.js`, `zonas.js`, `supycap.js`). Mucho JS va inline en los HTML.
- `herramientas/`: utilidades internas (`editor_pdv.html`, `mapa_incidencias.html`).
- `sources/` (Excel fuente, ignorado por git), `distribucion/` (paquetes zip y docs para distribuir) y los `*_prebak.json` no forman parte del sitio.

## Convenciones

- Haz commits pequeños, uno por cada cambio funcional, con mensaje en español y prefijo tipo `feat(...)`, `fix:`, `ci:` o `chore:`.
- Los commits automáticos de datos llevan `[skip ci]`.
- No hagas commit de `pbi_session.b64.txt` (es una sesión de Power BI) ni de `sources/`.
