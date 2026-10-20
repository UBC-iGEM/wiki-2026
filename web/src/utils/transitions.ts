/**
 * Picks how the ClientRouter animates each navigation, for the "Page transitions" rules in style.css. The page fades
 * as one, except:
 * - "logo": the navbar's home logo grows into the hero chip
 * - "prev"/"next": the page navigation buttons push the old page out to one side and the new one in from the other
 *
 * The kind is set as the navigation's direction, which Astro puts on <html> as data-astro-transition for the whole
 * transition. The DbDropdown and DbCalendar hold still within one database through their own transition:name.
 */
import type { TransitionBeforePreparationEvent, TransitionBeforeSwapEvent } from "astro:transitions/client";

export type TransitionKind = "logo" | "prev" | "next";

type Arrival = { kind?: TransitionKind; finished: Promise<void> };

// finished: when the current page's transition ends
// navAway: the page being pushed aside had been scrolled past the navbar
const STATE: { finished: Promise<void>; navAway: boolean } = { finished: Promise.resolve(), navAway: false };

/** How the current page was arrived at, and when its transition ends; for a page's own intro to wait on. */
export function arrivedBy(): Arrival {
    const direction = document.documentElement.dataset.astroTransition;
    const kind = direction === "logo" || direction === "prev" || direction === "next" ? direction : undefined;
    return { kind, finished: STATE.finished };
}

/**
 * Runs the new page's scripts not yet met on this visit. Astro only runs them once the new page has been captured,
 * so a component met for the first time would set itself up (the hero intro hiding its parts and moving its stage)
 * mid-transition, and the page would jump. Run now, their onPage setups are in place for astro:after-swap, before the
 * capture, as they are on any later visit. The browser runs a module once, so Astro's own run of them does nothing.
 *
 * In dev, component styles are modules too, which add a <style> to the head. Added now, the swap would drop them as
 * the old page's, so they are moved into the new page's head, which the swap brings in (the same elements, so Vite
 * can still update them).
 */
async function runNewScripts(newDocument: Document, to: URL): Promise<void> {
    const met = new Set([...document.scripts].map((script) => script.src));
    const styles = new Set(document.head.querySelectorAll("style"));
    const imports = [...newDocument.querySelectorAll<HTMLScriptElement>("script[type=module][src]")]
        .map((script) => new URL(script.getAttribute("src")!, to).href)
        .filter((src) => !met.has(src))
        .map((src) => import(/* @vite-ignore */ src).catch(() => undefined));
    await Promise.all(imports);
    for (const style of document.head.querySelectorAll("style")) {
        if (!styles.has(style)) newDocument.head.append(style);
    }
}

document.addEventListener("astro:before-preparation", (event: TransitionBeforePreparationEvent) => {
    const link = event.navigationType === "traverse" ? null : event.sourceElement?.closest("a");
    const rel = link?.closest(".page-nav") ? link.getAttribute("rel") : null;
    const toLogo = rel === null && !!link?.matches(".home-logo");
    if (rel === "prev" || rel === "next") event.direction = rel;
    else if (toLogo) event.direction = "logo";

    // Read now, before the new page resets the scroll
    const nav = document.querySelector("nav.primary");
    STATE.navAway = (rel === "prev" || rel === "next") && !!nav && nav.getBoundingClientRect().bottom <= 0;

    const loader = event.loader;
    event.loader = async (): Promise<void> => {
        await loader();
        // Prevented: a full page load follows instead
        if (event.signal.aborted || event.defaultPrevented) return;
        await Promise.all([runNewScripts(event.newDocument, event.to), toLogo && decodeChip(event)]);
    };
});

// Holds the transition until the chip's image can be drawn, or the logo would grow into a blank
async function decodeChip(event: TransitionBeforePreparationEvent): Promise<void> {
    const src = event.newDocument.querySelector(".chip-3")?.getAttribute("src");
    if (!src) return;
    const chip = new Image();
    chip.src = new URL(src, event.to).href;
    await chip.decode().catch(() => undefined);
}

document.addEventListener("astro:before-swap", (event: TransitionBeforeSwapEvent) => {
    STATE.finished = event.viewTransition.finished;

    // Set on the new page's <html>, as the swap replaces the old one's attributes with its
    if (STATE.navAway) {
        const root = event.newDocument.documentElement;
        root.dataset.navAway = "";
        event.viewTransition.finished.finally(() => delete document.documentElement.dataset.navAway);
    }
});
