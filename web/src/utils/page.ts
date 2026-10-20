/**
 * With the ClientRouter, a component's script runs once per visit, on the first page that has it, not on every page.
 * `onPage` runs `setup` on that page and again on every page swapped in after it. When the page is swapped out,
 * `signal` is aborted and the returned cleanup runs, so pass `{ signal }` to listeners on `document` or `window`
 * (which outlive the page) and stop observers, timelines and the like in the cleanup.
 *
 * A setup must cope with a page that lacks its component, as it runs on every page from then on.
 */
export function onPage(setup: (signal: AbortSignal) => void | (() => void)): void {
    const run = (): void => {
        const controller = new AbortController();
        const cleanup = setup(controller.signal);
        document.addEventListener(
            "astro:before-swap",
            () => {
                controller.abort();
                cleanup?.();
            },
            { once: true },
        );
    };

    // Not astro:page-load, which on the first page waits for every image to load
    run();
    document.addEventListener("astro:after-swap", run);
}
