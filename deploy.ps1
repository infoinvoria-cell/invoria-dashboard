Write-Host "Saving all files..."
git add .

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

Write-Host "Committing changes..."
git commit -m "Auto deploy $timestamp"

Write-Host "Pushing to GitHub..."
git push origin main

Write-Host "Deployment triggered on Vercel."
Pause