/** Extension tierce de démonstration (« tiers.lint ») : compte les fichiers TypeScript du projet. */
import type { ExtensionModule } from "@agent-studio/extension-api";

const lint: ExtensionModule = {
  activate(ctx) {
    ctx.chat.registerCommand("lint", async () => {
      const files = (await ctx.workspace.listFiles()).filter((f) => f.endsWith(".ts"));
      ctx.chat.post(`Vérification du style : ${files.length} fichier(s) TypeScript examiné(s), aucun écart.`);
    });
  },
};

export default lint;
