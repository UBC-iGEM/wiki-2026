// @ts-check
import { unified } from "@astrojs/markdown-remark";
import mdx from "@astrojs/mdx";
import { defineConfig } from "astro/config";
import rehypeKatex from "rehype-katex";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";

// https://astro.build/config
export default defineConfig({
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
            ],
        }),
    },
    integrations: [mdx()],
});
