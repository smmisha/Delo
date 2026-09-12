param(
    [string]$Output = (Join-Path $PSScriptRoot 'native\Delo.ico')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Point([double]$x, [double]$y, [double]$scale, [double]$offset) {
    [System.Drawing.PointF]::new([single]($offset + $x * $scale), [single]($offset + $y * $scale))
}

function New-DeloPng([int]$size) {
    $supersampling = 4
    $canvasSize = $size * $supersampling
    # The mark itself occupies coordinates 13..83 by 14..82. Fit that artwork into
    # an optical 10..86 box so the tray glyph uses the same visual area as peer icons.
    $padding = $canvasSize * 0.04
    $scale = ($canvasSize - 2 * $padding) / 76
    $offset = $padding - 10 * $scale
    $canvas = [System.Drawing.Bitmap]::new($canvasSize, $canvasSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $body = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $body.StartFigure()
    $body.AddLine((Point 31 30 $scale $offset), (Point 31 22 $scale $offset))
    $body.AddBezier((Point 31 17.58 $scale $offset), (Point 34.58 14 $scale $offset), (Point 39 14 $scale $offset), (Point 39 14 $scale $offset))
    $body.AddLine((Point 39 14 $scale $offset), (Point 57 14 $scale $offset))
    $body.AddBezier((Point 61.42 14 $scale $offset), (Point 65 17.58 $scale $offset), (Point 65 22 $scale $offset), (Point 65 22 $scale $offset))
    $body.AddLine((Point 65 22 $scale $offset), (Point 65 30 $scale $offset))
    $body.AddLine((Point 65 30 $scale $offset), (Point 71 30 $scale $offset))
    $body.AddBezier((Point 77.63 30 $scale $offset), (Point 83 35.37 $scale $offset), (Point 83 42 $scale $offset), (Point 83 42 $scale $offset))
    $body.AddLine((Point 83 42 $scale $offset), (Point 83 70 $scale $offset))
    $body.AddBezier((Point 83 76.63 $scale $offset), (Point 77.63 82 $scale $offset), (Point 71 82 $scale $offset), (Point 71 82 $scale $offset))
    $body.AddLine((Point 71 82 $scale $offset), (Point 25 82 $scale $offset))
    $body.AddBezier((Point 18.37 82 $scale $offset), (Point 13 76.63 $scale $offset), (Point 13 70 $scale $offset), (Point 13 70 $scale $offset))
    $body.AddLine((Point 13 70 $scale $offset), (Point 13 42 $scale $offset))
    $body.AddBezier((Point 13 35.37 $scale $offset), (Point 18.37 30 $scale $offset), (Point 25 30 $scale $offset), (Point 25 30 $scale $offset))
    $body.CloseFigure()

    $brush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 59, 130, 246))
    $graphics.FillPath($brush, $body)
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $clearBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::Transparent)
    $handle = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $handle.AddLine((Point 39 30 $scale $offset), (Point 39 26 $scale $offset))
    $handle.AddBezier((Point 39 23.79 $scale $offset), (Point 40.79 22 $scale $offset), (Point 43 22 $scale $offset), (Point 43 22 $scale $offset))
    $handle.AddLine((Point 43 22 $scale $offset), (Point 53 22 $scale $offset))
    $handle.AddBezier((Point 55.21 22 $scale $offset), (Point 57 23.79 $scale $offset), (Point 57 26 $scale $offset), (Point 57 26 $scale $offset))
    $handle.AddLine((Point 57 26 $scale $offset), (Point 57 30 $scale $offset))
    $handle.CloseFigure()
    $graphics.FillPath($clearBrush, $handle)

    $checkPen = [System.Drawing.Pen]::new([System.Drawing.Color]::Transparent, [single](9 * $scale))
    $checkPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $checkPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $checkPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $checkPoints = [System.Drawing.PointF[]]@((Point 34 53 $scale $offset), (Point 44 63 $scale $offset), (Point 62 45 $scale $offset))
    $graphics.DrawLines($checkPen, $checkPoints)

    $result = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $downsample = [System.Drawing.Graphics]::FromImage($result)
    $downsample.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $downsample.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $downsample.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $downsample.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $downsample.DrawImage($canvas, [System.Drawing.Rectangle]::new(0, 0, $size, $size))
    $stream = [System.IO.MemoryStream]::new()
    $result.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $stream.ToArray()

    $stream.Dispose(); $downsample.Dispose(); $result.Dispose(); $checkPen.Dispose(); $handle.Dispose()
    $clearBrush.Dispose(); $brush.Dispose(); $body.Dispose(); $graphics.Dispose(); $canvas.Dispose()
    return [pscustomobject]@{ Bytes = $bytes }
}

$sizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
$images = [System.Collections.Generic.List[byte[]]]::new()
foreach ($size in $sizes) {
    $image = New-DeloPng $size
    $images.Add([byte[]]$image.Bytes)
}
New-Item -ItemType Directory -Path (Split-Path -Parent $Output) -Force | Out-Null
$file = [System.IO.File]::Open($Output, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
$writer = [System.IO.BinaryWriter]::new($file)
try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
    $offset = 6 + 16 * $sizes.Count
    for ($index = 0; $index -lt $sizes.Count; $index++) {
        $dimension = if ($sizes[$index] -eq 256) { 0 } else { $sizes[$index] }
        $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
        $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([uint16]1); $writer.Write([uint16]32)
        $writer.Write([uint32]$images[$index].Length); $writer.Write([uint32]$offset)
        $offset += $images[$index].Length
    }
    foreach ($image in $images) { $writer.Write($image) }
}
finally {
    $writer.Dispose(); $file.Dispose()
}
Write-Output $Output
