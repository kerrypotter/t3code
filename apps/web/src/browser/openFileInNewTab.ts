import { mediaFileReference } from "@t3tools/client-runtime/media-reference";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  AssetCreateUrlResult,
  AssetResource,
  EnvironmentId,
  ScopedThreadRef,
} from "@t3tools/contracts";

/** Opens an environment file in the client's browser session using a fresh asset URL. */
export async function openFileInNewTab<E>(input: {
  readonly threadRef: ScopedThreadRef;
  readonly filePath: string;
  readonly workspaceRoot: string | undefined;
  readonly httpBaseUrl: string;
  readonly createAssetUrl: (input: {
    readonly environmentId: EnvironmentId;
    readonly input: { readonly resource: AssetResource };
  }) => Promise<AtomCommandResult<AssetCreateUrlResult, E>>;
}): Promise<void> {
  // Reserve the tab before signing the URL so slow remote connections do not
  // lose the menu click's user activation to the browser's popup blocker.
  const tab = window.open("about:blank", "_blank");
  if (!tab) throw new Error("Allow popups for T3 Code to open this file in a new tab.");
  tab.opener = null;
  try {
    const insideWorkspace =
      mediaFileReference(input.filePath, input.workspaceRoot).relativePath !== undefined;
    const result = await input.createAssetUrl({
      environmentId: input.threadRef.environmentId,
      input: {
        resource: {
          _tag: insideWorkspace ? "workspace-file" : "media-file",
          threadId: input.threadRef.threadId,
          path: input.filePath,
        },
      },
    });
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) {
        tab.close();
        return;
      }
      throw squashAtomCommandFailure(result);
    }
    const url = resolveAssetUrl(input.httpBaseUrl, result.value.relativeUrl);
    if (url === null) throw new Error("The environment returned an invalid asset URL.");
    if (!tab.closed) tab.location.replace(url);
  } catch (cause) {
    tab.close();
    throw cause;
  }
}
