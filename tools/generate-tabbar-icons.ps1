Add-Type -AssemblyName System.Drawing

$outputDirectory = Join-Path $PSScriptRoot '..\assets\tabbar'  # 拆仓后前端即仓根
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null

function New-TabIcon {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$ColorHex,
    [Parameter(Mandatory = $true)][scriptblock]$Draw
  )

  $bitmap = [System.Drawing.Bitmap]::new(81, 81, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $color = [System.Drawing.ColorTranslator]::FromHtml($ColorHex)
  $pen = [System.Drawing.Pen]::new($color, 5)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $brush = [System.Drawing.SolidBrush]::new($color)

  try {
    & $Draw $graphics $pen $brush
    $target = Join-Path $outputDirectory ($Name + '.png')
    $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $brush.Dispose()
    $pen.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

$drawers = @{
  home = {
    param($g, $p, $b)
    $g.DrawLines($p, [System.Drawing.Point[]]@(
      [System.Drawing.Point]::new(14, 39),
      [System.Drawing.Point]::new(40, 16),
      [System.Drawing.Point]::new(67, 39)
    ))
    $g.DrawLines($p, [System.Drawing.Point[]]@(
      [System.Drawing.Point]::new(22, 34),
      [System.Drawing.Point]::new(22, 65),
      [System.Drawing.Point]::new(59, 65),
      [System.Drawing.Point]::new(59, 34)
    ))
  }
  voice = {
    param($g, $p, $b)
    $g.DrawArc($p, 30, 10, 21, 20, 180, 180)
    $g.DrawLine($p, 30, 20, 30, 37)
    $g.DrawLine($p, 51, 20, 51, 37)
    $g.DrawArc($p, 30, 27, 21, 20, 0, 180)
    $g.DrawArc($p, 20, 25, 41, 34, 0, 180)
    $g.DrawLine($p, 40, 59, 40, 69)
    $g.DrawLine($p, 29, 69, 52, 69)
  }
  record = {
    param($g, $p, $b)
    $g.DrawPolygon($p, [System.Drawing.Point[]]@(
      [System.Drawing.Point]::new(40, 13),
      [System.Drawing.Point]::new(67, 40),
      [System.Drawing.Point]::new(40, 67),
      [System.Drawing.Point]::new(13, 40)
    ))
    $g.FillEllipse($b, 34, 34, 13, 13)
  }
  stats = {
    param($g, $p, $b)
    $g.FillRectangle($b, 15, 45, 12, 23)
    $g.FillRectangle($b, 34, 22, 12, 46)
    $g.FillRectangle($b, 54, 34, 12, 34)
  }
  mine = {
    param($g, $p, $b)
    $g.DrawEllipse($p, 29, 11, 23, 23)
    $g.DrawArc($p, 16, 37, 49, 36, 180, 180)
    $g.DrawLine($p, 16, 55, 16, 67)
    $g.DrawLine($p, 65, 55, 65, 67)
  }
}

$colors = @{
  normal = '#7A7A7A'
  active = '#07C160'
}

foreach ($entry in $drawers.GetEnumerator()) {
  New-TabIcon -Name $entry.Key -ColorHex $colors.normal -Draw $entry.Value
  New-TabIcon -Name ($entry.Key + '-active') -ColorHex $colors.active -Draw $entry.Value
}
