import type { Root, Text } from "mdast";
import type { Options as MdASTOptions } from "mdast-util-to-markdown";
import type { Plugin, Processor } from "unified";
import { visit } from "unist-util-visit";

/**
 * Matches a Notion presentational block annotation token, e.g. `{color="pink"}`.
 */
const BLOCK_ANNOTATION = /[ \t]*\{[a-zA-Z][\w-]*="[^"}]*"\}/g;

/**
 * Strip Notion presentational block annotations such as `{color="pink"}`.
 */
export const remarkStripNotionAnnotations: Plugin<[], Root> = () => (tree) => {
    visit(tree, "text", (node: Text) => {
        node.value = node.value.replace(BLOCK_ANNOTATION, "");
    });
};

/**
 * Escape stray `<` in text so the output is valid MDX.
 */
export const remarkEscapeMdxText: Plugin<[], Root> = function (this: Processor) {
    const data = this.data();
    const extensions = (data.toMarkdownExtensions ??= []) as MdASTOptions[];
    extensions.push({ unsafe: [{ character: "<", inConstruct: "phrasing" }] });
};
