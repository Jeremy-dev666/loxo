import { describe, expect, it } from 'vitest';
import { detectRuntime, resolveRuntime, scoreRuntimes } from '../src/modules/agents/runtime-detect';

describe('detectRuntime', () => {
  it.each([
    [['.claude/settings.json', 'CLAUDE.md', 'src/index.ts'], 'claude-code'],
    [['.codex/config.toml', 'codex.toml'], 'codex'],
    [['.opencode/state.json', 'opencode.json'], 'opencode'],
    [['.hermes/config', 'hermes.yaml'], 'hermes'],
    [['.openclaw/state.json', 'agent.manifest.json', 'SOUL.md'], 'openclaw'],
  ])('detects %j as %s', (paths, expected) => {
    expect(detectRuntime(paths as string[])).toBe(expected);
  });

  it('returns null for unmarked workspaces', () => {
    expect(detectRuntime(['src/main.py', 'README.md'])).toBeNull();
  });

  it('returns null on ties', () => {
    expect(detectRuntime(['CLAUDE.md', 'codex.toml'])).toBeNull();
  });

  it('sees markers nested under a single root folder', () => {
    expect(detectRuntime(['my-agent/.claude/settings.json', 'my-agent/README.md'])).toBe(
      'claude-code'
    );
  });

  it('normalizes backslash separators', () => {
    expect(detectRuntime(['.claude\\settings.json'])).toBe('claude-code');
  });
});

describe('resolveRuntime priority chain', () => {
  it('explicit choice wins over everything', () => {
    expect(resolveRuntime('hermes', ['.claude/settings.json'], 'codex')).toBe('hermes');
  });

  it('ignores invalid explicit values', () => {
    expect(resolveRuntime('not-a-runtime', ['CLAUDE.md'], undefined)).toBe('claude-code');
  });

  it('an exclusive .claude dir forces claude-code over manifest hints', () => {
    expect(resolveRuntime(undefined, ['.claude/settings.json', 'SOUL.md'], 'openclaw')).toBe(
      'claude-code'
    );
  });

  it('does not force when both .claude and .codex exist', () => {
    expect(resolveRuntime(undefined, ['.claude/a', '.codex/b'], 'hermes')).toBe('hermes');
  });

  it('manifest hint beats scoring', () => {
    expect(resolveRuntime(undefined, ['SOUL.md'], 'api')).toBe('api');
  });

  it('falls back to scoring, then null', () => {
    expect(resolveRuntime(undefined, ['hermes.yaml'], undefined)).toBe('hermes');
    expect(resolveRuntime(undefined, ['README.md'], undefined)).toBeNull();
  });
});

describe('scoreRuntimes', () => {
  it('counts each marker once', () => {
    const scores = scoreRuntimes(['.claude/a.json', '.claude/b.json', 'CLAUDE.md']);
    expect(scores['claude-code']).toBe(2); // dir marker + CLAUDE.md, not per-file
  });
});
