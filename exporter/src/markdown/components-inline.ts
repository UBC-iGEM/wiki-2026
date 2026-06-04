import { PagePathComponent } from "../map";
import { isErr } from "../utils";
import type { ComponentOutput } from "./components";
import { LINK_PROCESSORS } from "./link";
import { processAll, type ProcessorInput } from "./markdown";
import type { Html, Link, PhrasingContent, Text } from "mdast";
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
export const INLINE_COMPONENT_MAP: Record<string, (input: ComponentInput) => ComponentOutput> = {
    anchor,
    link,
};

function anchor({ node, ctx }: ComponentInput): ComponentOutput {
    const children = node.children;
    if (children.length !== 1 || children[0]!.type !== "text")
        return new Error(`Anchor component content is malformed: ${children}`);

    const [anchor_node] = children;
    const anchor_name = new PagePathComponent(anchor_node.value.trim()).toSlug();

    const new_node: Html = {
        type: "html",
        value: `<a id="${anchor_name}"></a>`,
    };
    ctx.parent.children[ctx.index] = new_node;

    return SKIP;
}

function link({ node, ctx }: ComponentInput): ComponentOutput {
    const children = node.children;
    const malformed_err = new Error(`Link component content is malformed: ${JSON.stringify(children, null, 2)}`);

    // Helper to generate new `Link` node
    // This replaces the component
    const generateNewLink = ({
        link_node,
        anchor_node,
        display,
    }: {
        link_node: Link;
        anchor_node: Text;
        display?: string | undefined;
    }): ComponentOutput => {
        // Replace this node with a Link
        const new_node: Link = {
            type: "link",
            url: link_node.url,
            children: link_node.children,
        };
        ctx.parent.children[ctx.index] = new_node;

        // Process the link to replace URL
        const processing_res = processAll(LINK_PROCESSORS, {
            node: new_node,
            ctx,
        });
        if (isErr(processing_res)) return processing_res;

        const processed_link_node = ctx.parent.children[ctx.index] as Link;

        let anchor_text = anchor_node.value.trimStart();
        if (!anchor_text.startsWith("@")) {
            return malformed_err;
        }
        anchor_text = anchor_text.replace(/@\s*/, "");
        const anchor_slug = new PagePathComponent(anchor_text).toSlug();

        const children: PhrasingContent[] = display
            ? [
                  {
                      type: "text",
                      value: display,
                  },
              ]
            : processed_link_node.children;

        const final_link: Link = {
            type: "link",
            url: `${processed_link_node.url}#${anchor_slug}`,
            children,
        };
        ctx.parent.children[ctx.index] = final_link;

        return SKIP;
    };

    // No display message provided, form of content is %{ LINK <mention> @ <anchor> }
    if (children.length === 2 && children[0]!.type === "link" && children[1]!.type === "text") {
        const [link_node, anchor_node] = children;
        return generateNewLink({ link_node, anchor_node });
    }
    // Display message provided, form of content is %{ LINK <display>; <mention> @ <anchor> }
    if (
        children.length === 3 &&
        children[0]!.type === "text" &&
        children[1]!.type === "link" &&
        children[2]!.type === "text"
    ) {
        const [display_node, link_node, anchor_node] = children;
        let display_text = display_node.value.trim();

        if (!display_text.endsWith(";")) {
            return malformed_err;
        }
        display_text = display_text.replace(";", "");

        return generateNewLink({ link_node, anchor_node, display: display_text });
    }

    return malformed_err;
}
