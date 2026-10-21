import { DatabaseMap, PagePathComponent, type MapItem } from "./map";
import {
    $unsafe,
    $unsafeExporterPromises,
    $unsafeSync,
    $withRetries,
    ExporterError,
    isErr,
    isExporterErr,
    recordNotionRateLimit,
    type ExporterResult,
    type Result,
} from "./utils";
import {
    APIErrorCode,
    Client,
    LogLevel,
    type Logger,
    type BlockObjectResponse,
    type GetDatabaseResponse,
    type GetPageResponse,
    type ListBlockChildrenParameters,
    type PageObjectResponse,
    type QueryDataSourceParameters,
} from "@notionhq/client";

/**
 * Counts rate-limited responses.
 */
const notionLogger: Logger = (_level, message, extra_info) => {
    if (message === "request fail" && extra_info.code === APIErrorCode.RateLimited) recordNotionRateLimit();
};

class NotionClientArmy {
    clients: Client[];
    next_to_retrieve: number = 0;

    constructor() {
        const keys = Object.entries(process.env).filter(([k, v]) => k.startsWith("NOTION_API_KEY") && v);
        this.clients = keys.map(([, v]) => {
            const client_res = $unsafeSync(
                () => new Client({ auth: v, logLevel: LogLevel.WARN, logger: notionLogger }),
            );
            if (isErr(client_res))
                new ExporterError(
                    "Failed to construct a client to connect to the Notion server.",
                    ["notion server"],
                    client_res,
                ).logAndQuit();
            return client_res as Client;
        });
        if (this.clients.length === 0)
            new ExporterError(
                "The exporter has not been configured with the necessary credentials; no NOTION_API_KEY variables are set.",
                ["exporter configuration", "notion server"],
            ).logAndQuit();
    }

    getClient = (): Client => this.clients[this.next_to_retrieve++ % this.clients.length]!;
}

let NOTION_CLIENTS: NotionClientArmy | null = null;
const notion = (): Client => (NOTION_CLIENTS ??= new NotionClientArmy()).getClient();

/**
 * Pages and databases already requested during this run, keyed by ID.
 * Promises are stored, so concurrent lookups of the same object share one request.
 */
const PAGE_CACHE = new Map<string, Promise<Result<GetPageResponse>>>();
const DATABASE_CACHE = new Map<string, Promise<Result<GetDatabaseResponse>>>();

function cached<T>(cache: Map<string, Promise<T>>, id: Id, fetch: () => Promise<T>): Promise<T> {
    const key = id.toString();
    let res = cache.get(key);
    if (!res) {
        res = fetch();
        cache.set(key, res);
    }
    return res;
}

type PageWithProperties = Extract<
    Awaited<ReturnType<Client["pages"]["retrieve"]>>,
    { properties: Record<string, unknown> }
>;
export type PageProperty = PageWithProperties["properties"][string];

/**
 * A Notion block with its children attached.
 */
export type NotionBlock = BlockObjectResponse & { children: NotionBlock[] };

export class Id {
    constructor(private id: string) {
        // Sanitize ID
        this.id = id.replaceAll("-", "");
    }

    equals(other: Id): boolean {
        return this.id === other.id;
    }

    toString(): string {
        return this.id;
    }
}

interface Named {
    getName(): Promise<ExporterResult<string>>;
    paths(): Promise<ExporterResult<MapItem<PageId | DatabaseMap>>>;
}

export class PageId extends Id implements Named {
    constructor(id: string) {
        super(id);
    }

    async getName(): Promise<ExporterResult<string>> {
        const page_res = await this.retrieve();
        if (isErr(page_res))
            return new ExporterError(`Failed to retrieve page at Notion ID ${this}.`, ["notion server"], page_res);

        if (!("properties" in page_res)) {
            return new ExporterError(`Failed to read properties of page at Notion ID ${this}.`, ["notion server"]);
        }

        const title_property = Object.values(page_res.properties).find((p) => p.type === "title");
        if (title_property) {
            return title_property.title.map((t) => t.plain_text).join("");
        } else {
            return new ExporterError(`Failed to retrieve title of page at Notion ID ${this}.`, ["notion server"]);
        }
    }

