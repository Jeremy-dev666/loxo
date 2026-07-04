import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  auditPublishTree,
  findPathRisks,
  isPublishExcluded,
  REDACTION_MARKER,
  sanitizeFileForPublish,
} from '../src/modules/market/publish-safety';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'swarmdev-publish-safety-'));

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('isPublishExcluded', () => {
  it('excludes build and VCS noise anywhere in the tree', () => {
    expect(isPublishExcluded('node_modules/pkg/index.js')).toBe(true);
    expect(isPublishExcluded('sub/dist/main.js')).toBe(true);
    expect(isPublishExcluded('.git', true)).toBe(true);
    expect(isPublishExcluded('docs/.DS_Store')).toBe(true);
    expect(isPublishExcluded('agent.config.json')).toBe(true);
  });

  it('keeps normal workspace files', () => {
    expect(isPublishExcluded('src/index.ts')).toBe(false);
    expect(isPublishExcluded('README.md')).toBe(false);
    expect(isPublishExcluded('distribution-notes.md')).toBe(false);
  });
});

describe('sanitizeFileForPublish', () => {
  it('omits sensitive paths regardless of content', () => {
    for (const p of ['.env', 'config/.env.production', 'id_rsa', 'keys/server.pem', 'credentials.json', 'auth-profiles.json', '.claude/settings.local.json']) {
      const result = sanitizeFileForPublish(p, Buffer.from('harmless'));
      expect(result.action, p).toBe('omit');
      expect(result.content).toBeNull();
      expect(result.risks.length).toBeGreaterThan(0);
    }
    expect(findPathRisks('notes.md')).toHaveLength(0);
  });

  it('redacts secrets in text files and reports each pattern', () => {
    const text = [
      'ANTHROPIC_KEY=sk-ant-abcdefghijklmnopqrstuvwxyz0123456789ABCD',
      'token: ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      '-----BEGIN RSA PRIVATE KEY-----',
    ].join('\n');
    const result = sanitizeFileForPublish('notes.md', Buffer.from(text));
    expect(result.action).toBe('redact');
    const out = result.content!.toString('utf8');
    expect(out).not.toContain('sk-ant-');
    expect(out).not.toContain('ghp_');
    expect(out).not.toContain('BEGIN RSA PRIVATE KEY');
    expect(out).toContain(REDACTION_MARKER);
    expect(result.risks.length).toBeGreaterThanOrEqual(3);
  });

  it('copies clean text and binary content untouched', () => {
    const clean = sanitizeFileForPublish('README.md', Buffer.from('# Hello\nA normal file.'));
    expect(clean.action).toBe('copy');
    expect(clean.risks).toHaveLength(0);

    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]);
    const image = sanitizeFileForPublish('logo.png', binary);
    expect(image.action).toBe('copy');
    expect(image.content).toBe(binary);
  });
});

describe('auditPublishTree', () => {
  it('reports risks across a tree while skipping excluded dirs', () => {
    const root = path.join(tmpRoot, 'tree');
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, '.env'), 'SECRET=1234567890abcdef0000');
    fs.writeFileSync(path.join(root, 'src', 'config.ts'), 'const key = "sk-abcdefghijklmnopqrstuvwx";');
    // Secrets inside node_modules never enter the copy, so they are not reported.
    fs.writeFileSync(path.join(root, 'node_modules', 'leak.js'), 'sk-abcdefghijklmnopqrstuvwx');
    fs.writeFileSync(path.join(root, 'README.md'), '# fine');

    const risks = auditPublishTree(root);
    const paths = risks.map((r) => r.path);
    expect(paths).toContain('.env');
    expect(paths).toContain('src/config.ts');
    expect(paths.every((p) => !p.startsWith('node_modules'))).toBe(true);
  });
});
