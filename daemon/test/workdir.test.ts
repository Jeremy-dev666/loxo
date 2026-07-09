import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultWorkspaceRoot, resolveAllowedWorkdir } from '../src/workdir';

const WORKSPACE = defaultWorkspaceRoot();

describe('resolveAllowedWorkdir', () => {
  it('falls back to the daemon workspace when no workdir is requested', () => {
    expect(resolveAllowedWorkdir(null, [])).toBe(resolve(WORKSPACE));
    expect(resolveAllowedWorkdir('  ', [])).toBe(resolve(WORKSPACE));
  });

  it('accepts the workspace root and its subdirectories', () => {
    expect(resolveAllowedWorkdir(WORKSPACE, [])).toBe(resolve(WORKSPACE));
    expect(resolveAllowedWorkdir(join(WORKSPACE, 'proj'), [])).toBe(resolve(WORKSPACE, 'proj'));
  });

  it('rejects directories outside every allowed root', () => {
    expect(resolveAllowedWorkdir(homedir(), [])).toBeNull();
    expect(resolveAllowedWorkdir('C:/Windows/System32', [])).toBeNull();
  });

  it('rejects traversal that escapes an allowed root', () => {
    expect(resolveAllowedWorkdir(join(WORKSPACE, '..', 'escape'), [])).toBeNull();
  });

  it('does not treat a sibling with a shared prefix as inside the root', () => {
    const root = join(homedir(), 'work');
    expect(resolveAllowedWorkdir(join(homedir(), 'workspace-2'), [root])).toBeNull();
  });

  it('accepts directories under an explicitly allowed root', () => {
    const root = join(homedir(), 'projects');
    const target = join(root, 'demo');
    expect(resolveAllowedWorkdir(target, [root])).toBe(resolve(target));
  });

  it('is case-insensitive on Windows', () => {
    if (process.platform !== 'win32') return;
    const root = join(homedir(), 'Projects');
    const target = join(homedir(), 'projects', 'demo');
    expect(resolveAllowedWorkdir(target, [root])).toBe(resolve(target));
  });
});
