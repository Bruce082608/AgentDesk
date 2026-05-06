import { useCallback, useMemo, useState } from "react";
import type { EventLogItem, SearchMatch, WorkspaceTreeItem } from "../types";
import type { AttachedFile, GitSummary } from "../global";
import { getInitialExpandedDirs, isTreeItemVisible } from "../utils";

type UseWorkspaceParams = {
  appendEvent: (kind: EventLogItem["kind"], title: string, body: string) => void;
};

export function useWorkspace({ appendEvent }: UseWorkspaceParams) {
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
      appendEvent("error", "文件树读取失败", error instanceof Error ? error.message : String(error));
    }
  }, [appendEvent, workspace]);

  const refreshGit = useCallback(async (target = workspace) => {
    if (!target) return;
    try {
      setGitSummary(await window.agentWindow.getGitSummary(target));
    } catch (error) {
      setGitSummary(null);
      appendEvent("error", "Git 状态读取失败", error instanceof Error ? error.message : String(error));
    }
  }, [appendEvent, workspace]);

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
      appendEvent("tool", "git diff", diff || "No unstaged diff.");
    } catch (error) {
      appendEvent("error", "git diff 失败", error instanceof Error ? error.message : String(error));
    }
  }, [appendEvent, workspace]);

  const openFile = useCallback(async (path: string) => {
    if (!workspace) return;
    try {
      const file = await window.agentWindow.readFile({ workspace, path });
      setPreviewFile(file);
    } catch (error) {
      appendEvent("error", "文件读取失败", error instanceof Error ? error.message : String(error));
    }
  }, [appendEvent, workspace]);

  const attachFile = useCallback(async (path: string) => {
    if (!workspace) return;
    if (attachedFiles.some((file) => file.path === path)) return;
    try {
      const file = await window.agentWindow.readFile({ workspace, path });
      setAttachedFiles((current) => [...current, file]);
    } catch (error) {
      appendEvent("error", "文件加入上下文失败", error instanceof Error ? error.message : String(error));
    }
  }, [appendEvent, attachedFiles, workspace]);

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
      appendEvent("tool", "文件已上传", JSON.stringify(files.map((file) => ({ path: file.path, chars: file.content.length })), null, 2));
    } catch (error) {
      appendEvent("error", "文件上传失败", error instanceof Error ? error.message : String(error));
    }
  }, [appendEvent]);

  const searchWorkspace = useCallback(async () => {
    const query = fileSearch.trim();
    if (!workspace || !query || searchingFiles) return;
    setSearchingFiles(true);
    try {
      const result = await window.agentWindow.searchFiles({ workspace, query, maxResults: 50 });
      setSearchResults(result.results);
      appendEvent("tool", "文件搜索", JSON.stringify({ query, matches: result.results.length, engine: result.engine, truncated: result.truncated }, null, 2));
    } catch (error) {
      appendEvent("error", "文件搜索失败", error instanceof Error ? error.message : String(error));
    } finally {
      setSearchingFiles(false);
    }
  }, [appendEvent, fileSearch, searchingFiles, workspace]);

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
