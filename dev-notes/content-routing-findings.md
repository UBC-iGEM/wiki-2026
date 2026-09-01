# Content routing findings

## Implementation

- Content collection folder: `web/docs/`.
- Collection name: `docs`.
- Route file: `web/src/pages/[...page_path].astro`.
- The local Astro config currently has no `base`, so this PoC uses root-relative local routes.
- Production URL behavior is still a follow-up decision. It may require Astro `base`, exporter-prefixed links, or relative links.

## Route mapping

Actual `page.id` values are logged during `npm run build` with the prefix:

```txt
[content-routing-poc] docs collection route mappings
```

The route uses Astro's generated `page.id` directly unless it would conflict with the existing homepage. A top-level docs `index.mdx` maps to `/docs` instead of `/` because `web/src/pages/index.astro` already owns the root route.

Astro generated these IDs for the current exported docs, and they already match the desired local route paths:

| Source file | `page.id` | Route |
| --- | --- | --- |
| `web/docs/Test Aggregate Page/Test Content Page.mdx` | `test-aggregate-page/test-content-page` | `/test-aggregate-page/test-content-page` |
| `web/docs/Test Aggregate Page/Test Lab Notebook/Test Entry 1.mdx` | `test-aggregate-page/test-lab-notebook/test-entry-1` | `/test-aggregate-page/test-lab-notebook/test-entry-1` |
| `web/docs/Test Aggregate Page/Test Lab Notebook/Test Entry 2.mdx` | `test-aggregate-page/test-lab-notebook/test-entry-2` | `/test-aggregate-page/test-lab-notebook/test-entry-2` |

No custom `generateId` function was needed.

## Internal links

For the local PoC, internal Markdown links should be root-relative and should not include `/ubc-vancouver`, for example:

```md
[Page](/test-aggregate-page/test-content-page)
```

This is not the final production link contract.

The current exported test content still contains older internal links such as:

```md
[Test Entry 1](<Test Aggregate Page/Test Lab Notebook/Test Entry 1>)
```

Those render as encoded relative links in the built HTML, not as the new slug routes. That does not block the routing PoC, but production integration should update exporter link generation once the final URL/base-path strategy is chosen.

## Export status

`npm run export` succeeded after rerunning outside the sandbox. The first sandboxed attempt failed before Notion access because `tsx` could not create its IPC pipe.

The fresh export confirmed the isolated exporter fix for MDX-safe component attributes. Generated figure props now use MDX expression syntax, for example `imgs={...}`, which is required for the current exported MDX to build.

## Validation

- `npm run export`: passed outside the sandbox.
- `npm run build`: passed; produced the three docs routes listed above plus the existing homepage.
- `npm run check`: passed with two existing hints in `web/src/components/navbar.astro`.
- `npm run lint`: passed.
- `npm run validate`: passed.
- `npm run dev`: passed outside the sandbox; local smoke tests returned `200 OK` for all three docs routes.

## Production follow-up

- Decide the final production base path and internal link strategy.
- Decide whether exporter output should emit already-slugified file paths or whether Astro routing should keep slugifying source paths.
- Add real wiki components for exported custom MDX tags when design requirements are ready.
- Clean up the Astro MDX deprecation warning by moving `remark-math` configuration to Astro's recommended markdown processor setup. This was not done in the PoC because the warning does not block build output and would require adding a direct `@astrojs/markdown-remark` dependency.
