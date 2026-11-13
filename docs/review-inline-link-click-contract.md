# Inline Review Link Navigation

The Submit for Review steps are Design Check, Verify Links and Submit. Manager verifies links entirely in Verify Links rows; it never opens a link-check dialog.

## Public Companion Required for All-Link Navigation Suppression

Manager sends the existing protocol v2 message, with one additive flag:

```json
{
  "source": "nova-manager",
  "type": "link-check",
  "enabled": true,
  "interceptAll": true,
  "links": [{ "raw": "/contact", "state": "todo" }]
}
```

While enabled with `interceptAll: true`, Public must intercept **all** link clicks in capture phase, prevent default navigation and stop visitor handlers (including new-tab links). Highlight only entries in `links`, as today. Links not in the changed list must not navigate either.

Public replies using the existing trusted v2 link-click shape:

```json
{
  "source": "nova-site",
  "type": "link-click",
  "v": 2,
  "raw": "/contact",
  "href": "https://public-preview.example/contact",
  "kind": "internal",
  "label": "Contact",
  "path": "/",
  "match": "/contact"
}
```

Set `match` to the listed raw value for changed links; set **`match: null`** for unchanged links. Keep `raw`, `href`, `kind`, `label`, and `path` valid under the current contract. Manager validates the exact iframe window/origin before opening the sidebar and selecting the row or showing the unchanged-link note. Manager does not navigate the preview in response.

Continue answering `link-check-ready` with `{source:"nova-site",type:"link-check-ready",v:2,enabled:true}` and fully remove interception when Manager sends `enabled:false`. Frames ignoring `interceptAll` retain their old behavior; Manager cannot cancel navigation inside a cross-origin iframe. The Public change is therefore required to guarantee that unchanged links never navigate away during review.
## Manager Readiness and Diagnostics

Manager installs its listener before sending link-check. A valid v2 click from the exact currently shown frame window/origin is accepted while review is active even before link-check-ready; readiness is not an additional click gate. Unchanged clicks must explicitly include match:null (missing match is rejected). Development builds log [review-link] received link-click with v/match/raw/href/kind/path and accepted, with preview credentials redacted; wrong windows/origins are never logged.

Real Public ca608cd9 message capture at 375px was attempted from the authenticated Manager in this sandbox. The design service was unavailable and the real Public frame refused connection, including a direct real-frame probe. No link-click payload was observed, so the actual unchanged-card payload shape remains unverified; do not infer it from the example above.

## Status Count Ownership

Status displays the relay's authoritative publish.open / draft.requests, not a computed link-difference count. Review saves send /content/sync through the existing durable queue. Its current contract accepts change description lines, with no cancellation or baseline identifier. A destination changed back to its opening value is not enough to prove zero pending changes (the opening draft may already differ from live). Netting already accepted requests must be handled by the relay against its accepted/live content baseline; Manager must not subtract two requests locally or hide unrelated pending changes.
