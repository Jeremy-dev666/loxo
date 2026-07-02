import path from 'node:path';

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
const WSL_MOUNT = /^\/mnt\/([A-Za-z])(\/|$)/;

export function windowsToWslPath(input: string): string {
  return input
    .replace(/^([A-Za-z]):[\\/]/, (_m, drive: string) => `/mnt/${drive.toLowerCase()}/`)
    .replace(/\\/g, '/');
}

export function wslToWindowsPath(input: string): string {
  return input
    .replace(WSL_MOUNT, (_m, drive: string) => `${drive.toUpperCase()}:\\`)
    .replace(/\//g, '\\');
}

/**
 * Normalizes a stored path to the current OS. Paths may have been written on
 * Windows or inside WSL; both spellings must resolve to the same location.
 */
export function toHostPath(input: string): string {
  if (process.platform === 'win32') {
    const host = WSL_MOUNT.test(input) ? wslToWindowsPath(input) : input.replace(/\//g, '\\');
    return path.isAbsolute(host) ? path.normalize(host) : path.resolve(host);
  }
  const host = WINDOWS_DRIVE.test(input) ? windowsToWslPath(input) : input.replace(/\\/g, '/');
  return path.posix.isAbsolute(host) ? path.posix.normalize(host) : path.resolve(host);
}
