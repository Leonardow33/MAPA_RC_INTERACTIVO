# Sistema de Tracking de Visitas RC

**Geodor** — desarrollado por Doriant Cárdenas Fernández como servicio para Elot Group Peru.

Plataforma de seguimiento en tiempo real de visitas de RC (Representantes Comerciales) con mapas interactivos, cobertura por partner y datos de Sin Venta sincronizados automáticamente.

## Funcionalidades

- Mapa de visitas diarias y semanales por RC
- Panel de cobertura por partner con drill-down a tiendas sin visita
- Capa de tiendas Sin Venta actualizada automáticamente cada 15 minutos (12:00–20:00)
- Filtros por semana, día, RC, supervisor y zona (Lima / Provincia)
- Integración con Google Sheets para datos de visita en tiempo real
- Diseño dashboard oscuro optimizado para campo

## Arquitectura

```
Excel (BASE_PARA MAPAS.xlsx)
    └── convertir.py → puntos.json (embedido en visitas.html)

SharePoint (Sin Venta BI)
    └── GitHub Actions + Playwright → sinventa.txt
        └── cron-job.org trigger (cada 15 min, 12–20h)

Google Sheets
    └── visitas.html fetch en tiempo real (getVisitas)
```

## Archivos principales

| Archivo | Descripción |
|---|---|
| `visitas.html` | Mapa principal de tracking de visitas RC |
| `mapa.html` | Mapa de rutas y cobertura por zona |
| `convertir.py` | Generador de puntos.json desde Excel |
| `sinventa.txt` | Datos Sin Venta actualizados automáticamente |
| `.github/workflows/update-sinventa.yml` | GitHub Action de sincronización |

---

## Aviso Legal

> **© 2026 Geodor — Doriant Cárdenas Fernández. Todos los derechos reservados.**
>
> El código, arquitectura y sistema de tracking son propiedad intelectual de Geodor,
> desarrollado como servicio para Elot Group Peru.
> Protegido bajo el D.L. N° 822 (Ley de Derecho de Autor del Perú) y el Convenio de Berna.
>
> No se permite redistribución, copia ni uso comercial sin autorización escrita de Geodor.
> Ver [LICENSE](LICENSE) · [COPYRIGHT](COPYRIGHT) · [TERMS](TERMS)
>
> Contacto: doriantleodor@gmail.com
