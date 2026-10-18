import { Id } from "../notion";
import { ExporterError } from "../utils";
import type { ConvertContext } from "./blocks";
import { isNumberedCite } from "./citations";
import type { Nodes, Root } from "mdast";

/**
 * Typographic checks on a converted page, for mistakes that render but read badly: spacing, periods and brackets around
 * citations, unmatched brackets, and headings that skip a level.
 */

/** Stands in for a numbered citation in flattened text. */
const CITE = "\u0001";
/** Stands in for text whose brackets aren't prose (inline code and maths). */
const OPAQUE = "\u0002";

/**
 * The text of a run of phrasing content, with the block each citation is in.
 */
interface Flattened {
    text: string;
    cite_blocks: (Id | undefined)[];
}

/**
 * Words whose abbreviating period may come right before a citation without ending the sentence.
 */
const ABBREVIATION = /\b(?:al|e\.g|i\.e|etc|vs|inc|ltd|co|corp|fig|figs|approx|ca|resp)\.\s*$/i;

const PAIRS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/**
 * Warns about typographic mistakes in the page's prose.
 */
export function proofread(tree: Root, ctx: ConvertContext): void {
    let block: Id | undefined = ctx.block;
    // The last heading's level; the next may go at most one deeper, so a page starts with heading 1
    let heading_depth = 0;

    const visit = (node: Nodes, in_table: boolean): void => {
        const anchor = anchorId(node);
        if (anchor) block = anchor;

        if (node.type === "paragraph" || node.type === "heading" || node.type === "tableCell") {
            // Paragraphs and table cells start with their block's anchor
            const first = node.children[0];
            const first_anchor = first && anchorId(first);
            if (first_anchor) block = first_anchor;

            const flattened = flatten(node);
            if (node.type === "heading") {
                if (node.depth > heading_depth + 1) {
                    const expected =
                        heading_depth === 0
                            ? "the page's first heading should be heading 1"
                            : `it follows a heading ${heading_depth}`;
                    new ExporterError(
                        `Heading ${node.depth} skips a level, as ${expected}: “${excerpt(flattened.text, 0)}”`,
                        ["malformed content"],
                    ).warn({ ...ctx, block });
                }
                heading_depth = node.depth;
            }

            const sentence = node.type === "paragraph" && !in_table;
            checkPhrasing(flattened, sentence, { ...ctx, block });
            return;
        }
        if (node.type === "code" || node.type === "math" || node.type === "html") return;
        if (!("children" in node)) return;

        const table = in_table || node.type === "table" || (node.type === "mdxJsxFlowElement" && node.name === "table");
        for (const child of node.children as Nodes[]) visit(child, table);
    };
    visit(tree, false);
}

function anchorId(node: Nodes): Id | undefined {
    if ((node.type !== "mdxJsxTextElement" && node.type !== "mdxJsxFlowElement") || node.name !== "a") return undefined;
    const id = node.attributes.find((attr) => attr.type === "mdxJsxAttribute" && attr.name === "id")?.value;
    return typeof id === "string" ? new Id(id) : undefined;
}

function flatten(node: Nodes): Flattened {
    const out: Flattened = { text: "", cite_blocks: [] };

    const walk = (node: Nodes): void => {
        if (isNumberedCite(node)) {
            out.text += CITE;
            out.cite_blocks.push(node.data.cite.block);
            return;
        }
        switch (node.type) {
            case "text":
                out.text += node.value;
                return;
            case "inlineCode":
            case "inlineMath":
                out.text += OPAQUE;
                return;
            case "break":
                out.text += "\n";
                return;
            case "mdxJsxTextElement":
                if (node.name === "br") out.text += "\n";
                else if (node.name !== "a" || node.children.length > 0) node.children.forEach(walk);
                return;
        }
        if ("children" in node) (node.children as Nodes[]).forEach(walk);
    };
    walk(node);
    return out;
}

/**
 * @param sentence whether the text is a paragraph of prose, which should end with punctuation
 */
function checkPhrasing({ text, cite_blocks }: Flattened, sentence: boolean, ctx: ConvertContext): void {
    const warn = (problem: string, at: number, block = ctx.block): void =>
        new ExporterError(`${problem}: “${excerpt(text, at)}”`, ["malformed content"]).warn({ ...ctx, block });

    let cite_index = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] !== CITE) continue;
        const block = cite_blocks[cite_index++] ?? ctx.block;
        const before = text.slice(0, i);
        const after = text.slice(i + 1);

        // Brackets on both sides are reported by `mergeAdjacent`
        const opened = /[([]\s*$/.test(before);
        const closed = /^\s*[)\]]/.test(after);
        if (opened !== closed) {
            warn(
                "A citation is next to a bracket; since brackets are automatically added, they show as doubled",
                i,
                block,
            );
        }

        if (/\S[ \t]{2,}$/.test(before)) warn("Extra space before a citation", i, block);
        else if (/[^\s([{—–]$/.test(before)) warn("No space before a citation", i, block);

        if (/[.!?]\s*$/.test(before) && !ABBREVIATION.test(before)) {
            warn("A citation comes after its sentence's period; it should come before it", i, block);
        }

        if (/^\s+[.,;:!?)\]]/.test(after)) warn("Space between a citation and the punctuation after it", i, block);
        else if (/^\s{2,}\S/.test(after)) warn("Extra space after a citation", i, block);
        else if (/^\s+[A-Z]/.test(after) && !/[:—–-]\s*$/.test(before)) {
            warn("No period after a citation before the next sentence", i, block);
        } else if (sentence && /^\s*$/.test(after) && /\s\S+\s+\S+\s*$/.test(before) && !/:\s*$/.test(before)) {
            warn("No period after a citation at the end of a paragraph", i, block);
        }
    }

    // Citations bring their own brackets, which `mergeAdjacent` checks
    checkBrackets(text.replaceAll(CITE, OPAQUE), warn);
}

function checkBrackets(text: string, warn: (problem: string, at: number) => void): void {
    for (const match of text.matchAll(/\(\s*\)|\[\s*\]|\{\s*\}/g)) {
        warn(`Empty brackets “${match[0].replace(/\s/g, "")}”`, match.index);
    }

    const open: { char: string; at: number }[] = [];
    for (let i = 0; i < text.length; i++) {
        const char = text[i]!;
        if (char === "(" || char === "[" || char === "{") {
            open.push({ char, at: i });
        } else if (char in PAIRS) {
            if (open.at(-1)?.char === PAIRS[char]) {
                open.pop();
                continue;
            }
            // Enumerations like `1)`, `b)` and `iv)`, and emoticons, close nothing
            if (char === ")" && /(?:^|[\s(])(?:\d{1,2}|[a-z]|[ivxlc]+)$|[:;]$/i.test(text.slice(0, i))) continue;
            if (open.length > 0) warn(`Mismatched brackets “${open.at(-1)!.char}…${char}”`, i);
            else warn(`Stray closing bracket “${char}”`, i);
            open.pop();
        }
    }
    for (const { char, at } of open) warn(`Unclosed bracket “${char}”`, at);
}

/**
 * The text around `at`, to find a problem by.
 */
function excerpt(text: string, at: number): string {
    const radius = 30;
    const start = Math.max(0, at - radius);
    const end = Math.min(text.length, at + radius);
    const shown = text.slice(start, end).replaceAll(CITE, "(n)").replaceAll(OPAQUE, "…").replace(/\n/g, " ");
    return `${start > 0 ? "…" : ""}${shown}${end < text.length ? "…" : ""}`;
}
