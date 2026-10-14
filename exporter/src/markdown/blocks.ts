import type { ContentMap } from "../map";
import { Id, PageId, type NotionBlock } from "../notion";
import { ExporterError, isExporterErr, type WarningContext } from "../utils";
import { COMPONENT_MAP, componentDocSuggestion } from "./components";
import { pageMention } from "./link";
import { anchorFlow, anchorText, jsxFlow, jsxInlineBlock, type FlowContent } from "./mdx";
import { uploadMedia } from "./media";
import { convertRichText, asPlainText } from "./rich-text";
import type { RichTextItemResponse } from "@notionhq/client";
import type { Heading, List, ListItem, Paragraph, PhrasingContent, Table, TableRow } from "mdast";

export interface ConvertContext extends WarningContext {
    routes: ContentMap;
}

/**
 * The context for converting `block`, so warnings point at it.
 */
export function blockContext(ctx: ConvertContext, block: { id: string }): ConvertContext {
    return { ...ctx, block: new Id(block.id) };
}

/**
 * A block, or a component parsed from the blocks between its markers.
 */
export type Item = NotionBlock | ComponentItem;
interface ComponentItem {
    type: "component";
    name: string;
    start: NotionBlock;
    items: Item[];
}

/**
 * Sibling items that convert to a single MDAST node.
 */
type ItemGroup = { type: "item"; item: Item } | { type: "list"; kind: ListKind; blocks: NotionBlock[] };

type ListKind = "bulleted_list_item" | "numbered_list_item" | "to_do";
const LIST_KINDS: string[] = ["bulleted_list_item", "numbered_list_item", "to_do"] satisfies ListKind[];

const COMPONENT_DOCS =
    "https://app.notion.com/p/ubcigem/Components-395d65dd82be8024b1dbe3fb07e95219?source=copy_link#395d65dd82be80ac838ef0a1375455cf";

/**
 * Converts a list of blocks into MDAST.
 */
export async function convertBlocks(blocks: NotionBlock[], ctx: ConvertContext): Promise<FlowContent[]> {
    return convertItems(parseItems(blocks, { i: 0 }, ctx, null).items, ctx);
}

/**
 * Converts a list of sibling items into MDAST; components have already been parsed into a {@link ComponentItem}.
 */
export async function convertItems(items: Item[], ctx: ConvertContext): Promise<FlowContent[]> {
    const converted = await Promise.all(groupItems(items).map((group) => convertGroup(group, ctx)));
    return converted.flat();
}

/**
 * Parse `block` as a start/end marker for a component.
 */
function componentMarker(block: NotionBlock): { type: "start"; name: string } | { type: "end" } | undefined {
    if (block.type !== "quote" || block.children.length > 0) return undefined;

    const text = asPlainText(block.quote.rich_text).trim();
    if (text.toLowerCase() === "end") return { type: "end" };

    const name = text.match(/^START(?:\s+([\s\S]*))?$/i);
    // An empty name (a bare START) is reported by `parseItems`
    if (name) return { type: "start", name: (name[1] ?? "").replace(/\s+/g, "").toLowerCase() };
}

/**
 * Consumes blocks from `pos` until the END of the component `open` (or the end of the list), parsing nested components.
 *
 * @returns `closed`: whether a matching END was consumed.
 */
function parseItems(
    blocks: NotionBlock[],
    pos: { i: number },
    ctx: ConvertContext,
    open: string | null,
): { items: Item[]; closed: boolean } {
    const items: Item[] = [];

    while (pos.i < blocks.length) {
        const block = blocks[pos.i++]!;
        const marker = componentMarker(block);

        if (marker?.type === "end") {
            if (open !== null) return { items, closed: true };
            warnMarker(blockContext(ctx, block), "an END block has no matching START");
            continue;
        }

        if (marker?.type === "start") {
            const inner = parseItems(blocks, pos, ctx, marker.name);
            if (marker.name === "") {
                // Keep the content, as if the markers were absent
                warnMarker(blockContext(ctx, block), "a START block does not name a component");
                items.push(...inner.items);
            } else if (inner.closed) {
                items.push({ type: "component", name: marker.name, start: block, items: inner.items });
            } else {
                // Keep the content, as if the marker were absent
                warnMarker(blockContext(ctx, block), `a START ${marker.name} block has no matching END`);
                items.push(...inner.items);
            }
            continue;
        }

        items.push(block);
    }

    return { items, closed: false };
}

