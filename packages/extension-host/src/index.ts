export { activateInProcess, type ExtensionChatSink, type ExtensionHandle, type HostDeps, type LoadedExtension } from "./in-process-host.js";
export { PermissionDeniedError, permissionChecker } from "./permissions.js";
export { createTestRunService, runTestsTool, summarizeRun, testFreezeGuard, type TestRunService } from "./test-runs.js";
