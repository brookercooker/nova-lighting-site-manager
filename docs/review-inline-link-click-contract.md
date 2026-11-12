# Inline Review Link Navigation

Manager now verifies links entirely in Step 2 rows; it never opens Check This Link.

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