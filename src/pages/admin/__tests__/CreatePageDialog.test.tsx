import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import CreatePageDialog from "../CreatePageDialog";
const mocks = vi.hoisted(() => ({ insert: vi.fn(), created: vi.fn(), pages: [] as { path: string; name: string }[] }));
vi.mock("@/prototype/client", () => ({ supabase: { from: () => ({
  select: () => Promise.resolve({ data: mocks.pages }),
  insert: (body: unknown) => { mocks.insert(body); return { select: () => ({ single: async () => ({ data: { id: "qa", slug_id: "qa-temp", name: "QA Temp", path: "/qa-temp" } }) }) }; },
}) } }));
vi.mock("../designChat/contentSync", () => ({ notifyContentEdited: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.pages = []; });
it("creates new pages as Draft, not Ready", async () => {
  render(<CreatePageDialog open onOpenChange={vi.fn()} initialName="QA Temp" onCreated={mocks.created} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Create Page" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Create Page" }));
  await waitFor(() => expect(mocks.created).toHaveBeenCalledOnce());
  expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ name: "QA Temp", path: "/qa-temp", build_status: "draft" }));
});it("shows one message when a page with that name and address already exists", async () => {
  mocks.pages = [{ path: "/contact", name: "Contact" }];
  render(<CreatePageDialog open onOpenChange={vi.fn()} initialName="Contact" />);
  await screen.findByText(/A page named "Contact" already exists/);
  expect(screen.queryByText("A page with this address already exists.")).toBeNull();
});
