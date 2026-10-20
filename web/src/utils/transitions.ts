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
// nav_away: the page being pushed aside had been scrolled past the navbar
const STATE: { finished: Promise<void>; nav_away: boolean } = { finished: Promise.resolve(), nav_away: false };

// How long a navigation waits on the new page's scripts and the hero chip before going ahead without them
const PREPARE_TIMEOUT_MS = 1500;

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
async function runNewScripts(new_document: Document, to: URL): Promise<void> {
    const met = new Set([...document.scripts].map((script) => script.src));
    const styles = new Set(document.head.querySelectorAll("style"));
    const imports = [...new_document.querySelectorAll<HTMLScriptElement>("script[type=module][src]")]
        .map((script) => new URL(script.getAttribute("src")!, to).href)
        .filter((src) => !met.has(src))
        .map((src) => import(/* @vite-ignore */ src).catch(() => undefined));
    await Promise.all(imports);
    for (const style of document.head.querySelectorAll("style")) {
        if (!styles.has(style)) new_document.head.append(style);
    }
}

document.addEventListener("astro:before-preparation", (event: TransitionBeforePreparationEvent) => {
    const link = event.navigationType === "traverse" ? null : event.sourceElement?.closest("a");
    const rel = link?.closest(".page-nav") ? link.getAttribute("rel") : null;
    const to_logo = rel === null && Boolean(link?.matches(".home-logo"));
    if (rel === "prev" || rel === "next") event.direction = rel;
    else if (to_logo) event.direction = "logo";

    // Read now, before the new page resets the scroll
    const nav = document.querySelector("nav.primary");
    STATE.nav_away = (rel === "prev" || rel === "next") && nav !== null && nav.getBoundingClientRect().bottom <= 0;

    const loader = event.loader;
    event.loader = async (): Promise<void> => {
        await loader();
        // Prevented: a full page load follows instead
        if (event.signal.aborted || event.defaultPrevented) return;
        // Capped, so a slow or stuck import (e.g. a big library on a slow connection) can't hold up the navigation;
        // anything not run by then is run by Astro after the swap, as usual
        await Promise.race([
            Promise.all([runNewScripts(event.newDocument, event.to), to_logo && decodeChip(event)]),
            new Promise((resolve) => window.setTimeout(resolve, PREPARE_TIMEOUT_MS)),
        ]);
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
    if (STATE.nav_away) {
        const root = event.newDocument.documentElement;
        root.dataset.navAway = "";
        event.viewTransition.finished.finally(() => delete document.documentElement.dataset.navAway);
    }
});
