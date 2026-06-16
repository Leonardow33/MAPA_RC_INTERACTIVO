"""
save_pbi_session.py  —  correr UNA VEZ localmente
Abre Power BI en el browser, completas el login + MFA,
y guarda la sesión como base64 para pegar en GitHub Secrets.

Uso:
    pip install playwright
    playwright install chromium
    python scripts/save_pbi_session.py
"""

import json
import base64
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False)
    context = browser.new_context()
    page    = context.new_page()

    print("Abriendo Power BI...")
    page.goto("https://app.powerbi.com")

    print("\nCompleta el login y MFA en el browser.")
    print("Cuando estés en el dashboard de Power BI, vuelve aquí y presiona Enter.")
    input(">>> Presiona Enter cuando hayas iniciado sesión: ")

    state   = context.storage_state()
    encoded = base64.b64encode(json.dumps(state).encode()).decode()

    with open("pbi_session.b64.txt", "w") as f:
        f.write(encoded)

    print("\n=== LISTO ===")
    print("Copia el contenido de pbi_session.b64.txt como secret PBI_SESSION en GitHub.")
    print(f"Tamaño: {len(encoded)} caracteres")

    browser.close()
