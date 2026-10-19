# 小鲸鱼一键启动：QQ -> SnowLuma -> DSH Desktop -> QQ 桥接
# 运行方式：双击 start-all.bat，或桌面「小鲸鱼一键启动」快捷方式。

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$Root = 'D:\Temp\qq-bridge'
$StateDir = Join-Path $Root 'state'
$LogPath = Join-Path $StateDir 'start-all.log'
$QqExe = 'D:\QQNT\QQ.exe'
$SnowDir = 'D:\Temp\SnowLuma'
$SnowBat = Join-Path $SnowDir 'launcher.bat'
$DshExe = Join-Path $env:LOCALAPPDATA 'Programs\DSH Desktop\DSH Desktop.exe'
$BridgeBat = Join-Path $Root 'start-bridge.bat'
$ConsoleTokenPath = Join-Path $StateDir 'console-token'

New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

function Log([string]$Message) {
  $line = '[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $Message
  Write-Host $line
  try { Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8 } catch {}
}

function Ok([string]$Message) {
  Write-Host "  [OK] $Message" -ForegroundColor Green
  try { Add-Content -LiteralPath $LogPath -Value "  [OK] $Message" -Encoding UTF8 } catch {}
}

function Warn([string]$Message) {
  Write-Host "  [!] $Message" -ForegroundColor Yellow
  try { Add-Content -LiteralPath $LogPath -Value "  [!] $Message" -Encoding UTF8 } catch {}
}

function Fail([string]$Message) {
  Write-Host "  [X] $Message" -ForegroundColor Red
  try { Add-Content -LiteralPath $LogPath -Value "  [X] $Message" -Encoding UTF8 } catch {}
  exit 1
}

function Test-Port([int]$Port) {
  try {
    $c = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop | Select-Object -First 1
    return [bool]$c
  } catch {
    return $false
  }
}

function Wait-Port([int]$Port, [int]$TimeoutSeconds, [string]$Name) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Port $Port) {
      Ok "$Name 已就绪（端口 $Port）"
      return $true
    }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Test-QQ {
  try { return [bool](Get-Process -Name 'QQ' -ErrorAction Stop | Select-Object -First 1) }
  catch { return $false }
}

function Start-Detached([string]$CommandLine) {
  try {
    $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $CommandLine } -ErrorAction Stop
    if ($r.ReturnValue -ne 0) { throw "Win32_Process.Create 返回 $($r.ReturnValue)" }
  } catch {
    Fail "创建进程失败：$CommandLine`n$($_.Exception.Message)"
  }
}

function Start-Url([string]$Url) {
  try { Start-Detached ('cmd.exe /c start "" "' + $Url + '"') } catch {}
}

function Start-QQ {
  if (-not (Test-Path -LiteralPath $QqExe)) { Fail "找不到 QQ：$QqExe" }
  Log '启动桌面 QQ...'
  Start-Detached ('cmd.exe /c start "" "' + $QqExe + '"')
  Start-Sleep -Seconds 8
}

function Start-SnowLuma {
  if (-not (Test-Path -LiteralPath $SnowBat)) { Fail "找不到 SnowLuma 启动器：$SnowBat" }
  Log '启动 SnowLuma...'
  Start-Detached ('cmd.exe /c start "" /D "' + $SnowDir + '" /min "' + $SnowBat + '"')
}

function Start-DSH {
  if (-not (Test-Path -LiteralPath $DshExe)) { Fail "找不到 DSH Desktop：$DshExe" }
  Log '启动 DSH Desktop...'
  Start-Detached ('cmd.exe /c start "" "' + $DshExe + '"')
}

function Start-Bridge {
  if (-not (Test-Path -LiteralPath $BridgeBat)) { Fail "找不到桥接启动器：$BridgeBat" }
  Log '启动 QQ 桥接（最小化窗口）...'
  Start-Detached ('cmd.exe /c start "" /D "' + $Root + '" /min "' + $BridgeBat + '"')
}

function Wait-Injection([int]$TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $opened = $false
  $started = Get-Date
  while ((Get-Date) -lt $deadline) {
    if ((Test-Port 3000) -and (Test-Port 3001)) { return $true }
    if (-not $opened -and ((Get-Date) - $started).TotalSeconds -ge 15) {
      Warn 'OneBot 3000/3001 还没就绪，打开 SnowLuma 页面；如果 QQ 没登录，请先扫码登录并确认 QQ.exe 在线。'
      Start-Url 'http://127.0.0.1:5099'
      $opened = $true
    }
    Start-Sleep -Seconds 3
  }
  return $false
}

