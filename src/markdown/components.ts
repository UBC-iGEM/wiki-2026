import type { ProcessorInput, ProcessorOutput } from "./markdown";
import type { BlockContent, DefinitionContent, Html, Image, Paragraph, Parent, ThematicBreak } from "mdast";
import type { ContainerDirective } from "mdast-util-directive";
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
export const ComponentMap: Record<string, (input: ComponentInput) => ComponentOutput> = {
    figure,
    dbtl,
    skip,
};

function figure({ node, ctx }: ComponentInput): ComponentOutput {
    const images: { url: string; alt: string }[] = [];

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
        return new Error(`Figure component at ${ctx.path} does not start with images: ${node.children}`);

    const filtered_children = node.children.filter(
        // Remove empty paragraphs
        (child) => !(child.type === "paragraph" && child.children.length === 0),
    );

    // Images have been removed from the node body and
    // will be added as a JSON attribute of the component
    return generateComponent({
        node,
        ctx,
        tag: "figure",
        attrs: { imgs: images },
        slots: { content: filtered_children },
    });
}

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
        return new Error(
            `DBTL component at ${ctx.path} does not have 4 components: ${JSON.stringify(node.children, null, 2)}`,
        );

    const [design, build, test, learn] = sections as [BlockElement[], BlockElement[], BlockElement[], BlockElement[]];
    return generateComponent({ node, ctx, tag: "dbtl", attrs: {}, slots: { design, build, test, learn } });
}

function skip({ ctx }: ComponentInput): ComponentOutput {
    // Remove this element entirely
    ctx.parent.children.splice(ctx.index, 1);
    // Skip children, continue at the next element (which is now at `ctx.index`)
    return [SKIP, ctx.index];
}

function generateComponent({
    ctx,
    tag,
    attrs,
    slots,
}: ComponentInput & {
    tag: string;
    attrs: Record<string, any>;
    slots: Record<string, BlockElement[]>;
}): ComponentOutput {
    let attr_string = Object.entries(attrs)
        .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
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

        return [slot_open, ...elements, slot_close];
    });

    ctx.parent.children.splice(ctx.index, 1, opening_element, ...component_elements, closing_element);

    // Total number of elements within the component + open block + close block
    const num_elements = component_elements.length + 2;
    // Skip all newly inserted elements
    return [SKIP, ctx.index + num_elements];
}
