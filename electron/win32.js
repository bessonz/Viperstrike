// Thin bindings for the few Win32 calls Electron doesn't expose.
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

const GetForegroundWindow = user32.func('void* __stdcall GetForegroundWindow()');
const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(void* hWnd, _Out_ uint32_t* pid)');
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(void* hWnd, _Out_ void* buf, int max)');
const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(void* hWnd, intptr_t lParam)');
const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsProc* cb, intptr_t lParam)');
const OpenProcess = kernel32.func('void* __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)');
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void* h)');
const QueryFullProcessImageNameW = kernel32.func('bool __stdcall QueryFullProcessImageNameW(void* h, uint32_t flags, _Out_ void* buf, _Inout_ uint32_t* size)');

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const textBuf = Buffer.alloc(1024);
const pathBuf = Buffer.alloc(2048);

function windowTitle(hwnd) {
  const len = GetWindowTextW(hwnd, textBuf, 512);
  return len > 0 ? textBuf.toString('utf16le', 0, len * 2) : '';
}

function windowPid(hwnd) {
  const out = [0];
  GetWindowThreadProcessId(hwnd, out);
  return out[0];
}

function processPath(pid) {
  const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (!handle) return null;
  try {
    const size = [1024];
    if (!QueryFullProcessImageNameW(handle, 0, pathBuf, size)) return null;
    return pathBuf.toString('utf16le', 0, size[0] * 2);
  } finally {
    CloseHandle(handle);
  }
}

function foregroundApp() {
  const hwnd = GetForegroundWindow();
  if (!hwnd) return null;
  const pid = windowPid(hwnd);
  if (!pid) return null;
  return { pid, path: processPath(pid), title: windowTitle(hwnd) };
}

// Every top-level window title owned by processes with the given exe name.
function windowTitlesFor(exeName) {
  const wanted = exeName.toLowerCase();
  const titles = [];
  const seen = new Map();
  const callback = koffi.register((hwnd) => {
    const title = windowTitle(hwnd);
    if (title) {
      const pid = windowPid(hwnd);
      if (!seen.has(pid)) seen.set(pid, (processPath(pid) || '').toLowerCase().endsWith(`\\${wanted}`));
      if (seen.get(pid)) titles.push(title);
    }
    return true;
  }, koffi.pointer(EnumWindowsProc));
  try {
    EnumWindows(callback, 0);
  } finally {
    koffi.unregister(callback);
  }
  return titles;
}

const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(void* hWnd)');
const IsIconic = user32.func('bool __stdcall IsIconic(void* hWnd)');
const ShowWindow = user32.func('bool __stdcall ShowWindow(void* hWnd, int cmd)');
const SetWindowPos = user32.func('bool __stdcall SetWindowPos(void* hWnd, intptr_t after, int x, int y, int cx, int cy, uint32_t flags)');
const SetForegroundWindow = user32.func('bool __stdcall SetForegroundWindow(void* hWnd)');
const SetWindowLongPtrW = user32.func('intptr_t __stdcall SetWindowLongPtrW(void* hWnd, int index, intptr_t value)');
const SW_RESTORE = 9, SW_SHOW = 5, GWLP_HWNDPARENT = -8;
const HWND_TOPMOST = -1, HWND_NOTOPMOST = -2, SWP_NOMOVE = 0x2, SWP_NOSIZE = 0x1, SWP_SHOWWINDOW = 0x40;

// The visible top-level windows of an app, with their titles.
function windowsFor(exeName, { hidden = false } = {}) {
  const wanted = exeName.toLowerCase();
  const found = [];
  const seen = new Map();
  const callback = koffi.register((hwnd) => {
    if (hidden || IsWindowVisible(hwnd) || IsIconic(hwnd)) {
      const title = windowTitle(hwnd);
      if (title) {
        const pid = windowPid(hwnd);
        if (!seen.has(pid)) seen.set(pid, (processPath(pid) || '').toLowerCase().endsWith(`\\${wanted}`));
        if (seen.get(pid)) found.push({ hwnd, title });
      }
    }
    return true;
  }, koffi.pointer(EnumWindowsProc));
  try { EnumWindows(callback, 0); } finally { koffi.unregister(callback); }
  return found;
}

// Puts one of an app's windows in front of everything. With `alone`, it's first cut loose from the app's main
// window, so it shows by itself: the main window stays where it is, minimised or not.
// Windows only lets an app hand focus over while it has focus itself, which it does right after a click.
function bringToFront(exeName, matches, { alone = false } = {}) {
  const target = windowsFor(exeName, { hidden: alone }).find((w) => matches(w.title));
  if (!target) return false;
  if (alone) { SetWindowLongPtrW(target.hwnd, GWLP_HWNDPARENT, 0); ShowWindow(target.hwnd, SW_SHOW); }
  if (IsIconic(target.hwnd)) ShowWindow(target.hwnd, SW_RESTORE);
  const flags = SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW;
  SetWindowPos(target.hwnd, HWND_TOPMOST, 0, 0, 0, 0, flags);
  SetWindowPos(target.hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, flags);
  SetForegroundWindow(target.hwnd);
  return true;
}

module.exports = { foregroundApp, windowTitlesFor, bringToFront };
