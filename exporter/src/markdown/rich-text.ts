import { type Id, PageId } from "../notion";
import { ExporterError, isExporterErr } from "../utils";
import type { ConvertContext } from "./blocks";
import { citation } from "./citations";
import { pageMention, parseNotionUrl, resolveHref, warnGoogleLink } from "./link";
import { jsxText } from "./mdx";
import type { RichTextItemResponse } from "@notionhq/client";
import type { PhrasingContent, Text } from "mdast";

/**
 * How line breaks are represented:
 * - `break`: a Markdown line break
 * - `jsx`: a `<br />` element, for places where a hard break is invalid (e.g. table cells)
 * - `space`: a plain space, for places that cannot hold a line break (e.g. headings)
 */
export type NewlineMode = "break" | "jsx" | "space";

type ProseRule = {
    id: string;
    term: RegExp;
    guidance: string;
    italics?: "required" | "forbidden";
    correct_spelling?: string;
    /** A correct use the term would otherwise match, tested where the match starts. */
    exempt?: RegExp;
    /**
     * Only checks text that directly follows a promoter equation, like `\mathrm{P}_\text{CpxP}`. `{promoter}` in the
     * guidance is replaced by the promoter's name.
     */
    after_promoter?: true;
};

/** Add prose checklist terms here. Gene and protein spellings are intentionally case-sensitive. */
const PROSE_RULES: ProseRule[] = [
    {
        id: "e-coli-italics",
        term: wholeTerm(/E\.?\s*coli/, true),
        guidance: "should be italicized",
        italics: "required",
    },
    {
        id: "escherichia-coli-italics",
        term: wholeTerm(/Escherichia\s+coli/, true),
        guidance: "should be italicized",
        italics: "required",
    },
    { id: "cpxp-italics", term: wholeTerm(/cpxP/), guidance: "should be italicized", italics: "required" },
    { id: "reca-italics", term: wholeTerm(/recA/), guidance: "should be italicized", italics: "required" },
    // The gene is italic, but the protein and plasmid names (sfGFP fluorescence, pCpxP-sfGFP) are not
    {
        id: "sfgfp-gene-italics",
        term: wholeTerm(/sfGFP(?=\s+genes?\b)/),
        guidance: "should be italicized when it names the gene",
        italics: "required",
    },
    // A promoter followed by the gene it drives, like P_CpxP-sfGFP, names the gene
    {
        id: "sfgfp-construct-italics",
        term: /(?<=^\s*[-–]\s*)sfGFP(?![\p{L}\p{N}])/gu,
        guidance:
            "should be italicized: a promoter followed by sfGFP describes the reporter construct, so sfGFP names the gene there (\\mathrm{P}_\\text{{promoter}}-*sfGFP*). To refer to the plasmid itself, use its name instead, like p{promoter}-sfGFP",
        italics: "required",
        after_promoter: true,
    },
    { id: "CpxP-plain", term: wholeTerm(/CpxP/), guidance: "should not be italicized", italics: "forbidden" },
    { id: "RecA-plain", term: wholeTerm(/RecA/), guidance: "should not be italicized", italics: "forbidden" },
    { id: "beta-lactam", term: wholeTerm(/Beta-lactam/, true), guidance: "should be β-lactam" },
    {
        id: "caulobacter",
        term: wholeTerm(/Caulobacter/, true),
        guidance: "did you copy content from last year?",
    },
    { id: "crescentus", term: wholeTerm(/crescentus/, true), guidance: "did you copy content from last year?" },
    { id: "utex", term: wholeTerm(/UTEX/, true), guidance: "did you copy content from last year?" },
    { id: "k-12-spelling", term: wholeTerm(/K-?12/, true), guidance: "should be K-12", correct_spelling: "K-12" },
    {
        id: "epi300-spelling",
        term: wholeTerm(/EPI-?300/, true),
        guidance: "should be EPI300",
        correct_spelling: "EPI300",
    },
    {
        id: "micro-symbol",
        term: /(?<=\d\s?)u(?:l|m|amp|k)(?![\p{L}\p{N}])/giu,
        guidance: "should use μ, not u",
    },
    // Inline equations aren't scanned, so these only fire on plain-text spellings.
    { id: "od600-latex", term: wholeTerm(/OD[\s_-]?(?:600|₆₀₀)/, true), guidance: "should be an equation: OD_{600}" },
    {
        id: "preca-latex",
        term: wholeTerm(/P[\s_-]?recA/, true),
        // The plasmid's name
        exempt: /^pRecA-sfGFP/,
        guidance: "should be an equation: \\mathrm{P}_\\text{RecA}",
    },
    {
        id: "pcpxp-latex",
        term: wholeTerm(/P[\s_-]?cpxP/, true),
        // The plasmid's name
        exempt: /^pCpxP-sfGFP/,
        guidance: "should be an equation: \\mathrm{P}_\\text{CpxP}",
    },
];

