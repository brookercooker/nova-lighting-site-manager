# Review destination editing: Public companion

No new message name is required. Manager requests:

```ts
{ source: "nova-manager", type: "link-inventory-request", v: 1 }
```

Public replies after rendered links and draft overrides are ready:

```ts
{
  source: "nova-site", type: "link-inventory", v: 1, path: "/",
  links: [{
    key: "0.5.0.1", scope: "page", href: "/contact",
    label: "Book a Consultation", target: null,
    originalHref: "/contact",
    fingerprint: '{"v":1,"tag":"div","t":"<actual original hash>"}'
  }]
}
```

- Cap links at 500; normalize path to the rendered page path.
- key is the original editable numeric dotted path of the element that actually navigates, including a card wrapper; scope is `page` or `object:<registry UUID>`, not a display label or component name.
- href is the effective draft destination, preserving raw relative paths; target is explicitly null for same tab or `_blank` for new tab. Do not omit target.
- originalHref is the original coded destination before replay.
- fingerprint is a JSON string containing the verbatim core's original `Fingerprint` for this element, before replay; never hash current edited wording or synthesize a placeholder. Manager stores it as `fp:<key>` unchanged, only when an existing stored fingerprint is absent.
- Validate exact parent origin and event.source. Manager validates exact reply origin/window/path and never reads cross-origin DOM.
- The inventory must include the real navigation owner rather than every text descendant. Ambiguous matches fail closed to the existing Manual Edit fallback; matching label and page scope can disambiguate body from shared chrome.

Existing inventory consumers ignore these optional extra fields. The direct review writer requires known target and a valid existing or supplied fingerprint; until Public supplies them, it offers Open in Manual Edit and performs no direct write.

Manager uses the existing row-confirmed save helper with an updated_at compare, existing inline change summaries and contentSync. Successful saves reset native/local input undo, as successful Manual Save does; this does not introduce post-save database Undo or relay Undo.