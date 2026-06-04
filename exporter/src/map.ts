import { PageId } from "./notion";

// Required setup for decorators
export class PagePathComponent {
    constructor(private path: string) {}

    equals(other: PagePathComponent): boolean {
        return this.path === other.path;
    }

    toString(): string {
        return this.path;
    }

    toSlug(): string {
        return this.path.trim().toLowerCase().replace(/\s+/g, "-");
    }
}

export class PagePath {
    constructor(private items: PagePathComponent[]) {}

    static fromString(s: string): PagePath {
        const components = s.split("/").map((s) => new PagePathComponent(s));
        return new PagePath(components);
    }

    components(): PagePathComponent[] {
        return this.items;
    }

    toString(): string {
        return this.items.map((item) => item.toString()).join("/");
    }

    toSlug(): string {
        return this.items.map((item) => item.toSlug()).join("/");
    }

    equals(other: PagePath): boolean {
        if (this.items.length !== other.items.length) return false;

        for (let i = 0; i < this.items.length; i++) {
            if (!this.items[i]!.equals(other.items[i]!)) return false;
        }

        return true;
    }

    startsWith(prefix: PagePath): boolean {
        // Prefix cannot be longer than the path
        if (prefix.items.length > this.items.length) return false;
        return prefix.items.every((prefix_component, idx) => prefix_component.equals(this.items[idx]!));
    }

    withExt(ext: string): string {
        return this.toString() + `.${ext}`;
    }
}

export interface MapItem<T> {
    path: PagePathComponent;
    item: T;
}

export interface MapPath<T> {
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
}

/**
 * Holds the original hierarchy of all content pages, as ordered and defined on Notion
 */
export class ContentMap extends PathMap {
    public aggregates: AggregateMap[];

    // Each entry on the top-level map must be another map representing entries in an aggregate
    constructor(aggregates: AggregateMap[]) {
        super();
        this.aggregates = aggregates;
    }

    override *pages(): Generator<MapPath<PageId>> {
        for (const entry of this.aggregates) {
            yield* entry.pages();
        }
    }

    toJSON(): JsonMap {
        return {
            aggregates: this.aggregates.map((agg) => ({
                name: agg.name.toString(),
                entries: agg.entries.map((entry) => {
                    const value =
                        entry.item instanceof PageId
                            ? ({
                                  type: "page",
                                  item: entry.item.toString(),
                              } as const)
                            : ({
                                  type: "db",
                                  item: entry.item.entries.map((db_page) => ({
                                      path: db_page.path.toString(),
                                      item: db_page.item.toString(),
                                  })),
                              } as const);
                    return { path: entry.path.toString(), ...value };
                }),
            })),
        };
    }

    static fromJSON(map: JsonMap): ContentMap {
        return new ContentMap(
            map.aggregates.map(
                (agg) =>
                    new AggregateMap({
                        name: new PagePathComponent(agg.name),
                        entries: agg.entries.map((agg_entry) => ({
                            path: new PagePathComponent(agg_entry.path),
                            item:
                                agg_entry.type === "page"
                                    ? new PageId(agg_entry.item)
                                    : new DatabaseMap(
                                          agg_entry.item.map((db_entry) => ({
                                              path: new PagePathComponent(db_entry.path),
                                              item: new PageId(db_entry.item),
                                          })),
                                      ),
                        })),
                    }),
            ),
        );
    }

    *queryDbEntries(db_name: PagePath): Generator<PagePath> {
        yield* this.pages()
            .filter(({ path }) => path.startsWith(db_name))
            .map(({ path }) => path);
    }
}

export interface JsonMap {
    aggregates: {
        name: string;
        entries: ({
            path: string;
        } & ({ type: "page"; item: string } | { type: "db"; item: { path: string; item: string }[] }))[];
    }[];
}

export class AggregateMap extends PathMap {
    public name: PagePathComponent;
    public entries: MapItem<PageId | DatabaseMap>[];

    constructor({ name, entries }: { name: PagePathComponent; entries: MapItem<PageId | DatabaseMap>[] }) {
        super();

        this.name = name;
        this.entries = entries;
    }

    push(item: MapItem<PageId | DatabaseMap>): void {
        this.entries.push(item);
    }

    /**
     * For each entry in this aggregate, yields:
     *     - If {@link PageId} the page entry
     *     - If {@link DatabaseMap} all sub-page entries in the database
     */
    override *pages(): Generator<MapPath<PageId>> {
        for (const { path: entry_path, item } of this.entries) {
            switch (true) {
                case item instanceof PageId:
                    yield { path: new PagePath([this.name, entry_path]), item };
                    break;
                case item instanceof DatabaseMap:
                    yield* item.entries.map(({ path: page_path, item }) => ({
                        path: new PagePath([this.name, entry_path, page_path]),
                        item,
                    }));
                    break;
            }
        }
    }

    /**
     * For each entry in this aggregate, yields:
     *   * If entry is a normal page, [<path to page>, <path to page>] (both entries identical)
     *   * If entry is a database, [<path to database>, <path to first page>]
     */
    *topLevelPages(): Generator<[PagePath, PagePath]> {
        for (const { path: entry_path, item } of this.entries) {
            const path_to_entry = new PagePath([this.name, entry_path]);

            switch (true) {
                case item instanceof PageId: {
                    yield [path_to_entry, path_to_entry];
                    break;
                }
                case item instanceof DatabaseMap: {
                    const { path: first_db_page } = item.entries[0]!;
                    yield [path_to_entry, new PagePath([...path_to_entry.components(), first_db_page])];
                }
            }
        }
    }
}

export class DatabaseMap {
    constructor(public entries: MapItem<PageId>[]) {}

    push(item: MapItem<PageId>): void {
        this.entries.push(item);
    }
}
