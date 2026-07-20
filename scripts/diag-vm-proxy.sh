#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Diagnóstico read-only de la VM proxy de Gamma (35.224.5.114)
# Objetivo: saber si los requests a obtenereventointernacion se MULTIPLICAN acá.
# No modifica nada. Pegalo entero en la VM.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
EP="obtenereventointernacion"
echo "════════════════════════════════════════════════════════"
echo " DIAGNÓSTICO VM PROXY — $(date)"
echo "════════════════════════════════════════════════════════"

# ── 1. ¿Qué servidor web corre? ─────────────────────────────────────────────
echo
echo "── 1. QUÉ CORRE ADELANTE ──"
sudo ss -lptn 'sport = :80' 2>/dev/null | tail -n +2 || netstat -lptn 2>/dev/null | grep ':80'
echo
ps aux | grep -E "[n]ginx|[a]pache2|[h]ttpd|[p]hp-fpm" | awk '{print $11, $12, $13}' | sort -u | head

# ── 2. Config de nginx: ¿REINTENTA? ─────────────────────────────────────────
echo
echo "── 2. ¿REINTENTA? (la pregunta clave) ──"
if command -v nginx >/dev/null 2>&1; then
  sudo nginx -T > /tmp/nginx-full.conf 2>/dev/null
  echo "Config completa volcada en /tmp/nginx-full.conf ($(wc -l < /tmp/nginx-full.conf) líneas)"
  echo
  echo "  ▸ next_upstream (si NO aparece nada, el DEFAULT 'error timeout' está ACTIVO):"
  grep -n "next_upstream" /tmp/nginx-full.conf | sed 's/^/    /' || echo "    (nada) ⚠️  default activo → reintenta"
  echo
  echo "  ▸ timeouts:"
  grep -nE "(proxy|fastcgi)_(read|send|connect)_timeout" /tmp/nginx-full.conf | sed 's/^/    /' || echo "    (nada) → defaults (60s)"
  echo
  echo "  ▸ upstreams definidos (si hay >1 server, next_upstream MULTIPLICA):"
  grep -A6 "^\s*upstream " /tmp/nginx-full.conf | sed 's/^/    /' || echo "    (ninguno)"
  echo
  echo "  ▸ a dónde manda:"
  grep -nE "proxy_pass|fastcgi_pass" /tmp/nginx-full.conf | sed 's/^/    /'
  echo
  echo "  ▸ ¿ignora el corte del cliente?"
  grep -nE "ignore_client_abort" /tmp/nginx-full.conf | sed 's/^/    /' || echo "    (nada) → default OFF (corta el upstream cuando el cliente se va)"
else
  echo "  nginx no está instalado — ¿Apache?"
  sudo apache2ctl -S 2>/dev/null | head
  grep -rn "retry=" /etc/apache2/ 2>/dev/null | head
fi

# ── 3. EL CONTEO DECISIVO ───────────────────────────────────────────────────
echo
echo "── 3. CUÁNTOS REQUESTS RECIBIÓ LA VM ──"
LOG=""
for c in /var/log/nginx/access.log /var/log/nginx/*access*.log /var/log/apache2/access.log; do
  [ -f "$c" ] && LOG="$c" && break
done
if [ -z "$LOG" ]; then
  echo "  ⚠️  No encontré el access log. Buscalo con:"
  echo "      sudo find /var/log -name '*access*' -mmin -180"
else
  echo "  Log: $LOG"
  echo
  TOTAL=$(sudo grep -c "$EP" "$LOG" 2>/dev/null || echo 0)
  echo "  TOTAL de requests a $EP en este archivo: $TOTAL"
  echo
  echo "  ▸ Por hora (últimas que haya):"
  sudo grep "$EP" "$LOG" | awk -F'[][]' '{print $2}' | cut -d: -f1-2 | sort | uniq -c | tail -8 | sed 's/^/    /'
  echo
  echo "  ▸ Por IP de origen (Vercel = MediFlow; otra IP = OTRO consumidor):"
  sudo grep "$EP" "$LOG" | awk '{print $1}' | sort | uniq -c | sort -rn | head | sed 's/^/    /'
  echo
  echo "  ▸ Por código de respuesta (499 = el cliente cortó = nuestros aborts):"
  sudo grep "$EP" "$LOG" | awk '{print $9}' | sort | uniq -c | sort -rn | sed 's/^/    /'
  echo
  echo "  ▸ ¿Hay logs rotados? (si el incidente fue hace rato, mirá también estos):"
  ls -la /var/log/nginx/*.gz /var/log/nginx/*.1 2>/dev/null | head -5 | sed 's/^/    /' || echo "    (no hay)"
fi

# ── 4. ¿El PHP reintenta por su cuenta? ─────────────────────────────────────
echo
echo "── 4. ¿EL PROXY PHP REINTENTA? ──"
PHP=$(sudo find / -name "index.php" -path "*proxy*" 2>/dev/null | head -1)
if [ -n "$PHP" ]; then
  echo "  Archivo: $PHP"
  echo
  echo "  ▸ Loops / reintentos / timeouts de cURL:"
  grep -nE "retry|for *\(|while *\(|CURLOPT_TIMEOUT|CURLOPT_CONNECTTIMEOUT|curl_exec|max_execution" "$PHP" | head -20 | sed 's/^/    /'
else
  echo "  No encontré proxy/index.php automáticamente. Buscalo con:"
  echo "      sudo find / -name 'index.php' -path '*proxy*' 2>/dev/null"
fi

# ── 5. Salud de la VM ───────────────────────────────────────────────────────
echo
echo "── 5. SALUD (¿está saturada?) ──"
uptime
echo
free -h | head -2
echo
echo "  ▸ Procesos PHP vivos (si hay muchos, están encolados):"
pgrep -c php 2>/dev/null || echo "  0"
echo
echo "  ▸ Conexiones establecidas hacia gsw_back:"
sudo ss -tn state established 2>/dev/null | wc -l

echo
echo "════════════════════════════════════════════════════════"
echo " CÓMO LEERLO"
echo "════════════════════════════════════════════════════════"
cat <<'EOF'
  El número del punto 3 (TOTAL) contra los 46.400 que reporta Gamma:

    ~1.650  → la multiplicación pasa DENTRO de la VM (reintentos del proxy).
              Mirá el punto 2: next_upstream + más de un server en upstream.
              Es tuyo y lo arreglás vos.

    ~46.400 → la VM recibió todo eso desde afuera. Mirá el desglose por IP:
              si son IPs de Vercel, somos nosotros (y me equivoqué).
              Si hay otras IPs, hay otro consumidor de la misma VM.

  Los 499 miden NUESTRO impacto: cada uno es un abort nuestro a los 30s.
  Muchos 499 = estamos cortando mucho = la VM está lenta.
EOF
