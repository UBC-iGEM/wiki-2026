import type { Id } from "../notion";
import type { BlockContent, DefinitionContent, Paragraph, PhrasingContent } from "mdast";
import type { MdxJsxAttribute, MdxJsxFlowElement, MdxJsxTextElement } from "mdast-util-mdx-jsx";

/**
 * Helpers to build MDX JSX nodes.
 * This allows the whole page to be built with MDAST and stringified with `remark-mdx`.
 */

export type FlowContent = BlockContent | DefinitionContent;

/**
 * JSX attribute values: strings are emitted as literals (`name="value"`),
 * anything else as a JSON expression (`name={...}`).
 */
export type JsxAttrs = object;

function intoJsxAttributes(attrs: JsxAttrs): MdxJsxAttribute[] {
    return Object.entries(attrs).map(([name, value]) => ({
        type: "mdxJsxAttribute",
        name,
        value:
            typeof value === "string"
                ? value
                : { type: "mdxJsxAttributeValueExpression", value: JSON.stringify(value) },
    }));
}

export function jsxFlow(name: string, attrs: JsxAttrs = {}, children: FlowContent[] = []): MdxJsxFlowElement {
    return { type: "mdxJsxFlowElement", name, attributes: intoJsxAttributes(attrs), children };
}

export function jsxText(name: string, attrs: JsxAttrs = {}, children: PhrasingContent[] = []): MdxJsxTextElement {
    return { type: "mdxJsxTextElement", name, attributes: intoJsxAttributes(attrs), children };
}

/**
 * An element whose content is inline, e.g. `<summary>`.
 *
 * Wrapped in a paragraph so it stringifies onto one line without inserting a `<p>`.
 */
export function jsxInlineBlock(name: string, attrs: JsxAttrs, children: PhrasingContent[]): Paragraph {
    return { type: "paragraph", children: [jsxText(name, attrs, children)] };
}

/**
 * An inline anchor element that links can target.
 */
export function anchorText(id: Id): MdxJsxTextElement {
    return jsxText("a", { id: id.toString() });
}

/**
 * A block-level anchor element that links can target.
 */
export function anchorFlow(id: Id): MdxJsxFlowElement {
    return jsxFlow("a", { id: id.toString() });
}
