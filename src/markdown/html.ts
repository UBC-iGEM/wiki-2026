import { isErr } from "../utils";
import { normalizeNotionUrl } from "./link";
import type { ProcessorInput, ProcessorOutput } from "./markdown";
import type { Html } from "mdast";
import type { HTMLElement } from "node-html-parser";
import { CONTINUE } from "unist-util-visit";

export const HtmlProcessors = [normalizePageMention, replaceEmptyBlocks];

type HtmlProcessorInput = ProcessorInput<Html> & { parsed_node: HTMLElement };

/**
 * Normalize link in `<mention-page url="...">` block and replace with a Markdown link block
 */
function normalizePageMention({ node, ctx, parsed_node }: HtmlProcessorInput): ProcessorOutput {
    const mention_element = parsed_node.querySelector("mention-page");
    if (!mention_element) {
        return;
    }

    const err_base = `'mention-page' element on page ${ctx.path} (${node})`;

    const url = mention_element.attributes["url"];
    if (!url) {
        return new Error(`${err_base} has no valid attribute 'url'`);
    }

    const res = normalizeNotionUrl({ url, err_base, ctx });
    if (isErr(res)) return res;

    const first_child = ctx.parent.children[ctx.index + 1];
    const second_child = ctx.parent.children[ctx.index + 2];

    if (first_child && second_child && first_child.type === "text" && second_child.type === "html") {
        // The form of this block is `<mention-page url="...">...</mention-page>`
        // Splice out the text and closing HTML block
        ctx.parent.children.splice(ctx.index + 1, 2);
        // Continue at the element that is now at `ctx.index + 1`
        return [CONTINUE, ctx.index + 1];
    } else {
        // The form of this block is `<mention-page url="..."/>`
        return res;
    }
}

/**
 * Replace `<empty-block/>` element with HTML break node as newline
 */
function replaceEmptyBlocks({ ctx, parsed_node }: HtmlProcessorInput): ProcessorOutput {
    const empty_block_element = parsed_node.querySelector("empty-block");
    if (!empty_block_element) {
        return;
    }

    const new_node: Html = {
        type: "html",
        value: "<br />",
    };

    ctx.parent.children[ctx.index] = new_node;
    return CONTINUE;
}
