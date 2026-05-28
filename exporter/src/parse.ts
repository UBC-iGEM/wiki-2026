import * as log from "./log";
import { AggregateMap, ContentMap, PagePathComponent, type MapItem, type MapPath } from "./map";
import { processMarkdown } from "./markdown/markdown";
import { PageId, DatabaseId, BlockId } from "./notion";
import { $unsafe, isErr, type Result } from "./utils";

export async function parseMaster(master_id: PageId): Promise<Result<ContentMap>> {
    const master_entries = await getAggregateEntries({ agg_id: master_id });
    if (isErr(master_entries)) return master_entries;

    if (master_entries.find((page) => page instanceof DatabaseId))
        return new Error("Database links not supported in master page");
    const aggregate_pages = master_entries as PageId[];

    const aggregate_maps = await Promise.all(aggregate_pages.map(async (agg_id) => parseAggregate({ agg_id })));

    const first_error = aggregate_maps.find((item) => isErr(item));
    if (first_error) return first_error;

    return new ContentMap(aggregate_maps as MapItem<AggregateMap>[]);
}

export async function parseAggregate({ agg_id }: { agg_id: PageId }): Promise<Result<MapItem<AggregateMap>>> {
    const agg_name = await agg_id.getName();
    if (isErr(agg_name)) return agg_name;

    const agg_entries = await getAggregateEntries({ agg_id });
    if (isErr(agg_entries)) return agg_entries;

    /** Use {@link $unsafe} scope to fail-fast on inner errors */
    return $unsafe(async () => {
        const paths = await Promise.all(
            agg_entries.map(async (entry) => {
                const res = await entry.paths();
                if (isErr(res)) throw res;

                return res;
            }),
        );
        return { item: new AggregateMap(paths), path: new PagePathComponent(agg_name) };
    });
}

async function getAggregateEntries({ agg_id }: { agg_id: PageId }): Promise<Result<(PageId | DatabaseId)[]>> {
    const agg_block = new BlockId(agg_id.toString());
    const blocks = await agg_block.getChildren();
    if (isErr(blocks)) return blocks;

    const pageIds = [];
    block_loop: for (const block of blocks) {
        if (block.type === "paragraph") {
            // Skip empty whitespace
            if (block.paragraph.rich_text.length === 0) continue block_loop;

            for (const item of block.paragraph.rich_text) {
                // Skip empty whitespace
                if (item.type === "text" && item.text.content.trim() === "") continue;

                if (item.type === "mention") {
                    switch (item.mention.type) {
                        case "page":
                            pageIds.push(new PageId(item.mention.page.id));
                            break;
                        case "database":
                            pageIds.push(new DatabaseId(item.mention.database.id));
                            break;
                        default:
                            return new Error(
                                `Aggregate ${agg_id} contains unsupported mention type ${item.mention.type}`,
                            );
                    }
                } else {
                    return new Error(
                        `Aggregate ${agg_id} contains Paragraph with non-mention element of type ${item.type}: ${item.plain_text}`,
                    );
                }
            }

            continue block_loop;
        }

        if (block.type !== "link_to_page") {
            return new Error(`Aggregate ${agg_id} contains unrecognized block type "${block.type}"`);
        }

        switch (block.link_to_page.type) {
            case "page_id":
                pageIds.push(new PageId(block.link_to_page.page_id));
                continue block_loop;
            case "database_id":
                pageIds.push(new DatabaseId(block.link_to_page.database_id));
                continue block_loop;
            case "comment_id":
                return new Error(`Aggregate ${agg_id} contains link to comment ${block.link_to_page.comment_id}"`);
        }
    }

    return pageIds;
}

export async function exportAllPages({ content_map }: { content_map: ContentMap }) {
    await Promise.all(content_map.pages().map((page) => exportPage({ page, content_map })));
}

async function exportPage({
    page: { item, path },
    content_map: routes,
}: {
    page: MapPath<PageId>;
    content_map: ContentMap;
}) {
    const markdown = await item.getMarkdown();
    if (isErr(markdown)) {
        log.warn_error(markdown);
        return;
    }

    await processMarkdown({ md: markdown, path, routes });
}
