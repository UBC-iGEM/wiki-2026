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
const STATE: { finished: Promise<void> } = { finished: Promise.resolve() };

/** How the current page was arrived at, and when its transition ends; for a page's own intro to wait on. */
export function arrivedBy(): Arrival {
    const direction = document.documentElement.dataset.astroTransition;
    const kind = direction === "logo" || direction === "prev" || direction === "next" ? direction : undefined;
    return { kind, finished: STATE.finished };
}

document.addEventListener("astro:before-preparation", (event: TransitionBeforePreparationEvent) => {
    const link = event.navigationType === "traverse" ? null : event.sourceElement?.closest("a");
    const rel = link?.closest(".page-nav") ? link.getAttribute("rel") : null;
    if (rel === "prev" || rel === "next") {
        event.direction = rel;
    } else if (link?.matches(".home-logo")) {
        event.direction = "logo";
        // Hold the transition until the chip's image can be drawn, or the logo would grow into a blank
        const loader = event.loader;
        event.loader = async (): Promise<void> => {
            await loader();
            const src = event.newDocument.querySelector(".chip-3")?.getAttribute("src");
            if (!src) return;
            const chip = new Image();
            chip.src = new URL(src, event.to).href;
            await chip.decode().catch(() => undefined);
        };
    }
});

document.addEventListener("astro:before-swap", (event: TransitionBeforeSwapEvent) => {
    STATE.finished = event.viewTransition.finished;
});
