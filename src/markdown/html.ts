import { isErr } from "../utils";
import { RemarkProcessingPipeline, type ProcessorInput, type ProcessorOutput } from "./markdown";
import type { Html, Link, PhrasingContent, Table, TableCell, TableRow } from "mdast";
import type { HTMLElement } from "node-html-parser";
import { SKIP } from "unist-util-visit";

export const HtmlProcessors = [normalizePageMention, replaceEmptyBlocks, parseTables];

type HtmlProcessorInput = ProcessorInput<void> & { parsed_node: HTMLElement };

/**
 * Convert `<mention-page url="...">` to Markdown link
 */
function normalizePageMention({ ctx, parsed_node }: HtmlProcessorInput): ProcessorOutput {
    const mention_element = parsed_node.querySelector("mention-page");
    if (!mention_element) {
        return;
    }

    const err_base = `'mention-page' element on page ${ctx.path} (${parsed_node})`;

    const url = mention_element.attributes["url"];
    if (!url) {
        return new Error(`${err_base} has no valid attribute 'url'`);
    }

    const new_node: Link = {
        type: "link",
        url,
        children: [{ type: "text", value: "PAGE" }],
    };
    // Replace with a `Link` node
    ctx.parent.children[ctx.index] = new_node;

    const first_child = ctx.parent.children[ctx.index + 1];
    const second_child = ctx.parent.children[ctx.index + 2];

    if (first_child && second_child && first_child.type === "text" && second_child.type === "html") {
        // The form of this block is `<mention-page url="...">...</mention-page>`
        // Remove the text and closing HTML block
        ctx.parent.children.splice(ctx.index + 1, 2);
        // There shouldn't be any children, but skip if there are
    }

    // Walk the new `Link` node
    return [SKIP, ctx.index];
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
    // Skip children of this node (there shouldn't be any, but just in case)
    return SKIP;
}

/**
 * Notion injects tables as HTML.
 * This parses them back to Markdown components so cells are properly processed.
 */
function parseTables({ ctx, parsed_node }: HtmlProcessorInput): ProcessorOutput {
    const table_elem = parsed_node.querySelector("table");
    if (!table_elem) return;
    console.log(`Table: ${table_elem.innerHTML}`);

    const has_header = table_elem.getAttribute("header-row") === "true";
    const html_rows = table_elem.querySelectorAll("tr");

    const rows = html_rows.map((html_row) => {
        const html_cells = html_row.querySelectorAll("td");

        const cells = html_cells.map((html_cell) => {
            const cell_content = html_cell.innerHTML.trim();
            const parsed_cell = RemarkProcessingPipeline().parse(cell_content);

            const children: PhrasingContent[] = parsed_cell.children.flatMap((child) =>
                "children" in child ? (child.children as PhrasingContent[]) : [],
            );

            const cell: TableCell = {
                type: "tableCell",
                children: children,
            };
            return cell;
        });

        const row: TableRow = {
            type: "tableRow",
            children: cells,
        };
        return row;
    });

    if (!has_header) {
        // We need to insert a dummy (blank) header row
        const dummy_row: TableRow = {
            type: "tableRow",
            // Array of empty text elements
            children: Array.from(
                { length: rows[0]!.children.length },
                (): TableCell => ({
                    type: "tableCell",
                    children: [{ type: "text", value: "" }],
                }),
            ),
        };
        // Prepend dummy row to `rows`
        rows.splice(0, 0, dummy_row);
    }

    const table: Table = {
        type: "table",
        children: rows,
    };
    ctx.parent.children[ctx.index] = table;

    // Skip children of the origin node
    // Traverse the new `Table` element
    return [SKIP, ctx.index];
}
