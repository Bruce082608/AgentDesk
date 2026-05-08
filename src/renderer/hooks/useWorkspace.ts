import { useCallback, useMemo, useState } from "react";
import { translations } from "../i18n";
import type { EventLogItem, SearchMatch, WorkspaceTreeItem } from "../types";
import type { AttachedFile, GitSummary } from "../global";
import { getInitialExpandedDirs, isTreeItemVisible } from "../utils";

type Translation = typeof translations[keyof typeof translations];

const MAX_DROPPED_FILE_BYTES = 1_000_000;
const MAX_DROPPED_FILE_CHARS = 120_000;

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

  const visibleTree = useMemo(
    () => tree.filter((item) => isTreeItemVisible(item, expandedDirs)),
    [expandedDirs, tree]
  );

  const refreshWorkspace = useCallback(async (target = workspace) => {
    if (!target) return;
    try {
      const result = await window.agentWindow.getWorkspaceTree(target);
      setTree(result.items);
      setExpandedDirs(getInitialExpandedDirs(result.items));
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

  const toggleDirectory = useCallback((path: string) => {
    setExpandedDirs((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

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
      setAttachedFiles((current) => {
        const seen = new Set(current.map((file) => file.path));
        return [...current, ...files.filter((file) => !seen.has(file.path))];
      });
      appendEvent("tool", t.fileUploaded, JSON.stringify(files.map((file) => ({ path: file.path, chars: file.content.length })), null, 2));
    } catch (error) {
      appendEvent("error", t.fileUploadFailed, error instanceof Error ? error.message : String(error));
    }
  }, [appendEvent, t]);

  const attachDroppedFiles = useCallback(async (fileList: File[]) => {
    try {
      const files = await readDroppedFiles(fileList);
      if (files.length === 0) return;
      setAttachedFiles((current) => {
        const seen = new Set(current.map((file) => file.path));
        return [...current, ...files.filter((file) => !seen.has(file.path))];
      });
      appendEvent("tool", t.fileUploaded, JSON.stringify(files.map((file) => ({ path: file.path, chars: file.content.length })), null, 2));
    } catch (error) {
      appendEvent("error", t.fileUploadFailed, error instanceof Error ? error.message : String(error));
    }
  }, [appendEvent, t]);

  const searchWorkspace = useCallback(async () => {
    const query = fileSearch.trim();
    if (!workspace || !query || searchingFiles) return;
    setSearchingFiles(true);
    try {
      const result = await window.agentWindow.searchFiles({ workspace, query, maxResults: 50 });
      setSearchResults(result.results);
      appendEvent("tool", t.fileSearchEvent, JSON.stringify({ query, matches: result.results.length, engine: result.engine, truncated: result.truncated }, null, 2));
    } catch (error) {
      appendEvent("error", t.fileSearchFailed, error instanceof Error ? error.message : String(error));
    } finally {
      setSearchingFiles(false);
    }
  }, [appendEvent, fileSearch, searchingFiles, t, workspace]);

  const resetWorkspaceTransientState = useCallback(() => {
    setAttachedFiles([]);
    setPreviewFile(null);
    setSearchResults([]);
    setFileSearch("");
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

async function readDroppedFiles(fileList: File[]): Promise<AttachedFile[]> {
  const files: AttachedFile[] = [];
  for (const file of fileList) {
    if (!file) continue;
    const path = getDroppedFilePath(file);
    if (file.size > MAX_DROPPED_FILE_BYTES) {
      files.push({
        path,
        content: `[文件过大，未读取正文。大小：${file.size} bytes；当前上传分析限制：${MAX_DROPPED_FILE_BYTES} bytes。]`
      });
      continue;
    }

    const buffer = new Uint8Array(await file.arrayBuffer());
    if (looksBinary(buffer)) {
      files.push({
        path,
        content: `[二进制文件，未读取正文。大小：${file.size} bytes。当前版本支持文本类文件分析。]`
      });
      continue;
    }

    let content = new TextDecoder("utf-8").decode(buffer);
    if (content.length > MAX_DROPPED_FILE_CHARS) {
      content = `${content.slice(0, MAX_DROPPED_FILE_CHARS)}\n\n[内容已截断：最多读取 ${MAX_DROPPED_FILE_CHARS} 字符。]`;
    }
    files.push({ path, content });
  }
  return files;
}

function getDroppedFilePath(file: File) {
  let electronPath = "";
  try {
    electronPath = window.agentWindow.getPathForFile(file);
  } catch {
    electronPath = (file as File & { path?: string }).path || "";
  }
  return electronPath || file.webkitRelativePath || file.name;
}

function looksBinary(buffer: Uint8Array) {
  if (buffer.length === 0) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 7 || (byte > 14 && byte < 32)) suspicious += 1;
  }
  return suspicious / sample.length > 0.08;
}
