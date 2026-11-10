// Program icons. Electron's lookup hands back a 32px generic placeholder for some programs,
// so when it can't deliver the large size we read the icon out of the .exe instead.
const { execFile } = require('child_process');
const { app } = require('electron');

const cache = new Map();

const EXTRACT = `
Add-Type -AssemblyName System.Drawing
$icon = [Drawing.Icon]::ExtractAssociatedIcon($env:VS_EXE)
$stream = New-Object IO.MemoryStream
$icon.ToBitmap().Save($stream, [Drawing.Imaging.ImageFormat]::Png)
[Convert]::ToBase64String($stream.ToArray())`;

function extractFromExe(exe) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', EXTRACT],
      { env: { ...process.env, VS_EXE: exe }, windowsHide: true, timeout: 8000 },
      (err, stdout) => {
        const base64 = stdout?.trim();
        resolve(!err && base64 ? `data:image/png;base64,${base64}` : null);
      });
  });
}

async function lookup(exe) {
  let shellIcon = null;
  try {
    const icon = await app.getFileIcon(exe, { size: 'large' });
    shellIcon = icon.toDataURL();
    if (icon.getSize().width >= 48) return shellIcon;
  } catch { /* fall through to the exe itself */ }
  return (await extractFromExe(exe)) || shellIcon;
}

function fileIcon(exe) {
  if (!cache.has(exe)) cache.set(exe, lookup(exe));
  return cache.get(exe);
}

// The biggest version of the icon stored in the .exe, sharp enough to fill a game card.
const EXTRACT_LARGE = `
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class VsIcons {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern uint PrivateExtractIcons(string file, int index, int cx, int cy, IntPtr[] icons, int[] ids, uint count, uint flags);
}
'@
$icons = New-Object IntPtr[] 1
$ids = New-Object int[] 1
[void][VsIcons]::PrivateExtractIcons($env:VS_EXE, 0, 256, 256, $icons, $ids, 1, 0)
if ($icons[0] -ne [IntPtr]::Zero) {
  $stream = New-Object IO.MemoryStream
  [Drawing.Icon]::FromHandle($icons[0]).ToBitmap().Save($stream, [Drawing.Imaging.ImageFormat]::Png)
  [Convert]::ToBase64String($stream.ToArray())
}`;

const largeCache = new Map();

function largeIcon(exe) {
  if (!largeCache.has(exe)) {
    largeCache.set(exe, new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', EXTRACT_LARGE],
        { env: { ...process.env, VS_EXE: exe }, windowsHide: true, timeout: 12000, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout) => {
          const base64 = stdout?.trim();
          resolve(!err && base64 ? `data:image/png;base64,${base64}` : null);
        });
    }).then((icon) => icon || fileIcon(exe)));
  }
  return largeCache.get(exe);
}

module.exports = { fileIcon, largeIcon };
