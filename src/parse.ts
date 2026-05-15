import type { BlockId, PageId } from "./notion";
import * as notion from "./notion";

type PagePath = Brand<string, "PagePath">;

export async function parseAggregates({ ids }: { ids: PageId[] }): Promise<Result<Record<PageId, PagePath>>> {
    try {
        const results = await Promise.all(
            ids.map(async (id) => {
                const root_name = await notion.getPageName({ page_id: id });
                if (root_name instanceof Error) throw root_name;

                const child_ids = await parseAggregate({ aggregate_id: id });
                if (child_ids instanceof Error) throw child_ids;

                const child_record = await Promise.all(
                    child_ids.map(async (child_id) => {
                        const child_name = await notion.getPageName({ page_id: child_id });
                        if (child_name instanceof Error) throw child_name;

                        return [child_id, `${root_name}/${child_name}` as PagePath];
                    }),
                );
                return Object.fromEntries(child_record) as Record<PageId, PagePath>;
            }),
        );

        const final_record = Object.assign({}, ...results) as Record<PageId, PagePath>;
        return final_record;
    } catch (error) {
        return error as Error;
    }
}

async function parseAggregate({ aggregate_id }: { aggregate_id: PageId }): Promise<Result<PageId[]>> {
    const blocks = await notion.getBlockChildren({ blockId: aggregate_id as string as BlockId });
    if (blocks instanceof Error) {
        return blocks;
    }

    const pageIds = [];

    for (const block of blocks) {
        if (block.type !== "link_to_page") {
            if (block.type === "paragraph" && block.paragraph.rich_text.length === 0) {
                // Empty whitespace
                continue;
            } else {
                return new Error(`Aggregate ${aggregate_id} contains unrecognized block type "${block.type}"`);
            }
        }

        if (block.link_to_page.type !== "page_id") {
            return new Error(`Aggregate ${aggregate_id} contains unrecognized link type "${block.link_to_page.type}"`);
        } else {
            pageIds.push(block.link_to_page.page_id as PageId);
        }
    }

    return pageIds;
}