    async getProperty(name: string): Promise<ExporterResult<PageProperty | undefined>> {
        const page_res = await this.retrieve();
        if (isErr(page_res))
            return new ExporterError(`Failed to retrieve page at Notion ID ${this}.`, ["notion server"], page_res);

        if (!("properties" in page_res)) {
            return new ExporterError(`Failed to read properties of page at Notion ID ${this}.`, ["notion server"]);
        }

        return page_res.properties[name];
    }

    /**
     * Whether the page is in Notion's trash, which the API still serves.
     */
    async isTrashed(): Promise<ExporterResult<boolean>> {
        const page_res = await this.retrieve();
        if (isErr(page_res))
            return new ExporterError(`Failed to retrieve page at Notion ID ${this}.`, ["notion server"], page_res);

        return "in_trash" in page_res && page_res.in_trash;
    }

    private retrieve(): Promise<Result<GetPageResponse>> {
        return cached(PAGE_CACHE, this, () =>
            $withRetries($unsafe, notion().pages.retrieve, { page_id: this.toString() }),
        );
    }

    async getDate(): Promise<string | undefined> {
        const property = await this.getProperty("Date");
        if (isExporterErr(property) || property?.type !== "date") return;

        return property.date?.start?.trim() || undefined;
    }

    async paths(): Promise<ExporterResult<MapItem<PageId | DatabaseMap>>> {
        const path_res = await this.getName();
        if (isExporterErr(path_res)) return path_res;

        return { item: this, path: new PagePathComponent(path_res) };
    }

    async getBlocks(): Promise<ExporterResult<NotionBlock[]>> {
        return new BlockId(this.toString()).getTree();
    }
}

export class DatabaseId extends Id implements Named {
    constructor(id: string) {
        super(id);
    }

    async getName(): Promise<ExporterResult<string>> {
        const db_res = await this.retrieve();
        if (isErr(db_res))
            return new ExporterError(`Failed to retrieve database at Notion ID ${this}.`, ["notion server"], db_res);

        if (!("title" in db_res)) {
            return new ExporterError("`title` property missing from database at Notion ID ${this}.", ["notion server"]);
        }

        const title_plain_text = db_res.title.map((t) => t.plain_text).join("");
        return title_plain_text;
    }

    private retrieve(): Promise<Result<GetDatabaseResponse>> {
        return cached(DATABASE_CACHE, this, () =>
            $withRetries($unsafe, notion().databases.retrieve, { database_id: this.toString() }),
        );
    }

    async paths(): Promise<ExporterResult<MapItem<PageId | DatabaseMap>>> {
        const db_name = await this.getName();
        if (isExporterErr(db_name)) return db_name;

        const db_entries = await this.getEntries();
        if (isExporterErr(db_entries)) return db_entries;

        /** Use {@link $unsafe} scope to fail-fast on inner errors */
        return $unsafeExporterPromises(async () => {
            const pages = await Promise.all(
                db_entries.map(async (entry) => {
                    const res = await entry.paths();
                    if (isExporterErr(res)) throw res;

                    // Should be a page, since `entry` is a `PageId`
                    return res as MapItem<PageId>;
                }),
            );

            return { item: new DatabaseMap(this, pages), path: new PagePathComponent(db_name) };
        });
    }

    async getEntries(): Promise<ExporterResult<PageId[]>> {
        const db_res = await this.retrieve();
        if (isErr(db_res))
            return new ExporterError(`Failed to retrieve database at Notion ID ${this}.`, ["notion server"], db_res);
        if (!("data_sources" in db_res)) {
            return new ExporterError("`data_sources` property missing from database at Notion ID ${this}.", [
                "notion server",
            ]);
        }

        const page_ids: string[] = [];
        for (const ds of db_res.data_sources) {
            let cursor: string | undefined = undefined;
            do {
                const params: QueryDataSourceParameters = {
                    data_source_id: ds.id,
                    start_cursor: cursor,
                    sorts: [{ property: "ID", direction: "ascending" }],
                };

                const res = await $withRetries($unsafe, notion().dataSources.query, params);
                if (isErr(res))
                    return new ExporterError(
                        `Querying database at Notion ID ${this} for pages based on "ID" property failed. Does the database have such a field?`,
                        ["malformed content", "notion server"],
                        res,
                    );

                page_ids.push(...res.results.map((r) => r.id));
                // Queries return each entry's full page, so cache them
                for (const entry of res.results) {
                    if (entry.object === "page" && "properties" in entry)
                        PAGE_CACHE.set(new Id(entry.id).toString(), Promise.resolve(entry));
                }
                cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
            } while (cursor);
        }

        return page_ids.map((id) => new PageId(id));
    }

