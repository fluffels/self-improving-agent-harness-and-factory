param([string]$AssemblyPath, [string]$RequestPath, [switch]$Pruefe)
$ErrorActionPreference = 'Stop'
$PSModuleAutoLoadingPreference = 'None'
try {
  $assembly = [Reflection.Assembly]::LoadFile($AssemblyPath)
  $method = $assembly.GetType('Supervisor', $true).GetMethod('Main', [Reflection.BindingFlags]'Static,NonPublic')
  $argument = if ($Pruefe) { '--pruefe' } else { $RequestPath }
  $code = $method.Invoke($null, [object[]]@(,[string[]]@($argument)))
  exit ([int]$code)
} catch {
  [Console]::Error.WriteLine('Supervisor-Loader fehlgeschlagen')
  exit 1
}
