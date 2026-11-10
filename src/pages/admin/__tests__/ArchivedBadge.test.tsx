import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import ArchivedBadge from "../ArchivedBadge";
it("marks archived rows and nothing else", () => {
  const { rerender } = render(<ArchivedBadge archived />);
  expect(screen.getByText("Archived")).toBeTruthy();
  rerender(<ArchivedBadge archived={false} />);
  expect(screen.queryByText("Archived")).toBeNull();
});
