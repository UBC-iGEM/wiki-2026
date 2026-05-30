import { remarkProcessingPipeline, type ProcessorInput, type ProcessorOutput } from "./markdown";
import type { PhrasingContent, Table, TableCell, TableRow } from "mdast";
import type { HTMLElement } from "node-html-parser";
import { SKIP } from "unist-util-visit";

export const HTML_PROCESSORS = [parseTables];

type HtmlProcessorInput = ProcessorInput<void> & { parsed_node: HTMLElement };

/**
 * Notion injects tables as HTML.
 * This parses them back to Markdown components so cells are properly processed.
 */
function parseTables({ ctx, parsed_node }: HtmlProcessorInput): ProcessorOutput {
    const table_elem = parsed_node.querySelector("table");
    if (!table_elem) return;

    const has_header = table_elem.getAttribute("header-row") === "true";
    const html_rows = table_elem.querySelectorAll("tr");

    const rows = html_rows.map((html_row) => {
        const html_cells = html_row.querySelectorAll("td");

        const cells = html_cells.map((html_cell) => {
            const cell_content = html_cell.innerHTML.trim();
            const parsed_cell = remarkProcessingPipeline().parse(cell_content);

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
