// @ts-check
import { unified } from "@astrojs/markdown-remark";
import mdx from "@astrojs/mdx";
import { defineConfig, fontProviders } from "astro/config";
import rehypeCitation from "rehype-citation";
import rehypeKatex from "rehype-katex";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";

// https://astro.build/config
export default defineConfig({
    fonts: [
        {
            provider: fontProviders.fontsource(),
            name: "Geist",
            cssVariable: "--font-geist",
            weights: [400, 700],
            styles: ["normal"],
        },
        {
            provider: fontProviders.fontsource(),
            name: "Source Serif 4",
            cssVariable: "--font-source-serif-4",
            weights: [400, 700],
            styles: ["normal"],
        },
    ],

    markdown: {
        processor: unified({
            remarkPlugins: [remarkMath, remarkBreaks],
            rehypePlugins: [
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
