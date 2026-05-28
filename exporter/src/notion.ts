import * as log from "./log";
import { DatabaseMap, PagePathComponent, type MapItem } from "./map";
import { $unsafe, $unsafeSync, $withRetries, errorGenerator, isErr, type Result } from "./utils";
import {
    Client,
    type BlockObjectResponse,
    type ListBlockChildrenParameters,
    type QueryDataSourceParameters,
} from "@notionhq/client";

let NOTION_CLIENT: Client | null = null;

function notion(): Client {
    if (NOTION_CLIENT) {
        return NOTION_CLIENT;
    }

    const key = process.env.NOTION_API_KEY;
    if (!key) log.error_and_quit("NOTION_API_KEY env. variable is unset");

    const client_res = $unsafeSync(() => new Client({ auth: key }));
    if (isErr(client_res)) log.error_and_quit(`Failed to connect new Notion client. Error: ${client_res}`);

    NOTION_CLIENT = client_res;
    return NOTION_CLIENT;
}

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
    getName(): Promise<Result<string>>;
    paths(): Promise<Result<MapItem<PageId | DatabaseMap>>>;
}

export class PageId extends Id implements Named {
    constructor(id: string) {
        super(id);
    }

    async getName(): Promise<Result<string>> {
        const makeError = errorGenerator({ base: `Unable to retrieve title of page ${this}` });

        const page = await $withRetries($unsafe, notion().pages.retrieve, { page_id: this.toString() });
        if (isErr(page)) return makeError(`failed to retrieve page with ${page}`);

        if (!("properties" in page)) {
            return makeError("no `properties` field found");
        }

        const title_property = Object.values(page.properties).find((p) => p.type === "title");
        if (title_property && title_property.type === "title") {
            return title_property.title.map((t) => t.plain_text).join("");
        } else {
            return makeError("`title` property missing");
        }
    }

    async paths(): Promise<Result<MapItem<PageId | DatabaseMap>>> {
        const path = await this.getName();
        if (isErr(path)) return path;

        return { item: this, path: new PagePathComponent(path) };
    }

    async getMarkdown(): Promise<Result<string>> {
        const page = await $withRetries($unsafe, notion().pages.retrieveMarkdown, {
            page_id: this.toString(),
            include_transcript: true,
        });
        if (isErr(page)) return new Error(`Unable to fetch page ${this} as markdown: ${page}`);

        return page.markdown;
    }
}

export class DatabaseId extends Id implements Named {
    constructor(id: string) {
        super(id);
    }

    async getName(): Promise<Result<string>> {
        const makeError = errorGenerator({ base: `Unable to retrieve title of page ${this}` });

        const db = await $withRetries($unsafe, notion().databases.retrieve, { database_id: this.toString() });
        if (isErr(db)) return makeError(`failed to retrieve database with ${db}`);

        if (!("title" in db)) {
            return makeError("`title` property missing.");
        }

        const title_plain_text = db.title.map((t) => t.plain_text).join("");
        return title_plain_text;
    }

    async paths(): Promise<Result<MapItem<PageId | DatabaseMap>>> {
        const db_name = await this.getName();
        if (isErr(db_name)) return db_name;

        const db_entries = await this.getEntries();
        if (isErr(db_entries)) return db_entries;

        /** Use {@link $unsafe} scope to fail-fast on inner errors */
        return $unsafe(async () => {
            const pages = await Promise.all(
                db_entries.map(async (entry) => {
                    const res = await entry.paths();
                    if (isErr(res)) throw res;

                    // Should be a page, since `entry` is a `PageId`
                    return res as MapItem<PageId>;
                }),
            );
            return { item: new DatabaseMap(pages), path: new PagePathComponent(db_name) };
        });
    }

    async getEntries(): Promise<Result<PageId[]>> {
        const makeError = errorGenerator({ base: `Error while retrieving entries of database ${this}` });

        const db = await $withRetries($unsafe, notion().databases.retrieve, { database_id: this.toString() });
        if (isErr(db)) return makeError(`failed to retrieve database with ${db}`);
        if (!("data_sources" in db)) {
            return makeError("db has no data sources");
        }

        const pageIds: string[] = [];
        for (const ds of db.data_sources) {
            let cursor: string | undefined = undefined;
            do {
                const params: QueryDataSourceParameters = {
                    data_source_id: ds.id,
                    start_cursor: cursor,
                    sorts: [{ property: "ID", direction: "ascending" }],
                };

                const res = await $withRetries($unsafe, notion().dataSources.query, params);
                if (isErr(res)) return makeError(`database query failed with ${res}`);

                pageIds.push(...res.results.map((r) => r.id));
                cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
            } while (cursor);
        }

        return pageIds.map((id) => new PageId(id));
    }
}

export class BlockId extends Id {
    constructor(id: string) {
        super(id);
    }

    async get(): Promise<Result<BlockObjectResponse>> {
        const res = await $withRetries($unsafe, notion().blocks.retrieve, { block_id: this.toString() });
        if (isErr(res)) return new Error(`Failed to retrieve content of block ${this.toString()}: ${res}`);

        return res as BlockObjectResponse;
    }

    async getChildren(): Promise<Result<BlockObjectResponse[]>> {
        const blocks: BlockObjectResponse[] = [];
        let cursor: string | undefined = undefined;

        do {
            const params: ListBlockChildrenParameters = {
                block_id: this.toString(),
                start_cursor: cursor,
            };

            const res = await $withRetries($unsafe, notion().blocks.children.list, params);
            if (isErr(res))
                return new Error(`Unable to retrieve blocks of ${this}: failed to fetch block children with ${res}`);

            blocks.push(...(res.results as BlockObjectResponse[]));
            cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
        } while (cursor);

        return blocks;
    }
}
