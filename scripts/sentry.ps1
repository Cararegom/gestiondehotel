param(
    [ValidateSet('status', 'configure', 'verify', 'issues', 'event')]
    [string]$Action = 'verify',
    [string]$Environment = 'prod',
    [ValidateRange(1, 50)][int]$Limit = 10,
    [string]$Query = 'is:unresolved',
    [string]$EventId
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$configPath = Join-Path $projectRoot 'sentry.config.json'
$savedEnvironment = @{}

function Read-SentryVariable([string]$Name) {
    foreach ($scope in @('Process', 'User', 'Machine')) {
        $value = [Environment]::GetEnvironmentVariable($Name, $scope)
        if (-not [string]::IsNullOrWhiteSpace($value)) { return $value.Trim() }
    }
    return $null
}

function Get-SentryJson([string]$Path) {
    try {
        Invoke-RestMethod -Uri ('https://sentry.io/api/0/' + $Path) -Method Get -Headers @{
            Authorization = 'Bearer ' + $env:SENTRY_AUTH_TOKEN
        }
    } catch {
        $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 'RED' }
        throw "Sentry API: ERROR $status. No se muestran URL, cabeceras ni credenciales."
    }
}

try {
    foreach ($name in @('SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT', 'SENTRY_BASE_URL')) {
        $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        if ($name -ne 'SENTRY_BASE_URL') {
            [Environment]::SetEnvironmentVariable($name, (Read-SentryVariable $name), 'Process')
        }
    }
    # This project uses Sentry Cloud. Never forward the token to an arbitrary URL.
    $env:SENTRY_BASE_URL = 'https://sentry.io'
    if (Test-Path -LiteralPath $configPath) {
        $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
        $env:SENTRY_PROJECT = $config.project
    }
    if ($Action -eq 'status') {
        foreach ($name in @('SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT')) {
            $state = if (Read-SentryVariable $name) { 'CONFIGURADA' } else { 'NO CONFIGURADA' }
            Write-Output "${name}: $state"
        }
        exit 0
    }
    if (-not $env:SENTRY_AUTH_TOKEN -or -not $env:SENTRY_ORG) {
        throw 'SENTRY_AUTH_TOKEN o SENTRY_ORG: NO CONFIGURADA en este contexto. Ejecuta desde tu usuario de Windows con el acceso autorizado.'
    }
    $org = [Uri]::EscapeDataString($env:SENTRY_ORG)
    if ($Action -eq 'configure') {
        $projects = @(Get-SentryJson "organizations/$org/projects/")
        $project = $projects | Where-Object { $_.slug -eq 'gestiondehotel' } | Select-Object -First 1
        if (-not $project) { throw 'No se encontro el proyecto gestiondehotel. No se crearon proyectos ni claves.' }
        $slug = [Uri]::EscapeDataString($project.slug)
        $keys = @(Get-SentryJson "projects/$org/$slug/keys/")
        $key = $keys | Where-Object { $_.isActive -and $_.dsn.public } | Select-Object -First 1
        if (-not $key) { throw 'No se encontro un DSN publico activo. No se crearon claves.' }
        $publicConfig = [ordered]@{ project = $project.slug; dsn = $key.dsn.public; enabled = $true }
        [IO.File]::WriteAllText($configPath, ($publicConfig | ConvertTo-Json) + "`n", [Text.UTF8Encoding]::new($false))
        Write-Output 'Configuracion publica de Sentry guardada. Token y organizacion permanecen en Windows.'
        exit 0
    }
    if (-not $env:SENTRY_PROJECT) { throw 'Falta sentry.config.json. Ejecuta primero -Action configure.' }
    $codexBase = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
    $pluginRoot = Join-Path $codexBase 'plugins/cache/openai-curated-remote/sentry'
    $pluginScript = Get-ChildItem -Path (Join-Path $pluginRoot '*/skills/sentry/scripts/sentry_api.py') -File |
        Sort-Object FullName -Descending | Select-Object -First 1
    if (-not $pluginScript) { throw 'El plugin Sentry no esta instalado en este perfil de Codex.' }
    $python = Get-Command python -ErrorAction Stop
    $arguments = @($pluginScript.FullName)
    if ($Action -eq 'event') {
        if ($EventId -notmatch '^[a-fA-F0-9]{32}$') { throw 'EventId invalido.' }
        $arguments += @('event-detail', $EventId)
    } else {
        $arguments += @('list-issues', '--environment', $Environment, '--time-range', '24h', '--limit', $Limit, '--query', $Query)
    }
    # Capture raw plugin output in memory only; never log error URLs or payloads.
    $result = & $python.Source @arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'El plugin no pudo consultar Sentry. Revisa conectividad y permisos project:read/event:read.' }
    $data = ($result -join "`n") | ConvertFrom-Json
    if ($Action -eq 'verify') {
        Write-Output 'Plugin Sentry: CONEXION VERIFICADA'
        Write-Output ('Incidencias encontradas en la consulta: ' + @($data).Count)
    } elseif ($Action -eq 'event') {
        $data | Select-Object eventID, dateCreated, platform | ConvertTo-Json
    } else {
        $data | Select-Object shortId, title, status, count, firstSeen, lastSeen | ConvertTo-Json -Depth 3
    }
} catch {
    # Only our fixed messages are safe to display; OS/HTTP exceptions may contain secrets.
    $safeMessages = '^(Sentry API: ERROR|SENTRY_AUTH_TOKEN o SENTRY_ORG:|No se encontro|Falta sentry.config.json|El plugin Sentry no esta|EventId invalido|El plugin no pudo)'
    if ($_.Exception.Message -match $safeMessages) { Write-Output $_.Exception.Message }
    else { Write-Output 'No se pudo completar la operacion Sentry. Detalles sensibles omitidos.' }
    exit 1
} finally {
    foreach ($name in $savedEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
    }
}
