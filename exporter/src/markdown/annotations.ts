import type { Root, Text } from "mdast";
import type { Plugin } from "unified";
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
