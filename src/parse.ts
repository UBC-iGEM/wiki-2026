import { PageId, DatabaseId, BlockId } from "./notion";
import type { Result } from "./utils";
import { isErr } from "./utils";

export class PagePath {
    constructor(public path: string) {}

    with(other: PagePath): PagePath {
        return new PagePath(`${this.path}/${other.path}`);
    }
}

export async function parseAggregates({ agg_ids }: { agg_ids: PageId[] }): Promise<Result<Map<PageId, PagePath>>> {
    try {
        const id_path_map = new Map();

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

                        for (const [id, path] of paths) id_path_map.set(id, new PagePath(agg_name).with(path));
                    }),
                );
            }),
        );

        return id_path_map;
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
