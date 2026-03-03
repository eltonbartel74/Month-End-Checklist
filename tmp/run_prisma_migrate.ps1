$ErrorActionPreference = 'Stop'

# Load .env.local into current process env
$envPath = Join-Path (Get-Location) '.env.local'
if (Test-Path $envPath) {
  Get-Content $envPath | ForEach-Object {
    $line = $_.Trim()
    if (-not $line) { return }
    if ($line.StartsWith('#')) { return }
    $m = [regex]::Match($line, '^(?<k>[^=]+)=(?<v>.*)$')
    if (-not $m.Success) { return }
    $k = $m.Groups['k'].Value.Trim()
    $v = $m.Groups['v'].Value.Trim()
    if ($v.StartsWith('"') -and $v.EndsWith('"')) {
      $v = $v.Substring(1, $v.Length-2)
    }
    [Environment]::SetEnvironmentVariable($k, $v, 'Process')
  }
}

npx prisma migrate dev --name wp_approval_workflow
