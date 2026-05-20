import { normalizeUrl } from "./link";
import type { ProcessorInput, ProcessorOutput } from "./markdown";
import type { Html } from "mdast";
import type { HTMLElement } from "node-html-parser";
import { SKIP } from "unist-util-visit";

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

    return normalizeUrl({ url, err_base, ctx });
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
    return SKIP;
}
