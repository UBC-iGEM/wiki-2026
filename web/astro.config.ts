// @ts-check
import { CONFIG } from "../exporter/src/config";
import { unified } from "@astrojs/markdown-remark";
import mdx from "@astrojs/mdx";
import { defineConfig, fontProviders } from "astro/config";
import rehypeKatex from "rehype-katex";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";

const INTERNAL_LINK_ROOT = CONFIG.internal_link_root;

const projectPage = (ext: string): string => `${INTERNAL_LINK_ROOT}/project/${ext}`;

// https://astro.build/config
export default defineConfig({
    base: INTERNAL_LINK_ROOT,
    redirects: {
        "/description": projectPage("description"),
        "/engineering": projectPage("engineering-success"),
        "/results": projectPage("results"),
        "/contribution": projectPage("contribution"),
        "/human-practices": projectPage("human-practices"),
    },
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
            ],
        }),
    },
    integrations: [mdx()],
    vite: {
        build: {
            rollupOptions: {
                output: {
                    assetFileNames: "_astro/[hash][extname]",
                    chunkFileNames: "_astro/[hash].js",
                },
            },
        },
    },
});
