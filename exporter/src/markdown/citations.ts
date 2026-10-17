import type { Id } from "../notion";
import { ExporterError } from "../utils";
import type { ConvertContext } from "./blocks";
import { jsxFlow, jsxText } from "./mdx";
import type { Nodes, PhrasingContent, Root } from "mdast";
import type { MdxJsxTextElement } from "mdast-util-mdx-jsx";

/**
 * A literature entry cited on a page, and its number in the page's bibliography.
 *
 * @property key the entry's citation key, which `litdb.json` is keyed by
 */
export interface CitedRef {
    n: number;
    key: string;
}

/**
 * @property prose whether the citation is a run of text (its children) rather than a number in parentheses
 */
export interface CiteAttrs {
    refs: CitedRef[];
    prose?: boolean;
}

export interface BibliographyAttrs {
    refs: CitedRef[];
}

/**
 * What a citation cites, before the page is numbered. Kept in the node's `data`, as attributes are only written once numbered.
 *
 * @property block the block the citation is in, so warnings about it point there
 */
interface PendingCite {
    keys: string[];
    prose: boolean;
    block?: Id;
}

type CiteNode = MdxJsxTextElement & { data: { cite: PendingCite } };

/**
 * A citation of one or more literature entries, numbered by {@link numberCitations} once the page is converted.
 *
 * @param block the block the citation is in
 * @param prose the text that cites the entries; without it, the citation shows their numbers
 */
export function citation(keys: string[], block: Id | undefined, prose?: PhrasingContent[]): MdxJsxTextElement {
    const node = jsxText("Cite", {}, prose ?? []) as CiteNode;
    node.data = { cite: { keys, prose: prose !== undefined, block } };
    return node;
}

function isCite(node: Nodes | undefined): node is CiteNode {
    return node?.type === "mdxJsxTextElement" && node.data !== undefined && "cite" in node.data;
}

/**
 * Numbers the entries a page cites in the order they are first cited, and adds the page's bibliography at its end.
 */
export function numberCitations(tree: Root, ctx: ConvertContext): void {
    const numbers = new Map<string, number>();

    const visit = (node: Nodes): void => {
        if (!("children" in node)) return;
        mergeAdjacent(node.children as Nodes[], ctx);

        for (const child of node.children as Nodes[]) {
            if (isCite(child)) {
                const refs = child.data.cite.keys.map((key): CitedRef => {
                    if (!numbers.has(key)) numbers.set(key, numbers.size + 1);
                    return { n: numbers.get(key)!, key };
                });
                if (!child.data.cite.prose) refs.sort((a, b) => a.n - b.n);

                const attrs: CiteAttrs = child.data.cite.prose ? { refs, prose: true } : { refs };
                child.attributes = jsxText("Cite", attrs).attributes;
            }
            visit(child);
        }
    };
    visit(tree);

    if (numbers.size === 0) return;

    const refs: CitedRef[] = [...numbers].map(([key, n]) => ({ n, key }));
    tree.children.push(
        { type: "heading", depth: 1, children: [{ type: "text", value: "References" }] },
        jsxFlow("Bibliography", { refs } satisfies BibliographyAttrs),
    );
}

/**
 * Joins numbered citations separated only by spaces or punctuation (`(1), (2)` becomes `(1, 2)`),
 * and warns about brackets the author typed around them, as the citation brings its own.
 */
function mergeAdjacent(children: Nodes[], ctx: ConvertContext): void {
    for (let i = 0; i < children.length; i++) {
        const node = children[i];
        if (!isCite(node) || node.data.cite.prose) continue;

        // Absorb following citations
        while (true) {
            const between = children[i + 1];
            const next = isCite(between) ? between : children[i + 2];
            const separator = isCite(between) ? undefined : between;
            if (!isCite(next) || next.data.cite.prose) break;
            if (separator && !(separator.type === "text" && /^[\s,;]*$/.test(separator.value))) break;

            node.data.cite.keys = [...new Set([...node.data.cite.keys, ...next.data.cite.keys])];
            children.splice(i + 1, separator ? 2 : 1);
        }

        const before = children[i - 1];
        const after = children[i + 1];
        if (before?.type !== "text" || after?.type !== "text") continue;
        if (!/[([]\s*$/.test(before.value) || !/^\s*[)\]]/.test(after.value)) continue;
        new ExporterError(
            `A citation is wrapped in brackets; since brackets are automatically added, they show as doubled.`,
            ["malformed content"],
        ).warn({ ...ctx, block: node.data.cite.block ?? ctx.block });
    }
}
