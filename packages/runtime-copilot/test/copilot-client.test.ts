import { describe, expect, it } from "vitest";
import { sdkCopilotClientOptions } from "../src/copilot-client.js";

describe("options du client Copilot", () => {
  const ambiant = { PATH: "/usr/bin", HOME: "/home/x", HTTPS_PROXY: "http://proxy:3128" };

  it("transmet le jeton OAuth standard au SDK sans utiliser la session ambiante", () => {
    expect(sdkCopilotClientOptions({ gitHubToken: "oauth-token" }, ambiant)).toEqual({
      gitHubToken: "oauth-token",
      useLoggedInUser: false,
      logLevel: "error",
      env: { ...ambiant, GH_HOST: "github.com" },
    });
  });

  it("associe le jeton gh à son hôte Enterprise Cloud sans activer le mode GHES offline", () => {
    expect(sdkCopilotClientOptions({
      gitHubToken: "enterprise-token",
      hostname: "byb.ghe.com",
      baseDirectory: "/tmp/copilot",
    }, ambiant)).toEqual({
      useLoggedInUser: false,
      logLevel: "error",
      baseDirectory: "/tmp/copilot",
      gitHubToken: "enterprise-token",
      env: { ...ambiant, GH_HOST: "byb.ghe.com" },
    });
  });

  // Le SDK prend `options.env` À LA PLACE de l'environnement du processus : sans cette copie, le CLI
  // démarrait sans PATH, HOME ni proxy (commandes shell des agents, proxy d'entreprise).
  it("garde l'environnement du processus ; l'hôte de la connexion l'emporte sur un GH_HOST hérité", () => {
    const env = sdkCopilotClientOptions({ gitHubToken: "t", hostname: "byb.ghe.com" }, { ...ambiant, GH_HOST: "github.com" }).env;
    expect(env).toEqual({ ...ambiant, GH_HOST: "byb.ghe.com" });
  });

  it("par défaut, part de process.env", () => {
    expect(sdkCopilotClientOptions({ gitHubToken: "t" }).env?.PATH).toBe(process.env.PATH);
  });
});
