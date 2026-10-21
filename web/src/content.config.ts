import { glob } from "astro/loaders";
import { defineCollection } from "astro:content";

const DOCS = defineCollection({
    loader: glob({
        base: "./docs",
        pattern: "**/*.mdx",
        // Nothing reads an entry's raw MDX, which would otherwise be bundled into the build for every page
        retainBody: false,
    }),
});

// Astro requires this export name.
// eslint-disable-next-line @typescript-eslint/naming-convention
export const collections = { docs: DOCS };
