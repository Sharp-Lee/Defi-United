import { describe, expect, it } from "vitest";
import { createInitialBrowserVaultState } from "../core/browserVault/accounts";
import {
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
    await importBrowserVaultEnvelope(tampered, storage);

    await expect(unlockBrowserVaultSession("correct horse battery staple", storage)).rejects.toThrow(/unlock encrypted vault/i);
  });
});
