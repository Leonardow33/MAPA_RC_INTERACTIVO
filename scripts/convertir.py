import pandas as pd
import json
import os
from datetime import datetime

# 📂 Leer Excel (hoja BASE_RSUM del documento fuente)
_base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
df = pd.read_excel(os.path.join(_base, "sources", "BASE_PARA MAPAS.xlsx"), sheet_name="BASE_RSUM")
df.columns = df.columns.str.strip()

data = []

for _, row in df.iterrows():

    # ✅ Puntos con coordenadas, excluyendo solo CERRADO
    if (pd.notnull(row["LATITUD"]) and pd.notnull(row["LONGITUD"])
            and float(row["LATITUD"]) != 0 and float(row["LONGITUD"]) != 0
            and str(row["ESTATUS"]).strip().upper() != "CERRADO"):

        # 🔥 PROCESAR DÍAS DESDE "FRECUENCIA-NORMAL"
        dias = []

        if pd.notnull(row["FRECUENCIA-NORMAL"]):
            texto = str(row["FRECUENCIA-NORMAL"]).upper()

            partes = texto.split("-")

            for d in partes:
                dia = d.strip()

                # 🚫 limpiar valores basura
                if dia not in ["", "NAN", "SIN ASIGNAR"]:
                    dias.append(dia)

        # 🔁 evitar duplicados
        dias = list(set(dias))

        # ⚠️ si no hay días válidos
        if len(dias) == 0:
            dias = ["SIN RUTA"]

        def s(val):
            return str(val).strip() if pd.notnull(val) else ""

        # 🧩 construir registro
        data.append({
            "nombre":      s(row["NOMBRE DE TIENDA"]),
            "lat":         float(row["LATITUD"]),
            "lng":         float(row["LONGITUD"]),
            "estado":      s(row["ESTATUS"]),
            "zona":        s(row["ZONAL"]),
            "cluster":     s(row["CLUSTER INTERNO"]),
            "cluster_bono": s(row["CLUSTER"]),
            "ID":          str(row["ORG_CODE"]),
            "rc":          s(row["RC_NOMBRE"]),
            "username":    s(row.get("USERNAME")),
            "supervisor":  s(row["SUPERVISOR"]),
            "capacitador": s(row.get("CAPACITADOR")),
            "responsable": s(row["P_RESPONSABLE"]),
            "frecuencia":  s(row["FRECUENCIA-NORMAL"]),
            "dias":        dias,
            "meta_diaria": (lambda v: float(v) if v == v and v is not None and str(v).strip() not in ('', 'nan') else None)(pd.to_numeric(row.get("META DIARIA"), errors='coerce')),
            "direccion":   s(row.get("TdaDireccion")),
            "distrito":    s(row.get("DISTRITOS")),
            "gz":          s(row.get("GZ")),
            "jz":          s(row.get("JZ")),
            "zonal_tipo":  s(row.get("ZONAL_TIPO")).upper(),
            "tipo":        s(row.get("TIPO")).upper()
        })

ts = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")

with open("data/puntos.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=4)

with open("data/version.json", "w", encoding="utf-8") as f:
    json.dump({"v": ts, "n": len(data)}, f)

# partners.json — todos los códigos incluyendo cerrados, solo ID → responsable
partners = {}
for _, row in df.iterrows():
    cod = str(row["ORG_CODE"]).strip()
    resp = str(row["P_RESPONSABLE"]).strip() if pd.notnull(row["P_RESPONSABLE"]) else ""
    if cod and resp:
        partners[cod] = resp

with open("data/partners.json", "w", encoding="utf-8") as f:
    json.dump(partners, f, ensure_ascii=False)

# keys_bonos.json — metas de bonos por cluster Tambo (A/B/C/D)
keys_df = pd.read_excel(os.path.join(_base, "sources", "KEYS_BONOS_TAMBO.xlsx"))
keys_bonos = []
for _, krow in keys_df.iterrows():
    keys_bonos.append({
        "cluster": str(krow["CLUSTER"]).strip(),
        "meta":    int(krow["META"]),
        "pp":      int(krow["PP"]),
        "lakidey": int(krow["LAKIDEY"])
    })

with open("data/keys_bonos.json", "w", encoding="utf-8") as f:
    json.dump(keys_bonos, f, ensure_ascii=False)

print(f"Mapa actualizado OK — {len(data)} puntos — v{ts}")
print(f"Partners OK — {len(partners)} códigos (incluye cerrados)")
print(f"Keys bonos OK — {len(keys_bonos)} clusters")