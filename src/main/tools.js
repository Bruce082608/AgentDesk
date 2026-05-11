export { toolDefinitions } from "./tool-defs.js";
export {
  approvePendingCommand,
  discardPendingCommand,
  executeCommandRecord,
  executeToolCall
} from "./tool-runner.js";
export {
  applyPatchRecord,
  applyPendingPatch,
  discardPendingPatch,
  getPendingPatch,
  setCommandAutoApproval,
  setFullAccessAutoApproval,
  setPatchAutoApproval
} from "./patch-approval.js";

import { __test__ as patchApprovalTest } from "./patch-approval.js";
import { __test__ as toolRunnerTest } from "./tool-runner.js";

export const __test__ = {
  ...patchApprovalTest,
  ...toolRunnerTest
};
