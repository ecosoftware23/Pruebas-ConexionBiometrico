<#
.SYNOPSIS
  Valida que el laboratorio ADMS responde lo que el MB10-VL espera.

.DESCRIPTION
  Simula las cuatro peticiones que hace el dispositivo y comprueba la respuesta
  byte a byte. Usa curl.exe (viene con Windows) en vez de Invoke-WebRequest
  porque necesitamos ver el cable tal cual: si la respuesta viaja troceada
  (Transfer-Encoding: chunked) hay firmwares que no saben leerla, y eso solo se
  detecta mirando las cabeceras crudas.

.EXAMPLE
  .\probar.ps1
  Prueba contra http://127.0.0.1:3000

.EXAMPLE
  .\probar.ps1 -Base https://biometrico.ecosolarcolombia.com
  Prueba contra el dominio desplegado.
#>

param(
  [string]$Base = 'http://127.0.0.1:3000',
  [string]$SN   = 'CNYG213260182'
)

$ErrorActionPreference = 'Stop'
$Base = $Base.TrimEnd('/')

if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) {
  Write-Host 'Falta curl.exe. Viene con Windows 10/11; revisa el PATH.' -ForegroundColor Red
  exit 1
}

$script:ok = 0
$script:fallos = 0

function Prueba {
  param([string]$Titulo, [scriptblock]$Accion, [string]$Espera)

  Write-Host ''
  Write-Host "  $Titulo" -ForegroundColor White
  Write-Host "    espera: $Espera" -ForegroundColor DarkGray
  try {
    $r = & $Accion
    if ($r.ok) {
      Write-Host "    OK     $($r.detalle)" -ForegroundColor Green
      $script:ok++
    } else {
      Write-Host "    FALLA  $($r.detalle)" -ForegroundColor Red
      $script:fallos++
    }
  } catch {
    Write-Host "    ERROR  $($_.Exception.Message)" -ForegroundColor Red
    $script:fallos++
  }
}

# Escribe un cuerpo con los bytes EXACTOS (tabulaciones y saltos de linea reales).
function NuevoCuerpo {
  param([string]$Texto)
  $ruta = Join-Path $env:TEMP ("zk-" + [guid]::NewGuid().ToString('N') + '.txt')
  [System.IO.File]::WriteAllBytes($ruta, [System.Text.Encoding]::UTF8.GetBytes($Texto))
  return $ruta
}

Write-Host ''
Write-Host '=========================================================' -ForegroundColor Cyan
Write-Host " Laboratorio ADMS - validacion de protocolo" -ForegroundColor Cyan
Write-Host " destino: $Base" -ForegroundColor Cyan
Write-Host " serial : $SN" -ForegroundColor Cyan
Write-Host '=========================================================' -ForegroundColor Cyan

# --- 1. Handshake ---------------------------------------------------------
Prueba '1. Handshake  GET /iclock/cdata' {
  $salida = curl.exe -s -i --max-time 20 "$Base/iclock/cdata?SN=$SN&options=all&pushver=2.4.1&pushcommkey=0" 2>&1 | Out-String

  $tieneBloque = $salida -match [regex]::Escape("GET OPTION FROM: $SN")
  $tieneStamp  = $salida -match 'ATTLOGStamp='
  $tieneFlag   = $salida -match 'TransFlag='
  $tieneLen    = $salida -match '(?im)^content-length:\s*\d+'
  $esChunked   = $salida -match '(?im)^transfer-encoding:\s*chunked'

  $notas = @()
  if (-not $tieneBloque) { $notas += 'no devuelve el bloque de opciones con el SN exacto' }
  if (-not $tieneStamp)  { $notas += 'falta ATTLOGStamp' }
  if (-not $tieneFlag)   { $notas += 'falta TransFlag' }
  if (-not $tieneLen)    { $notas += 'SIN Content-Length' }
  if ($esChunked)        { $notas += 'viaja CHUNKED: hay firmwares que no lo leen' }

  if ($notas.Count -eq 0) {
    @{ ok = $true; detalle = 'bloque completo, Content-Length presente, sin chunked' }
  } else {
    @{ ok = $false; detalle = ($notas -join ' | ') }
  }
} 'bloque GET OPTION FROM + Content-Length, sin chunked'

# --- 2. Ficha del equipo --------------------------------------------------
Prueba '2. Ficha       POST /iclock/cdata?table=options' {
  $f = NuevoCuerpo "DeviceName=MB10-VL`tFirmwareVersion=Ver 6.60`tPlatform=ZMM220_TFT`n"
  try {
    $r = (curl.exe -s --max-time 20 -X POST --data-binary "@$f" "$Base/iclock/cdata?SN=$SN&table=options" 2>&1 | Out-String).Trim()
  } finally { Remove-Item $f -ErrorAction SilentlyContinue }

  if ($r -eq 'OK') {
    @{ ok = $true; detalle = 'OK pelado, correcto' }
  } else {
    @{ ok = $false; detalle = "devolvio '$r'; el contador OK: N solo va en ATTLOG" }
  }
} 'OK pelado, sin contador'

