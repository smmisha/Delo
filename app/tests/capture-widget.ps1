param([Parameter(Mandatory=$true)][string]$OutputPath,[ValidateSet('Delo','Delo Quick')][string]$WindowTitle='Delo',[switch]$Screen)
$ErrorActionPreference='Stop'
# Resolve the HWND through the harness, not FindWindow: production may be running too.
$code='import {pathToFileURL} from "node:url"; const {connect,screenshot}=await import(pathToFileURL(process.argv[1])); const page=await connect(process.argv[2]==="Delo Quick"); try {await screenshot(page,process.argv[3],{screen:process.argv[4]==="True"});} finally {page.close();}'
& node --input-type=module -e $code "$PSScriptRoot/audit-harness.mjs" $WindowTitle ([IO.Path]::GetFullPath($OutputPath)) ([string]$Screen.IsPresent)
if($LASTEXITCODE -ne 0){throw 'Delo harness screenshot failed'}