function Get-BridgeStatus {
  if (-not (Test-Path -LiteralPath $ConsoleTokenPath)) { return $null }
  $token = (Get-Content -LiteralPath $ConsoleTokenPath -Raw).Trim()
  if (-not $token) { return $null }
  try {
    return Invoke-RestMethod -Uri 'http://127.0.0.1:3100/api/status' -Headers @{ 'x-console-token' = $token } -TimeoutSec 15
  } catch {
    return $null
  }
}

Log '========================================'
Log '小鲸鱼一键启动'
Log '========================================'

# 1. QQ
if (Test-QQ) {
  Ok 'QQ 已在运行'
} else {
  Start-QQ
  if (-not (Test-QQ)) { Fail 'QQ 没有启动成功，请手动打开 D:\QQNT\QQ.exe 后重试。' }
  Ok 'QQ 已启动'
}

# 2. SnowLuma
if (Test-Port 5099) {
  Ok 'SnowLuma 已在运行（5099）'
} else {
  Start-SnowLuma
  if (-not (Wait-Port 5099 90 'SnowLuma')) {
    Fail 'SnowLuma 没有在 90 秒内监听 5099。请检查 D:\Temp\SnowLuma\launcher.bat 是否报错。'
  }
}

# 3. 等 SnowLuma 注入 QQ / OneBot 就绪
if ((Test-Port 3000) -and (Test-Port 3001)) {
  Ok 'OneBot 3000/3001 已就绪，QQ 注入正常'
} else {
  Log '等待 SnowLuma 注入 QQ（OneBot 3000/3001）...'
  if (-not (Wait-Injection 240)) {
    Fail 'OneBot 没有在 4 分钟内就绪。请确认桌面 QQ 已登录，并在 5099 的“进程注入”页确认 QQ.exe 在线；然后重新双击一键启动。'
  }
  Ok 'OneBot 3000/3001 已就绪'
}

# 4. DSH Desktop
if (Test-Port 43120) {
  Ok 'DSH Desktop 已在运行（43120）'
} else {
  Start-DSH
  if (-not (Wait-Port 43120 120 'DSH Desktop')) {
    Fail 'DSH Desktop 没有在 120 秒内监听 43120。请手动打开 DSH Desktop 后再试。'
  }
}

# 5. Bridge
if (Test-Port 3100) {
  Ok 'QQ 桥接已在运行（3100）'
} else {
  Start-Bridge
  if (-not (Wait-Port 3100 90 'QQ 桥接')) {
    Fail 'QQ 桥接没有在 90 秒内监听 3100。请看 D:\Temp\qq-bridge\state\bridge.log。'
  }
}

# 6. 状态
Log '检查桥接状态...'
$status = $null
for ($i = 0; $i -lt 15; $i++) {
  $status = Get-BridgeStatus
  if ($status -and $status.snowluma.connected -and $status.dshReady) { break }
  Start-Sleep -Seconds 2
}
if (-not $status) {
  Fail '桥接 3100 已在监听，但 /api/status 读取失败。请打开控制台 http://127.0.0.1:3100 查看。'
}

Ok ("模式={0}，角色={1}，SnowLuma={2}，DSH={3}" -f $status.mode, $status.role, $status.snowluma.connected, $status.dshReady)
if ($status.mode -ne 'closed-agent') { Warn '当前不是 closed-agent；如果不是你手动改的，请在控制台切回。' }
if ($status.role -ne '小鲸鱼') { Warn '当前角色不是小鲸鱼；如果不是你手动改的，请在控制台重设角色。' }
if (-not $status.snowluma.connected) { Fail 'SnowLuma 显示未连接；请检查 5099 里 QQ.exe 是否在线，然后重试。' }
if (-not $status.dshReady) { Fail 'DSH 未就绪；请检查 DSH Desktop 是否正常。' }

Write-Host ''
Write-Host '启动完成：QQ / SnowLuma / DSH / QQ桥接 都已就绪。' -ForegroundColor Green
Write-Host '控制台：http://127.0.0.1:3100' -ForegroundColor Cyan
Write-Host '日志：D:\Temp\qq-bridge\state\start-all.log' -ForegroundColor DarkGray
Write-Host ''
Write-Host '8 秒后自动关闭（下次直接双击桌面「小鲸鱼一键启动」）。' -ForegroundColor DarkGray
Start-Sleep -Seconds 8
exit 0
