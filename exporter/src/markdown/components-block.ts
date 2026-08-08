import { BlockId, Id } from "../notion";
import { getToolsClient } from "../tools-api";
import { $unsafeSync, ExporterError, isErr, isExporterErr, type ExporterResult, type Result } from "../utils";
import { type ProcessorInput, type ProcessorOutput } from "./markdown";
import type { BlockContent, DefinitionContent, Html, Image, Paragraph, ThematicBreak } from "mdast";
import type { ContainerDirective } from "mdast-util-directive";
import HTMLParse from "node-html-parser";
import { SKIP } from "unist-util-visit";

const MODEL3D_DOC_URL = "https://app.notion.com/p/ubcigem/Components-395d65dd82be8024b1dbe3fb07e95219?source=copy_link";

/**
 * Support for block components.
 *
 * Example:
 * %% START COMPONENT
 *     ...content
 * %% END
 *
 * This is passed as a {@link ContainerDirective} node for processing.
 */

type ComponentInput = ProcessorInput<ContainerDirective>;
// A component cannot "skip" processing itself
export type ComponentOutput = Exclude<ProcessorOutput, undefined>;

/**
 * Possible types of {@link ContainerDirective} children.
 */
type BlockElement = BlockContent | DefinitionContent;

/**
 * A [name -> handler function] map for all possible component types.
 */
