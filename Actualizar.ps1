Write-Host "Actualizando mapa..."

Set-Location "C:\Users\elirg\Music\ESTRUCTURA TRANSVERSAL\MAPAS_RC_AUTO"

Write-Host "Generando JSON..."
python convertir.py

Write-Host "Subiendo a GitHub..."
git add .
git commit -m "update automatico"
git push

Write-Host "Mapa actualizado"