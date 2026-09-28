export { activateInProcess, type ExtensionChatSink, type ExtensionHandle, type HostDeps, type LoadedExtension } from "./in-process-host.js";
export { PermissionDeniedError, permissionChecker } from "./permissions.js";
export { createTestRunService, runTestsTool, summarizeRun, testFreezeGuard, type TestRunService } from "./test-runs.js";
export { activateIsolated, type IsolatedExtension, type IsolatedHandle, type IsolatedHostOptions } from "./isolated-host.js";
export { runExtensionChild, type ActivationRequest } from "./child/runtime.js";
export { createRpcEndpoint, memoryChannelPair, RpcClosedError, type RpcEndpoint, type RpcHandler } from "./rpc/endpoint.js";
export type { MessageChannelLike, RpcMessage } from "./rpc/protocol.js";
export { createNodeLauncher } from "./launchers/node-launcher.js";
export { cheminReel, isolationExecArgv, type ChildHandle, type LaunchOptions, type ProcessLauncher } from "./launchers/protocol.js";
export { bundle } from "./build/bundle.js";
export {
  composeAgentPrompt,
  contractBlock,
  copyDeclaredFiles,
  declaredPaths,
  extensionFileReader,
  extractSection,
  loadAgentPrompts,
  loadSkillTool,
  parseMarkdownDoc,
  resolveSkillRef,
  skillFile,
  type ComposedAgent,
  type MarkdownDoc,
  type SkillSource,
} from "./agent-prompts.js";
