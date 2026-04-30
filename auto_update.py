import time
import os

archivo = "BASE_PARA MAPAS.xlsx"
ultima_mod = os.path.getmtime(archivo)

while True:
    nueva_mod = os.path.getmtime(archivo)
    
    if nueva_mod != ultima_mod:
        print("Cambio detectado...")
        os.system("python auto_update.py")
        ultima_mod = nueva_mod
    
    time.sleep(10)