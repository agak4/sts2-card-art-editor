param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,

    [Parameter(Mandatory = $true)]
    [string]$OutputDir
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$inputFile = [System.IO.Path]::GetFullPath($InputPath)
$outputFolder = [System.IO.Path]::GetFullPath($OutputDir)

if (-not [System.IO.File]::Exists($inputFile)) {
    throw "Input GIF not found: $inputFile"
}

[System.IO.Directory]::CreateDirectory($outputFolder) | Out-Null

$gif = [System.Drawing.Image]::FromFile($inputFile)
try {
    $frameDimension = New-Object System.Drawing.Imaging.FrameDimension($gif.FrameDimensionsList[0])
    $frameCount = $gif.GetFrameCount($frameDimension)

    $delays = @()
    $frames = @()

    $delayPropertyId = 0x5100
    $delayBytes = $null
    if ($gif.PropertyIdList -contains $delayPropertyId) {
        $delayBytes = $gif.GetPropertyItem($delayPropertyId).Value
    }

    for ($i = 0; $i -lt $frameCount; $i++) {
        $gif.SelectActiveFrame($frameDimension, $i) | Out-Null

        $bitmap = New-Object System.Drawing.Bitmap($gif.Width, $gif.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear([System.Drawing.Color]::Transparent)
            $graphics.DrawImage($gif, 0, 0, $gif.Width, $gif.Height)

            $frameName = ("frame_{0:D3}.png" -f $i)
            $framePath = [System.IO.Path]::Combine($outputFolder, $frameName)
            $bitmap.Save($framePath, [System.Drawing.Imaging.ImageFormat]::Png)
            $frames += $framePath
        }
        finally {
            $graphics.Dispose()
            $bitmap.Dispose()
        }

        $delaySeconds = 0.1
        if ($delayBytes -ne $null -and $delayBytes.Length -ge (($i + 1) * 4)) {
            $delayValue = [BitConverter]::ToInt32($delayBytes, $i * 4)
            if ($delayValue -gt 0) {
                $delaySeconds = [Math]::Max(0.02, $delayValue / 100.0)
            }
        }
        $delays += $delaySeconds
    }

    $metadata = @{
        frames = $frames
        delays = $delays
    }

    $metadataPath = [System.IO.Path]::Combine($outputFolder, "metadata.json")
    $metadata | ConvertTo-Json -Depth 4 | Set-Content -Path $metadataPath -Encoding UTF8
}
finally {
    $gif.Dispose()
}
