"""
fetch_ventas.py
Llama al Power BI REST API, ejecuta DAX de ventas mensuales por tipo de juego
(PozoPower + LakiDey, solo TAMBO), y guarda data/ventas_mes.json.

Requiere variables de entorno:
  PBI_USERNAME  - cuenta con licencia Pro (powerbi@elotgroup.com)
  PBI_PASSWORD  - contraseña de esa cuenta
"""

import os
import json
import requests
from datetime import datetime, timezone

# ── CONFIG ──────────────────────────────────────────────────────────────────
USERNAME      = os.environ["PBI_USERNAME"]
PASSWORD      = os.environ["PBI_PASSWORD"]
PBI_CLIENT_ID = "ea0616ba-638b-4df5-95b9-636659ae5121"  # cliente público Power BI

GROUP_ID   = "84e9d9cc-3d1f-4f47-9552-2c117a974b46"
DATASET_ID = "04929bbb-a61d-4ca0-a758-535cd102e1f8"

DAX = """
EVALUATE
SUMMARIZECOLUMNS(
    RMS_sp_reporte_transacciones_retailer[org_code],
    RMS_sp_reporte_transacciones_retailer[nombre_agente],
    RMS_sp_reporte_transacciones_retailer[parent_org_name],
    'Game Maste-Retaler'[Type Game 2],
    Fecha[Date],
    FILTER(ALL('Game Maste-Retaler'[Type Game 2]),
        'Game Maste-Retaler'[Type Game 2] IN {"PozoPower", "LakiDey"}),
    FILTER(ALL(Fecha[Date]),
        Fecha[Date] >= DATE(YEAR(TODAY()), MONTH(TODAY()), 1)
        && Fecha[Date] <= TODAY()),
    FILTER(ALL(RMS_sp_reporte_transacciones_retailer[parent_org_name]),
        RMS_sp_reporte_transacciones_retailer[parent_org_name] = "TAMBO"),
    "Total_Ventas", [Total Sales Retailer]
)
"""

# ── TENANT AUTO-DETECT ───────────────────────────────────────────────────────
def get_tenant_id():
    domain = USERNAME.split("@")[-1]
    url = f"https://login.microsoftonline.com/{domain}/.well-known/openid-configuration"
    r = requests.get(url, timeout=15)
    r.raise_for_status()
    issuer = r.json()["issuer"]  # "https://sts.windows.net/{tenant_id}/"
    return issuer.rstrip("/").split("/")[-1]

# ── AUTH ─────────────────────────────────────────────────────────────────────
def get_token(tenant_id):
    url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/token"
    r = requests.post(url, data={
        "grant_type": "password",
        "client_id":  PBI_CLIENT_ID,
        "username":   USERNAME,
        "password":   PASSWORD,
        "resource":   "https://analysis.windows.net/powerbi/api",
    }, timeout=30)
    r.raise_for_status()
    return r.json()["access_token"]

# ── DAX QUERY ────────────────────────────────────────────────────────────────
def run_dax(token):
    url = (f"https://api.powerbi.com/v1.0/myorg/groups/{GROUP_ID}"
           f"/datasets/{DATASET_ID}/executeQueries")
    r = requests.post(url,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type":  "application/json",
        },
        json={
            "queries": [{"query": DAX}],
            "serializerSettings": {"includeNulls": True},
        },
        timeout=60,
    )
    r.raise_for_status()
    return r.json()

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
            "tipo_juego": row.get("Game Maste-Retaler[Type Game 2]", ""),
            "fecha":      str(row.get("Fecha[Date]", ""))[:10],
            "total":      row.get("[Total_Ventas]", 0) or 0,
        })
    return ventas

# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    print("Detectando tenant...")
    tenant_id = get_tenant_id()
    print(f"  Tenant: {tenant_id}")

    print("Autenticando en Power BI...")
    token = get_token(tenant_id)
    print("OK — ejecutando DAX...")

    result = run_dax(token)
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
