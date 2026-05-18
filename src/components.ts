import type { ProcessorInput, ProcessorOutput } from "./markdown";
import type { Html, Image, Parent } from "mdast";
import type { ContainerDirective } from "mdast-util-directive";
import type { MdxJsxFlowElement } from "mdast-util-mdx";
import { SKIP } from "unist-util-visit";

type ComponentInput = ProcessorInput<ContainerDirective>;
// A component cannot "skip" processing itself
type ComponentOutput = Exclude<ProcessorOutput, undefined>;

export const ComponentMap: Record<string, (input: ProcessorInput<ContainerDirective>) => ComponentOutput> = {
    figure,
};

function generateComponent({
    node,
    ctx,
    tag,
    attrs,
}: ComponentInput & { tag: string; attrs: Record<string, any> }): ComponentOutput {
    const attr_string = Object.entries(attrs)
        .map(([name, value]) => `${name}="${JSON.stringify(value).replaceAll('"', "&quot;")}"`)
        .join(" ");

    const opening_tag = `<${tag} ${attr_string}>`;
    const closing_tag = `</${tag}>`;

    const opening_element: Html = {
        type: "html",
        value: opening_tag,
    };
    const closing_element: Html = {
        type: "html",
        value: closing_tag,
    };

    ctx.parent.children.splice(ctx.index, 1, opening_element, ...node.children, closing_element);
    // Skip all newly inserted elements
    return [SKIP, ctx.index + 2 + node.children.length];
}

function figure({ node, ctx }: ComponentInput): ComponentOutput {
    const images: { url: string; alt: string }[] = [];
    const imgs_err = new Error(`Figure component at ${ctx.path} does not start with images`);

    // A figure block should start with a paragraph
    const child_paragraph = node.children[0];
    if (!child_paragraph || child_paragraph.type !== "paragraph") return imgs_err;

    const children = child_paragraph.children;

    // Consume children while they are images or empty whitespace
    while (children.length > 0) {
        const first_child = children[0]!;

        if (first_child.type === "text" && first_child.value.trim() === "") {
            // Consume the empty element and continue
            children.shift();
            continue;
        }

        if (first_child.type !== "image") {
            // No more images!
            break;
        }

        // Consume the image
        const image = children.shift() as Image;
        images.push({ url: image.url, alt: image.alt || "" });
    }

    // The paragraph should start with 1 or more images
    if (images.length === 0) return imgs_err;

    return generateComponent({ node, ctx, tag: "figure", attrs: { imgs: images } });
}
