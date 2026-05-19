import * as log from "./log";
import { processMarkdown } from "./markdown";
import { PageId, DatabaseId, BlockId } from "./notion";
import { isErr, type Result } from "./utils";

export class PagePathComponent {
    constructor(private path: string) {}

    equals(other: PagePathComponent): boolean {
        return this.path === other.path;
    }

    toString(): string {
        return this.path;
    }
}

export class PagePath {
    private items: PagePathComponent[];

    constructor(input: PagePathComponent | (PagePathComponent | PagePath)[]) {
        this.items =
            input instanceof PagePathComponent
                ? [input]
                : input.flatMap((item) => {
                      return item instanceof PagePathComponent ? [item] : item.items;
                  });
    }

    toString(): string {
        return this.items.map((item) => item.toString()).join("/");
    }

    equals(other: PagePath): boolean {
        if (this.items.length !== other.items.length) return false;

        for (let i = 0; i < this.items.length; i++) {
            if (!this.items[i]!.equals(other.items[i]!)) return false;
        }

        return true;
    }

    withExt(ext: string): string {
        return this.toString() + `.${ext}`;
    }

    components(): PagePathComponent[] {
        return this.items;
    }
}

export interface MapItem<T> {
    path: PagePathComponent;
    item: T;
}

interface MapPath<T> {
    path: PagePath;
    item: T;
}

abstract class PathMap {
    abstract pages(): Generator<MapPath<PageId>>;

    /**
     * fuck your DS&A course, my algorithm can be as inefficient as I want
     */
    get(id: PageId): PagePath | undefined {
        return this.pages().find(({ item }) => item.equals(id))?.path;
    }

    abstract toJSON(): [string, any][];
}

/**
 * Holds the original hierarchical aggregate structure, as defined on Notion
 */
export class ContentMap extends PathMap {
    // Each entry on the top-level map must be another map representing entries in an aggregate
    constructor(private aggregates: MapItem<AggregateMap>[]) {
        super();
    }

    override *pages(): Generator<MapPath<PageId>> {
        for (const { path: agg_path, item } of this.aggregates) {
            yield* item.pages().map(({ path, item }) => ({ path: new PagePath([agg_path, path]), item }));
        }
    }

    override toJSON(): [string, any][] {
        return this.aggregates.map((entry) => [entry.path.toString(), entry.item.toJSON()]);
    }
}

class AggregateMap extends PathMap {
    constructor(private entries: MapItem<PageId | DatabaseMap>[]) {
        super();
    }

    push(item: MapItem<PageId | DatabaseMap>) {
        this.entries.push(item);
    }

    override *pages(): Generator<MapPath<PageId>> {
        for (const { path: entry_path, item } of this.entries) {
            switch (true) {
                case item instanceof PageId:
                    yield { path: new PagePath([entry_path]), item };
                    break;
                case item instanceof DatabaseMap:
                    yield* item
                        .pages()
                        .map(({ path: db_path, item }) => ({ path: new PagePath([entry_path, db_path]), item }));
                    break;
            }
        }
    }

    override toJSON(): [string, any][] {
        return this.entries.map((entry) => [
            entry.path.toString(),
            entry.item instanceof PageId ? entry.item.toString() : entry.item.toJSON(),
        ]);
    }
}

export class DatabaseMap extends PathMap {
    constructor(private entries: MapItem<PageId>[]) {
        super();
    }

    override *pages(): Generator<MapPath<PageId>> {
        yield* this.entries.map(({ path, item }) => ({ path: new PagePath([path]), item }));
    }

    push(item: MapItem<PageId>) {
        this.entries.push(item);
    }

    override toJSON(): [string, any][] {
        return this.entries.map((entry) => [entry.path.toString(), entry.item.toString()]);
    }
}

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

    try {
        const paths = await Promise.all(
            agg_entries.map(async (entry) => {
                const res = await entry.paths();
                if (isErr(res)) throw res;

                return res;
            }),
        );
        return { item: new AggregateMap(paths), path: new PagePathComponent(agg_name) };
    } catch (err) {
        return err as Error;
    }
}

async function getAggregateEntries({ agg_id }: { agg_id: PageId }): Promise<Result<(PageId | DatabaseId)[]>> {
    const agg_block = new BlockId(agg_id.toString());
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