/**
 * Group list items (bulleted, numbered, todo) together.
 */
function groupItems(items: Item[]): ItemGroup[] {
    const groups: ItemGroup[] = [];

    for (const item of items) {
        if (item.type !== "component" && LIST_KINDS.includes(item.type)) {
            const last = groups.at(-1);
            if (last?.type === "list" && last.kind === item.type) last.blocks.push(item);
            else groups.push({ type: "list", kind: item.type as ListKind, blocks: [item] });
            continue;
        }

        groups.push({ type: "item", item });
    }

    return groups;
}

function warnMarker(ctx: ConvertContext, problem: string): void {
    new ExporterError(
        `Component not understood: ${problem}. The marker was ignored.` + componentDocSuggestion(COMPONENT_DOCS),
        ["malformed content"],
    ).warn(ctx);
}

async function convertGroup(group: ItemGroup, ctx: ConvertContext): Promise<FlowContent[]> {
    if (group.type === "list") return [await convertList(group.kind, group.blocks, ctx)];

    const item = group.item;
    if (item.type !== "component") return convertBlock(item, ctx);

    // Problems with the component as a whole point at its START marker
    const component_ctx = blockContext(ctx, item.start);
    const parseComponent = COMPONENT_MAP[item.name];
    if (!parseComponent) {
        new ExporterError(
            `Block component type "${item.name}" could not be understood; see all options ${ExporterError.link({ with_label: "here", to: COMPONENT_DOCS })}.`,
            ["malformed content"],
        ).warn(component_ctx);
        return [];
    }

    const res = await parseComponent({ items: item.items, ctx: component_ctx });
    if (isExporterErr(res)) {
        res.warn(component_ctx);
        return [];
    }

    return [anchorFlow(new Id(item.start.id)), ...res];
}

/**
 * Converts a block's own content and its children.
 */
async function convertBlock(block: NotionBlock, parent_ctx: ConvertContext): Promise<FlowContent[]> {
    const ctx = blockContext(parent_ctx, block);
    const anchor = ctx.block!;
    const children = (): Promise<FlowContent[]> => convertBlocks(block.children, ctx);

    const textParagraphNode = async (rich_text: RichTextItemResponse[]): Promise<Paragraph> => ({
        type: "paragraph",
        children: [anchorText(anchor), ...(await convertRichText(rich_text, ctx))],
    });

    switch (block.type) {
        case "paragraph": {
            if (/^\s*%{2,}\s*(START|END)/im.test(asPlainText(block.paragraph.rich_text)))
                warnMarker(
                    ctx,
                    `"%% START" / "%% END" paragraphs are no longer supported, use a quote block containing only "START <name>" or "END"`,
                );

            const text = await convertRichText(block.paragraph.rich_text, ctx);
            // Empty paragraphs are used for vertical spacing
            const own: FlowContent =
                text.length === 0
                    ? jsxFlow("br", { id: anchor.toString() })
                    : { type: "paragraph", children: [anchorText(anchor), ...text] };

            // Children are placed after the paragraph, at the same level
            return [own, ...(await children())];
        }
        case "heading_1":
        case "heading_2":
        case "heading_3":
        case "heading_4": {
            const heading_data =
                block.type === "heading_1"
                    ? block.heading_1
                    : block.type === "heading_2"
                      ? block.heading_2
                      : block.type === "heading_3"
                        ? block.heading_3
                        : block.heading_4;
            const heading: Heading = {
                type: "heading",
                depth: Number(block.type.at(-1)) as Heading["depth"],
                children: [anchorText(anchor), ...(await convertRichText(heading_data.rich_text, ctx, "space"))],
            };
            if (!heading_data.is_toggleable) {
                return [heading];
            } else {
                // The heading stays a real heading inside the dropdown summary
                return [jsxFlow("details", {}, [jsxFlow("summary", {}, [heading]), ...(await children())])];
            }
        }
        case "toggle":
            return [
                jsxFlow("details", {}, [
                    jsxInlineBlock("summary", {}, [
                        anchorText(anchor),
                        ...(await convertRichText(block.toggle.rich_text, ctx)),
                    ]),
                    ...(await children()),
                ]),
            ];
        case "quote":
            return [
                {
                    type: "blockquote",
                    children: [await textParagraphNode(block.quote.rich_text), ...(await children())],
                },
            ];
        case "callout": {
            const icon = block.callout.icon?.type === "emoji" ? block.callout.icon.emoji : "";
            return [
                jsxFlow("Callout", { icon }, [await textParagraphNode(block.callout.rich_text), ...(await children())]),
            ];
        }
        case "code":
            return [
                anchorFlow(anchor),
                {
                    type: "code",
                    lang: block.code.language === "plain text" ? null : block.code.language,
                    value: asPlainText(block.code.rich_text),
                },
            ];
        case "equation":
            return [anchorFlow(anchor), { type: "math", value: block.equation.expression }];
        case "divider":
            return [anchorFlow(anchor), { type: "thematicBreak" }];
        case "image": {
            const url = await uploadMedia(block);
            if (isExporterErr(url)) {
                url.warn(ctx);
                return [];
            }

            // Captions are used as alt text
            const alt = asPlainText(block.image.caption).trim();
            return [{ type: "paragraph", children: [anchorText(anchor), { type: "image", url, alt }] }];
        }
        case "table":
            return [anchorFlow(anchor), await convertTable(block, ctx)];
        case "synced_block":
            return [anchorFlow(anchor), ...(await children())];
        case "link_to_page": {
            const target = block.link_to_page;
            if (target.type !== "page_id") {
                new ExporterError(
                    `A link to a ${target.type === "database_id" ? "database" : "comment"} is unsupported and was ignored.`,
                    ["malformed content"],
                ).warn(ctx);
                return [];
            }

            const link = await pageMention(new PageId(target.page_id), ctx);
            if (isExporterErr(link)) {
                link.warn(ctx);
                return [];
            }
            return [{ type: "paragraph", children: [anchorText(anchor), link] }];
        }
        case "link_preview": {
            return [
                {
                    type: "paragraph",
                    children: [
                        anchorText(anchor),
                        {
                            type: "link",
                            url: block.link_preview.url,
                            children: [{ type: "text", value: block.link_preview.url }],
                        },
                    ],
                },
            ];
        }
        default:
            new ExporterError(`Block of type ${block.type} is unsupported and was discarded.`, [
                "malformed content",
            ]).warn(ctx);
            return [];
    }
}

