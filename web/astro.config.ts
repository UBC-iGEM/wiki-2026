// @ts-check
import { ContentMap, type JsonMap } from "../exporter/src/map";
import contentMap from "./docs/content_map.json";
import { unified } from "@astrojs/markdown-remark";
import mdx from "@astrojs/mdx";
import { defineConfig } from "astro/config";
import type { Root, RootContent } from "hast";
import rehypeCitation from "rehype-citation";
import rehypeKatex from "rehype-katex";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";

const WIKI_BASE_PATH = "/ubc-vancouver";

const CONTENT_MAP = ContentMap.fromJSON(contentMap as JsonMap);
const INTERNAL_ROUTES = new Set([
    "/",
    ...Array.from(CONTENT_MAP.pages(), ({ path }) => `/${path.toSlug()}`),
    ...CONTENT_MAP.static_links.map(({ href }) => href),
]);

function rebaseInternalLinks() {
    return (tree: Root): void => {
        const visitNode = (node: Root | RootContent): void => {
            if (node.type === "element" && node.tagName === "a" && typeof node.properties.href === "string") {
                const href = node.properties.href;
                const match = /^(?<path>[^?#]*)(?<suffix>[?#].*)?$/.exec(href);
                const path = match?.groups?.path;

                if (path && INTERNAL_ROUTES.has(path)) {
                    node.properties.href = `${WIKI_BASE_PATH}${path === "/" ? "/" : path}${match?.groups?.suffix ?? ""}`;
                }
            }

            if ("children" in node) {
                for (const child of node.children) visitNode(child);
            }
        };

        visitNode(tree);
    };
}

// https://astro.build/config
export default defineConfig({
    base: WIKI_BASE_PATH,
    markdown: {
        processor: unified({
            remarkPlugins: [remarkMath, remarkBreaks],
            rehypePlugins: [
                rebaseInternalLinks,
                [
                    rehypeKatex,
                    {
                        strict: false,
                    },
                ],
                [
                    rehypeCitation,
                    {
                        bibliography: "./docs/litdb.bib",
                        csl: "vancouver",
                        linkCitations: true,
                        showTooltips: true,
                        path: process.cwd(),
                    },
                ],
            ],
        }),
    },
    integrations: [mdx()],
});
