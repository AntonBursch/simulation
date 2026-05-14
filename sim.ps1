# Thin PowerShell wrapper so you can run `./sim 3` from this folder.
param([Parameter(ValueFromRemainingArguments=$true)][string[]]$args)
python (Join-Path $PSScriptRoot 'sim.py') @args
