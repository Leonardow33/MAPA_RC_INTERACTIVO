"""Ajustes de totales Tambo con el BI de Tambo.

Nuestro BI (todos los partners) y el BI de Tambo calculan las promociones
por separado, así que el TOTAL por tienda y día puede diferir en ±S/3.
Para Tambo manda su BI: estos ajustes reemplazan el registro TOTAL de cada
tienda Tambo en los días que trae el export. No tocan el desglose por juego.

Uso:
  python scripts/ajustes_tambo.py importar "sources/ventas por dia_04_11.xlsx"
      Agrega/actualiza data/ajustes_tambo.json con los días del Excel
      (export del BI de Tambo: fila 1 = fechas, col A = código de tienda).
  python scripts/ajustes_tambo.py aplicar
      Aplica data/ajustes_tambo.json a data/ventas_mes.json y
      data/ventas_mes_prev.json. Idempotente; lo ejecutan los workflows
      después de cada descarga.
"""
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AJUSTES = ROOT / 'data' / 'ajustes_tambo.json'
VENTAS = [ROOT / 'data' / 'ventas_mes.json', ROOT / 'data' / 'ventas_mes_prev.json']
PARTNER = 'TAMBO'


def leer_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def importar(xlsx):
    import openpyxl
    wb = openpyxl.load_workbook(xlsx, data_only=True, read_only=True)
    rows = list(wb.worksheets[0].iter_rows(values_only=True))
    cols = {i: d.strftime('%Y-%m-%d') for i, d in enumerate(rows[0]) if isinstance(d, datetime)}
    aj = leer_json(AJUSTES) if AJUSTES.exists() else {'totales': {}}
    n = 0
    for r in rows[2:]:
        cod = str(r[0]).strip() if r[0] is not None else ''
        if not cod.isdigit():
            continue  # fila "Total" u otras
        for i, fecha in cols.items():
            aj['totales'].setdefault(fecha, {})[cod] = float(r[i] or 0)
            n += 1
    aj['fuente'] = Path(xlsx).name
    aj['actualizado'] = datetime.now().strftime('%Y-%m-%d %H:%M')
    aj['totales'] = dict(sorted(aj['totales'].items()))
    AJUSTES.write_text(json.dumps(aj, ensure_ascii=False), encoding='utf-8')
    print(f'{n} valores importados de {Path(xlsx).name}: {", ".join(cols.values())}')


def aplicar():
    if not AJUSTES.exists():
        print('Sin ajustes_tambo.json: nada que aplicar')
        return
    totales = leer_json(AJUSTES).get('totales', {})
    nombres = {}
    try:
        nombres = {str(p['ID']): p.get('nombre', '') for p in leer_json(ROOT / 'data' / 'puntos.json')}
    except Exception:
        pass
    for path in VENTAS:
        if not path.exists():
            continue
        data = leer_json(path)
        key = 'body' if 'body' in data else 'ventas'
        arr = data.get(key) or []
        fechas = {v.get('fecha') for v in arr}
        idx = {(str(v['org_code']), v['fecha']): v for v in arr
               if v.get('tipo_juego') == 'TOTAL' and (v.get('partner') or '').upper() == PARTNER}
        cambios = agregados = 0
        for fecha, tiendas in totales.items():
            if fecha not in fechas:
                continue  # ese día no está en este archivo
            for cod, total in tiendas.items():
                v = idx.get((cod, fecha))
                if v is not None:
                    if v['total'] != total:
                        v['total'] = total
                        cambios += 1
                elif total:
                    arr.append({'org_code': cod, 'nombre': nombres.get(cod, ''), 'total': total,
                                'tipo_juego': 'TOTAL', 'fecha': fecha, 'partner': PARTNER})
                    agregados += 1
        if cambios or agregados:
            path.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
        print(f'{path.name}: {cambios} totales Tambo ajustados, {agregados} agregados')


if __name__ == '__main__':
    if len(sys.argv) >= 3 and sys.argv[1] == 'importar':
        importar(sys.argv[2])
    elif len(sys.argv) >= 2 and sys.argv[1] == 'aplicar':
        aplicar()
    else:
        print(__doc__)
        sys.exit(1)
