import { PageId } from "./notion";

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
    // Each entry on the top-level map must be another map representing entries in an aggregate
    constructor(private aggregates: MapItem<AggregateMap>[]) {
        super();
    }

    override *pages(): Generator<MapPath<PageId>> {
        for (const { path: agg_path, item } of this.aggregates) {
            yield* item.pages().map(({ path, item }) => ({ path: new PagePath([agg_path, path]), item }));
        }
    }
}

export class AggregateMap extends PathMap {
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
}
