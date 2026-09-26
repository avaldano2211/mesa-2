#!/bin/bash
# Corre las suites de la app una por una (desde cualquier directorio). Falla si alguna falla.
cd "$(dirname "$0")" || exit 2
MAIN=../app/main.js; fallo=0; total=0
for t in test_cadena_carrera.js test_chart.js test_diario.js test_disciplina.js test_etrade_sesion.js test_ordenes.js test_plan10.js test_posiciones_broker.js test_senales_ocultas.js test_version.js; do
  out=$(node "$t" "$MAIN" 2>&1); code=$?; nf=$(printf '%s\n' "$out" | grep -c '^FALLA'); u=$(printf '%s\n' "$out" | grep -v '^\s*at ' | tail -1)
  n=$(printf '%s' "$u" | grep -o '^[0-9]*'); total=$((total + ${n:-0}))
  printf '%-28s exit=%s FALLA=%s · %s\n' "$t" "$code" "$nf" "$u"
  if [ "$code" -ne 0 ] || [ "$nf" -ne 0 ]; then fallo=1; printf '%s\n' "$out" | grep '^FALLA' | head -5; fi
done
echo "total asserts: $total"; [ "$fallo" -eq 0 ] && echo "SUITES OK" || { echo "SUITES FALLARON"; exit 1; }
