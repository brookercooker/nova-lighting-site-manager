import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ErrorText from "../errorText";

const sql = `Your Site Manager edits couldn't be copied to the live site, so nothing was published. the builder API error: 400 query_error: Failed to run sql query: ERROR: 23514: new row for relation "object_registry" violates check constraint PL/pgSQL function apply_content_package(jsonb,text) line 48 at SQL statement Try sending it again in a moment.`;

describe("ErrorText", () => {
  it("shows the friendly sentence and retry line, hiding SQL in a closed disclosure", () => {
    const { container } = render(<div><ErrorText text={sql} /></div>);
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain("query_error");
    expect(details.textContent).not.toContain("couldn't be copied");
    const visible = container.firstElementChild!.textContent!.replace(details.textContent!, "");
    expect(visible).toContain("so nothing was published.");
    expect(visible).toContain("Try sending it again in a moment.");
    expect(visible).not.toContain("object_registry");
    expect(screen.getByText("Technical Details")).toBeTruthy();
    const chevron = screen.getByTestId("details-chevron");
    expect(details.querySelector("summary")!.contains(chevron)).toBe(true);
    expect(chevron.getAttribute("class")).toContain("group-open:rotate-90");
  });
  it("leaves a plain message unchanged", () => {
    const { container } = render(<div><ErrorText text="The change couldn't finish. Try again." /></div>);
    expect(container.firstElementChild!.innerHTML).toBe("The change couldn't finish. Try again.");
  });
});
