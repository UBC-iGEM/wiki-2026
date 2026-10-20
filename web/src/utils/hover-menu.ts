// How long the mouse may be off a menu before it closes, so brushing past an edge doesn't close it
const GRACE_MS = 150;
// How far outside a menu's boxes still counts as on it, which also spans a small gap before its popup
const SLACK_PX = 8;

const PAGE_TRANSITION_ATTR = "data-astro-transition";

/**
 * Closes the open `menu` once the mouse has been off it (its own box, its open `popup`'s, or the gap between them)
 * for a moment, while `enabled()` holds.
 *
 * Judged by where the pointer is on each move rather than by pointerleave: a page transition's overlay takes the
 * pointer and a swap replaces the elements under it, after which the browser's enter/leave events go missing or come
 * from the wrong element. Moves during a transition are skipped, so the first one after it decides.
 * Pass the page's `signal` (see utils/page.ts) for a menu that is swapped out with the page.
 */
export function closeWhenMouseLeaves(
    menu: HTMLDetailsElement,
    popup: Element | null,
    enabled: () => boolean,
    signal?: AbortSignal,
): void {
    let close_timer: number | undefined;

    const cancel = (): void => {
        window.clearTimeout(close_timer);
        close_timer = undefined;
    };
    const closeSoon = (): void => {
        if (close_timer !== undefined) return;
        close_timer = window.setTimeout(() => {
            close_timer = undefined;
            menu.open = false;
        }, GRACE_MS);
    };

    const within = (rect: DOMRect, x: number, y: number): boolean =>
        x >= rect.left - SLACK_PX &&
        x <= rect.right + SLACK_PX &&
        y >= rect.top - SLACK_PX &&
        y <= rect.bottom + SLACK_PX;

    const isOver = (x: number, y: number): boolean => {
        const own = menu.getBoundingClientRect();
        if (within(own, x, y)) return true;
        if (!popup) return false;
        const pop = popup.getBoundingClientRect();
        if (within(pop, x, y)) return true;
        // The strip between the two, where they overlap side to side
        const bridge = new DOMRect(
            Math.max(own.left, pop.left),
            Math.min(own.bottom, pop.bottom),
            Math.min(own.right, pop.right) - Math.max(own.left, pop.left),
            Math.max(own.top, pop.top) - Math.min(own.bottom, pop.bottom),
        );
        return bridge.width > 0 && bridge.height > 0 && within(bridge, x, y);
    };

    document.addEventListener(
        "pointermove",
        (event) => {
            if (event.pointerType !== "mouse" || !menu.open || !enabled()) return cancel();
            if (document.documentElement.hasAttribute(PAGE_TRANSITION_ATTR)) return;
            if (isOver(event.clientX, event.clientY)) cancel();
            else closeSoon();
        },
        { passive: true, signal },
    );

    // Off the window altogether, where no more moves arrive
    document.documentElement.addEventListener(
        "pointerleave",
        (event) => {
            if (event.pointerType === "mouse" && menu.open && enabled()) closeSoon();
        },
        { signal },
    );

    // Closed some other way (a click, Escape), so a pending close has nothing left to do
    menu.addEventListener("toggle", () => {
        if (!menu.open) cancel();
    });
}
