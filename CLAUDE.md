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
- **Cierre de mes**: `actualizar_ventas.yml` copia el archivo a `*_prev.json` solo cuando el mes descargado es **posterior** al guardado. Si una descarga trae un mes anterior, se ignora. Si trae 0 registros, tampoco sobrescribe el archivo. El mismo workflow sincroniza los JSON de ventas con `dist`, incluidos los `_prev`.
- **El último día del mes queda congelado**: el `_prev` guarda ese día tal como estaba a las 00:00 de Lima del día 1. La causa no es que falten descargas, sino que **Power BI carga ventas con atraso**. El 31-oct-2026 hubo descargas a las 23:25, 23:40 (cron), 23:50 y 00:00, y desde las 23:40 el total ya no cambió (S/ 49,656). Las ventas que faltaban entraron al modelo después de medianoche, cuando el DAX ya solo traía noviembre. Por eso se perdieron 39 tickets PozoPower en 7 tiendas, más LakiDey, Elige 3, Go y raspes. El cron de las 23:40 no puede capturar lo que Power BI todavía no tiene. La única solución es **seguir descargando el día anterior después de medianoche**. Para Tambo ya está resuelto con los archivos `tambo_*` (ver **BI de Tambo**). Los demás partners siguen expuestos y para ellos `findemes_noche.yml` es la única protección.
- **Atraso de datos**: lo normal es ~25 min por la descarga más ~5 min por la publicación en Pages. Si reportan datos atrasados: (1) compara el `updated` del JSON en `main` con el publicado (`https://leonardow33.github.io/MAPA_RC_INTERACTIVO/data/<archivo>.json`); (2) revisa https://www.githubstatus.com (Actions/Pages degradados dejan los workflows en cola); (3) para ver si Power BI se está refrescando, compara el total del día entre commits con `git show <commit>:data/ventas_mes.json`. Los JSON no traen la hora de corte de Power BI. Las ventas de la noche siguen llegando hasta pasada la medianoche.

