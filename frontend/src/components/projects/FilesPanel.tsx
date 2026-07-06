'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  deleteProjectFile,
  downloadProjectArchive,
  downloadProjectFile,
  fetchFilePreview,
  fetchFileTree,
  renameProjectFile,
  type FileNode,
  type FilePreview,
  type FileTree,
} from '@/lib/projects';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface FilesPanelProps {
  projectId: string;
  projectName: string;
  /** Bumped by the parent when an execution finishes to refresh the tree. */
  refreshToken: number;
  onPreview: (path: string) => void;
  onFileRemoved: (path: string) => void;
}

export function FilesPanel({
  projectId,
  projectName,
  refreshToken,
  onPreview,
  onFileRemoved,
}: FilesPanelProps) {
  const [tree, setTree] = useState<FileTree | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetchFileTree(projectId)
      .then((t) => {
        setTree(t);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load files'));
  }, [projectId]);

  useEffect(reload, [reload, refreshToken]);

  const toggleDir = (path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const rename = async (node: FileNode) => {
    const newName = prompt(`Rename ${node.name} to:`, node.name)?.trim();
    if (!newName || newName === node.name) return;
    try {
      await renameProjectFile(projectId, node.path, newName);
      onFileRemoved(node.path);
      reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Rename failed');
    }
  };

  const remove = async (node: FileNode) => {
    if (!confirm(`Delete ${node.path}?`)) return;
    try {
      await deleteProjectFile(projectId, node.path);
      onFileRemoved(node.path);
      reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const renderNode = (node: FileNode, depth: number): React.ReactNode => {
    if (node.isDirectory) {
      const isCollapsed = collapsed.has(node.path);
      return (
        <div key={node.path || 'root'}>
          {node.path && (
            <button
              onClick={() => toggleDir(node.path)}
              className="flex w-full items-center gap-1 px-1 py-0.5 text-left text-xs text-pixel-black/70 hover:bg-pixel-cream"
              style={{ paddingLeft: `${depth * 12}px` }}
            >
              <span className="text-pixel-black/50">{isCollapsed ? '▸' : '▾'}</span>
              {node.name}
            </button>
          )}
          {!isCollapsed &&
            node.children?.map((child) => renderNode(child, node.path ? depth + 1 : depth))}
        </div>
      );
    }
    return (
      <div
        key={node.path}
        className="group flex items-center justify-between px-1 py-0.5 hover:bg-pixel-cream"
        style={{ paddingLeft: `${depth * 12 + 14}px` }}
      >
        <button
          onClick={() => onPreview(node.path)}
          className="min-w-0 flex-1 truncate text-left text-xs text-pixel-black/60 hover:text-pixel-black"
          title={`${node.path} · ${formatSize(node.size)}`}
        >
          {node.name}
        </button>
        <span className="hidden shrink-0 gap-1 group-hover:flex">
          <button
            onClick={() => rename(node)}
            className="px-1 text-[10px] text-pixel-black/50 hover:text-pixel-black"
            title="Rename"
          >
            R
          </button>
          <button
            onClick={() => remove(node)}
            className="px-1 text-[10px] text-pixel-black/50 hover:text-pixel-red"
            title="Delete"
          >
            ×
          </button>
        </span>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-pixel-line px-3 py-2">
        <span className="text-xs font-medium text-pixel-black/70">Files</span>
        <div className="flex gap-2">
          <button
            onClick={reload}
            className="text-[11px] text-pixel-black/50 hover:text-pixel-black"
            title="Refresh"
          >
            refresh
          </button>
          <button
            onClick={() => downloadProjectArchive(projectId, projectName).catch(() => {})}
            className="text-[11px] text-pixel-black/50 hover:text-pixel-black"
            title="Download workspace as zip"
          >
            zip
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {error && <p className="px-1 text-xs text-pixel-red">{error}</p>}
        {tree && tree.root.children?.length === 0 && (
          <p className="px-1 text-xs text-pixel-black/50">Workspace is empty.</p>
        )}
        {tree?.root.children?.map((child) => renderNode(child, 0))}
        {tree?.truncated && (
          <p className="mt-2 px-1 text-[11px] text-pixel-black">
            Listing truncated ({tree.totalEntries} entries shown).
          </p>
        )}
      </div>
    </div>
  );
}

interface FilePreviewModalProps {
  projectId: string;
  path: string;
  onClose: () => void;
}

export function FilePreviewModal({ projectId, path, onClose }: FilePreviewModalProps) {
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPreview(null);
    setError(null);
    fetchFilePreview(projectId, path)
      .then(setPreview)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load preview'));
  }, [projectId, path]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-pixel-black/70 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col border border-pixel-line bg-pixel-white shadow-pixel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-pixel-line px-4 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{path}</p>
            {preview && (
              <p className="text-[11px] text-pixel-black/50">
                {formatSize(preview.size)}
                {preview.truncated ? ' · preview truncated' : ''}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button
              onClick={() => downloadProjectFile(projectId, path).catch(() => {})}
              className="text-xs text-pixel-black/60 hover:text-pixel-black"
            >
              download
            </button>
            <button onClick={onClose} className="text-xs text-pixel-black/60 hover:text-pixel-black">
              close
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {error && <p className="text-sm text-pixel-red">{error}</p>}
          {!preview && !error && <p className="text-sm text-pixel-black/50">Loading…</p>}
          {preview?.binary && (
            <p className="text-sm text-pixel-black/60">
              Binary file — not previewable. Use download instead.
            </p>
          )}
          {preview && !preview.binary && (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs text-pixel-black/70">
              {preview.content || '(empty file)'}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
