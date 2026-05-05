import pandas as pd
import json

# 📂 Leer Excel
df = pd.read_excel(r"C:\Users\elirg\Music\ESTRUCTURA TRANSVERSAL\MAPAS_RC_AUTO\BASE_PARA MAPAS.xlsx")

data = []

for _, row in df.iterrows():

    # ✅ Solo puntos Activos con coordenadas
    if pd.notnull(row["LATITUD"]) and pd.notnull(row["LONGITUD"]) and str(row["ESTATUS"]).strip().upper() == "ACTIVO":

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

        # 🧩 construir registro
        data.append({
            "nombre": row["NOMBRE DE TIENDA"],
            "lat": float(row["LATITUD"]),
            "lng": float(row["LONGITUD"]),
            "estado": row["ESTATUS"],
            "zona": row["ZONAL"],
            "cluster": row["CLUSTER"],
            "ID": str(row["ORG_CODE"]),
            "rc": row["RC_NOMBRE"],
            "username": str(row["USERNAME"]).strip() if pd.notnull(row.get("USERNAME")) else "",
            "supervisor": str(row["SUPERVISOR"]).strip() if pd.notnull(row["SUPERVISOR"]) else "",
            "capacitador": str(row["CAPACITADOR"]).strip() if pd.notnull(row.get("CAPACITADOR")) else "",
            "responsable": row["P_RESPONSABLE"],
            "frecuencia": row["FRECUENCIA-NORMAL"],
            "dias": dias
        })

# 💾 Guardar JSON
with open("puntos.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=4)

print("Mapa actualizado ✔")