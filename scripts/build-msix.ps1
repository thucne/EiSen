[CmdletBinding()]
param(
  [ValidateSet('store', 'test')]
  [string]$Mode = 'store',
  [string]$Version = '0.2.1.0',
  [string]$OutputDirectory = 'artifacts/msix'
)

$ErrorActionPreference = 'Stop'

function Assert-ExternalCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  if ($null -eq (Get-Command -Name $Name -ErrorAction SilentlyContinue)) {
    throw "Required command is not available: $Name"
  }
}

function Invoke-ExternalCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  & $Name @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Name failed with exit code $LASTEXITCODE"
  }
}

function Read-PackageManifest {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $document = New-Object System.Xml.XmlDocument
  $document.PreserveWhitespace = $true
  $document.Load($Path)
  return $document
}

function Get-ManifestIdentity {
  param(
    [Parameter(Mandatory = $true)]
    [System.Xml.XmlDocument]$Document
  )

  $identity = $Document.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Identity']")
  if ($null -eq $identity) {
    throw 'Package.appxmanifest is missing its package Identity element'
  }

  $name = $identity.GetAttribute('Name').Trim()
  $publisher = $identity.GetAttribute('Publisher').Trim()
  if ([string]::IsNullOrWhiteSpace($name) -or [string]::IsNullOrWhiteSpace($publisher)) {
    throw 'Package.appxmanifest must contain non-empty Partner Center Name and Publisher values'
  }

  $unresolvedMarker = '(__PARTNER_CENTER_|<Partner Center|\bTBD\b|\bTODO\b)'
  if ($name -match $unresolvedMarker -or $publisher -match $unresolvedMarker) {
    throw 'Package.appxmanifest still contains an unresolved Partner Center identity marker'
  }

  return [ordered]@{
    Node = $identity
    Name = $name
    Publisher = $publisher
  }
}

function Assert-ManifestAssets {
  param(
    [Parameter(Mandatory = $true)]
    [System.Xml.XmlDocument]$Document,
    [Parameter(Mandatory = $true)]
    [string]$ManifestDirectory
  )

  $references = @(
    $Document.SelectNodes('//@*') |
      ForEach-Object { $_.Value } |
      Where-Object { $_ -match '^Assets[\\/]' } |
      Sort-Object -Unique
  )

  if ($references.Count -eq 0) {
    throw 'Package.appxmanifest does not reference any Assets/ files'
  }

  foreach ($reference in $references) {
    $normalized = $reference -replace '\\', '/'
    if ($normalized -match '(^|/)\.\.(/|$)') {
      throw "Manifest asset path escapes the package directory: $reference"
    }

    $assetPath = Join-Path $ManifestDirectory $normalized
    $asset = Get-Item -LiteralPath $assetPath -File -ErrorAction SilentlyContinue
    if ($null -eq $asset -or $asset.Length -eq 0) {
      throw "Manifest asset is missing or empty: $reference"
    }
  }
}

function Invoke-WinApp {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  & $script:WinAppCommand @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "winapp failed with exit code $LASTEXITCODE"
  }
}

function Invoke-WinAppPack {
  param(
    [Parameter(Mandatory = $true)]
    [string]$OutputPath,
    [switch]$GenerateDevelopmentCertificate
  )

  $packArguments = @(
    'pack',
    $script:StagingDirectory,
    '--manifest',
    $script:StagingManifest,
    '--executable',
    'eisen.exe',
    '--output',
    $OutputPath
  )

  if ($GenerateDevelopmentCertificate) {
    $packArguments += @('--generate-cert', '--install-cert', '--publisher', $script:Publisher)
  }

  Push-Location $script:StagingDirectory
  try {
    Invoke-WinApp -Arguments $packArguments
  }
  finally {
    Pop-Location
  }

  $package = Get-Item -LiteralPath $OutputPath -File -ErrorAction SilentlyContinue
  if ($null -eq $package -or $package.Length -eq 0) {
    throw "winapp did not produce a non-empty package: $OutputPath"
  }

  return $package
}

