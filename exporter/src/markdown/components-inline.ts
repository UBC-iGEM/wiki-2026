import { PagePathComponent } from "../map";
import { ExporterError, isExporterErr } from "../utils";
import type { ComponentOutput } from "./components";
import { LINK_PROCESSORS } from "./link";
import { constructNodeErrorSource, processAll, type ProcessorInput } from "./markdown";
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
export const INLINE_COMPONENT_MAP: Record<string, (input: ComponentInput) => ComponentOutput> = {
    anchor,
    link,
};

function anchor({ node, ctx }: ComponentInput): ComponentOutput {
    const children = node.children;
    if (children.length !== 1 || children[0]!.type !== "text")
        return new ExporterError(
            `Inline anchor component on page "${ctx.path}"" is malformed. Anchor components should only have a singular text field representing the name of the anchor.`,
            ["malformed content"],
            constructNodeErrorSource(node.children),
        );

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

    const malformed = (detail: string): ExporterError =>
        new ExporterError(
            `Inline link component on page "${ctx.path}" could not be understood: ${detail} This component should follow the format <optional display text> <optional page mention> @ <anchor name>.`,
            ["malformed content"],
            constructNodeErrorSource(node.children),
        );

    // Builds and installs the final `Link` node that replaces the component.
    const generateNewLink = (url: string, anchor_text: string, display?: string): ComponentOutput => {
        const trimmed_anchor = anchor_text.trimStart();
        if (!trimmed_anchor.startsWith("@")) return malformed(`an "@" separator was not identified.`);
        const anchor_name = trimmed_anchor.replace(/@\s*/, "").trim();

        const final_link: Link = {
            type: "link",
            url: `${url}#${new PagePathComponent(anchor_name).toSlug()}`,
            children: [{ type: "text", value: display || anchor_name }],
        };
        ctx.parent.children[ctx.index] = final_link;

        return SKIP;
    };

    // Normalizes a mention link node into its wiki URL.
    const processMention = (link_node: Link): string | ExporterError => {
        ctx.parent.children[ctx.index] = link_node;

        const processing_res = processAll(LINK_PROCESSORS, { node: link_node, ctx });
        if (isExporterErr(processing_res)) return processing_res;

        return (ctx.parent.children[ctx.index] as Link).url;
    };

    // Mention provided: <mention> @ <anchor>
    if (children.length === 2 && children[0]!.type === "link" && children[1]!.type === "text") {
        const [link_node, anchor_node] = children;
        const url = processMention(link_node);
        if (isExporterErr(url)) return url;
        return generateNewLink(url, anchor_node.value);
    }

    // Mention and display text provided: <display> <mention> @ <anchor>
    if (
        children.length === 3 &&
        children[0]!.type === "text" &&
        children[1]!.type === "link" &&
        children[2]!.type === "text"
    ) {
        const [display_node, link_node, anchor_node] = children;
        const url = processMention(link_node);
        if (isExporterErr(url)) return url;
        return generateNewLink(url, anchor_node.value, display_node.value.trim());
    }

    // No mention provided; link targets the current page.
    // <optional display text> @ <anchor> all in a single text node.
    if (children.length === 1 && children[0]!.type === "text") {
        const text = children[0]!.value;
        const at_index = text.indexOf("@");
        if (at_index === -1) return malformed(`an "@" separator was not identified.`);

        return generateNewLink(
            `/${ctx.path.toSlug()}`,
            text.slice(at_index),
            text.slice(0, at_index).trim() || undefined,
        );
    }

    return malformed("its format is incorrect.");
}
