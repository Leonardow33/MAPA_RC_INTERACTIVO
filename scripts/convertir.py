import pandas as pd
import json

# 📂 Leer Excel
df = pd.read_excel(r"C:\Users\elirg\Music\ESTRUCTURA TRANSVERSAL\MAPAS_RC_AUTO\sources\BASE_PARA MAPAS.xlsx")

data = []

for _, row in df.iterrows():

    # ✅ Puntos con coordenadas, excluyendo solo CERRADO
    if pd.notnull(row["LATITUD"]) and pd.notnull(row["LONGITUD"]) and str(row["ESTATUS"]).strip().upper() != "CERRADO":

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
            "cluster":     s(row["CLUSTER"]),
            "ID":          str(row["ORG_CODE"]),
            "rc":          s(row["RC_NOMBRE"]),
            "username":    s(row.get("USERNAME")),
            "supervisor":  s(row["SUPERVISOR"]),
            "capacitador": s(row.get("CAPACITADOR")),
            "responsable": s(row["P_RESPONSABLE"]),
            "frecuencia":  s(row["FRECUENCIA-NORMAL"]),
            "dias":        dias,
            "distrito":    s(row.get("DISTRITOS")),
            "gz":          s(row.get("GZ")),
            "jz":          s(row.get("JZ")),
            "zonal_tipo":  s(row.get("ZONAL_TIPO")).upper(),
            "tipo":        s(row.get("TIPO")).upper()
        })

# 💾 Guardar JSON
with open("data/puntos.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=4)

print("Mapa actualizado OK")