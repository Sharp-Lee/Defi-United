import { describe, expect, it } from "vitest";
import { createInitialBrowserVaultState } from "../core/browserVault/accounts";
import {
  BROWSER_VAULT_KDF_ITERATIONS,
  createBrowserVaultSession,
  createMemoryBrowserVaultStorage,
  hasBrowserVault,
  importBrowserVaultEnvelope,
  parseBrowserVaultEnvelope,
  saveBrowserVaultSession,
  serializeBrowserVaultEnvelope,
  unlockBrowserVaultSession,
} from "./browserVault";

describe("browserVault", () => {
  it("creates, saves, unlocks, and re-saves encrypted vault state", async () => {
    const storage = createMemoryBrowserVaultStorage();
    const initialState = createInitialBrowserVaultState({ mnemonicPhrase: "test test test test test test test test test test test junk" });

    const created = await createBrowserVaultSession("correct horse battery staple", initialState, storage);
    const serialized = serializeBrowserVaultEnvelope(created.envelope);
    expect(serialized).not.toContain("test test test test test test test test test test test junk");
    expect(serialized).not.toContain("correct horse battery staple");

    const parsed = parseBrowserVaultEnvelope(serialized);
    expect(parsed.id).toBe("primary");
    expect(await hasBrowserVault(storage)).toBe(true);

    const unlocked = await unlockBrowserVaultSession("correct horse battery staple", storage);
    expect(unlocked.state.groups).toHaveLength(1);
    expect(unlocked.state.groups[0].accounts[0].address).toMatch(/^0x[0-9a-fA-F]{40}$/);

    const nextState = {
      ...unlocked.state,
      groups: unlocked.state.groups.map((group) => ({
        ...group,
        name: "Renamed",
      })),
    };
    const saved = await saveBrowserVaultSession(unlocked, nextState, storage);
    expect(saved.state.groups[0].name).toBe("Renamed");
    expect(serializeBrowserVaultEnvelope(saved.envelope)).not.toContain("Renamed");
  });

  it("rejects wrong passwords and tampered ciphertext", async () => {
    const storage = createMemoryBrowserVaultStorage();
    const initialState = createInitialBrowserVaultState({ mnemonicPhrase: "test test test test test test test test test test test junk" });
    const created = await createBrowserVaultSession("correct horse battery staple", initialState, storage);

    await expect(unlockBrowserVaultSession("wrong password", storage)).rejects.toThrow(/unlock encrypted vault/i);

    const tampered = parseBrowserVaultEnvelope(serializeBrowserVaultEnvelope(created.envelope));
    tampered.ciphertext = tampered.ciphertext.slice(0, -2) + "AA";
    await storage.saveEnvelope(tampered);

    await expect(unlockBrowserVaultSession("correct horse battery staple", storage)).rejects.toThrow(/unlock encrypted vault/i);
  });

  it("verifies imported vault passwords before saving and never overwrites on failure", async () => {
    const existingStorage = createMemoryBrowserVaultStorage();
    const existingState = createInitialBrowserVaultState({ mnemonicPhrase: "test test test test test test test test test test test junk" });
    const existing = await createBrowserVaultSession("existing password", existingState, existingStorage);

    const importStorage = createMemoryBrowserVaultStorage();
    const importState = createInitialBrowserVaultState({ mnemonicPhrase: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about" });
    const imported = await createBrowserVaultSession("import password", importState, importStorage);

    await expect(importBrowserVaultEnvelope(imported.envelope, "wrong password", existingStorage, { overwriteExisting: true })).rejects.toThrow(
      /unlock encrypted vault/i,
    );
    expect((await existingStorage.loadEnvelope())?.ciphertext).toBe(existing.envelope.ciphertext);

    await expect(importBrowserVaultEnvelope(imported.envelope, "import password", existingStorage)).rejects.toThrow(/confirm overwrite/i);
    expect((await existingStorage.loadEnvelope())?.ciphertext).toBe(existing.envelope.ciphertext);

    const importedSession = await importBrowserVaultEnvelope(imported.envelope, "import password", existingStorage, {
      overwriteExisting: true,
    });
    expect(importedSession.state.groups[0].accounts[0].address).toBe(importState.groups[0].accounts[0].address);
    expect((await existingStorage.loadEnvelope())?.ciphertext).toBe(imported.envelope.ciphertext);
  });

  it("rejects imported vault envelopes below the current KDF policy", async () => {
    const storage = createMemoryBrowserVaultStorage();
    const state = createInitialBrowserVaultState({ mnemonicPhrase: "test test test test test test test test test test test junk" });
    const created = await createBrowserVaultSession("correct horse battery staple", state, storage);
    const weakEnvelope = JSON.parse(serializeBrowserVaultEnvelope(created.envelope)) as typeof created.envelope;
    weakEnvelope.kdf.iterations = BROWSER_VAULT_KDF_ITERATIONS - 1;

    await expect(importBrowserVaultEnvelope(weakEnvelope, "correct horse battery staple", createMemoryBrowserVaultStorage())).rejects.toThrow(
      /invalid encrypted vault envelope/i,
    );
  });
});
