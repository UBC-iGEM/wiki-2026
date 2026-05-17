import { PageId, DatabaseId, BlockId } from "./notion";
import { isErr, type Result } from "./utils";
import * as log from "./log";
import { processMarkdown } from "./markdown";

export class PagePath {
    constructor(public path: string) {}

    with(other: PagePath): PagePath {
        return new PagePath(`${this.path}/${other.path}`);
    }

    withExt(ext: string): PagePath {
        return new PagePath(`${this.path}.${ext}`);
    }

    components(): string[] {
        return this.path.split("/");
    }
}
export type RouteMap = Record<string, PagePath>;

export async function parseAggregates({ agg_ids }: { agg_ids: PageId[] }): Promise<Result<RouteMap>> {
    try {
        const route_map: RouteMap = {};

        await Promise.all(
            agg_ids.map(async (id) => {
                const agg_name = await id.getName();
                if (isErr(agg_name)) throw agg_name;

                const entries = await getAggregateEntries({ agg_id: id });
                if (isErr(entries)) throw entries;

                await Promise.all(
                    entries.map(async (item) => {
                        const paths = await item.getPaths();
                        if (isErr(paths)) throw paths;

                        for (const [id, path] of paths) {
                            id.sanitize();
                            route_map[id.id] = new PagePath(agg_name).with(path);
                        }
                    }),
                );
            }),
        );

        return route_map;
    } catch (error) {
        return error as Error;
    }
}

async function getAggregateEntries({ agg_id }: { agg_id: PageId }): Promise<Result<(PageId | DatabaseId)[]>> {
    const agg_block = new BlockId(agg_id.id);
    const blocks = await agg_block.getChildren();
    if (isErr(blocks)) return blocks;

    const pageIds = [];
    for (const block of blocks) {
        if (block.type === "paragraph" && block.paragraph.rich_text.length === 0) {
            // Empty whitespace
            continue;
        }

        if (block.type !== "link_to_page") {
            return new Error(`Aggregate ${agg_id} contains unrecognized block type "${block.type}"`);
        }

        switch (block.link_to_page.type) {
            case "page_id":
                pageIds.push(new PageId(block.link_to_page.page_id));
                break;
            case "database_id":
                pageIds.push(new DatabaseId(block.link_to_page.database_id));
                break;
            case "comment_id":
                return new Error(`Aggregate ${agg_id} contains link to comment ${block.link_to_page.comment_id}"`);
        }
    }

    return pageIds;
}

export async function exportAllPages({ pages }: { pages: RouteMap }) {
    await Promise.all(
        Object.entries(pages).map(([id, path]) => exportPage({ page: [new PageId(id), path], routes: pages })),
    );
}

async function exportPage({ page: [id, path], routes }: { page: [PageId, PagePath]; routes: RouteMap }) {
    const markdown = await id.getMarkdown();
    if (isErr(markdown)) {
        log.warn_error(markdown);
        return;
    }

    await processMarkdown({ md: markdown, path, routes });
}
