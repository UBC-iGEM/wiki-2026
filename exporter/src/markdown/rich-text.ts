import { type Id, PageId } from "../notion";
import { ExporterError, isExporterErr } from "../utils";
import type { ConvertContext } from "./blocks";
import { citation } from "./citations";
import { pageMention, parseNotionUrl, resolveHref } from "./link";
import { jsxText } from "./mdx";
import type { RichTextItemResponse } from "@notionhq/client";
import type { PhrasingContent, Text } from "mdast";

/**
 * How line breaks are represented:
 * - `break`: a Markdown line break
 * - `jsx`: a `<br />` element, for places where a hard break is invalid (e.g. table cells)
 * - `space`: a plain space, for places that cannot hold a line break (e.g. headings)
 */
export type NewlineMode = "break" | "jsx" | "space";

/**
 * @property cite the literature entry linked text cites, by citation key, and the block the text is in
 */
interface TextProperties {
    cite: { key: string; block?: Id } | null;
    href: string | null;
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
}

/**
 * A piece of text and its properties.
 */
interface Leaf {
    node: PhrasingContent | "newline";
    props: TextProperties;
}

export function asPlainText(items: RichTextItemResponse[]): string {
    return items.map((item) => item.plain_text).join("");
}

/**
 * Converts Notion rich text into phrasing content. Text is kept literally (Markdown syntax typed into Notion is escaped).
 */
export async function convertRichText(
    items: RichTextItemResponse[],
    ctx: ConvertContext,
    newline: NewlineMode = "break",
): Promise<PhrasingContent[]> {
    const leaves = (await Promise.all(items.map((item) => itemLeaves(item, ctx)))).flat();
    trimLeaves(leaves);

    const newline_node: PhrasingContent =
        newline === "break" ? { type: "break" } : newline === "jsx" ? jsxText("br") : { type: "text", value: " " };
    const resolved = leaves.map((leaf) => ({ ...leaf, node: leaf.node === "newline" ? newline_node : leaf.node }));

    return applyProperties(resolved, 0);
}

async function itemLeaves(item: RichTextItemResponse, ctx: ConvertContext): Promise<Leaf[]> {
    const props: TextProperties = {
        cite: null,
        href: null,
        bold: item.annotations.bold,
        italic: item.annotations.italic,
        strikethrough: item.annotations.strikethrough,
        underline: item.annotations.underline,
    };

    switch (item.type) {
        case "text": {
            if (/%\\?\{[\s\S]*\}%/.test(item.text.content))
                new ExporterError(`Text contains an inline component, which is no longer supported.`, [
                    "malformed content",
                ]).warn(ctx);

            if (item.href) {
                const href_res = await resolveHref(item.href, ctx);
                if (isExporterErr(href_res)) href_res.warn(ctx);
                // Linked text cites the entry it links to
                else if (href_res.citation) props.cite = { key: href_res.citation.citation_key, block: ctx.block };
                else props.href = href_res.url;
            }

            if (item.annotations.code)
                return [{ node: { type: "inlineCode", value: item.text.content.replaceAll("\n", " ") }, props: props }];

            return item.text.content
                .split("\n")
                .flatMap((line, i): Leaf[] => [
                    ...(i > 0 ? [{ node: "newline" as const, props }] : []),
                    ...(line ? [{ node: { type: "text" as const, value: line }, props }] : []),
                ]);
        }
        case "equation":
            return [{ node: { type: "inlineMath", value: item.equation.expression }, props }];
        case "mention": {
            const mention = item.mention;

            let node: PhrasingContent;
            switch (mention.type) {
                case "link_mention":
                    node = {
                        type: "link",
                        url: mention.link_mention.href,
                        children: [{ type: "text", value: mention.link_mention.title ?? mention.link_mention.href }],
                    };
                    break;
                case "link_preview":
                    node = {
                        type: "link",
                        url: mention.link_preview.url,
                        children: [{ type: "text", value: mention.link_preview.url }],
                    };
                    break;
                case "page": {
                    // A mention of a block is a page mention whose URL names the block
                    const block_id = item.href ? parseNotionUrl(item.href)?.block : undefined;
                    const block = block_id ? { id: block_id, text: item.plain_text.trim() } : undefined;
                    const page_node_res = await pageMention(new PageId(mention.page.id), ctx, block);
                    if (isExporterErr(page_node_res)) {
                        page_node_res.warn(ctx);
                        return [];
                    }
                    node = page_node_res;
                    break;
                }
                case "date": {
                    const { start, end } = mention.date;
                    node = {
                        type: "text",
                        value: end ? `${formatDate(start)} to ${formatDate(end)}` : formatDate(start),
                    };
                    break;
                }
                default:
                    new ExporterError(
                        `A ${mention.type} mention ("${item.plain_text}") is unsupported and was ignored.`,
                        ["malformed content"],
                    ).warn(ctx);
                    return [];
            }
            return [{ node, props }];
        }
    }
}

