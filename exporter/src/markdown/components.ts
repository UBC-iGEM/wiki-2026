import { fetchNotebook, parseColabFileId } from "../colab";
import type { NotionBlock } from "../notion";
import { ExporterError, isExporterErr, type ExporterResult } from "../utils";
import { blockContext, convertItems, type ConvertContext, type Item } from "./blocks";
import { jsxFlow, type FlowContent, type JsxAttrs } from "./mdx";
import { mediaFileName, uploadMedia } from "./media";
import { asPlainText } from "./rich-text";
import type { Image } from "mdast";
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

export interface IHPAttrs {
    image: {
        url: string;
        alt: string;
    };
    name: string;
    bio: string;
}

export const IHP_SLOTS = ["content"] as const;
type IHPSlots = SlotRecord<typeof IHP_SLOTS>;

async function ihp({ items, ctx }: ComponentInput): ComponentOutput {
    // An image, a two-item bulleted list with the name and bio, a divider, then the interview description
    const [image_block, name_block, bio_block, divider, ...content] = trimBlank(items);

    if (image_block?.type !== "image") return malformedIHP("it does not start with an image");

    if (name_block?.type !== "bulleted_list_item" || bio_block?.type !== "bulleted_list_item")
        return malformedIHP("the image must be followed by a two-item bulleted list containing the name and bio");

    const name = asPlainText(name_block.bulleted_list_item.rich_text).trim();
    const bio = asPlainText(bio_block.bulleted_list_item.rich_text).trim();
    if (name === "" || bio === "") return malformedIHP("the name and bio cannot be empty");

    if (divider?.type !== "divider") return malformedIHP("the name and bio must be followed by a divider");

    if (trimBlank(content).length === 0)
        return malformedIHP("it does not contain an interview description after the divider");

    const image = await imageAttr(image_block, ctx);
    if (!image) return malformedIHP("its image could not be uploaded");

    return generateComponent<IHPAttrs, IHPSlots>({
        tag: "IHP",
        attrs: { image, name, bio },
        slots: { content: await convertItems(trimBlank(content), ctx) },
    });
}

function malformedIHP(problem: string): ExporterError {
    return new ExporterError(
        `iHP component could not be understood: ${problem}.` +
            componentDocSuggestion(
                "https://app.notion.com/p/ubcigem/Components-395d65dd82be8024b1dbe3fb07e95219?source=copy_link",
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
