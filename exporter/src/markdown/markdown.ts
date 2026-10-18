import { isExporterErr, saveFile } from "../utils";
import { convertBlocks, type ConvertContext } from "./blocks";
import { numberCitations } from "./citations";
import { proofread } from "./proofread";
import type { Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkMdx from "remark-mdx";
import remarkStringify from "remark-stringify";
import { unified } from "unified";

export interface PageAttrs {
    type: "page";
    title: string;
}

export interface DatabaseAttrs {
    type: "database";
    title: string;
    path: string;
    date?: string;
}

export type MarkdownHeader = PageAttrs | DatabaseAttrs;

const mdStringifier = unified()
    .use(remarkMdx)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkStringify, { bullet: "-", resourceLink: true });

/**
 * Converts a page's Notion blocks to MDX and saves it.
 */
export async function exportPageMarkdown(ctx: ConvertContext): Promise<void> {
    const { path, page: id } = ctx;

    const blocks_res = await id.getBlocks();
    if (isExporterErr(blocks_res)) return blocks_res.warn(ctx);

    const tree: Root = { type: "root", children: await convertBlocks(blocks_res, ctx) };
    numberCitations(tree, ctx);
    proofread(tree, ctx);
    const processed_markdown = mdStringifier.stringify(tree);

    const type = path.components().length === 3 ? "database" : "page";
    const title = path.name().toString();
    const date: string | undefined = type === "database" ? await id.getDate() : undefined;

    const header_items: MarkdownHeader =
        type === "page" ? { type, title } : { type, title, path: path.toString(), date };

    const page_header = Object.entries(header_items)
        .filter(([, value]) => value !== undefined)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join("\n");
    const page = `
---
${page_header}
---

${processed_markdown}
`.trim();

    const raw_result = await saveFile({
        content: JSON.stringify(blocks_res, null, 2),
        path: path.withExt("json"),
        debug_path: "raw",
    });
    if (isExporterErr(raw_result)) raw_result.warn(ctx);

    const result = await saveFile({ content: page, path: path.withExt("mdx") });
    if (isExporterErr(result)) result.warn(ctx);
}
