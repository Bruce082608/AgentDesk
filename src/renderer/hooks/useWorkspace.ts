import { useCallback, useMemo, useRef, useState } from "react";
import { translations } from "../i18n";
import type { EventLogItem, SearchMatch, WorkspaceTreeItem } from "../types";
import type { AttachedFile, GitSummary } from "../global";
import { getInitialExpandedDirs, isTreeItemVisible } from "../utils";

type Translation = typeof translations[keyof typeof translations];

type UseWorkspaceParams = {
  appendEvent: (kind: EventLogItem["kind"], title: string, body: string) => void;
  t: Translation;
};

export function useWorkspace({ appendEvent, t }: UseWorkspaceParams) {
  const [workspace, setWorkspace] = useState("");
  const [tree, setTree] = useState<WorkspaceTreeItem[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set());
  const [fileSearch, setFileSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [previewFile, setPreviewFile] = useState<AttachedFile | null>(null);
  const [gitSummary, setGitSummary] = useState<GitSummary | null>(null);
  const [searchingFiles, setSearchingFiles] = useState(false);
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(() => new Set());
  const searchRunRef = useRef(0);

  const visibleTree = useMemo(
    () => tree.filter((item) => isTreeItemVisible(item, expandedDirs)),
    [expandedDirs, tree]
  );

  const refreshWorkspace = useCallback(async (target = workspace) => {
    if (!target) return;
    try {
      const result = await window.agentWindow.getWorkspaceTree({ workspace: target, directory: "" });
      setTree(result.items);
      setExpandedDirs(getInitialExpandedDirs(result.items));
      setLoadingDirs(new Set());
    } catch (error) {
      appendEvent("error", t.fileTreeReadFailed, error instanceof Error ? error.message : String(error));
    }
  }, [appendEvent, t, workspace]);

  const refreshGit = useCallback(async (target = workspace) => {
    if (!target) return;
    try {
      setGitSummary(await window.agentWindow.getGitSummary(target));
    } catch (error) {
      setGitSummary(null);
      appendEvent("error", t.gitStatusReadFailed, error instanceof Error ? error.message : String(error));
    }
  }, [appendEvent, t, workspace]);

  const chooseWorkspace = useCallback(async (onSelected?: (selected: string) => void) => {
    const selected = await window.agentWindow.chooseWorkspace();
    if (!selected) return;
    setWorkspace(selected);
    onSelected?.(selected);
    setAttachedFiles([]);
    setPreviewFile(null);
    setSearchResults([]);
    setFileSearch("");
    await refreshWorkspace(selected);
    await refreshGit(selected);
  }, [refreshGit, refreshWorkspace]);

  const toggleDirectory = useCallback(async (directoryPath: string) => {
    const isExpanded = expandedDirs.has(directoryPath);
    setExpandedDirs((current) => {
      const next = new Set(current);
      if (next.has(directoryPath)) next.delete(directoryPath);
      else next.add(directoryPath);
      return next;
    });
    if (isExpanded || !workspace) return;
    const item = tree.find((entry) => entry.path === directoryPath);
    if (item?.loaded || item?.hasChildren === false || loadingDirs.has(directoryPath)) return;

    setLoadingDirs((current) => new Set(current).add(directoryPath));
    try {
      const result = await window.agentWindow.getWorkspaceTree({ workspace, directory: directoryPath });
      setTree((current) => insertTreeChildren(current, directoryPath, result.items));
    } catch (error) {
      appendEvent("error", t.fileTreeReadFailed, error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingDirs((current) => {
        const next = new Set(current);
        next.delete(directoryPath);
        return next;
      });
    }
  }, [appendEvent, expandedDirs, loadingDirs, t, tree, workspace]);

  const showGitDiff = useCallback(async () => {
    if (!workspace) return;
    try {
      const { diff } = await window.agentWindow.getGitDiff(workspace);
      appendEvent("tool", "git diff", diff || t.noUnstagedDiff);
    } catch (error) {
      appendEvent("error", t.gitDiffFailed, error instanceof Error ? error.message : String(error));
    }
  }, [appendEvent, t, workspace]);

  const openFile = useCallback(async (path: string) => {
    if (!workspace) return;
    try {
      const file = await window.agentWindow.readFile({ workspace, path });
      setPreviewFile(file);
    } catch (error) {
      appendEvent("error", t.fileReadFailed, error instanceof Error ? error.message : String(error));
    }
  }, [appendEvent, t, workspace]);

  const attachFile = useCallback(async (path: string) => {
    if (!workspace) return;
    if (attachedFiles.some((file) => file.path === path)) return;
    try {
      const file = await window.agentWindow.readFile({ workspace, path });
      setAttachedFiles((current) => [...current, file]);
    } catch (error) {
      appendEvent("error", t.fileAttachFailed, error instanceof Error ? error.message : String(error));
    }
  }, [appendEvent, attachedFiles, t, workspace]);

  const detachFile = useCallback((path: string) => {
    setAttachedFiles((current) => current.filter((file) => file.path !== path));
  }, []);

  const uploadAttachmentFiles = useCallback(async () => {
    try {
      const files = await window.agentWindow.chooseAttachmentFiles();
      if (files.length === 0) return;
      setAttachedFiles((current) => mergeAttachedFiles(current, files));
      appendEvent("tool", t.fileUploaded, JSON.stringify(files.map((file) => ({ path: file.path, status: file.status || "ready", chars: file.content.length })), null, 2));
    } catch (error) {
      appendEvent("error", t.fileUploadFailed, error instanceof Error ? error.message : String(error));
    }
  }, [appendEvent, t]);

  const attachDroppedFiles = useCallback(async (fileList: File[]) => {
    try {
      const paths = getDroppedFilePaths(fileList);
      if (paths.length === 0) return;
      const files = await window.agentWindow.readAttachmentFiles({ paths });
      if (files.length === 0) return;
      setAttachedFiles((current) => mergeAttachedFiles(current, files));
      appendEvent("tool", t.fileUploaded, JSON.stringify(files.map((file) => ({ path: file.path, status: file.status || "ready", chars: file.content.length })), null, 2));
    } catch (error) {
      appendEvent("error", t.fileUploadFailed, error instanceof Error ? error.message : String(error));
    }
  }, [appendEvent, t]);

  const searchWorkspace = useCallback(async () => {
    const query = fileSearch.trim();
    if (!workspace || !query || searchingFiles) return;
    const runId = searchRunRef.current + 1;
    searchRunRef.current = runId;
    setSearchingFiles(true);
    try {
      const result = await window.agentWindow.searchFiles({ workspace, query, maxResults: 50 });
      if (searchRunRef.current !== runId) return;
      setSearchResults(result.results);
      appendEvent("tool", t.fileSearchEvent, JSON.stringify({ query, matches: result.results.length, engine: result.engine, truncated: result.truncated }, null, 2));
    } catch (error) {
      appendEvent("error", t.fileSearchFailed, error instanceof Error ? error.message : String(error));
    } finally {
      if (searchRunRef.current === runId) setSearchingFiles(false);
    }
  }, [appendEvent, fileSearch, searchingFiles, t, workspace]);

  const cancelSearchWorkspace = useCallback(() => {
    searchRunRef.current += 1;
    setSearchingFiles(false);
  }, []);

  const resetWorkspaceTransientState = useCallback(() => {
    setAttachedFiles([]);
    setPreviewFile(null);
    setSearchResults([]);
    setFileSearch("");
    setLoadingDirs(new Set());
  }, []);

  const clearWorkspaceData = useCallback(() => {
    setTree([]);
    setGitSummary(null);
  }, []);

  return {
    attachedFiles,
    attachFile,
    attachDroppedFiles,
    chooseWorkspace,
    clearWorkspaceData,
    detachFile,
    expandedDirs,
    fileSearch,
    gitSummary,
    openFile,
    previewFile,
    refreshGit,
    refreshWorkspace,
    resetWorkspaceTransientState,
    searchResults,
    searchingFiles,
    searchWorkspace,
    cancelSearchWorkspace,
    loadingDirs,
    setAttachedFiles,
    setFileSearch,
    setGitSummary,
    setPreviewFile,
    setSearchResults,
    setTree,
    setWorkspace,
    showGitDiff,
    toggleDirectory,
    tree,
    uploadAttachmentFiles,
    visibleTree,
    workspace
  };
}

function getDroppedFilePaths(fileList: File[]) {
  const paths = fileList
    .map((file) => {
      try {
        return window.agentWindow.getPathForFile(file);
      } catch {
        return (file as File & { path?: string }).path || "";
      }
    })
    .map((filePath) => filePath.trim())
    .filter(Boolean);
  return [...new Set(paths)];
}

function mergeAttachedFiles(current: AttachedFile[], incoming: AttachedFile[]) {
  const next = [...current];
  const indexByPath = new Map(next.map((file, index) => [file.path, index]));
  for (const file of incoming) {
    const existingIndex = indexByPath.get(file.path);
    if (existingIndex === undefined) {
      indexByPath.set(file.path, next.length);
      next.push(file);
      continue;
    }
    const existing = next[existingIndex];
    next[existingIndex] = {
      ...existing,
      duplicateCount: (existing.duplicateCount || 1) + 1
    };
  }
  return next;
}

function insertTreeChildren(current: WorkspaceTreeItem[], directoryPath: string, children: WorkspaceTreeItem[]) {
  const childPrefix = `${directoryPath}/`;
  const parentIndex = current.findIndex((item) => item.path === directoryPath);
  if (parentIndex < 0) return current;
  const withoutOldChildren = current.filter((item) => item.path === directoryPath || !item.path.startsWith(childPrefix));
  const nextParentIndex = withoutOldChildren.findIndex((item) => item.path === directoryPath);
  const parent = withoutOldChildren[nextParentIndex];
  const nextParent = { ...parent, loaded: true, hasChildren: children.length > 0 };
  return [
    ...withoutOldChildren.slice(0, nextParentIndex),
    nextParent,
    ...children,
    ...withoutOldChildren.slice(nextParentIndex + 1)
  ];
}
