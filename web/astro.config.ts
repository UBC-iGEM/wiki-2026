// @ts-check
import mdx from "@astrojs/mdx";
import { defineConfig } from "astro/config";
import remarkMath from "remark-math";

// https://astro.build/config
export default defineConfig({
    integrations: [
        mdx({
            remarkPlugins: [remarkMath],
        }),
    ],
});