/**
 * Formats a Notion date (`YYYY-MM-DD`, optionally with a time) as `DD/MM/YYYY` or `DD/MM/YYYY at HH:mm`.
 */
function formatDate(date: string): string {
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
    if (!match) return date;

    const [, year, month, day, hour, minute] = match;
    const formatted = `${day}/${month}/${year}`;
    return hour ? `${formatted} at ${hour}:${minute}` : formatted;
}

/**
 * Removes leading and trailing whitespace/line break leaves.
 */
function trimLeaves(leaves: Leaf[]): void {
    const trimEnd = (index: () => number, trim: (s: string) => string): void => {
        while (leaves.length > 0) {
            const i = index();
            const leaf = leaves[i]!;
            if (leaf.node !== "newline") {
                if (leaf.node.type !== "text") return;
                leaf.node = { ...leaf.node, value: trim(leaf.node.value) };
                if (leaf.node.value !== "") return;
            }
            leaves.splice(i, 1);
        }
    };

    trimEnd(
        () => 0,
        (s) => s.trimStart(),
    );
    trimEnd(
        () => leaves.length - 1,
        (s) => s.trimEnd(),
    );
}

interface TextProperty {
    /** Leaves with identical keys are wrapped together; `null` means the leaf is unstyled. */
    key(marks: TextProperties): string | null;
    /** Wrap `children` in a MDAST styling node. */
    wrap(marks: TextProperties, children: PhrasingContent[]): PhrasingContent;
    /** Whether whitespace must be moved out of the mark for it to stringify cleanly. */
    hoist_whitespace: boolean;
}

const PROP_GENERATORS: TextProperty[] = [
    {
        key: (m) => m.cite?.key ?? null,
        wrap: (m, children) => citation([m.cite!.key], m.cite!.block, children),
        hoist_whitespace: true,
    },
    {
        key: (m) => m.href,
        wrap: (m, children) => ({ type: "link", url: m.href!, children }),
        hoist_whitespace: false,
    },
    {
        key: (m) => (m.bold ? "" : null),
        wrap: (_, children) => ({ type: "strong", children }),
        hoist_whitespace: true,
    },
    {
        key: (m) => (m.italic ? "" : null),
        wrap: (_, children) => ({ type: "emphasis", children }),
        hoist_whitespace: true,
    },
    {
        key: (m) => (m.strikethrough ? "" : null),
        wrap: (_, children) => ({ type: "delete", children }),
        hoist_whitespace: true,
    },
    {
        key: (m) => (m.underline ? "" : null),
        wrap: (_, children) => jsxText("u", {}, children),
        hoist_whitespace: false,
    },
];

function applyProperties(leaves: { node: PhrasingContent; props: TextProperties }[], level: number): PhrasingContent[] {
    // The current property being applied
    const prop = PROP_GENERATORS[level];
    if (!prop) return leaves.map((leaf) => leaf.node);

    const output: PhrasingContent[] = [];
    let start = 0;
    while (start < leaves.length) {
        const key = prop.key(leaves[start]!.props);
        let end = start + 1;
        // Side-by-side regions with an identical property should join
        while (end < leaves.length && prop.key(leaves[end]!.props) === key) end++;

        const run = leaves.slice(start, end);
        // Try to apply the next property
        const children = applyProperties(run, level + 1);
        if (key === null) output.push(...children);
        else if (prop.hoist_whitespace)
            output.push(...wrapHoistingWhitespace(children, (c) => prop.wrap(run[0]!.props, c)));
        else output.push(prop.wrap(run[0]!.props, children));

        start = end;
    }

    return output;
}

/**
 * Emphasis cannot start or end with whitespace in Markdown, so move it outside the wrapping node.
 */
function wrapHoistingWhitespace(
    children: PhrasingContent[],
    wrap: (children: PhrasingContent[]) => PhrasingContent,
): PhrasingContent[] {
    const inner = [...children];
    let leading = "";
    let trailing = "";

    const first = inner[0];
    if (first?.type === "text") {
        const trimmed = first.value.trimStart();
        leading = first.value.slice(0, first.value.length - trimmed.length);
        if (trimmed) inner[0] = { type: "text", value: trimmed };
        else inner.shift();
    }

    const last = inner.at(-1);
    if (last?.type === "text") {
        const trimmed = last.value.trimEnd();
        trailing = last.value.slice(trimmed.length);
        if (trimmed) inner[inner.length - 1] = { type: "text", value: trimmed };
        else inner.pop();
    }

    const text = (value: string): Text[] => (value ? [{ type: "text", value }] : []);
    if (inner.length === 0) return text(leading + trailing);

    return [...text(leading), wrap(inner), ...text(trailing)];
}
