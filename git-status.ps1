[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:GIT_PAGER = "cat"
Write-Output "=== OUTER ==="
git -C "C:\Users\dongbae\Desktop\The_Journey_of_Glucose" status --short --branch
git -C "C:\Users\dongbae\Desktop\The_Journey_of_Glucose" remote -v
Write-Output "=== INNER (3d) ==="
git -C "C:\Users\dongbae\Desktop\The_Journey_of_Glucose\3d" status --short --branch
git -C "C:\Users\dongbae\Desktop\The_Journey_of_Glucose\3d" log --oneline -2
