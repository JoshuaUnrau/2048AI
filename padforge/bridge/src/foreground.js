'use strict';
// Reports which program is in the foreground, so phones can switch to the
// layout made for that game automatically. Returns a lowercase program name
// such as "eldenring.exe" (Windows) or "factorio" (Linux), or null if unknown.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

function windowsDetector() {
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const GetForegroundWindow = user32.func('void * __stdcall GetForegroundWindow()');
  const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *pid)');
  const OpenProcess = kernel32.func('void * __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)');
  const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void *h)');
  const QueryFullProcessImageNameW = kernel32.func(
    'bool __stdcall QueryFullProcessImageNameW(void *h, uint32 flags, _Out_ uint16 *name, _Inout_ uint32 *size)');
  const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  return async () => {
    const hwnd = GetForegroundWindow();
    if (!hwnd) return null;
    const pid = [0];
    GetWindowThreadProcessId(hwnd, pid);
    const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid[0]);
    if (!h) return null;
    try {
      const buf = new Uint16Array(1024);
      const size = [buf.length];
      if (!QueryFullProcessImageNameW(h, 0, buf, size)) return null;
      const full = String.fromCharCode(...buf.subarray(0, size[0]));
      return path.win32.basename(full).toLowerCase();
    } finally {
      CloseHandle(h);
    }
  };
}

function linuxDetector() {
  return () => new Promise((resolve) => {
    execFile('xdotool', ['getactivewindow', 'getwindowpid'], { timeout: 1000 }, (err, out) => {
      if (err) return resolve(null);
      const pid = parseInt(out, 10);
      try { resolve(fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim().toLowerCase()); } catch { resolve(null); }
    });
  });
}

function macDetector() {
  return () => new Promise((resolve) => {
    execFile('osascript', ['-e', 'tell application "System Events" to get name of first process whose frontmost is true'],
      { timeout: 1500 }, (err, out) => resolve(err ? null : out.trim().toLowerCase()));
  });
}

function watchForeground(onChange, intervalMs = 1500) {
  let detect;
  try {
    detect = process.platform === 'win32' ? windowsDetector()
      : process.platform === 'linux' ? linuxDetector()
      : process.platform === 'darwin' ? macDetector() : null;
  } catch (err) {
    console.warn('[foreground] auto layout switching disabled:', err.message);
  }
  if (!detect) return { stop() {}, current: () => null };
  let last = null;
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const exe = await detect();
      if (exe && exe !== last) { last = exe; onChange(exe); }
    } catch { /* ignore */ } finally { busy = false; }
  }, intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer), current: () => last };
}

module.exports = { watchForeground };
