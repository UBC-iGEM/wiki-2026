import { BlockId, Id } from "../notion";
import { getToolsClient } from "../tools-api";
import { $unsafeSync, ExporterError, isErr, isExporterErr, type ExporterResult, type Result } from "../utils";
import { constructNodeErrorSource, type ProcessorInput, type ProcessorOutput } from "./markdown";
import type { BlockContent, DefinitionContent, Html, Image, Paragraph, ThematicBreak } from "mdast";
import type { ContainerDirective } from "mdast-util-directive";
import HTMLParse from "node-html-parser";
import { SKIP } from "unist-util-visit";

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
            `Figure component on page "${ctx.path}" could not be understood: it does not start with images. Figure components should follow the format <images> <description>.`,
            ["malformed content"],
            constructNodeErrorSource(node.children),
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
            `DBTL component on page "${ctx.path}" could not be understood: it does not have 4 sections delimited by dividers. DBTL components should follow the format <design content> <divider> <build content> <divider> <test content> <divider> <learn content>.`,
            ["malformed content"],
            constructNodeErrorSource(node.children),
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

function model3d({ node, ctx }: ComponentInput): ComponentOutput {
    const [file_node, ...description] = node.children;
    const file_html =
        file_node?.type === "html"
            ? file_node
            : file_node?.type === "paragraph" && file_node.children[0]?.type === "html"
              ? file_node.children[0]
              : undefined;
    if (!file_html)
        return malformedModel3d(ctx.path.toString(), node.children, "it does not start with an uploaded file");

    const parsed_file = HTMLParse.parse(file_html.value).querySelector("file");
    const file_url = parsed_file?.getAttribute("src")?.replaceAll("\\:", ":");
    if (!file_url?.startsWith("file://"))
        return malformedModel3d(ctx.path.toString(), node.children, "its file source is not a Notion-uploaded file");

    const description_text = getInlineModelDescription(file_node) || getModelDescription(description);
    const emitted_node: Html = {
        type: "html",
        value: model3dMdx("", description_text),
    };
    ctx.parent.children.splice(ctx.index, 1, emitted_node);

    const callback = async (): Promise<ExporterResult<void>> => {
        const file_data_res: Result<{ permissionRecord: { id: string } }> = $unsafeSync(
            JSON.parse,
            decodeURIComponent(file_url.replace("file://", "")),
        );
        if (isErr(file_data_res))
            return new ExporterError(
                `Model3D component on page "${ctx.path}" could not understand its uploaded file URL.`,
                ["malformed content"],
                file_data_res,
            );

        const file_id = new Id(file_data_res.permissionRecord.id);
        const block_res = await new BlockId(file_id.toString()).get();
        if (isExporterErr(block_res)) return block_res;
        if (block_res.type !== "file" || block_res.file.type !== "file")
            return new ExporterError(
                `Model3D component on page "${ctx.path}" points to Notion block ${file_id}, which is not an uploaded file.`,
                ["malformed content", "notion server"],
            );

        const tools_res = await getToolsClient();
        if (isExporterErr(tools_res)) return tools_res;
        const upload_res = await tools_res.upload({ uid: file_id.toString(), url: block_res.file.file.url, path: ctx.path });
        if (isExporterErr(upload_res)) return upload_res;

        emitted_node.value = model3dMdx(upload_res.location, description_text);
    };
    ctx.callbacks.push(callback);

    return [SKIP, ctx.index + 1];
}

function malformedModel3d(path: string, children: BlockElement[], problem: string): ExporterError {
    return new ExporterError(
        `Model3D component on page "${path}" could not be understood: ${problem}. Model3D components should follow the format <uploaded .glb or .gltf file> <optional description>.`,
        ["malformed content"],
        constructNodeErrorSource(children),
    );
}

function getModelDescription(children: BlockElement[]): string | undefined {
    if (
        children.length !== 1 ||
        children[0]!.type !== "paragraph" ||
        !children[0]!.children.every((child) => child.type === "text")
    )
        return undefined;

    const description = children[0]!.children.map((child) => child.value).join("").trim();
    return description || undefined;
}

function getInlineModelDescription(file_node: BlockElement | undefined): string | undefined {
    if (file_node?.type !== "paragraph") return;

    const description = file_node.children
        .slice(1)
        .flatMap((child) => (child.type === "text" ? [child.value] : []))
        .join("")
        .trim();
    return description || undefined;
}

function model3dMdx(url: string, alt: string | undefined): string {
    const attrs = [`url={${JSON.stringify(url)}}`];
    if (alt) attrs.push(`alt={${JSON.stringify(alt)}}`);
    return `<Model3D ${attrs.join(" ")} />`;
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
    let attr_string = Object.entries(attrs)
        .map(([name, value]) => `${name}={${JSON.stringify(value)}}`)
        .join(" ");
    // If there are attributes, they must be prepended with a space
    if (attr_string !== "") attr_string = " " + attr_string;

    const opening_tag = `<${tag}${attr_string}>`;
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
