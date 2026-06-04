$ModelDir = "C:\Models"
$ModelPath = "$ModelDir\Llama-3.2-1B-Instruct-Q4_K_M.gguf"
$ModelUrl = "https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf"
$ServerExe = "C:\Tools\llama-tools\llama-server.exe"

# 1. Ensure directory exists
if (-not (Test-Path $ModelDir)) {
    New-Item -ItemType Directory -Path $ModelDir -Force | Out-Null
}

# 2. Check and download model
if (-not (Test-Path $ModelPath)) {
    Write-Host "Model file not found. Downloading Llama-3.2-1B-Instruct-Q4_K_M.gguf from Hugging Face..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri $ModelUrl -OutFile $ModelPath -UserAgent "Mozilla/5.0"
    Write-Host "Download complete." -ForegroundColor Green
} else {
    Write-Host "Model found in cache: $ModelPath" -ForegroundColor Green
}

# 3. Start llama-server on Windows (Runs Vulkan by default on the AMD GPU)
Write-Host "Starting Vulkan llama-server on port 8080..." -ForegroundColor Cyan
& $ServerExe -m $ModelPath --port 8080 -c 4096 --host 0.0.0.0
