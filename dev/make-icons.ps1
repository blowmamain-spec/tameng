# Draws the placeholder shield icon at the sizes the manifest needs.
# Run: powershell -ExecutionPolicy Bypass -File dev\make-icons.ps1
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot "..\extension\icons"
New-Item -ItemType Directory -Force $out | Out-Null

foreach ($size in 16, 32, 48, 128) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $s = $size / 32.0
  $pts = @(
    (New-Object System.Drawing.PointF (16 * $s), (2 * $s)),
    (New-Object System.Drawing.PointF (28 * $s), (6.5 * $s)),
    (New-Object System.Drawing.PointF (27 * $s), (17 * $s)),
    (New-Object System.Drawing.PointF (16 * $s), (30 * $s)),
    (New-Object System.Drawing.PointF (5 * $s), (17 * $s)),
    (New-Object System.Drawing.PointF (4 * $s), (6.5 * $s))
  )
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddClosedCurve($pts, 0.12)
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(31, 92, 74))), $path)

  # Inner bar: the "closed gate" mark that the block page repeats.
  $bar = New-Object System.Drawing.RectangleF (10 * $s), (13.5 * $s), (12 * $s), (4 * $s)
  $g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(246, 243, 236))), $bar)

  $bmp.Save((Join-Path $out "icon$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
"Ikon dibuat di $out"
