import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { openFileInNewTab } from "./openFileInNewTab";

const threadRef = {
  environmentId: EnvironmentId.make("remote"),
  threadId: ThreadId.make("thread"),
};

function setup() {
  const tab = {
    opener: {} as unknown,
    closed: false,
    close: vi.fn(),
    location: { replace: vi.fn() },
  };
  const open = vi.fn(() => tab);
  vi.stubGlobal("window", { open });
  const createAssetUrl = vi.fn(async () =>
    AsyncResult.success({
      relativeUrl: "/api/assets/fresh/report.pdf",
      expiresAt: 1000,
    }),
  );
  const input = {
    threadRef,
    filePath: "/workspace/report.pdf",
    workspaceRoot: "/workspace",
    httpBaseUrl: "https://access.example.test/",
    createAssetUrl,
  };
  return { tab, open, input };
}

afterEach(() => vi.unstubAllGlobals());

describe("openFileInNewTab", () => {
  it("reserves an isolated tab before signing and preserves the environment's public origin", async () => {
    const { tab, open, input } = setup();
    input.createAssetUrl.mockImplementationOnce(async () => {
      expect(open).toHaveBeenCalledWith("about:blank", "_blank");
      expect(tab.opener).toBeNull();
      expect(tab.location.replace).not.toHaveBeenCalled();
      return AsyncResult.success({
        relativeUrl: "/api/assets/fresh/report.pdf",
        expiresAt: 1000,
      });
    });

    await openFileInNewTab(input);

    expect(input.createAssetUrl).toHaveBeenCalledWith({
      environmentId: threadRef.environmentId,
      input: {
        resource: {
          _tag: "workspace-file",
          threadId: threadRef.threadId,
          path: "/workspace/report.pdf",
        },
      },
    });
    expect(tab.location.replace).toHaveBeenCalledWith(
      "https://access.example.test/api/assets/fresh/report.pdf",
    );
    expect(tab.close).not.toHaveBeenCalled();
  });

  it("signs a file outside the workspace without exposing sibling files", async () => {
    const { input } = setup();

    await openFileInNewTab({ ...input, filePath: "/tmp/report.pdf" });

    expect(input.createAssetUrl).toHaveBeenCalledWith({
      environmentId: threadRef.environmentId,
      input: {
        resource: { _tag: "media-file", threadId: threadRef.threadId, path: "/tmp/report.pdf" },
      },
    });
  });

  it("reports blocked popups before requesting a URL", async () => {
    const { input } = setup();
    vi.stubGlobal("window", { open: () => null });

    await expect(openFileInNewTab(input)).rejects.toThrow("Allow popups");

    expect(input.createAssetUrl).not.toHaveBeenCalled();
  });

  it("closes the reserved tab when signing fails", async () => {
    const { tab, input } = setup();
    const error = new Error("File is missing.");

    await expect(
      openFileInNewTab({
        ...input,
        createAssetUrl: async () => AsyncResult.failure(Cause.fail(error)),
      }),
    ).rejects.toBe(error);

    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.replace).not.toHaveBeenCalled();
  });

  it("closes the reserved tab without reporting interrupted signing as an error", async () => {
    const { tab, input } = setup();

    await openFileInNewTab({
      ...input,
      createAssetUrl: async () => AsyncResult.failure(Cause.interrupt()),
    });

    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.replace).not.toHaveBeenCalled();
  });

  it("closes the reserved tab when signing rejects", async () => {
    const { tab, input } = setup();
    const error = new Error("Connection lost.");

    await expect(
      openFileInNewTab({
        ...input,
        createAssetUrl: async () => {
          throw error;
        },
      }),
    ).rejects.toBe(error);

    expect(tab.close).toHaveBeenCalledOnce();
    expect(tab.location.replace).not.toHaveBeenCalled();
  });

  it("closes the reserved tab if the environment URL cannot be resolved", async () => {
    const { tab, input } = setup();

    await expect(openFileInNewTab({ ...input, httpBaseUrl: "invalid" })).rejects.toThrow(
      "invalid asset URL",
    );

    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.replace).not.toHaveBeenCalled();
  });

  it("leaves a tab the user closed while signing closed", async () => {
    const { tab, input, open } = setup();
    input.createAssetUrl.mockImplementationOnce(async () => {
      tab.closed = true;
      return AsyncResult.success({ relativeUrl: "/api/assets/fresh/report.pdf", expiresAt: 1000 });
    });

    await openFileInNewTab(input);

    expect(tab.location.replace).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledOnce();
  });
});
