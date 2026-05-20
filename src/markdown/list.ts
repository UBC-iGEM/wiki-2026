import type { ProcessorInput, ProcessorOutput } from "./markdown";
import type { List, ListItem, Paragraph } from "mdast";
import { CONTINUE } from "unist-util-visit";

export const ListProcessors = [newlineAfterList];

/**
 * Walk a Markdown list. If text has been accidentally joined to its end,
 * splice it out and return it as a new Paragraph.
 */
function newlineAfterList({ node, ctx }: ProcessorInput<List>): ProcessorOutput {
    const last_list_item = node.children.at(-1);
    if (!last_list_item) return;

    return splitListItem({ node: last_list_item, ctx });
}

function splitListItem({ node: item, ctx }: ProcessorInput<ListItem>): ProcessorOutput {
    const last_child = item.children.at(-1);
    if (!last_child) return;

    switch (last_child.type) {
        case "paragraph":
            break;
        case "list":
            // Time to go deeper
            return newlineAfterList({ node: last_child, ctx });
        default:
            return;
    }

    const last_text_element = last_child.children.at(-1);
    if (!last_text_element || last_text_element.type !== "text") return false;
    const text = last_text_element.value;

    const split_index = text.indexOf("\n");
    if (split_index === -1) return false;

    const before = text.slice(0, split_index).trimEnd();
    const after = text.slice(split_index + 1).trimStart();

    last_text_element.value = before;
    const new_paragraph: Paragraph = {
        type: "paragraph",
        children: [
            {
                type: "text",
                value: after,
            },
        ],
    };
    ctx.parent.children.splice(ctx.index + 1, 0, new_paragraph);
    return CONTINUE;
}