### Workflows con horario (hora de Lima = UTC-5)
| Workflow | Cuándo | Qué hace |
|---|---|---|
| `actualizar_ventas.yml` | `workflow_dispatch` lanzado por cron-job.org cada 25 min | Descarga los 5 JSON de ventas, crea los `_prev` al cambiar de mes y sincroniza `dist` |
| `findemes_noche.yml` | cron-job.org a diario a las 23:40 | Descarga extra solo el último día del mes; los demás días termina en ~3 s sin hacer nada (input `forzar` para lanzarlo a mano). Su `schedule` de GitHub es solo un respaldo: suele llegar 4–8 h tarde, cuando ya es día 1 |
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
- **Unidades**: PozoPower viene en soles; `keys_bonos.json` está en tickets. Usa el campo `tickets` del registro si existe (Tambo, días cerrados); si no, estima con `Math.floor(soles / 5)` (1 ticket = S/5, pero la promo 3x12 hace que esa estimación cuente de menos). LakiDey: S/1 = 1 unidad.
- **Semana Tambo**: de jueves a miércoles (`juevesDe(fecha)`). Las fechas se parsean como `new Date(fecha + 'T12:00:00')` para evitar desfases de zona horaria.
- **Semana de los demás partners**: de lunes a domingo, salvo Apuesta Total, que va de miércoles a martes (`miercolesDe` en `bonus_at.html`).
- **Semanas que cruzan de mes**: todas las páginas de `BONOS PARTNERS/` también cargan `ventas_mes_prev.json`. Los cálculos semanales usan el array `ventasSemana` (no `allVentas`) para no perder los días del mes anterior. Tambo lo resuelve aparte con `allVentasPrev`.
- **Cencosud con 2 POS**: algunas tiendas tienen un 2do POS con otro `org_code` (4043–4056). `bonus_cencosud.html` lo reasigna al ID principal con `POS2_MAP` (el código original queda en `pos_code`) y muestra la venta separada por POS. Si se agrega un 2do POS, hay que sumarlo a `POS2_MAP`.
- Los archivos `*_prev.json` contienen el mes anterior.
- **BI de Tambo (dos BIs)**: nuestro BI reúne a todos los partners y Tambo tiene su propio BI. La métrica es la misma, pero cada uno calcula la **promo de PozoPower (3 jugadas por S/12)** por su lado: el monto PozoPower por tienda y día difiere en **±S/3 (múltiplos de 3) en las dos direcciones**, aunque los **tickets son iguales**. Los demás juegos cuadran exacto. No es un error del repo ni de la descarga.
  - **Para Tambo manda su BI en los días cerrados.** Tres flujos de Power Automate exportan desde el modelo de Tambo, con fechas desde `min(último día del mes anterior, jueves de la semana Tambo)` para que la semana que cruza de mes no se congele: `data/tambo_totales.json` (TOTAL), `data/tambo_pozopower.json` (monto PozoPower con promociones) y `data/tambo_tickets.json` (tickets PozoPower; su campo `total` es de nuestro modelo y no se usa). `actualizar_ventas.yml` los descarga (si fallan, el workflow sigue y usa los últimos guardados, sin lógica `_prev`).
  - **Rango de fechas de los 3 DAX de Tambo**: `VAR _jueves = _hoy - MOD(WEEKDAY(_hoy, 2) - 4, 7)` y `VAR _desde = MIN(_iniMes - 1, _jueves)`, filtrando `Fecha[Date] >= _desde && Fecha[Date] <= _hoy` y con "hoy" en hora de Lima. Con `_jueves`, en la semana que cruza de mes se siguen descargando los días del mes anterior. El `- 1` cubre el caso borde en que **el día 1 cae jueves**: ahí `_jueves` = día 1 y, sin el −1, el miércoles anterior, que cierra la semana y se cierra en el snapshot del jueves a las 9:00, quedaría congelado. El próximo caso es el 1-abr-2027. Fuera de esos casos, el −1 solo agrega el último día del mes anterior, que va a `_prev` con el valor de Tambo. `_desde` solo define el rango que se descarga: no cambia cómo se calcula la semana jue–mié.
  - **Flujos de Power Automate de Tambo**: el de tickets usa la medida `[Count_Tickets]`, que el usuario agregó a nuestro modelo. `# Promociones` no se puede sacar porque depende de una columna que la fuente no trae. Ese DAX usa `SELECTCOLUMNS`, así que en el *Select* las claves van como `item()?['[org_code]']`. El de monto PozoPower filtra `'Game Maste-Retaler'[game_name] = "PozoPower"` (sin Go ni Elige 3, que ya cuadran) y se guarda como lista JSON sin envoltura. Si un DAX da `Cannot find table`, la tabla o medida no existe en el modelo que consulta el flujo: hay que nombrar la medida sin la tabla (`[Count_Tickets]`) o publicar el modelo.
  - `scripts/tambo_bi.py aplicar` (después de cada descarga, en `actualizar_ventas.yml` y `findemes_noche.yml`) escribe, **solo para fechas anteriores a hoy en Lima**, el `TOTAL` Tambo en `ventas_mes(_prev).json` y el registro `PozoPower` Tambo en `ventas_loteria(_prev).json` con su monto y el campo **`tickets`**. Cada fecha va al archivo de su mes. **El día en curso sigue con nuestro BI**, y la comparación entre BIs solo se hace con días cerrados.
  - **Tickets PozoPower para el bono**: `bonus.html`, `bonus_tambo.html`, `snapshot_bonos.yml`, `safety_snapshot_findemes.yml` y el snapshot de fin de mes usan `tickets` cuando el registro lo trae; si no (día en curso, meses viejos), lo estiman desde los soles (`floor(soles/5)` o `ppTickets()`). **Los montos siempre llevan las promociones**: nunca se inflan los soles para que cuadre el conteo.
  - **Semana que cruza de mes**: `bonus.html` y `snapshot_bonos.yml` leen los días del mes anterior desde los `_prev` (que tienen las correcciones), no desde el snapshot parcial guardado el último día del mes, que queda solo como respaldo.
  - El 31-oct-2026 se perdieron movimientos completos al cerrar el mes (39 tickets PozoPower en 7 tiendas, más LakiDey, Elige 3, Go y raspes); se repusieron a mano en los `_prev` por juego con el export del BI de Tambo.
  - Cuando los dos BIs se homogenicen, se pueden quitar las 3 descargas `tambo_*` y el paso `tambo_bi.py`.
- Algunos JSON traen BOM: los scripts de Node lo quitan con `.replace(/^﻿/, '')`.
- Los JSON de datos son de una sola línea y pesan varios MB: para inspeccionarlos usa `node -e`, no `grep`. Para ver cómo cambiaron a lo largo del día, compara versiones con `git show <commit>:data/...`. El campo `updated` cambia en cada descarga aunque los datos no cambien.

