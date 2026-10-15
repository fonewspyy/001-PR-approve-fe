<#
.SYNOPSIS
    สั่งให้ AI worker ของ pr_approve วิเคราะห์ใบ PR ที่ยังไม่มีผล AI

.DESCRIPTION
    ยิง POST ไปที่ /PR/api/ai-worker แล้วเขียน log ผลลัพธ์
    ใช้ได้ทั้งกับ Windows Task Scheduler (ตั้งเวลา) และรันเองด้วยมือ

    secret อ่านตามลำดับ:
      1) พารามิเตอร์ -Secret
      2) environment variable AI_WORKER_SECRET
      3) ไฟล์ .env.local ของโปรเจค (บรรทัด AI_WORKER_SECRET=...)

.EXAMPLE
    # รันเองด้วยมือ (dev)
    .\run-ai-worker.ps1

.EXAMPLE
    # ระบุ host + จำนวนใบต่อรอบ
    .\run-ai-worker.ps1 -BaseUrl "https://pr.beger.co.th" -Top 10

.NOTES
    exit code 0 = สำเร็จ, 1 = ล้มเหลว (Task Scheduler จะได้เห็นว่ารอบนั้นพัง)
#>

[CmdletBinding()]
param(
    # host ของ pr_approve (dev = http://localhost:3101)
    [string] $BaseUrl = "http://localhost:3101",

    # จำนวนใบสูงสุดต่อรอบ (worker จำกัดไว้ที่ 1–20)
    [int] $Top = 5,

    # ถ้าไม่ส่ง จะไปหาจาก env var หรือ .env.local ให้เอง
    [string] $Secret,

    # ไฟล์ log (ค่าเริ่มต้น = logs\ai-worker.log ข้างโปรเจค)
    [string] $LogFile
)

$ErrorActionPreference = "Stop"

# ── ขั้น 1: หา path ของโปรเจค (สคริปต์อยู่ใน <project>\scripts\) ──────────────
$scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

if (-not $LogFile) {
    $LogFile = Join-Path $projectRoot "logs\ai-worker.log"
}

# ── ขั้น 2: ฟังก์ชัน log (ลง console + ไฟล์ พร้อม timestamp) ─────────────────
function Write-Log {
    param([string] $Message)

    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Write-Host $line

    $logDir = Split-Path -Parent $LogFile
    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
    Add-Content -Path $LogFile -Value $line -Encoding utf8
}

# ── ขั้น 3: หา secret ตามลำดับ (param → env var → .env.local) ────────────────
function Resolve-Secret {
    if ($Secret) {
        Write-Verbose "ใช้ secret จากพารามิเตอร์"
        return $Secret
    }

    if ($env:AI_WORKER_SECRET) {
        Write-Verbose "ใช้ secret จาก environment variable"
        return $env:AI_WORKER_SECRET
    }

    $envFile = Join-Path $projectRoot ".env.local"
    if (Test-Path $envFile) {
        $line = Select-String -Path $envFile -Pattern '^\s*AI_WORKER_SECRET\s*=' | Select-Object -First 1
        if ($line) {
            Write-Verbose "ใช้ secret จาก .env.local"
            return ($line.Line -replace '^\s*AI_WORKER_SECRET\s*=\s*', '').Trim()
        }
    }

    return $null
}

# ── ขั้น 4: ยิง worker ───────────────────────────────────────────────────────
try {
    $resolvedSecret = Resolve-Secret

    if (-not $resolvedSecret) {
        Write-Log "ERROR: ไม่พบ AI_WORKER_SECRET (ส่ง -Secret, ตั้ง env var, หรือใส่ใน .env.local)"
        exit 1
    }

    $uri = "{0}/PR/api/ai-worker" -f $BaseUrl.TrimEnd('/')
    Write-Log "START  POST $uri  (top=$Top)"

    $response = Invoke-RestMethod -Method Post -Uri $uri `
        -Headers @{ "x-worker-secret" = $resolvedSecret } `
        -ContentType "application/json" `
        -Body (@{ top = $Top } | ConvertTo-Json -Compress) `
        -TimeoutSec 600

    $done   = [int] $response.done
    $failed = [int] $response.failed
    $took   = [int] $response.took

    Write-Log ("DONE   สำเร็จ {0} ใบ, พลาด {1} ใบ, ใช้เวลา {2:N1} วิ" -f $done, $failed, ($took / 1000))

    # แจกแจงรายใบ เพื่อให้ตามหาใบที่พลาดได้
    foreach ($item in $response.results) {
        if ($item.ok) {
            Write-Log ("  OK    {0}  decision={1}" -f $item.processInstanceId, $item.decision)
        }
        else {
            Write-Log ("  FAIL  {0}  error={1}" -f $item.processInstanceId, $item.error)
        }
    }

    # มีใบพลาด = ให้ Task Scheduler เห็นว่ารอบนี้ไม่สมบูรณ์
    if ($failed -gt 0) { exit 1 }
    exit 0
}
catch {
    Write-Log ("ERROR  {0}" -f $_.Exception.Message)
    exit 1
}