    // for special pages like the Team page, which is a database, not a collection of pages
    async getRows(): Promise<ExporterResult<PageObjectResponse[]>> {
        const db_res = await this.retrieve();
        if (isErr(db_res))
            return new ExporterError(`Failed to retrieve database at Notion ID ${this}.`, ["notion server"], db_res);
        if (!("data_sources" in db_res)) {
            return new ExporterError("`data_sources` property missing from database at Notion ID ${this}.", [
                "notion server",
            ]);
        }

        const rows: PageObjectResponse[] = [];
        for (const ds of db_res.data_sources) {
            let cursor: string | undefined = undefined;
            do {
                const params: QueryDataSourceParameters = {
                    data_source_id: ds.id,
                    start_cursor: cursor,
                };

                const res = await $withRetries($unsafe, notion().dataSources.query, params);
                if (isErr(res))
                    return new ExporterError(
                        `Querying database at Notion ID ${this} for rows failed.`,
                        ["malformed content", "notion server"],
                        res,
                    );

                for (const row of res.results) {
                    if (!("properties" in row)) {
                        return new ExporterError(
                            `A row in database at Notion ID ${this} could not be read as a page with properties.`,
                            ["malformed content", "notion server"],
                        );
                    }
                    rows.push(row as PageObjectResponse);
                }

                cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
            } while (cursor);
        }

        return rows;
    }
}

export class BlockId extends Id {
    constructor(id: string) {
        super(id);
    }

    async get(): Promise<ExporterResult<BlockObjectResponse>> {
        const res = await $withRetries($unsafe, notion().blocks.retrieve, { block_id: this.toString() });
        if (isErr(res))
            return new ExporterError(
                `Failed to retrieve content of block at Notion ID ${this}.`,
                ["notion server"],
                res,
            );

        return res as BlockObjectResponse;
    }

    /**
     * Finds the page containing this block.
     */
    async getParentPage(): Promise<ExporterResult<PageId>> {
        let block_id = this.toString();

        // Continue recursing until parent page found
        recursion_loop: while (true) {
            const res = await new BlockId(block_id).get();
            if (isExporterErr(res)) return res;

            // A page nested in a page is itself a block
            if (res.type === "child_page") return new PageId(res.id);

            switch (res.parent.type) {
                case "page_id":
                    return new PageId(res.parent.page_id);
                case "block_id":
                    // Keep walking upward
                    block_id = res.parent.block_id;
                    continue recursion_loop;
                default:
                    break recursion_loop;
            }
        }

        return new ExporterError(`Block at Notion ID ${this} is not inside a page.`, ["notion server"]);
    }

    /**
     * Fetches all children of this block.
     * Child pages and databases are NOT descended into; synced blocks are resolved as content.
     */
    async getTree(): Promise<ExporterResult<NotionBlock[]>> {
        const children = await this.getChildren();
        if (isExporterErr(children)) return children;

        /** Fail-fast on inner errors */
        return $unsafeExporterPromises(async () =>
            Promise.all(
                children.map(async (block): Promise<NotionBlock> => {
                    if (!block.has_children || block.type === "child_page" || block.type === "child_database")
                        // no children
                        return { ...block, children: [] };

                    const source_id =
                        block.type === "synced_block" && block.synced_block.synced_from
                            ? block.synced_block.synced_from.block_id
                            : block.id;
                    const subtree = await new BlockId(source_id).getTree(); // go deeper
                    if (isExporterErr(subtree)) throw subtree;

                    return { ...block, children: subtree };
                }),
            ),
        );
    }

    async getChildren(): Promise<ExporterResult<BlockObjectResponse[]>> {
        const blocks: BlockObjectResponse[] = [];
        let cursor: string | undefined = undefined;

        do {
            const params: ListBlockChildrenParameters = {
                block_id: this.toString(),
                start_cursor: cursor,
            };

            const res = await $withRetries($unsafe, notion().blocks.children.list, params);
            if (isErr(res))
                return new ExporterError(
                    `Failed to retrieve children of block at Notion ID ${this}.`,
                    ["notion server"],
                    res,
                );

            blocks.push(...(res.results as BlockObjectResponse[]));
            cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
        } while (cursor);

        return blocks;
    }
}