/** Promoters, written in equations as `\mathrm{P}_\text{<name>}`. */
const PROMOTERS = ["CpxP", "RecA"];

/**
 * Warns about promoters in an equation not written as `\mathrm{P}_\text{<name>}`, such as `P_{cpxP}` (an italic P) or
 * `\mathrm{P}_\textit{CpxP}`.
 */
export function warnLatexIssues(expression: string, ctx: ConvertContext): void {
    for (const name of PROMOTERS) {
        // A P, however it is styled, with a subscript naming the promoter, however it is styled or cased
        const promoter = new RegExp(
            String.raw`(?:\\(?:mathrm|text|textrm|mathit|textit)\s*\{\s*P\s*\}|(?<![\\\p{L}])P)\s*_\s*\{?\s*(?:\\[a-z]+\s*\{)?\s*${name}\s*\}?\s*\}?`,
            "giu",
        );
        const expected = String.raw`\mathrm{P}_\text{${name}}`;
        for (const match of expression.matchAll(promoter)) {
            const found = match[0].replace(/\s+/g, "");
            if (found === expected || found === String.raw`\mathrm{P}_{\text{${name}}}`) continue;

            const issue_key = [ctx.page.toString(), ctx.block?.toString() ?? "", `promoter-latex-${name}`].join(":");
            if (WARNED_PROSE_ISSUES.has(issue_key)) continue;
            WARNED_PROSE_ISSUES.add(issue_key);
            new ExporterError(`[${match[0]}: should be ${expected}]`, ["malformed content"]).warn(ctx);
        }
    }
}

/** Regex matches complete terms, including terms split across Notion rich-text segments. */
function wholeTerm(term: RegExp, ignore_case = false): RegExp {
    return new RegExp("(?<![\\p{L}\\p{N}])(?:" + term.source + ")(?![\\p{L}\\p{N}])", ignore_case ? "giu" : "gu");
}

const WARNED_PROSE_ISSUES = new Set<string>();

/**
 * @property cite the literature entry linked text cites, by citation key, and the block the text is in
 */
interface TextProperties {
    cite: { key: string; block?: Id } | null;
    href: string | null;
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
}

/**
 * A piece of text and its properties.
 */
interface Leaf {
    node: PhrasingContent | "newline";
    props: TextProperties;
}

export function asPlainText(items: RichTextItemResponse[]): string {
    return items.map((item) => item.plain_text).join("");
}

/**
 * Converts Notion rich text into phrasing content. Text is kept literally (Markdown syntax typed into Notion is escaped).
 */
export async function convertRichText(
    items: RichTextItemResponse[],
    ctx: ConvertContext,
    newline: NewlineMode = "break",
): Promise<PhrasingContent[]> {
    const leaves = (await Promise.all(items.map((item) => itemLeaves(item, ctx)))).flat();
    trimLeaves(leaves);
    warnProseIssues(leaves, ctx);

    const newline_node: PhrasingContent =
        newline === "break" ? { type: "break" } : newline === "jsx" ? jsxText("br") : { type: "text", value: " " };
    const resolved = leaves.map((leaf) => ({ ...leaf, node: leaf.node === "newline" ? newline_node : leaf.node }));

    return applyProperties(resolved, 0);
}

