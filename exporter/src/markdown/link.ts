import { Id, PageId } from "../notion";
import { ExporterError, isExporterErr, type ExporterResult } from "../utils";
import { findLiterature, type LitEntry } from "../zotero";
import type { ConvertContext } from "./blocks";
import { citation } from "./citations";
import { asPlainText } from "./rich-text";
import type { PhrasingContent } from "mdast";

/**
 * Converts a page mention or link into either an intra-wiki link or a citation.
 */
export async function pageMention(
    page: PageId,
    ctx: ConvertContext,
    block?: { id: Id; text: string },
): Promise<ExporterResult<PhrasingContent>> {
    const trashed = await trashedError(page);
    if (trashed) return trashed;

    const page_path = ctx.routes.get(page);
    if (page_path)
        return {
            type: "link",
            url: page_path.toURL(block?.id),
            children: [{ type: "text", value: block?.text || page_path.name().toString() }],
        };

    const entry = await literatureEntry(page);
    if (isExporterErr(entry)) return entry;
    if (!entry)
        return new ExporterError(`A link to a page that is neither a wiki page nor a literature entry was ignored.`, [
            "malformed content",
        ]);

    return citation([entry.citation_key], ctx.block);
}

/**
 * Where a link points: either a URL, or a literature entry it cites.
 */
type ResolvedHref = { url: string; citation?: undefined } | { citation: LitEntry };

/**
 * If a URL points to:
 * - a Notion page on the wiki, then replace it with the URL of that page (and block) on the wiki
 * - the Notion page of a literature entry, then cite it
 * - another URL, then return it unchanged
 */
export async function resolveHref(href: string, ctx: ConvertContext): Promise<ExporterResult<ResolvedHref>> {
    warnGoogleLink(href, ctx);
    const target = parseNotionUrl(href);
    if (!target) return { url: href };

    const trashed = target.page ? await trashedError(target.page) : undefined;
    if (trashed) return trashed;

    const page_path = target.page ? ctx.routes.get(target.page) : undefined;
    if (page_path) return { url: page_path.toURL(target.block) };

    const entry = target.page ? await literatureEntry(target.page) : undefined;
    if (isExporterErr(entry)) return entry;
    if (entry) return { citation: entry };

    const target_link = ExporterError.link({ with_label: "this Notion page", to: target.url });
    return new ExporterError(
        `A link to ${target_link} does not point to a known wiki page or literature entry; the link was ignored.`,
        ["malformed content"],
    );
}

/** Warns when an authored link points to Google Drive or Docs while leaving the link usable. */
export function warnGoogleLink(href: string, ctx: ConvertContext): void {
    let hostname: string;
    try {
        hostname = new URL(href).hostname.toLowerCase();
    } catch {
        return;
    }

    if (hostname !== "drive.google.com" && hostname !== "docs.google.com") return;

    const link = ExporterError.link({ with_label: hostname, to: href });
    new ExporterError(`A Google Drive or Docs link (${link}) was found; check that it is appropriate to publish.`, [
        "malformed content",
    ]).warn(ctx);
}

/**
 * The API still serves pages in Notion's trash, so links to them are refused here rather than followed.
 */
async function trashedError(page: PageId): Promise<ExporterError | undefined> {
    // Pages the exporter cannot read are reported by whatever goes on to look them up
    if ((await page.isTrashed()) !== true) return undefined;

    const page_link = ExporterError.link({ with_label: "a page", to: `https://app.notion.com/p/${page}` });
    return new ExporterError(`A link to ${page_link} in the Notion trash was ignored; link to the live page instead.`, [
        "malformed content",
    ]);
}

/**
 * @returns `url`: the absolute Notion URL, since Notion stores links to its own pages as relative paths.
 */
export function parseNotionUrl(href: string): { url: string; page?: PageId; block?: Id } | undefined {
    const NOTION_HOST = /(^|\.)notion\.(so|site|com)$/i;

    let url: URL;
    try {
        // Notion emits relative links (`/p/<id>`) for its own pages
        url = new URL(href, "https://app.notion.com");
    } catch {
        return undefined;
    }
    if (!NOTION_HOST.test(url.hostname)) return undefined;

    // Paths end in an ID, either bare or after a title slug, and with or without dashes
    const page_id = url.pathname.replaceAll("-", "").match(/([0-9a-f]{32})\/?$/i)?.[1];
    const block_id = url.hash.replaceAll("-", "").match(/^#([0-9a-f]{32})$/i)?.[1];

    return {
        url: url.href,
        page: page_id ? new PageId(page_id) : undefined,
        block: block_id ? new Id(block_id) : undefined,
    };
}

/**
 * The literature entry a Notion page is for, by its "Citation Key" property, or `undefined` if the page is not one.
 */
async function literatureEntry(page: PageId): Promise<ExporterResult<LitEntry | undefined>> {
    const property = await page.getProperty("Citation Key");
    if (isExporterErr(property) || !property) return undefined;

    if (property.type !== "rich_text")
        return new ExporterError(
            `Literature entry at Notion ID ${page} has a "Citation Key" property, but it is of type "${property.type}" instead of rich text.`,
            ["bug?", "notion server"],
        );

    const citation_key = asPlainText(property.rich_text).trim();
    if (!citation_key)
        return new ExporterError(`Page at Notion ID ${page} has an empty "Citation Key" property.`, [
            "bug?",
            "notion server",
        ]);

    return (
        findLiterature(citation_key) ??
        new ExporterError(
            `Literature entry at Notion ID ${page} has the citation key "${citation_key}", which is not in the Zotero library; the citation was ignored.`,
            ["malformed content", "zotero server"],
        )
    );
}
