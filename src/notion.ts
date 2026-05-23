import * as log from "./log";
import { DatabaseMap, PagePathComponent, type MapItem } from "./parse";
import { isErr, type Result } from "./utils";
import { Client, type BlockObjectResponse } from "@notionhq/client";

let NOTION_CLIENT: Client | null = null;

function notion(): Client {
    if (NOTION_CLIENT) {
        return NOTION_CLIENT;
    }

    const key = process.env.NOTION_API_KEY;

    if (key) {
        try {
            NOTION_CLIENT = new Client({ auth: key });
            return NOTION_CLIENT;
        } catch (e) {
            log.error_and_quit(`Failed to connect new Notion client. Error: ${e}`);
        }
    } else {
        log.error_and_quit("NOTION_API_KEY env. variable is unset");
    }
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
        const error_base = `Unable to retrieve title of page ${this}`;

        try {
            const page = await notion().pages.retrieve({ page_id: this.toString() });

            if (!("properties" in page)) {
                return new Error(`${error_base}: no properties found.`);
            }

            const title_property = Object.values(page.properties).find((p) => p.type === "title");
            if (title_property && title_property.type === "title") {
                return title_property.title.map((t) => t.plain_text).join("");
            } else {
                return new Error(`${error_base}: 'title' property missing.`);
            }
        } catch (err) {
            return new Error(`${error_base}: ${err}`);
        }
    }

    async paths(): Promise<Result<MapItem<PageId | DatabaseMap>>> {
        const path = await this.getName();
        if (isErr(path)) return path;

        return { item: this, path: new PagePathComponent(path) };
    }

    async getMarkdown(): Promise<Result<string>> {
        try {
            const page = await notion().pages.retrieveMarkdown({ page_id: this.toString(), include_transcript: true });
            return page.markdown;
        } catch (error) {
            return new Error(`Unable to fetch page ${this} as markdown: ${error}`);
        }
    }
}

export class DatabaseId extends Id implements Named {
    constructor(id: string) {
        super(id);
    }

    async getName(): Promise<Result<string>> {
        const error_base = `Unable to retrieve title of page ${this}`;

        try {
            const db = await notion().databases.retrieve({ database_id: this.toString() });

            if (!("title" in db)) {
                return new Error(`${error_base}: 'title' property missing.`);
            }

            const title_plain_text = db.title.map((t) => t.plain_text).join("");
            return title_plain_text;
        } catch (err) {
            return new Error(`${error_base}: ${err}`);
        }
    }

    async paths(): Promise<Result<MapItem<PageId | DatabaseMap>>> {
        const db_name = await this.getName();
        if (isErr(db_name)) return db_name;

        try {
            const db_entries = await this.getEntries();
            if (isErr(db_entries)) return db_entries;

            const pages = await Promise.all(
                db_entries.map(async (entry) => {
                    const res = await entry.paths();
                    if (isErr(res)) throw res;

                    // Should be a page, since `entry` is a `PageId`
                    return res as MapItem<PageId>;
                }),
            );
            return { item: new DatabaseMap(pages), path: new PagePathComponent(db_name) };
        } catch (err) {
            return err as Error;
        }
    }

    async getEntries(): Promise<Result<PageId[]>> {
        const error_base = `Error while retrieving entries of database ${this}`;

        try {
            const db = await notion().databases.retrieve({ database_id: this.toString() });
            if (!("data_sources" in db)) {
                return new Error(`${error_base}: db has no data sources!`);
            }

            const pageIds: string[] = [];
            for (const ds of db.data_sources) {
                let cursor: string | undefined = undefined;
                do {
                    const res = await notion().dataSources.query({
                        data_source_id: ds.id,
                        start_cursor: cursor,
                        sorts: [{ property: "ID", direction: "ascending" }],
                    });
                    pageIds.push(...res.results.map((r) => r.id));
                    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
                } while (cursor);
            }

            return pageIds.map((id) => new PageId(id));
        } catch (err) {
            return new Error(`${error_base}: ${err}`);
        }
    }
}

export class BlockId extends Id {
    constructor(id: string) {
        super(id);
    }

    async get(): Promise<Result<BlockObjectResponse>> {
        try {
            return (await notion().blocks.retrieve({ block_id: this.toString() })) as BlockObjectResponse;
        } catch (error) {
            return new Error(`Failed to retrieve content of block ${this.toString()}: ${error}`);
        }
    }

    async getChildren(): Promise<Result<BlockObjectResponse[]>> {
        try {
            const blocks: BlockObjectResponse[] = [];
            let cursor: string | undefined = undefined;

            do {
                const res = await notion().blocks.children.list({
                    block_id: this.toString(),
                    start_cursor: cursor,
                });
                blocks.push(...(res.results as BlockObjectResponse[]));
                cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
            } while (cursor);

            return blocks;
        } catch (error) {
            return new Error(`Failed to retrieve blocks of ${this.toString()}: ${error}`);
        }
    }
}