async function convertList(kind: ListKind, blocks: NotionBlock[], ctx: ConvertContext): Promise<List> {
    const items = await Promise.all(
        blocks.map(async (block): Promise<ListItem> => {
            const item_ctx = blockContext(ctx, block);
            const data =
                block.type === "numbered_list_item"
                    ? block.numbered_list_item
                    : block.type === "to_do"
                      ? block.to_do
                      : block.type === "bulleted_list_item"
                        ? block.bulleted_list_item
                        : undefined;
            const text: PhrasingContent[] = data ? await convertRichText(data.rich_text, item_ctx) : [];

            return {
                type: "listItem",
                spread: false,
                checked: block.type === "to_do" ? block.to_do.checked : undefined,
                children: [
                    { type: "paragraph", children: [anchorText(item_ctx.block!), ...text] },
                    ...(await convertBlocks(block.children, item_ctx)),
                ],
            };
        }),
    );

    const ordered = kind === "numbered_list_item";
    return { type: "list", ordered, start: ordered ? 1 : undefined, spread: false, children: items };
}

async function convertTable(block: Extract<NotionBlock, { type: "table" }>, ctx: ConvertContext): Promise<Table> {
    const width = block.table.table_width;

    const rows = await Promise.all(
        block.children.map(async (row): Promise<TableRow> => {
            if (row.type !== "table_row") return { type: "tableRow", children: [] };

            const row_ctx = blockContext(ctx, row);
            const cells = await Promise.all(row.table_row.cells.map((cell) => convertRichText(cell, row_ctx, "jsx")));
            return {
                type: "tableRow",
                children: cells.map((children, i) => ({
                    type: "tableCell",
                    // Rows get an anchor in their first cell
                    children: i === 0 ? [anchorText(row_ctx.block!), ...children] : children,
                })),
            };
        }),
    );

    if (!block.table.has_column_header) {
        // Markdown tables require a header row, so insert a blank one if missing
        rows.unshift({
            type: "tableRow",
            children: Array.from({ length: width }, () => ({ type: "tableCell", children: [] })),
        });
    }

    return { type: "table", align: Array.from({ length: width }, () => null), children: rows };
}