export const COMPONENT_MAP: Record<string, (input: ComponentInput) => ComponentOutput> = {
    figure,
    dbtl,
    carousel,
    model3d,
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

function figure({ node, ctx }: ComponentInput): ComponentOutput {
    const images: FigureAttrs["imgs"] = [];

    // A figure block should start with one or more paragraphs containing images
    const paragraphs: Paragraph[] = [];
    for (const child of node.children) {
        if (child.type === "paragraph") {
            paragraphs.push(child);
        } else {
            // Hit a non-paragraph block
            break;
        }
    }

    image_consumption_loop: for (const p of paragraphs) {
        const children = p.children;

        // Consume elements inside the child
        // This removes images from the node body and adds them to the `images` accumulator
        while (children.length > 0) {
            const next_child = children[0]!;

            if (next_child.type === "text") {
                if (next_child.value.trim() === "") {
                    // Empty space, consume it
                    children.shift();
                    continue;
                } else {
                    // We've hit the figure description
                    break image_consumption_loop;
                }
            }

            if (next_child.type === "image") {
                // An image, consume it
                const image = children.shift() as Image;
                images.push({ url: image.url, alt: image.alt || "" });

                continue;
            }

            // Not an image!
            break image_consumption_loop;
        }
    }

    if (images.length === 0)
        return new ExporterError(
            `Figure component on page "${ctx.path}" could not be understood: it does not start with images.` +
                ExporterError.componentDocSuggestion(
                    "https://app.notion.com/p/ubcigem/Components-395d65dd82be8024b1dbe3fb07e95219?source=copy_link#395d65dd82be80849d9eff853d8453a2",
                ),
            ["malformed content"],
        );

    const filtered_children = node.children.filter(
        // Remove empty paragraphs
        (child) => !(child.type === "paragraph" && child.children.length === 0),
    );

    // Images have been removed from the node body and
    // will be added as a JSON attribute of the component

    return generateComponent<FigureAttrs, FigureSlots>({
        node,
        ctx,
        tag: "Figure",
        attrs: { imgs: images },
        slots: { content: filtered_children },
    });
}

// ====================
// DBTL COMPONENT
// ====================

type DbtlAttrs = Record<string, never>;
export const DBTL_SLOTS = ["design", "build", "test", "learn"] as const;
type DbtlSlots = SlotRecord<typeof DBTL_SLOTS>;

function dbtl({ node, ctx }: ComponentInput): ComponentOutput {
    /**
     * Possible types of DBTL block sections.
     *
     * {@link ThematicBreak} is excluded, since it divides sections.
     */
    type SectionContent = Exclude<BlockElement, ThematicBreak>;

    const sections: SectionContent[][] = [];
    let cur_section: SectionContent[] = [];

    for (const child of node.children) {
        switch (child.type) {
            case "thematicBreak":
                // Start a new section on divider
                sections.push(cur_section);
                cur_section = [];
                break;
            default:
                // Add to current section
                cur_section.push(child);
        }
    }
    // Push last section
    sections.push(cur_section);

    if (sections.length !== 4)
        return new ExporterError(
            `DBTL component on page "${ctx.path}" could not be understood: it does not have 4 sections delimited by dividers.` +
                ExporterError.componentDocSuggestion(
                    "https://app.notion.com/p/ubcigem/Components-395d65dd82be8024b1dbe3fb07e95219?source=copy_link#395d65dd82be805ea14ed9af6aaeff99",
                ),
            ["malformed content"],
        );

    const [design, build, test, learn] = sections as [BlockElement[], BlockElement[], BlockElement[], BlockElement[]];

    return generateComponent<DbtlAttrs, DbtlSlots>({
        node,
        ctx,
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

function model3d({ node, ctx }: ComponentInput): ComponentOutput {
    const [file_node, ...following_content] = node.children;
    const file_html =
        file_node?.type === "html"
            ? file_node
            : file_node?.type === "paragraph" && file_node.children[0]?.type === "html"
              ? file_node.children[0]
              : undefined;
    if (!file_html) return malformedModel3d(ctx.path.toString(), "it does not start with an uploaded file");

    const inline_content =
        file_node?.type === "paragraph" && file_node.children.length > 1
            ? [{ ...file_node, children: file_node.children.slice(1) }]
            : [];
    const content = [...inline_content, ...following_content];

    const parsed_file = HTMLParse.parse(file_html.value).querySelector("file");
    const file_url = parsed_file?.getAttribute("src")?.replaceAll("\\:", ":");
    if (!file_url?.startsWith("file://"))
        return malformedModel3d(ctx.path.toString(), "its file source is not a Notion-uploaded file");

    interface ModelFileData {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        permissionRecord?: { id?: unknown };
    }
    const file_data_res: Result<ModelFileData> = $unsafeSync(
        JSON.parse,
        decodeURIComponent(file_url.replace("file://", "")),
    );
    if (isErr(file_data_res) || typeof file_data_res.permissionRecord?.id !== "string")
        return malformedModel3d(ctx.path.toString(), "it has an invalid uploaded file URL");

    const file_id = new Id(file_data_res.permissionRecord.id);

    const result = generateComponent<Model3dAttrs, Model3dSlots>({
        node,
        ctx,
        tag: "Model3D",
        attrs: { url: "" },
        slots: { content },
    });
    const opening_node = ctx.parent.children[ctx.index] as Html;

    const callback = async (): Promise<ExporterResult<void>> => {
        const block_res = await new BlockId(file_id.toString()).get();
        if (isExporterErr(block_res)) return block_res;
        if (block_res.type !== "file" || block_res.file.type !== "file")
            return malformedModel3d(ctx.path.toString(), `Notion block ${file_id} is not an uploaded file`);
        if (!/\.gl(?:b|tf)$/i.test(block_res.file.name))
            return malformedModel3d(ctx.path.toString(), "its uploaded file is not a .glb or .gltf model");

        const tools_res = await getToolsClient();
        if (isExporterErr(tools_res)) return tools_res;
        const upload_res = await tools_res.upload({
            uid: file_id.toString(),
            url: block_res.file.file.url,
            path: ctx.path,
            original_file: { file_name: block_res.file.name },
        });
        if (isExporterErr(upload_res)) return upload_res;

        opening_node.value = componentOpeningTag("Model3D", { url: upload_res.location });
    };
    ctx.callbacks.push(callback);

    return result;
}

function malformedModel3d(path: string, problem: string): ExporterError {
    return new ExporterError(
        `Model3D component on page "${path}" could not be understood: ${problem}.` +
        ExporterError.componentDocSuggestion(MODEL3D_DOC_URL),
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

function carousel({ node, ctx }: ComponentInput): ComponentOutput {
    /**
     * Possible types of carousel slide sections.
     *
     * {@link ThematicBreak} is excluded, since it divides slides.
     */
    type SectionContent = Exclude<BlockElement, ThematicBreak>;

    const sections: SectionContent[][] = [];
    let cur_section: SectionContent[] = [];

    for (const child of node.children) {
        switch (child.type) {
            case "thematicBreak":
                // Start a new slide on divider
                sections.push(cur_section);
                cur_section = [];
                break;
            default:
                // Add to the current slide
                cur_section.push(child);
        }
    }

    // Push last slide
    sections.push(cur_section);

    const slides: CarouselAttrs["slides"] = [];
    const descriptions: BlockElement[] = [];

    for (let i = 0; i < sections.length; i++) {
        const section = sections[i]!;
        const first = section[0];

        if (!first || first.type !== "paragraph")
            return new ExporterError(
                `Carousel component on page "${ctx.path}" could not be understood: slide ${i + 1} does not start with an image.` +
                    ExporterError.componentDocSuggestion(
                        "https://www.notion.so/ubcigem/Components-395d65dd82be8024b1dbe3fb07e95219?v=390d65dd82be80879bd4000c8f0deedc&source=copy_link#3add65dd82be8004a504cb122ae5ca7b",
                    ),
                ["malformed content"],
            );

        // Skip leading whitespace-only text nodes before the image, e.g. a stray leading space
        while (first.children[0]?.type === "text" && first.children[0].value.trim() === "") {
            first.children.shift();
        }

        if (first.children[0]?.type !== "image")
            return new ExporterError(
                `Carousel component on page "${ctx.path}" could not be understood: slide ${i + 1} does not start with an image.` +
                    ExporterError.componentDocSuggestion(
                        "https://www.notion.so/ubcigem/Components-395d65dd82be8024b1dbe3fb07e95219?v=390d65dd82be80879bd4000c8f0deedc&source=copy_link#3add65dd82be8004a504cb122ae5ca7b",
                    ),
                ["malformed content"],
            );

        const image = first.children.shift() as Image;
        slides.push({ url: image.url, alt: image.alt || "" });

        const filtered_section = section.filter(
            // Removing the now-empty leading paragraph
            (child) => !(child.type === "paragraph" && child.children.length === 0),
        );

        const desc_open: Html = { type: "html", value: `<div class="carousel-desc" data-index="${i}">` };
        const desc_close: Html = { type: "html", value: "</div>" };
        descriptions.push(desc_open, ...filtered_section, desc_close);
    }

    return generateComponent<CarouselAttrs, CarouselSlots>({
        node,
        ctx,
        tag: "ImageCarousel",
        attrs: { slides },
        slots: { descriptions },
    });
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

function skip({ ctx }: ComponentInput): ComponentOutput {
    // Remove this element entirely
    ctx.parent.children.splice(ctx.index, 1);
    // Skip children, continue at the next element (which is now at `ctx.index`)
    return [SKIP, ctx.index];
}

// ====================
// HELPERS
// ====================

type SlotRecord<Slots extends readonly string[]> = Record<Slots[number], BlockElement[]>;
function generateComponent<Attrs extends Record<string, any>, Slots extends SlotRecord<readonly string[]>>({
    ctx,
    tag,
    attrs,
    slots,
}: ComponentInput & {
    tag: string;
    attrs: Attrs;
    slots: Slots;
}): ComponentOutput {
    const opening_tag = componentOpeningTag(tag, attrs);
    const closing_tag = `</${tag}>`;

    const opening_element: Html = {
        type: "html",
        value: opening_tag,
    };
    const closing_element: Html = {
        type: "html",
        value: closing_tag,
    };

    const component_elements = Object.entries(slots).flatMap(([name, elements]) => {
        const slot_open: Html = {
            type: "html",
            value: `<Fragment slot="${name}">`,
        };
        const slot_close: Html = {
            type: "html",
            value: "</Fragment>",
        };

        return [slot_open, ...(elements as BlockElement[]), slot_close];
    });

    ctx.parent.children.splice(ctx.index, 1, opening_element, ...component_elements, closing_element);

    // Total number of elements within the component + open block + close block
    const num_elements = component_elements.length + 2;
    // Skip all newly inserted elements
    return [SKIP, ctx.index + num_elements];
}

function componentOpeningTag(tag: string, attrs: Record<string, any>): string {
    let attr_string = Object.entries(attrs)
        .map(([name, value]) => `${name}={${JSON.stringify(value)}}`)
        .join(" ");
    if (attr_string !== "") attr_string = " " + attr_string;

    return `<${tag}${attr_string}>`;
}
