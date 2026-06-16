import { dialog, ipcMain } from "electron";

import { readAttachmentFiles, readUploadedFiles } from "../attachments.js";
import { getGitDiff, getGitSummary, getWorkspaceTree, readWorkspaceFile, searchWorkspaceFiles } from "../workspace.js";
import {
  validateAttachmentPathsPayload,
  validateFileReadPayload,
  validateFileSearchPayload,
  validateWorkspace,
  validateWorkspaceTreePayload
} from "../ipc-validation.js";

export function registerWorkspaceIpc({ getMainWindow }) {
  ipcMain.handle("workspace:tree", async (_event, workspace) => {
    const validated = validateWorkspaceTreePayload(workspace);
    return await getWorkspaceTree(validated.workspace, validated.directory);
  });

  ipcMain.handle("file:read", async (_event, payload) => {
    const validated = validateFileReadPayload(payload);
    return await readWorkspaceFile(validated.workspace, validated.path);
  });

  ipcMain.handle("file:search", async (_event, payload) => {
    const validated = validateFileSearchPayload(payload);
    return await searchWorkspaceFiles(validated.workspace, validated.query, validated.maxResults);
  });

  ipcMain.handle("file:choose-attachments", async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      properties: ["openFile", "multiSelections"],
      title: "选择要上传分析的文件"
    });

    if (result.canceled || result.filePaths.length === 0) return [];
    return await readUploadedFiles(result.filePaths);
  });

  ipcMain.handle("file:read-attachments", async (_event, payload) => {
    const validated = validateAttachmentPathsPayload(payload);
    return await readAttachmentFiles(validated.paths);
  });

  ipcMain.handle("git:summary", async (_event, workspace) => {
    return await getGitSummary(validateWorkspace(workspace));
  });

  ipcMain.handle("git:diff", async (_event, workspace) => {
    return await getGitDiff(validateWorkspace(workspace));
  });
}
