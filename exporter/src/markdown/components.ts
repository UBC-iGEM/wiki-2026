import { fetchNotebook, parseColabFileId } from "../colab";
import type { NotionBlock } from "../notion";
import { fetchFileText, parsePlate, type Plate } from "../platemap";
import { ExporterError, isExporterErr, type ExporterResult } from "../utils";
import { blockContext, convertBlocks, convertItems, type ConvertContext, type Item } from "./blocks";
import { jsxFlow, jsxInlineBlock, type FlowContent, type JsxAttrs } from "./mdx";
import { mediaFileName, uploadMedia } from "./media";
import { asPlainText, convertRichText } from "./rich-text";
import type { Heading, Image, PhrasingContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

/**
 * Support for block components.
 *
 * Example:
 * > START COMPONENT
 * ...content
 * > END
 *
 * The items between the markers are passed to the component's handler; nested components arrive already parsed.
 */

export interface ComponentInput {
    items: Item[];
    ctx: ConvertContext;
}
type ComponentOutput = Promise<ExporterResult<FlowContent[]>>;

/**
 * A [name -> handler function] map for all possible component types.
 * Names are matched case-insensitively with whitespace removed.
 */
export const COMPONENT_MAP: Record<string, (input: ComponentInput) => ComponentOutput> = {
    figure,
    dbtl,
    carousel,
    model3d,
    ihp,
    colab,
    platemap,
    skip,
};

// ====================
// FIGURE COMPONENT
// ====================

export interface FigureAttrs {
    imgs: { url: string; alt: string }[];
}
export const FIGURE_SLOTS = ["content"] as const;
type FigureSlots = SlotRecord<typeof FIGURE_SLOTS>;

async function figure({ items, ctx }: ComponentInput): ComponentOutput {
    // A figure starts with one or more images, followed by its description
    const content = trimBlank(items);
    const image_blocks: ImageBlock[] = [];
    while (content[0]?.type === "image" || (content[0] && isBlank(content[0]) && image_blocks.length > 0)) {
        const block = content.shift()!;
        if (block.type === "image") image_blocks.push(block);
    }

    if (image_blocks.length === 0)
        return new ExporterError(
            `Figure component could not be understood: it does not start with images.` +
                componentDocSuggestion(
                    "https://app.notion.com/p/ubcigem/Components-395d65dd82be8024b1dbe3fb07e95219?source=copy_link#395d65dd82be80849d9eff853d8453a2",
                ),
            ["malformed content"],
        );

    const imgs = (await Promise.all(image_blocks.map((block) => imageAttr(block, ctx)))).filter((img) => img !== null);

    return generateComponent<FigureAttrs, FigureSlots>({
        tag: "Figure",
        attrs: { imgs },
        slots: { content: await convertItems(trimBlank(content), ctx) },
    });
}

// ====================
// DBTL COMPONENT
// ====================

type DbtlAttrs = Record<string, never>;
export const DBTL_SLOTS = ["design", "build", "test", "learn"] as const;
type DbtlSlots = SlotRecord<typeof DBTL_SLOTS>;

async function dbtl({ items, ctx }: ComponentInput): ComponentOutput {
    const sections = splitOnDividers(items);

    if (sections.length !== 4)
        return new ExporterError(
            `DBTL component could not be understood: it does not have 4 sections separated by dividers.` +
                componentDocSuggestion(
                    "https://app.notion.com/p/ubcigem/Components-395d65dd82be8024b1dbe3fb07e95219?source=copy_link#395d65dd82be805ea14ed9af6aaeff99",
                ),
            ["malformed content"],
        );

    const [design, build, test, learn] = (await Promise.all(
        sections.map((section) => convertItems(trimBlank(section), ctx)),
    )) as [FlowContent[], FlowContent[], FlowContent[], FlowContent[]];

    return generateComponent<DbtlAttrs, DbtlSlots>({
        tag: "Dbtl",
        attrs: {},
        slots: { design, build, test, learn },
    });
}

// ====================
// MODEL3D COMPONENT
// ====================

interface Model3dAttrs {
    url: string;
}
export const MODEL3D_SLOTS = ["content"] as const;
type Model3dSlots = SlotRecord<typeof MODEL3D_SLOTS>;

async function model3d({ items, ctx }: ComponentInput): ComponentOutput {
    const [file_block, ...following_content] = trimBlank(items);
    if (file_block?.type !== "file") return malformedModel3d("it does not start with an uploaded file");

    if (!/\.gl(?:b|tf)$/i.test(mediaFileName(file_block)))
        return malformedModel3d("its uploaded file is not a .glb or .gltf model");

    const url = await uploadMedia(file_block, { keep_original_file: true });
    if (isExporterErr(url)) return url;

    return generateComponent<Model3dAttrs, Model3dSlots>({
        tag: "Model3D",
        attrs: { url },
        slots: { content: await convertItems(following_content, ctx) },
    });
}

function malformedModel3d(problem: string): ExporterError {
    return new ExporterError(
        `Model3D component could not be understood: ${problem}.` +
            componentDocSuggestion(
                "https://app.notion.com/p/ubcigem/Components-395d65dd82be8024b1dbe3fb07e95219?source=copy_link",
            ),
        ["malformed content"],
    );
}

// ====================
// CAROUSEL COMPONENT
// ====================

export interface CarouselAttrs {
    slides: { url: string; alt: string }[];
}
export const CAROUSEL_SLOTS = ["descriptions"] as const;
type CarouselSlots = SlotRecord<typeof CAROUSEL_SLOTS>;

async function carousel({ items, ctx }: ComponentInput): ComponentOutput {
    // Each slide starts with an image, followed by its description
    const sections = splitOnDividers(items).map(trimBlank);

    const malformed_slide = sections.findIndex((section) => section[0]?.type !== "image");
    if (malformed_slide !== -1)
        return new ExporterError(
            `Carousel component could not be understood: slide ${malformed_slide + 1} does not start with an image.` +
                componentDocSuggestion(
                    "https://www.notion.so/ubcigem/Components-395d65dd82be8024b1dbe3fb07e95219?v=390d65dd82be80879bd4000c8f0deedc&source=copy_link#3add65dd82be8004a504cb122ae5ca7b",
                ),
            ["malformed content"],
        );

    const converted = await Promise.all(
        sections.map(async ([image, ...description]) => ({
            slide: await imageAttr(image as ImageBlock, ctx),
            description: await convertItems(trimBlank(description), ctx),
        })),
    );

    // Slides whose image failed to upload are dropped, along with their description
    const kept = converted.filter((item) => item.slide !== null);
    const slides = kept.map((item) => item.slide!);
    const descriptions = kept.map((item, i) =>
        jsxFlow("div", { class: "carousel-desc", "data-index": `${i}` }, item.description),
    );

    return generateComponent<CarouselAttrs, CarouselSlots>({
        tag: "ImageCarousel",
        attrs: { slides },
        slots: { descriptions },
    });
}

// ====================
// IHP COMPONENT
// ====================

/** Each person's card arrives pre-built in the `people` slot; the component counts them in the browser. */
export type IHPAttrs = Record<string, never>;
export const IHP_SLOTS = ["people"] as const;
type IHPSlots = SlotRecord<typeof IHP_SLOTS>;

async function ihp({ items, ctx }: ComponentInput): ComponentOutput {
    // One or more people separated by dividers, each:
    // a paragraph with their name, an optional image, a callout describing them, then anything else
    const sections = splitOnDividers(items).map(trimBlank);
    const cards: FlowContent[] = [];

    for (const [i, section] of sections.entries()) {
        const position = sections.length > 1 ? ` (person ${i + 1})` : "";
        const [name_block, ...rest] = section;
        const name = name_block?.type === "paragraph" ? asPlainText(name_block.paragraph.rich_text).trim() : "";
        if (name === "") return malformedIHP(`it does not start with a paragraph holding the person's name${position}`);

        const image_block = rest[0]?.type === "image" ? rest.shift() : undefined;
        const callout_block = rest.shift();
        if (callout_block?.type !== "callout")
            return malformedIHP(`the name "${name}" must be followed by an optional image, then a callout`);

        const image = image_block?.type === "image" ? await imageAttr(image_block, ctx) : null;
        const callout_ctx = blockContext(ctx, callout_block);
        const description_text = await convertRichText(callout_block.callout.rich_text, callout_ctx);
        const description: FlowContent[] = [
            ...(asPlainText(callout_block.callout.rich_text).trim() === ""
                ? []
                : [{ type: "paragraph", children: description_text } as const]),
            ...(await convertBlocks(callout_block.children, callout_ctx)),
        ];

        // The card's markup is built here, so each person's content stays with their name and image
        cards.push(
            jsxFlow("div", { class: "ihp-card glow-panel", "data-index": `${i}` }, [
                jsxFlow("div", { class: "ihp-card-body glow-panel-body" }, [
                    jsxInlineBlock("div", { class: "ihp-name" }, [{ type: "text", value: name }]),
                    jsxFlow("div", { class: "ihp-profile" }, [
                        ...(image
                            ? [jsxFlow("img", { class: "ihp-photo", src: image.url, alt: image.alt || name })]
                            : []),
                        jsxFlow("div", { class: "ihp-desc" }, description),
                    ]),
                    jsxFlow("div", { class: "ihp-content" }, await convertItems(trimBlank(rest), ctx)),
                ]),
            ]),
        );
    }

    return generateComponent<IHPAttrs, IHPSlots>({
        tag: "IHP",
        attrs: {},
        slots: { people: cards },
    });
}

function malformedIHP(problem: string): ExporterError {
    return new ExporterError(
        `iHP component could not be understood: ${problem}.` +
            componentDocSuggestion(
                "https://app.notion.com/p/ubcigem/Wiki-Components-395d65dd82be8024b1dbe3fb07e95219?source=copy_link#3edd65dd82be80e4bf00e818b654a00d",
            ),
        ["malformed content"],
    );
}

// ====================
// COLAB COMPONENT
// ====================

export interface ColabAttrs {
    /** The notebook on the web, for running. */
    url: string;
}
export const COLAB_SLOTS = ["notebook", "content"] as const;
type ColabSlots = SlotRecord<typeof COLAB_SLOTS>;

const notebookMarkdownParser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

async function colab({ items, ctx }: ComponentInput): ComponentOutput {
    // A link to the notebook, followed by its description
    const [link_block, ...content] = trimBlank(items);
    const url = link_block === undefined ? undefined : blockLink(link_block);
    const file_id = url === undefined ? undefined : parseColabFileId(url);
    if (url === undefined || file_id === undefined)
        return malformedColab("it does not start with a Colab notebook link");

    const notebook = await fetchNotebook(file_id);
    if (isExporterErr(notebook)) return notebook;

    // Markdown cells each get their own box; code cells are shown as code blocks
    const dropped = new Set<string>();
    const cells: FlowContent[] = [];
    for (const [i, cell] of notebook.cells.entries()) {
        if (cell.cell_type === "code") {
            cells.push({ type: "code", lang: notebook.language, value: cell.source });
        } else if (cell.cell_type === "markdown") {
            const root = notebookMarkdownParser.parse(cell.source);
            const children = sanitizeNotebookMarkdown(root.children as FlowContent[], dropped);
            cells.push(jsxFlow("div", { class: "colab-markdown" }, children));
        } else {
            new ExporterError(
                `Colab notebook cell ${i + 1} is a "${cell.cell_type}" cell, which cannot be shown; it was skipped.`,
                ["malformed content"],
            ).warn(ctx);
        }
    }

    if (dropped.size > 0)
        new ExporterError(
            `Colab notebook markdown contains ${[...dropped].join(" and ")}, which cannot be shown on the wiki; they were removed.`,
            ["malformed content"],
        ).warn(ctx);

    return generateComponent<ColabAttrs, ColabSlots>({
        tag: "Colab",
        attrs: { url },
        slots: {
            notebook: cells,
            content: await convertItems(trimBlank(content), ctx),
        },
    });
}

/**
 * Removes what notebook markdown can hold but the page cannot: raw HTML (which MDX would read as JSX)
 * and images stored inside the notebook or next to it rather than on the web.
 * What was removed is recorded in `dropped`.
 *
 * Headings are written as JSX tags, which keeps their look but leaves them out of the page's table of contents.
 */
function sanitizeNotebookMarkdown<Node extends { type: string }>(nodes: Node[], dropped: Set<string>): Node[] {
    return nodes.flatMap((node) => {
        if (node.type === "html") {
            dropped.add("raw HTML");
            return [];
        }
        if (node.type === "image" && !/^https?:\/\//i.test((node as unknown as Image).url)) {
            dropped.add("embedded images");
            return [];
        }
        if (!("children" in node && Array.isArray(node.children))) return [node];

        const children = sanitizeNotebookMarkdown(node.children as { type: string }[], dropped);
        // A paragraph that only held removed content would leave a gap
        if (node.type === "paragraph" && children.length === 0) return [];
        if (node.type === "heading")
            // So it isn't picked up by ToC
            return [
                jsxInlineBlock(
                    `h${(node as unknown as Heading).depth}`,
                    {},
                    children as PhrasingContent[],
                ) as unknown as Node,
            ];
        return [{ ...node, children }];
    });
}

function malformedColab(problem: string): ExporterError {
    return new ExporterError(
        `Colab component could not be understood: ${problem}.` +
            componentDocSuggestion(
                "https://app.notion.com/p/ubcigem/Components-395d65dd82be8024b1dbe3fb07e95219?source=copy_link",
            ),
        ["malformed content"],
    );
}

/**
 * The link a block holds: pasted links arrive as a bookmark, an embed, a mention, linked text or bare text.
 */
function blockLink(item: Item): string | undefined {
    if (item.type === "bookmark") return item.bookmark.url.trim();
    if (item.type === "embed") return item.embed.url.trim();
    if (item.type !== "paragraph") return undefined;

    const rich_text = item.paragraph.rich_text;
    for (const text of rich_text) {
        if (text.type === "mention" && text.mention.type === "link_mention") return text.mention.link_mention.href;
        if (text.href) return text.href;
    }
    return asPlainText(rich_text).trim() || undefined;
}

// ====================
// PLATEMAP COMPONENT
// ====================

export interface PlatemapAttrs {
    title: string;
    /** Group names, in order of first appearance; a well's `group` indexes into this. */
    groups: string[];
    /** The plates as JSON (`Plate[]`). */
    plates: string;
}
export const PLATEMAP_SLOTS = [] as const;
type PlatemapSlots = SlotRecord<typeof PLATEMAP_SLOTS>;

async function platemap({ items, ctx }: ComponentInput): ComponentOutput {
    // A title, then a subtitle followed by an uploaded CSV for each plate
    const [title_block, ...rest] = items.filter((item) => !isBlank(item));
    const title = title_block === undefined ? undefined : blockText(title_block);
    if (title === undefined || title === "") return malformedPlatemap("it does not start with a title");

    if (rest.length === 0 || rest.length % 2 !== 0)
        return malformedPlatemap("each plate must be a subtitle followed by an uploaded CSV file");

    const groups: string[] = [];
    const plates: Plate[] = [];
    for (let i = 0; i < rest.length; i += 2) {
        const subtitle_block = rest[i]!;
        const file_block = rest[i + 1]!;
        const name = blockText(subtitle_block);
        if (name === undefined || name === "")
            return malformedPlatemap(`plate ${i / 2 + 1} does not start with a subtitle`);
        if (file_block.type !== "file" || !/\.csv$/i.test(mediaFileName(file_block)))
            return malformedPlatemap(`the subtitle "${name}" is not followed by an uploaded .csv file`);

        const csv = await fetchFileText(file_block);
        if (isExporterErr(csv)) return csv;

        const parsed = parsePlate(name, csv, groups);
        if (isExporterErr(parsed)) return parsed;
        for (const warning of parsed.warnings)
            new ExporterError(warning, ["malformed content"]).warn(blockContext(ctx, file_block));
        plates.push(parsed.plate);
    }

    if (groups.length > PLATEMAP_PALETTE_SIZE)
        new ExporterError(
            `Platemap "${title}" has ${groups.length} groups, but only ${PLATEMAP_PALETTE_SIZE} colours; some groups share a colour.`,
            ["malformed content"],
        ).warn(ctx);

    return generateComponent<PlatemapAttrs, PlatemapSlots>({
        tag: "Platemap",
        attrs: { title, groups, plates: JSON.stringify(plates) },
        slots: {},
    });
}

/** How many distinct group colours `Platemap.astro` has. */
export const PLATEMAP_PALETTE_SIZE = 12;

/** The text of a heading or paragraph. */
function blockText(item: Item): string | undefined {
    switch (item.type) {
        case "paragraph":
            return asPlainText(item.paragraph.rich_text).trim();
        case "heading_1":
            return asPlainText(item.heading_1.rich_text).trim();
        case "heading_2":
            return asPlainText(item.heading_2.rich_text).trim();
        case "heading_3":
            return asPlainText(item.heading_3.rich_text).trim();
        case "heading_4":
            return asPlainText(item.heading_4.rich_text).trim();
        default:
            return undefined;
    }
}

function malformedPlatemap(problem: string): ExporterError {
    return new ExporterError(
        `Platemap component could not be understood: ${problem}.` +
            componentDocSuggestion(
                "https://app.notion.com/p/ubcigem/Components-395d65dd82be8024b1dbe3fb07e95219?source=copy_link",
            ),
        ["malformed content"],
    );
}

// ====================
// CALLOUT COMPONENT
// ====================
export interface CalloutAttrs {
    icon: string;
}

// ====================
// SKIP COMPONENT
// ====================

async function skip(): ComponentOutput {
    // Remove this element entirely
    return [];
}

// ====================
// HELPERS
// ====================

type ImageBlock = Extract<NotionBlock, { type: "image" }>;

/**
 * Uploads an image for use as a component attribute. Captions are used as alt text.
 */
async function imageAttr(block: ImageBlock, ctx: ConvertContext): Promise<{ url: string; alt: string } | null> {
    const image_ctx = blockContext(ctx, block);
    const url = await uploadMedia(block);
    if (isExporterErr(url)) {
        url.warn(image_ctx);
        return null;
    }

    return { url, alt: asPlainText(block.image.caption).trim() };
}

function isBlank(item: Item): boolean {
    return (
        item.type === "paragraph" && asPlainText(item.paragraph.rich_text).trim() === "" && item.children.length === 0
    );
}

/**
 * Removes leading and trailing empty paragraphs.
 */
function trimBlank(items: Item[]): Item[] {
    let start = 0;
    let end = items.length;
    while (start < end && isBlank(items[start]!)) start++;
    while (end > start && isBlank(items[end - 1]!)) end--;
    return items.slice(start, end);
}

function splitOnDividers(items: Item[]): Item[][] {
    const sections: Item[][] = [[]];
    for (const item of items) {
        if (item.type === "divider") sections.push([]);
        else sections.at(-1)!.push(item);
    }
    return sections;
}

export function componentDocSuggestion(link: string): string {
    return ` See ${ExporterError.link({ with_label: "this documentation", to: link })} for details.`;
}

type SlotRecord<Slots extends readonly string[]> = Record<Slots[number], FlowContent[]>;
function generateComponent<Attrs extends JsxAttrs, Slots extends SlotRecord<readonly string[]>>({
    tag,
    attrs,
    slots,
}: {
    tag: string;
    attrs: Attrs;
    slots: Slots;
}): FlowContent[] {
    const fragments = Object.entries(slots).map(([name, children]) =>
        jsxFlow("Fragment", { slot: name }, children as FlowContent[]),
    );

    return [jsxFlow(tag, attrs, fragments)];
}