function Write-StoreArtifacts {
  param(
    [Parameter(Mandatory = $true)]
    [System.IO.FileInfo]$Package,
    [Parameter(Mandatory = $true)]
    [string]$ManifestIdentityName,
    [Parameter(Mandatory = $true)]
    [string]$ManifestPublisher
  )

  $hash = (Get-FileHash -LiteralPath $Package.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $sidecarPath = "$($Package.FullName).sha256"
  $sidecar = "$hash  $($Package.Name)"
  [System.IO.File]::WriteAllText(
    $sidecarPath,
    $sidecar,
    [System.Text.UTF8Encoding]::new($false)
  )

  $sidecarReadBack = [System.IO.File]::ReadAllText($sidecarPath)
  if ($sidecarReadBack -ne $sidecar) {
    throw "Checksum sidecar could not be verified: $sidecarPath"
  }

  $rehash = (Get-FileHash -LiteralPath $Package.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($rehash -ne $hash) {
    throw "Package checksum changed while writing the sidecar: $($Package.Name)"
  }

  $metadataPath = Join-Path $script:OutputDirectory "$($Package.BaseName).metadata.json"
  $metadata = [ordered]@{
    product = 'EiSen'
    version = $script:Version
    architecture = 'x64'
    mode = 'store'
    packageFile = $Package.Name
    packageSha256 = $hash
    packageIdentityName = $ManifestIdentityName
    publisher = $ManifestPublisher
    manifestFile = 'app/msix/Package.appxmanifest'
  }
  $metadataJson = $metadata | ConvertTo-Json -Depth 4
  [System.IO.File]::WriteAllText(
    $metadataPath,
    $metadataJson,
    [System.Text.UTF8Encoding]::new($false)
  )

  return [ordered]@{
    Package = $Package.FullName
    Sha256 = $hash
    Sidecar = $sidecarPath
    Metadata = $metadataPath
  }
}

if ($Version -notmatch '^\d+\.\d+\.\d+\.\d+$') {
  throw "MSIX version must contain four numeric components: $Version"
}

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$script:Version = $Version
$script:OutputDirectory = if ([System.IO.Path]::IsPathRooted($OutputDirectory)) {
  [System.IO.Path]::GetFullPath($OutputDirectory)
}
else {
  Join-Path $repo $OutputDirectory
}

$manifestSource = Join-Path $repo 'app/msix/Package.appxmanifest'
$assetsSource = Join-Path $repo 'app/msix/Assets'
$brandingSource = Join-Path $repo 'assets/branding/eisen-mark-on-dark-1024.png'
$executablePath = Join-Path $repo 'app/src-tauri/target/release/eisen.exe'

Assert-ExternalCommand -Name 'npm'
Assert-ExternalCommand -Name 'winapp'

foreach ($requiredPath in @($manifestSource, $assetsSource, $brandingSource)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Required MSIX input is missing: $requiredPath"
  }
}

New-Item -ItemType Directory -Path $script:OutputDirectory -Force | Out-Null
$script:StagingDirectory = Join-Path $script:OutputDirectory ("staging-" + [guid]::NewGuid().ToString('N'))
$script:StagingManifest = Join-Path $script:StagingDirectory 'Package.appxmanifest'
$script:WinAppCommand = (Get-Command -Name 'winapp').Source

Push-Location $repo
try {
  Invoke-ExternalCommand -Name 'npm' -Arguments @('--prefix', 'app', 'run', 'tauri', '--', 'build', '--no-bundle', '--ci')
}
finally {
  Pop-Location
}

$executable = @(Get-Item -LiteralPath $executablePath -File -ErrorAction SilentlyContinue)
if ($executable.Count -ne 1) {
  throw "Expected exactly one release executable at $executablePath, found $($executable.Count)"
}

New-Item -ItemType Directory -Path $script:StagingDirectory -Force | Out-Null
try {
  Copy-Item -LiteralPath $executable.FullName -Destination (Join-Path $script:StagingDirectory 'eisen.exe')
  Copy-Item -LiteralPath $manifestSource -Destination $script:StagingManifest
  Copy-Item -LiteralPath $assetsSource -Destination (Join-Path $script:StagingDirectory 'Assets') -Recurse

  $manifest = Read-PackageManifest -Path $script:StagingManifest
  $identity = Get-ManifestIdentity -Document $manifest
  $identity.Node.SetAttribute('Version', $Version)
  $manifest.Save($script:StagingManifest)

  $script:Publisher = $identity.Publisher

  # winapp manifest update-assets and winapp pack are intentionally run only in staging.
  Invoke-WinApp -Arguments @('manifest', 'update-assets', $brandingSource, '--manifest', $script:StagingManifest)

  $manifest = Read-PackageManifest -Path $script:StagingManifest
  $identity = Get-ManifestIdentity -Document $manifest
  Assert-ManifestAssets -Document $manifest -ManifestDirectory $script:StagingDirectory

  if ($Mode -eq 'test') {
    $testPackagePath = Join-Path $script:OutputDirectory "EiSen_${Version}_x64-test.msix"
    $testPackage = Invoke-WinAppPack -OutputPath $testPackagePath -GenerateDevelopmentCertificate
    $result = [ordered]@{
      Mode = 'test'
      Package = $testPackage.FullName
      Version = $Version
      Architecture = 'x64'
    }
  }
  else {
    $storePackagePath = Join-Path $script:OutputDirectory "EiSen_${Version}_x64.msix"
    $storePackage = Invoke-WinAppPack -OutputPath $storePackagePath
    $artifacts = Write-StoreArtifacts `
      -Package $storePackage `
      -ManifestIdentityName $identity.Name `
      -ManifestPublisher $identity.Publisher
    $result = [ordered]@{
      Mode = 'store'
      Package = $artifacts.Package
      Sha256 = $artifacts.Sha256
      Sidecar = $artifacts.Sidecar
      Metadata = $artifacts.Metadata
      Version = $Version
      Architecture = 'x64'
    }
  }

  $result | ConvertTo-Json -Depth 4
}
finally {
  if (Test-Path -LiteralPath $script:StagingDirectory) {
    Remove-Item -LiteralPath $script:StagingDirectory -Recurse -Force
  }
}
