import { describe, expect, it } from "vitest";
import { sdkCopilotClientOptions } from "../src/copilot-client.js";

describe("options du client Copilot", () => {
  it("transmet le jeton OAuth standard au SDK sans utiliser la session ambiante", () => {
    expect(sdkCopilotClientOptions({ gitHubToken: "oauth-token" })).toEqual({
      gitHubToken: "oauth-token",
      useLoggedInUser: false,
      logLevel: "error",
      env: { GH_HOST: "github.com" },
    });
  });

  it("associe le jeton gh à son hôte Enterprise Cloud sans activer le mode GHES offline", () => {
    expect(sdkCopilotClientOptions({
      gitHubToken: "enterprise-token",
      hostname: "byb.ghe.com",
      baseDirectory: "/tmp/copilot",
    })).toEqual({
      useLoggedInUser: false,
      logLevel: "error",
      baseDirectory: "/tmp/copilot",
      gitHubToken: "enterprise-token",
      env: {
        GH_HOST: "byb.ghe.com",
      },
    });
  });
});