# --- 3. Marcaciones -------------------------------------------------------
Prueba '3. Marcaciones POST /iclock/cdata?table=ATTLOG' {
  # A proposito con CRLF: comprueba que el corte de lineas no deja un \r colgado.
  $f = NuevoCuerpo "105`t2026-04-25 07:30:00`t0`t1`t0`t0`r`n210`t2026-04-25 07:35:12`t0`t15`t0`t0`r`n"
  try {
    $r = (curl.exe -s --max-time 20 -X POST --data-binary "@$f" "$Base/iclock/cdata?SN=$SN&table=ATTLOG&Stamp=9999" 2>&1 | Out-String).Trim()
  } finally { Remove-Item $f -ErrorAction SilentlyContinue }

  if ($r -eq 'OK: 2') {
    @{ ok = $true; detalle = 'OK: 2 - conto bien las 2 lineas pese al CRLF' }
  } else {
    @{ ok = $false; detalle = "devolvio '$r' en vez de 'OK: 2'" }
  }
} 'OK: 2'

# --- 4. Polling y comandos ------------------------------------------------
Prueba '4. Polling     GET /iclock/getrequest' {
  $r = (curl.exe -s --max-time 20 "$Base/iclock/getrequest?SN=$SN" 2>&1 | Out-String).Trim()
  if ($r -eq 'OK') { @{ ok = $true; detalle = 'OK, sin comandos pendientes' } }
  else { @{ ok = $false; detalle = "devolvio '$r'" } }
} 'OK'

Prueba '5. Comandos    POST /iclock/devicecmd' {
  $f = NuevoCuerpo "ID=1&Return=0&CMD=DATA`n"
  try {
    $r = (curl.exe -s --max-time 20 -X POST --data-binary "@$f" "$Base/iclock/devicecmd?SN=$SN" 2>&1 | Out-String).Trim()
  } finally { Remove-Item $f -ErrorAction SilentlyContinue }
  if ($r -eq 'OK') { @{ ok = $true; detalle = 'OK' } }
  else { @{ ok = $false; detalle = "devolvio '$r'" } }
} 'OK'

# --- 6. Ruta sin segmento -------------------------------------------------
Prueba '6. Ruta base   GET /iclock' {
  $c = (curl.exe -s -o NUL -w '%{http_code}' --max-time 20 "$Base/iclock" 2>&1 | Out-String).Trim()
  if ($c -eq '200') {
    @{ ok = $true; detalle = '200, sin redireccion' }
  } else {
    @{ ok = $false; detalle = "codigo $c; un 308 aqui rompe firmwares que no siguen redirecciones" }
  }
} '200 (no 308)'

# --- 7. Serial desconocido ------------------------------------------------
Prueba '7. Rechazo     GET /iclock/cdata con SN ajeno' {
  $salida = curl.exe -s --max-time 20 "$Base/iclock/cdata?SN=SERIAL_INVENTADO&options=all" 2>&1 | Out-String
  $tieneBloque = $salida -match 'GET OPTION FROM:'
  if ($tieneBloque) {
    @{ ok = $true; detalle = 'responde el bloque: ZK_ALLOWED_SN esta vacio (laboratorio abierto)' }
  } else {
    @{ ok = $true; detalle = "responde '$($salida.Trim())': lista blanca activa, rechazo protocolar" }
  }
} 'bloque si la lista blanca esta vacia, OK pelado si esta activa'

# --- 8. Panel y almacen ---------------------------------------------------
Prueba '8. Panel       GET /' {
  $c = (curl.exe -s -o NUL -w '%{http_code}' --max-time 20 "$Base/" 2>&1 | Out-String).Trim()
  if ($c -eq '200') { @{ ok = $true; detalle = "200, abrelo en el navegador: $Base/" } }
  else { @{ ok = $false; detalle = "codigo $c" } }
} '200 con el panel en vivo'

Prueba '9. Almacen     GET /api/frames' {
  $j = curl.exe -s --max-time 20 "$Base/api/frames" 2>&1 | Out-String | ConvertFrom-Json
  $marc = $j.resumen.marcaciones
  $modo = $j.modo
  $aviso = if ($modo -eq 'memoria') { ' (volatil: conecta Upstash para capturar en serio)' } else { '' }
  if ($marc -ge 2) {
    @{ ok = $true; detalle = "$($j.resumen.tramas) tramas, $marc marcaciones, almacen: $modo$aviso" }
  } else {
    @{ ok = $false; detalle = "el almacen no registro las marcaciones de la prueba 3 (almacen: $modo)$aviso" }
  }
} 'las tramas de esta prueba quedaron guardadas'

# --- Resumen --------------------------------------------------------------
Write-Host ''
Write-Host '---------------------------------------------------------' -ForegroundColor Cyan
if ($fallos -eq 0) {
  Write-Host " $ok pruebas OK. El endpoint habla ADMS correctamente." -ForegroundColor Green
  Write-Host ''
  Write-Host " Siguiente paso: abre $Base/ en el navegador y configura" -ForegroundColor White
  Write-Host ' el dispositivo. Las marcaciones reales apareceran solas.' -ForegroundColor White
} else {
  Write-Host " $ok OK, $fallos con fallo. Revisa el detalle arriba." -ForegroundColor Red
}
Write-Host '---------------------------------------------------------' -ForegroundColor Cyan
Write-Host ''