async function itemLeaves(item: RichTextItemResponse, ctx: ConvertContext): Promise<Leaf[]> {
    const props: TextProperties = {
        cite: null,
        href: null,
        bold: item.annotations.bold,
        italic: item.annotations.italic,
        strikethrough: item.annotations.strikethrough,
        underline: item.annotations.underline,
    };

    switch (item.type) {
        case "text": {
            if (/%\\?\{[\s\S]*\}%/.test(item.text.content))
                new ExporterError(`Text contains an inline component, which is no longer supported.`, [
                    "malformed content",
                ]).warn(ctx);

            if (item.href) {
                const href_res = await resolveHref(item.href, ctx);
                if (isExporterErr(href_res)) href_res.warn(ctx);
                // Linked text cites the entry it links to
                else if (href_res.citation) props.cite = { key: href_res.citation.citation_key, block: ctx.block };
                else props.href = href_res.url;
            }

            if (item.annotations.code)
                return [{ node: { type: "inlineCode", value: item.text.content.replaceAll("\n", " ") }, props: props }];

            return item.text.content
                .split("\n")
                .flatMap((line, i): Leaf[] => [
                    ...(i > 0 ? [{ node: "newline" as const, props }] : []),
                    ...(line ? [{ node: { type: "text" as const, value: line }, props }] : []),
                ]);
        }
        case "equation":
            warnLatexIssues(item.equation.expression, ctx);
            return [{ node: { type: "inlineMath", value: item.equation.expression }, props }];
        case "mention": {
            const mention = item.mention;

            let node: PhrasingContent;
            switch (mention.type) {
                case "link_mention":
                    warnGoogleLink(mention.link_mention.href, ctx);
                    node = {
                        type: "link",
                        url: mention.link_mention.href,
                        children: [{ type: "text", value: mention.link_mention.title ?? mention.link_mention.href }],
                    };
                    break;
                case "link_preview":
                    warnGoogleLink(mention.link_preview.url, ctx);
                    node = {
                        type: "link",
                        url: mention.link_preview.url,
                        children: [{ type: "text", value: mention.link_preview.url }],
                    };
                    break;
                case "page": {
                    // A mention of a block is a page mention whose URL names the block
                    const block_id = item.href ? parseNotionUrl(item.href)?.block : undefined;
                    const block = block_id ? { id: block_id, text: item.plain_text.trim() } : undefined;
                    const page_node_res = await pageMention(new PageId(mention.page.id), ctx, block);
                    if (isExporterErr(page_node_res)) {
                        page_node_res.warn(ctx);
                        return [];
                    }
                    node = page_node_res;
                    break;
                }
                case "date": {
                    const { start, end } = mention.date;
                    node = {
                        type: "text",
                        value: end ? `${formatDate(start)} to ${formatDate(end)}` : formatDate(start),
                    };
                    break;
                }
                default:
                    new ExporterError(
                        `A ${mention.type} mention ("${item.plain_text}") is unsupported and was ignored.`,
                        ["malformed content"],
                    ).warn(ctx);
                    return [];
            }
            return [{ node, props }];
        }
    }
}

/**
 * Reports prose checklist issues without changing the exported text or its annotations.
 * Text leaves can be split by Notion formatting, so scan contiguous text as one string.
 */
function warnProseIssues(leaves: Leaf[], ctx: ConvertContext): void {
    let position = 0;
    while (position < leaves.length) {
        const first = leaves[position]!.node;
        if (first === "newline" || first.type !== "text") {
            position++;
            continue;
        }

        const before = leaves[position - 1]?.node;
        // The promoter an equation just before this text ends with, if any
        const after_promoter =
            before !== undefined && before !== "newline" && before.type === "inlineMath"
                ? new RegExp(String.raw`\\text\s*\{\s*(${PROMOTERS.join("|")})\s*\}\s*\}?\s*$`).exec(before.value)?.[1]
                : undefined;

        const spans: { start: number; end: number; italic: boolean }[] = [];
        let text = "";
        while (position < leaves.length) {
            const leaf = leaves[position]!;
            if (leaf.node === "newline" || leaf.node.type !== "text") break;
            const start = text.length;
            text += leaf.node.value;
            spans.push({ start, end: text.length, italic: leaf.props.italic });
            position++;
        }

        for (const rule of PROSE_RULES) {
            if (rule.after_promoter && !after_promoter) continue;
            for (const match of text.matchAll(rule.term)) {
                const found = match[0];
                if (found === rule.correct_spelling) continue;

                const start = match.index!;
                if (rule.exempt?.test(text.slice(start))) continue;
                const end = start + found.length;
                const covered = spans.filter((span) => span.start < end && span.end > start);
                if (rule.italics === "required" && covered.every((span) => span.italic)) continue;
                if (rule.italics === "forbidden" && covered.every((span) => !span.italic)) continue;

                const issue_key = [ctx.page.toString(), ctx.block?.toString() ?? "", rule.id].join(":");
                if (WARNED_PROSE_ISSUES.has(issue_key)) continue;
                WARNED_PROSE_ISSUES.add(issue_key);
                const guidance = rule.guidance.replaceAll("{promoter}", after_promoter ?? "");
                new ExporterError("[" + found + ": " + guidance + "]", ["malformed content"]).warn(ctx);
            }
        }
    }
}

/**
 * Formats a Notion date (`YYYY-MM-DD`, optionally with a time) as `DD/MM/YYYY` or `DD/MM/YYYY at HH:mm`.
 */
