param([string]$NotesPath = ".\notes")
$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $NotesPath -PathType Container)) {
    throw "Notes directory not found: $NotesPath"
}

$notes = Get-ChildItem -LiteralPath $NotesPath -File -Recurse |
    Where-Object { $_.Extension -in ".txt", ".md", ".markdown" }

$summary = $notes |
    Group-Object Extension |
    ForEach-Object {
        [PSCustomObject]@{
            Format = $_.Name
            Files = $_.Count
            Bytes = ($_.Group | Measure-Object Length -Sum).Sum
        }
    } |
    Sort-Object Format

Write-Output "Reading room / local notes inventory"
$summary | Format-Table -AutoSize
Write-Output ("Total files: {0}" -f $notes.Count)
