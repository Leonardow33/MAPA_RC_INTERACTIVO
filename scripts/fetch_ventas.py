"""
fetch_ventas.py
Usa sesión guardada de Power BI (Playwright) para ejecutar DAX
y guardar data/ventas_mes.json.

Requiere variable de entorno:
  PBI_SESSION  - sesión base64 generada por save_pbi_session.py
"""

import os
import json
import base64
import sys
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright

# ── CONFIG ──────────────────────────────────────────────────────────────────
GROUP_ID   = "84e9d9cc-3d1f-4f47-9552-2c117a974b46"
DATASET_ID = "04929bbb-a61d-4ca0-a758-535cd102e1f8"

DAX = """EVALUATE
SUMMARIZECOLUMNS(
    RMS_sp_reporte_transacciones_retailer[org_code],
    RMS_sp_reporte_transacciones_retailer[nombre_agente],
    RMS_sp_reporte_transacciones_retailer[parent_org_name],
    'Game Maste-Retaler'[game_name],
    Fecha[Date],
    FILTER(
        ALL(Fecha[Date]),
        Fecha[Date] >= DATE(YEAR(TODAY()), MONTH(TODAY()), 1)
        && Fecha[Date] <= TODAY()
    ),
    FILTER(
        ALL(RMS_sp_reporte_transacciones_retailer[parent_org_name]),
        RMS_sp_reporte_transacciones_retailer[parent_org_name] IN {"TAMBO", "APUESTA TOTAL", "TINBET", "ACIERTALA", "DORADOBET", "LIVESPORT", "RETABET", "CENCOSUD"}
    ),
    "Total_Ventas", [Total Sales Retailer]
)"""

API_URL = (f"https://api.powerbi.com/v1.0/myorg/groups/{GROUP_ID}"
           f"/datasets/{DATASET_ID}/executeQueries")

# ── PARSEAR RESULTADO ────────────────────────────────────────────────────────
def parse_rows(result):
    tables = result.get("results", [{}])[0].get("tables", [{}])
    rows   = tables[0].get("rows", []) if tables else []
    ventas = []
    for row in rows:
        ventas.append({
            "org_code":   row.get("RMS_sp_reporte_transacciones_retailer[org_code]", ""),
            "nombre":     row.get("RMS_sp_reporte_transacciones_retailer[nombre_agente]", ""),
            "partner":    row.get("RMS_sp_reporte_transacciones_retailer[parent_org_name]", ""),
            "tipo_juego": row.get("Game Maste-Retaler[game_name]", ""),
            "fecha":      str(row.get("Fecha[Date]", ""))[:10],
            "total":      row.get("[Total_Ventas]", 0) or 0,
        })
    return ventas

# ── MAIN ────────────────────────────────────────────────────────────────────
def main():
    session_b64 = os.environ.get("PBI_SESSION", "")
    if not session_b64:
        print("ERROR: falta variable PBI_SESSION")
        sys.exit(1)

    print("Cargando sesión guardada...")
    state = json.loads(base64.b64decode(session_b64).decode())

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(storage_state=state)
        page    = context.new_page()

        print("Ejecutando DAX via Power BI API...")
        result = page.evaluate(f"""async () => {{
            const r = await fetch("{API_URL}", {{
                method: "POST",
                headers: {{"Content-Type": "application/json"}},
                body: JSON.stringify({{
                    queries: [{{query: {json.dumps(DAX)}}}],
                    serializerSettings: {{includeNulls: true}}
                }})
            }});
            if (!r.ok) {{
                const txt = await r.text();
                throw new Error("HTTP " + r.status + ": " + txt);
            }}
            return await r.json();
        }}""")

        browser.close()

    ventas = parse_rows(result)
    print(f"OK — {len(ventas)} filas")

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")
    output = {
        "updated": now,
        "total":   len(ventas),
        "ventas":  ventas,
    }

    out_path = os.path.join(os.path.dirname(__file__), "..", "data", "ventas_mes.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False)

    print(f"ventas_mes.json guardado — {len(ventas)} registros")

if __name__ == "__main__":
    main()
