import { registerAgentIpc } from "./agent-ipc.js";
import { registerConfigIpc } from "./config-ipc.js";
import { registerPersistenceIpc } from "./persistence-ipc.js";
import { registerProviderIpc } from "./provider-ipc.js";
import { registerSystemIpc } from "./system-ipc.js";
import { registerToolApprovalIpc } from "./tool-approval-ipc.js";
import { registerUpdatesIpc } from "./updates-ipc.js";
import { registerWorkspaceIpc } from "./workspace-ipc.js";

export function registerMainIpc({ getMainWindow, activeRequests, queueOpenPaths, markOpenPathsReady }) {
  registerSystemIpc({ getMainWindow, queueOpenPaths, markOpenPathsReady });
  registerConfigIpc();
  registerUpdatesIpc();
  registerPersistenceIpc();
  registerToolApprovalIpc();
  registerWorkspaceIpc({ getMainWindow });
  registerProviderIpc();
  registerAgentIpc({ getMainWindow, activeRequests });
}
