param([string]$Key)
$ErrorActionPreference = 'Stop'
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$system = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
$root = [IO.Path]::Combine([Environment]::GetFolderPath('LocalApplicationData'), 'Temp', 'codex-job-cache-v1')

function Check-Path([string]$Path) {
  $current = [IO.Path]::GetFullPath($Path)
  while ($current) {
    if ([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint) { throw 'Cacheumleitung' }
    $current = [IO.Path]::GetDirectoryName($current)
  }
}
function Check-Acl([string]$Path) {
  Check-Path $Path
  if ([IO.Directory]::Exists($Path)) { $acl = [IO.Directory]::GetAccessControl($Path) }
  else { $acl = [IO.File]::GetAccessControl($Path) }
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'Cacheeigentum' }
  $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
  if ($rules.Count -ne 2) { throw 'Cacheberechtigungen' }
  foreach ($rule in $rules) {
    if ($rule.IdentityReference.Value -notin @($sid.Value, $system.Value) -or
        $rule.AccessControlType -ne 'Allow' -or $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) { throw 'Cacheberechtigungen' }
  }
  if (@($rules | Where-Object { $_.IdentityReference.Value -eq $sid.Value }).Count -ne 1) { throw 'Cacheberechtigungen' }
}
if ($Key -notmatch '^[a-f0-9]{64}$') { throw 'Cacheschluessel' }
Check-Path ([IO.Path]::GetDirectoryName($root))
if (-not [IO.Directory]::Exists($root)) {
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetOwner($sid)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($identity in @($sid, $system)) {
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
  }
  [IO.Directory]::CreateDirectory($root, $acl) | Out-Null
}
Check-Acl $root
$artifact = [IO.Path]::Combine($root, $Key)
if ([IO.Directory]::Exists($artifact) -or [IO.File]::Exists($artifact)) {
  if (-not [IO.Directory]::Exists($artifact)) { throw 'Cachetyp' }
  Check-Acl $artifact
  $files = [IO.Directory]::GetFileSystemEntries($artifact)
  if ($files.Count -ne 3) { throw 'Cachedateien' }
  foreach ($name in @('source.cs', 'supervisor.exe', 'manifest.json')) {
    $file = [IO.Path]::Combine($artifact, $name)
    if (-not [IO.File]::Exists($file)) { throw 'Cachedateityp' }
    Check-Acl $file
  }
}
[Console]::WriteLine($root)
