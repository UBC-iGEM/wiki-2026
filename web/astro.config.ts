// @ts-check
import { CONFIG } from "../exporter/src/config";
import { CODE_THEME } from "./src/code-theme";
import { unified } from "@astrojs/markdown-remark";
import mdx from "@astrojs/mdx";
import linkValidator from "astro-link-validator";
import { defineConfig, fontProviders } from "astro/config";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import rehypeKatex from "rehype-katex";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";

const INTERNAL_LINK_ROOT = CONFIG.internal_link_root;

const projectPage = (ext: string): string => `${INTERNAL_LINK_ROOT}/project/${ext}`;

/** A package's build directory, which holds its main entry, as its `exports` hide its prebuilt bundles there. */
const buildDir = (pkg: string): string => dirname(createRequire(import.meta.url).resolve(pkg));

// https://astro.build/config
export default defineConfig({
    base: INTERNAL_LINK_ROOT,
    // Astro 7 strips whitespace between inline elements by default, which runs adjacent links and text together
    compressHTML: true,
    // Every internal link starts fetching its page on hover, so the ClientRouter rarely waits on the network
    prefetch: {
        prefetchAll: true,
        defaultStrategy: "hover",
    },
    redirects: {
        "/description": projectPage("description"),
        "/engineering": projectPage("engineering-success"),
        "/results": projectPage("results"),
        "/contribution": projectPage("contribution"),
        "/human-practices": projectPage("human-practices"),
        "/measurement": projectPage("best-measurement"),
        "/hardware": projectPage("best-hardware"),
    },
    fonts: [
        {
            provider: fontProviders.fontsource(),
            name: "Geist",
            cssVariable: "--font-geist",
            weights: [400, 600, 700],
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
        shikiConfig: { theme: CODE_THEME },
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
    // `optimize` renders each page's static markup (most of all KaTeX's) as HTML strings rather than a tree of JSX
    // calls, which shrinks the code the server build has to bundle
    integrations: [mdx({ optimize: true }), linkValidator()],
    vite: {
        resolve: {
            // Vega's prebuilt bundles, for components/Vega.astro
            alias: {
                "vega-build": buildDir("vega"),
                "vega-lite-build": buildDir("vega-lite"),
                "vega-embed-build": buildDir("vega-embed"),
            },
        },
        // The client scripts' npm dependencies, bundled when the dev server starts. Otherwise Vite finds each the
        // first time a page using it is visited and reloads the page, and as utils/transitions.ts imports the next
        // page's scripts before the URL changes, that reload lands back on the page being left
        optimizeDeps: {
            include: [
                "gsap",
                "gsap/DrawSVGPlugin",
                "gsap/MotionPathPlugin",
                "gsap/ScrollTrigger",
                "lenis",
                "react",
                "react-dom/client",
                "seqviz",
            ],
        },
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
