import { DatabaseMap, PagePathComponent, type MapItem } from "./map";
import {
    $unsafe,
    $unsafeExporterPromises,
    $unsafeSync,
    $withRetries,
    ExporterError,
    isErr,
    isExporterErr,
    type ExporterResult,
} from "./utils";
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
    if (!key)
        new ExporterError(
            "The environment variable NOTION_API_KEY is unset. The exporter has not been configured with the necessary credentials.",
            ["exporter configuration", "notion server"],
        ).logAndQuit();

    const client_res = $unsafeSync(() => new Client({ auth: key }));
    if (isErr(client_res))
        new ExporterError(
            "Failed to construct a client to connect to the Notion server.",
            ["notion server"],
            client_res,
        ).logAndQuit();

    NOTION_CLIENT = client_res as Client;
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
    getName(): Promise<ExporterResult<string>>;
    paths(): Promise<ExporterResult<MapItem<PageId | DatabaseMap>>>;
}

export class PageId extends Id implements Named {
    constructor(id: string) {
        super(id);
    }

    async getName(): Promise<ExporterResult<string>> {
        const page_res = await $withRetries($unsafe, notion().pages.retrieve, { page_id: this.toString() });
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

    async getDate(): Promise<ExporterResult<string | undefined>> {
        const page_res = await $withRetries($unsafe, notion().pages.retrieve, { page_id: this.toString() });
        if (isErr(page_res))
            return new ExporterError(`Failed to retrieve page at Notion ID ${this}.`, ["notion server"], page_res);

        if (!("properties" in page_res)) {
            return new ExporterError(`Failed to read properties of page at Notion ID ${this}.`, ["notion server"]);
        }

        const date_property = Object.values(page_res.properties).find((p) => p.type === "date");
        if (date_property) {
            return date_property.date?.start;
        } else {
            return new ExporterError(
                `Page at Notion ID ${this} has no date property. Does its parent database not have a date field?`,
                ["malformed content", "notion server"],
            );
        }
    }

    async paths(): Promise<ExporterResult<MapItem<PageId | DatabaseMap>>> {
        const path_res = await this.getName();
        if (isExporterErr(path_res)) return path_res;

        return { item: this, path: new PagePathComponent(path_res) };
    }

    async getMarkdown(): Promise<ExporterResult<string>> {
        const page_res = await $withRetries($unsafe, notion().pages.retrieveMarkdown, {
            page_id: this.toString(),
            include_transcript: true,
        });
        if (isErr(page_res))
            return new ExporterError(
                `Failed to fetch page at Notion ID ${this} as markdown.`,
                ["notion server"],
                page_res,
            );

        return page_res.markdown;
    }
}

export class DatabaseId extends Id implements Named {
    constructor(id: string) {
        super(id);
    }

    async getName(): Promise<ExporterResult<string>> {
        const db_res = await $withRetries($unsafe, notion().databases.retrieve, { database_id: this.toString() });
        if (isErr(db_res))
            return new ExporterError(`Failed to retrieve database at Notion ID ${this}.`, ["notion server"], db_res);

        if (!("title" in db_res)) {
            return new ExporterError("`title` property missing from database at Notion ID ${this}.", ["notion server"]);
        }

        const title_plain_text = db_res.title.map((t) => t.plain_text).join("");
        return title_plain_text;
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

            return { item: new DatabaseMap(pages), path: new PagePathComponent(db_name) };
        });
    }

    async getEntries(): Promise<ExporterResult<PageId[]>> {
        const db_res = await $withRetries($unsafe, notion().databases.retrieve, { database_id: this.toString() });
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
                cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
            } while (cursor);
        }

        return page_ids.map((id) => new PageId(id));
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
