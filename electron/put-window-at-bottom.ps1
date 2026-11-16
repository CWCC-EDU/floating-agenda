param(
  [Parameter(Mandatory = $true)][string]$Handle
)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class DesktopWindow {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetWindowPos(
    IntPtr hWnd,
    IntPtr hWndInsertAfter,
    int X,
    int Y,
    int cx,
    int cy,
    uint uFlags
  );
}
"@

$windowHandle = [IntPtr]::Parse($Handle)
$bottom = [IntPtr]::new(1)
$noMoveNoSizeNoActivate = 0x0001 -bor 0x0002 -bor 0x0010
[DesktopWindow]::SetWindowPos($windowHandle, $bottom, 0, 0, 0, 0, $noMoveNoSizeNoActivate) | Out-Null
