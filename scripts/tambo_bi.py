"""Datos Tambo desde el BI de Tambo (días cerrados).

Nuestro BI (todos los partners) y el BI de Tambo calculan las promociones de
PozoPower por separado, y al cerrar el mes el último día queda congelado. Para
Tambo manda su BI. Tres flujos de Power Automate exportan desde ese modelo
(con fechas desde el jueves de la semana Tambo cuando cruza de mes):

  data/tambo_totales.json    TOTAL por tienda y día
  data/tambo_pozopower.json  monto PozoPower por tienda y día (con promociones)
  data/tambo_tickets.json    tickets PozoPower por tienda y día

`python scripts/tambo_bi.py aplicar` los escribe sobre nuestros archivos, solo
para días cerrados (fecha < hoy en Lima); el día en curso sigue con nuestro BI:
  - registro TOTAL de cada tienda Tambo en ventas_mes.json / ventas_mes_prev.json
  - registro PozoPower de cada tienda Tambo en ventas_loteria.json / _prev,
    con su monto y el campo `tickets`
Cada fecha va al archivo de su mes. Es idempotente; actualizar_ventas.yml y
findemes_noche.yml lo corren después de cada descarga. Si falta un archivo de
Tambo, esa parte se omite.
"""
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
PARTNER = 'TAMBO'


def leer(path):
    d = json.loads(path.read_text(encoding='utf-8-sig'))
    return {'ventas': d} if isinstance(d, list) else d


def filas(d):
    return d.get('body') if 'body' in d else (d.get('ventas') or [])


def hoy_lima():
    return (datetime.now(timezone.utc) - timedelta(hours=5)).date().isoformat()


def cargar_tambo(nombre, campo):
    """{(org_code, fecha): valor} de días cerrados; None si el archivo no existe o falla."""
    p = DATA / nombre
    if not p.exists():
        print(f'{nombre}: no existe, se omite')
        return None
    try:
        hoy = hoy_lima()
        out = {}
        for v in filas(leer(p)):
            f = str(v.get('fecha', ''))[:10]
            if not f or f >= hoy:
                continue
            k = (str(v.get('org_code')), f)
            out[k] = out.get(k, 0) + float(v.get(campo) or 0)
        return out
    except Exception as e:
        print(f'{nombre}: error al leer ({e}), se omite')
        return None


def aplicar_en(base, juego, montos, tickets, nombres):
    """Escribe montos (y tickets) Tambo de `juego` en base.json y base_prev.json."""
    for path in (DATA / f'{base}.json', DATA / f'{base}_prev.json'):
        if not path.exists():
            continue
        data = leer(path)
        arr = filas(data)
        meses = {str(v.get('fecha', ''))[:7] for v in arr if v.get('fecha')}
        idx = {}
        for v in arr:
            if v.get('tipo_juego') == juego and (v.get('partner') or '').upper() == PARTNER:
                idx.setdefault((str(v.get('org_code')), v.get('fecha')), []).append(v)
        claves = set(montos or {}) | set(tickets or {})
        cambios = agregados = 0
        for k in claves:
            cod, fecha = k
            if fecha[:7] not in meses:
                continue  # esa fecha es de otro mes: va en el otro archivo
            recs = idx.get(k)
            if not recs:
                recs = [{'org_code': cod, 'nombre': nombres.get(cod, ''), 'total': 0.0,
                         'tipo_juego': juego, 'fecha': fecha, 'partner': PARTNER}]
                arr.append(recs[0])
                agregados += 1
            r = recs[0]
            antes = (r.get('total'), r.get('tickets'))
            if montos is not None and k in montos:
                r['total'] = montos[k]
                for extra in recs[1:]:
                    extra['total'] = 0.0
            if tickets is not None:
                r['tickets'] = tickets.get(k, 0.0)
            if (r.get('total'), r.get('tickets')) != antes:
                cambios += 1
        if cambios or agregados:
            path.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
        print(f'{path.name}: {juego} Tambo {cambios} actualizados, {agregados} agregados')


def aplicar():
    nombres = {}
    try:
        nombres = {str(p['ID']): p.get('nombre', '') for p in json.loads((DATA / 'puntos.json').read_text(encoding='utf-8-sig'))}
    except Exception:
        pass
    totales = cargar_tambo('tambo_totales.json', 'total')
    if totales is not None:
        aplicar_en('ventas_mes', 'TOTAL', totales, None, nombres)
    montos = cargar_tambo('tambo_pozopower.json', 'total')
    tickets = cargar_tambo('tambo_tickets.json', 'tickets')
    if montos is not None or tickets is not None:
        aplicar_en('ventas_loteria', 'PozoPower', montos, tickets, nombres)


if __name__ == '__main__':
    if len(sys.argv) >= 2 and sys.argv[1] == 'aplicar':
        aplicar()
    else:
        print(__doc__)
        sys.exit(1)