## Páginas

- Raíz: `visitas.html` (tracking de visitas RC, que lee Google Sheets en tiempo real), `mapa.html`, `bonus.html` (bonos Tambo con descarga del Excel FORMATO_1_TAMBO), `zonas.html`, `SUPYCAP.html`, `logistica.html`, `admin_claves.html` (incluye el resumen gerencial de ventas), `progreso.html`, `incidencias.html`, `activacion.html`.
- `BONOS PARTNERS/bonus_<partner>.html`: una página por partner, todas con el mismo patrón (`const PARTNER = '...'` + `Promise.all` de puntos y los 3 JSON de ventas + `renderStore`). Un cambio en una casi siempre aplica a las 7. `bonus_cencosud.html` además carga `metas_cencosud.json`.
- **`bonus_at.html` (Apuesta Total)** tiene además el **Top Turbito / Top LakiDey**: el ranking de ventas del mes de ese juego entre todas las tiendas AT activas (`topDe(juego)` sobre `allLoteria`). Todas las tarjetas se llenan con `fillTopCard`.
  - **Desktop (≥1100px)**: en el buscador y en el dashboard, Turbito va fijo a la izquierda y LakiDey a la derecha (`.top-side`). En el buscador solo se muestra el top 10; en el dashboard además "Eres top N" y la fila de la tienda.
  - **Móvil**: una sola tarjeta con botón Turbito/LakiDey (`.top-mobile`). En el buscador va antes del video; en el dashboard, entre el ranking semanal y el video.
  - **Premios**: S/ 60, S/ 40 y S/ 20 para los 3 primeros (`TOP_PREMIOS`). Se muestran como insignias y en los mensajes.
  - **Colores**: Turbito en marrón `#92400E` (también en la barra del desglose por juego) y LakiDey en celeste `#3B9EE8`. Los logos están en `TOP_LOGO`.
  - **Video de la llama**: va al final de las dos pantallas. Ya no hay stickers laterales.
  - **Fondo Lotobola**: franja magenta y bolitas (`.lb-bg`) en el buscador y en el dashboard. La llama `suerte-3.png` solo aparece en el buscador.
  - **Promociones activas** (`<section class="promos">` en el buscador): texto fijo en el HTML. Si una promo lleva `data-hasta="AAAA-MM-DD"`, se oculta sola al día siguiente (hora de Lima). La Campaña Fixture Liga 1 dura hasta el 23-nov; los bundles no tienen fecha de fin. Las imágenes están en `sources/logos-games/` (`lotobola.webp`, `kv_fixture_liga1.jpg`, `bundle_*.webp`).
  - **Pestañas**: Mi tienda · Supervisor · Ranking de tiendas · Ranking de supervisores (`rankingSupervisores(per)`: solo mes en curso, ventas del mes vs `meta_diaria × 30`; el selector semanal se quitó porque la semana Mié→Mar mezclaba días del mes anterior). La pestaña **Jefe Comercial está oculta** (`tab-jz` con `display:none`), pero su panel y su descarga (`downloadJzReport`) se conservan.
  - `sources/` está en `.gitignore`: las imágenes nuevas de `sources/logos-games/` se agregan con `git add -f`, o no se publican.
- **Stock Rapiraspas**: está oculto en AT, Aciertala, Doradobet, Livesport, Retabet y Tinbet porque no se usa. El código se conserva detrás de `const STOCK_ACTIVO = false`; con `true` vuelve a aparecer.
- `bonus_at.html` tiene finales de línea mixtos (LF/CRLF). Los scripts que lo editen deben aceptar `\r?\n`.
- La lógica compartida grande vive en `js/` (`mapa.js`, `visitas.js`, `planificador.js`, `zonas.js`, `supycap.js`). Mucho JS va inline en los HTML.
- `herramientas/`: utilidades internas (`editor_pdv.html`, `mapa_incidencias.html`).
- `sources/` (Excel fuente, ignorado por git), `distribucion/` (paquetes zip y docs para distribuir) y los `*_prebak.json` no forman parte del sitio.

## Convenciones

- Haz commits pequeños, uno por cada cambio funcional, con mensaje en español y prefijo tipo `feat(...)`, `fix:`, `ci:` o `chore:`.
- Los commits automáticos de datos llevan `[skip ci]`.
- No hagas commit de `pbi_session.b64.txt` (es una sesión de Power BI) ni de `sources/`.
