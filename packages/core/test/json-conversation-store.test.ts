import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ConversationRecord } from "../src/protocols/conversation.js";
import { createJsonConversationStore } from "../src/conversation/json-conversation-store.js";

describe("JsonConversationStore", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "agent-studio-conv-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const record = (root: string, text = "bonjour"): ConversationRecord => ({
    version: 1,
    workspaceRoot: root,
    runtimeSessionId: "sess-1",
    messages: [{ id: "m1", role: "user", text, createdAt: "2026-09-23T10:00:00.000Z", checkpointId: "cp1" }],
  });

  it("renvoie null quand rien n'a été enregistré", async () => {
    const store = createJsonConversationStore(dir);
    expect(await store.load("/projets/a")).toBeNull();
  });

  it("relit ce qui a été enregistré, y compris depuis une nouvelle instance (redémarrage)", async () => {
    await createJsonConversationStore(dir).save(record("/projets/a"));
    expect(await createJsonConversationStore(dir).load("/projets/a")).toEqual(record("/projets/a"));
  });

  it("isole les conversations par espace de travail", async () => {
    const store = createJsonConversationStore(dir);
    await store.save(record("/projets/a", "A"));
    await store.save(record("/projets/b", "B"));
    expect((await store.load("/projets/a"))?.messages[0]?.text).toBe("A");
    expect((await store.load("/projets/b"))?.messages[0]?.text).toBe("B");
  });

  it("écrit de façon atomique : aucun fichier temporaire ne subsiste", async () => {
    const store = createJsonConversationStore(dir);
    await store.save(record("/projets/a"));
    await store.save(record("/projets/a", "deux"));
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.json$/);
  });

  it("ignore un fichier corrompu au lieu de planter, en le mettant de côté", async () => {
    const store = createJsonConversationStore(dir);
    await store.save(record("/projets/a"));
    const [file] = await readdir(dir);
    await writeFile(join(dir, file!), "{ pas du json");
    expect(await store.load("/projets/a")).toBeNull();
    const files = await readdir(dir);
    expect(files.some((f) => f.includes(".corrupt-"))).toBe(true);
  });

  it("rejette un enregistrement qui ne respecte pas le schéma", async () => {
    const store = createJsonConversationStore(dir);
    await store.save(record("/projets/a"));
    const [file] = await readdir(dir);
    const raw = JSON.parse(await readFile(join(dir, file!), "utf8"));
    raw.messages[0].role = "pirate";
    await writeFile(join(dir, file!), JSON.stringify(raw));
    expect(await store.load("/projets/a")).toBeNull();
  });
});
