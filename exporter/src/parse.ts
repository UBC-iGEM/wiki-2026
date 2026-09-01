import { AggregateMap, ContentMap, PagePathComponent, type MapPath } from "./map";
import { processMarkdown } from "./markdown/markdown";
import { PageId, DatabaseId, BlockId } from "./notion";
import { $unsafeExporterPromises, ExporterError, isExporterErr, type ExporterResult } from "./utils";

export async function parseMaster(master_id: PageId): Promise<ExporterResult<ContentMap>> {
    const master_entries = await getAggregateEntries({ agg_id: master_id });
    if (isExporterErr(master_entries)) return master_entries;

    const database_page_link = master_entries.find((page) => page instanceof DatabaseId);
    if (database_page_link)
        return new ExporterError(
            `The master aggregate page contains a link to the database at Notion ID ${database_page_link}. Database links are unsupported on the master aggregate page.`,
            ["malformed content"],
        );
    const aggregate_pages = master_entries as PageId[];

    const aggregate_maps = await Promise.all(aggregate_pages.map(async (agg_id) => parseAggregate({ agg_id })));

    const first_error = aggregate_maps.find((item) => isExporterErr(item));
    if (first_error) return first_error;

    return new ContentMap(aggregate_maps as AggregateMap[]);
}

export async function parseAggregate({ agg_id }: { agg_id: PageId }): Promise<ExporterResult<AggregateMap>> {
    const agg_name = await agg_id.getName();
    if (isExporterErr(agg_name)) return agg_name;

    const agg_entries = await getAggregateEntries({ agg_id });
    if (isExporterErr(agg_entries)) return agg_entries;

    /** Use {@link $unsafe} scope to fail-fast on inner errors */
    return $unsafeExporterPromises(async () => {
        const paths = await Promise.all(
            agg_entries.map(async (entry) => {
                const res = await entry.paths();
                if (isExporterErr(res)) throw res;

                return res;
            }),
        );
        return new AggregateMap({ name: new PagePathComponent(agg_name), entries: paths });
    });
}

async function getAggregateEntries({ agg_id }: { agg_id: PageId }): Promise<ExporterResult<(PageId | DatabaseId)[]>> {
    const agg_block = new BlockId(agg_id.toString());
    const blocks = await agg_block.getChildren();
    if (isExporterErr(blocks)) return blocks;

    const page_ids = [];
    block_loop: for (const block of blocks) {
        if (
            block.type !== "paragraph" &&
            block.type !== "link_to_page" &&
            block.type !== "child_page" &&
            block.type !== "child_database"
        ) {
            return new ExporterError(
                `Aggregate page at Notion ID ${agg_id} contains unrecognized block type ${block.type}. Aggregate pages should only contain mentions, link_to_page blocks, and child pages.`,
                ["malformed content"],
            );
        }

        switch (block.type) {
            case "paragraph": {
                // Skip empty whitespace
                if (block.paragraph.rich_text.length === 0) continue block_loop;

                for (const item of block.paragraph.rich_text) {
                    // Skip empty whitespace
                    if (item.type === "text" && item.text.content.trim() === "") continue;

                    if (item.type === "mention") {
                        switch (item.mention.type) {
                            case "page":
                                page_ids.push(new PageId(item.mention.page.id));
                                break;
                            case "database":
                                page_ids.push(new DatabaseId(item.mention.database.id));
                                break;
                            default:
                                return new ExporterError(
                                    `Aggregate page at Notion ID ${agg_id} contains unsupported mention type ${item.mention.type}.`,
                                    ["malformed content"],
                                );
                        }
                    } else {
                        return new ExporterError(
                            `Aggregate page at Notion ID ${agg_id} contains a paragraph block with a non-mention element of type ${item.type} and content "${item.plain_text}".`,
                            ["malformed content"],
                        );
                    }
                }

                break;
            }
            case "link_to_page": {
                switch (block.link_to_page.type) {
                    case "page_id":
                        page_ids.push(new PageId(block.link_to_page.page_id));
                        break;
                    case "database_id":
                        page_ids.push(new DatabaseId(block.link_to_page.database_id));
                        break;
                    case "comment_id":
                        return new ExporterError(
                            `Aggregate page at Notion ID ${agg_id} contains a link to a comment at Notion ID ${block.link_to_page.comment_id}.`,
                            ["malformed content"],
                        );
                }
                break;
            }
            case "child_page": {
                page_ids.push(new PageId(block.id));
                break;
            }
            case "child_database": {
                page_ids.push(new DatabaseId(block.id));
                break;
            }
        }
    }

    return page_ids;
}

export async function exportAllPages({ content_map }: { content_map: ContentMap }): Promise<void> {
    await Promise.all(content_map.pages().map((page) => exportPage({ page, content_map })));
}

async function exportPage({
    page: { item, path },
    content_map: routes,
}: {
    page: MapPath<PageId>;
    content_map: ContentMap;
}): Promise<void> {
    const markdown_res = await item.getMarkdown();
    if (isExporterErr(markdown_res)) {
        markdown_res.warn();
        return;
    }

    await processMarkdown({ id: item, md: markdown_res, path, routes });
}
