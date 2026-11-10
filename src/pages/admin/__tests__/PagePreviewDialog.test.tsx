import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../signedThumb", () => ({ usePageThumbSrc: () => null }));
vi.mock("../useThumbnailCapture", () => ({ regenerateThumbnail: vi.fn() }));
vi.mock("../siteManifest", () => ({ draftEmbedUrl: () => null }));
import PagePreviewDialog from "../PagePreviewDialog";
import { DEFAULT_PUBLIC_PREVIEW } from "../designChat/publicPreviewUrl";
afterEach(cleanup);
it("previews the page on the public site, never the Site Manager's own address", () => {
  render(<PagePreviewDialog page={{ kind: "page", id: "x", name: "Experiment", path: "/draft/experiment" } as never} onClose={vi.fn()} />);
  const frame = document.querySelector("iframe")!;
  expect(new URL(frame.src).origin).toBe(new URL(import.meta.env.VITE_PUBLIC_SITE_URL || DEFAULT_PUBLIC_PREVIEW).origin);
  expect(new URL(frame.src).pathname).toBe("/draft/experiment");
});
