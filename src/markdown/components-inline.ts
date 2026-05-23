import { cleanWebString } from "../utils";
import type { ComponentOutput } from "./components";
import type { ProcessorInput } from "./markdown";
import type { Html, Link } from "mdast";
import type { TextDirective } from "mdast-util-directive";
import { SKIP } from "unist-util-visit";

/**
 * Support for inline components.
 *
 * Example:
 * %{ COMPONENT ...content }%
 *
 * This is passed as a {@link TextDirective} node for processing.
 */

type ComponentInput = ProcessorInput<TextDirective>;

/**
 * A [name -> handler function] map for all possible component types.
 */
export const InlineComponentMap: Record<string, (input: ComponentInput) => ComponentOutput> = {
    anchor,
    link,
};

function anchor({ node, ctx }: ComponentInput): ComponentOutput {
    const children = node.children;
    if (children.length !== 1 || children[0]!.type !== "text")
        return new Error(`Anchor component content is malformed: ${children}`);

    const [anchor_node] = children;
    const anchor_name = cleanWebString(anchor_node.value.trim());

    const new_node: Html = {
        type: "html",
        value: `<a id="${anchor_name}"></a>`,
    };
    ctx.parent.children[ctx.index] = new_node;

    return SKIP;
}

function link({ node, ctx }: ComponentInput): ComponentOutput {
    const children = node.children;
    if (children.length !== 2 || children[0]!.type !== "link" || children[1]!.type !== "text")
        return new Error(`Link component content is malformed: ${JSON.stringify(children, null, 2)}`);

    const [link, anchor_node] = children;
    const anchor_name = cleanWebString(anchor_node.value.trim());

    const new_node: Link = {
        type: "link",
        url: `${link.url}#${anchor_name}`,
        children: link.children,
    };
    ctx.parent.children[ctx.index] = new_node;

    return SKIP;
}