function formatDate(date: string): string {
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
    if (!match) return date;

    const [, year, month, day, hour, minute] = match;
    const formatted = `${day}/${month}/${year}`;
    return hour ? `${formatted} at ${hour}:${minute}` : formatted;
}

/**
 * Removes leading and trailing whitespace/line break leaves.
 */
function trimLeaves(leaves: Leaf[]): void {
    const trimEnd = (index: () => number, trim: (s: string) => string): void => {
        while (leaves.length > 0) {
            const i = index();
            const leaf = leaves[i]!;
            if (leaf.node !== "newline") {
                if (leaf.node.type !== "text") return;
                leaf.node = { ...leaf.node, value: trim(leaf.node.value) };
                if (leaf.node.value !== "") return;
            }
            leaves.splice(i, 1);
        }
    };

    trimEnd(
        () => 0,
        (s) => s.trimStart(),
    );
    trimEnd(
        () => leaves.length - 1,
        (s) => s.trimEnd(),
    );
}

interface TextProperty {
    /** Leaves with identical keys are wrapped together; `null` means the leaf is unstyled. */
    key(marks: TextProperties): string | null;
    /** Wrap `children` in a MDAST styling node. */
    wrap(marks: TextProperties, children: PhrasingContent[]): PhrasingContent;
    /** Whether whitespace must be moved out of the mark for it to stringify cleanly. */
    hoist_whitespace: boolean;
}

const PROP_GENERATORS: TextProperty[] = [
    {
        key: (m) => m.cite?.key ?? null,
        wrap: (m, children) => citation([m.cite!.key], m.cite!.block, children),
        hoist_whitespace: true,
    },
    {
        key: (m) => m.href,
        wrap: (m, children) => ({ type: "link", url: m.href!, children }),
        hoist_whitespace: false,
    },
    {
        key: (m) => (m.bold ? "" : null),
        wrap: (_, children) => ({ type: "strong", children }),
        hoist_whitespace: true,
    },
    {
        key: (m) => (m.italic ? "" : null),
        wrap: (_, children) => ({ type: "emphasis", children }),
        hoist_whitespace: true,
    },
    {
        key: (m) => (m.strikethrough ? "" : null),
        wrap: (_, children) => ({ type: "delete", children }),
        hoist_whitespace: true,
    },
    {
        key: (m) => (m.underline ? "" : null),
        wrap: (_, children) => jsxText("u", {}, children),
        hoist_whitespace: false,
    },
];

function applyProperties(leaves: { node: PhrasingContent; props: TextProperties }[], level: number): PhrasingContent[] {
    // The current property being applied
    const prop = PROP_GENERATORS[level];
    if (!prop) return leaves.map((leaf) => leaf.node);

    const output: PhrasingContent[] = [];
    let start = 0;
    while (start < leaves.length) {
        const key = prop.key(leaves[start]!.props);
        let end = start + 1;
        // Side-by-side regions with an identical property should join
        while (end < leaves.length && prop.key(leaves[end]!.props) === key) end++;

        const run = leaves.slice(start, end);
        // Try to apply the next property
        const children = applyProperties(run, level + 1);
        if (key === null) output.push(...children);
        else if (prop.hoist_whitespace)
            output.push(...wrapHoistingWhitespace(children, (c) => prop.wrap(run[0]!.props, c)));
        else output.push(prop.wrap(run[0]!.props, children));

        start = end;
    }

    return output;
}

/**
 * Emphasis cannot start or end with whitespace in Markdown, so move it outside the wrapping node.
 */
function wrapHoistingWhitespace(
    children: PhrasingContent[],
    wrap: (children: PhrasingContent[]) => PhrasingContent,
): PhrasingContent[] {
    const inner = [...children];
    let leading = "";
    let trailing = "";

    const first = inner[0];
    if (first?.type === "text") {
        const trimmed = first.value.trimStart();
        leading = first.value.slice(0, first.value.length - trimmed.length);
        if (trimmed) inner[0] = { type: "text", value: trimmed };
        else inner.shift();
    }

    const last = inner.at(-1);
    if (last?.type === "text") {
        const trimmed = last.value.trimEnd();
        trailing = last.value.slice(trimmed.length);
        if (trimmed) inner[inner.length - 1] = { type: "text", value: trimmed };
        else inner.pop();
    }

    const text = (value: string): Text[] => (value ? [{ type: "text", value }] : []);
    if (inner.length === 0) return text(leading + trailing);

    return [...text(leading), wrap(inner), ...text(trailing)];
}
