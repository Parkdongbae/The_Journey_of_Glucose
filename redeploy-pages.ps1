$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:GIT_TERMINAL_PROMPT = "0"
$env:GIT_PAGER = "cat"
Set-Location "C:\Users\dongbae\Desktop\The_Journey_of_Glucose\3d"

# 1) backup source branch
git push origin main:source
Write-Output "=== source branch pushed ==="

# 2) orphan deploy branch with build output only
git checkout --orphan deploy
git rm -rf --cached . 2>$null | Out-Null
Get-ChildItem -Force | Where-Object { $_.Name -notin @("dist", ".git") } | Remove-Item -Recurse -Force
Copy-Item "dist\index.html" ".\index.html" -Force
New-Item -ItemType File -Path ".nojekyll" -Force | Out-Null
git add -A
git status --short
git commit -m "deploy: web app build for GitHub Pages"
git push origin deploy:main --force
Write-Output "=== main force-pushed ==="

# 3) back to source branch locally
git checkout main
git branch -D deploy
git log --oneline -3
git branch -a
