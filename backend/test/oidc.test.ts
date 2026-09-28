import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../src/config.js";
import { rotateCompromisedKeyOIDC } from "../src/oidc.js";

const original = { endpoint: config.rotationEndpoint, file: config.oidcTokenFile };
afterEach(() => { config.rotationEndpoint = original.endpoint; config.oidcTokenFile = original.file; vi.restoreAllMocks(); });

describe("OIDC credential rotation", () => {
  it("skips cleanly when rotation is not configured", async () => {
    config.rotationEndpoint = undefined; config.oidcTokenFile = undefined;
    await expect(rotateCompromisedKeyOIDC("match")).resolves.toMatchObject({ status: "skipped" });
  });
  it("uses a workload identity token without exposing credentials", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentguard-oidc-"));
    const tokenFile = join(directory, "token"); await writeFile(tokenFile, "workload-token\n");
    config.rotationEndpoint = "https://rotation.example.test/rotate"; config.oidcTokenFile = tokenFile;
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    await expect(rotateCompromisedKeyOIDC("credential-pattern-detected", "gcp")).resolves.toMatchObject({ status: "rotated", provider: "gcp" });
    expect(request).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer workload-token" }) }));
    await rm(directory, { recursive: true });
  });
});
