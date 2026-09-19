/**
 * A `details` closes only on a click of its own summary. Add the dismissals expected of a
 * dropdown: a click outside it, and Escape while the focus is within it.
 */
export function makeDismissable(element: HTMLDetailsElement): void {
    const summary = element.querySelector("summary");

    document.addEventListener("click", (event) => {
        if (element.open && !element.contains(event.target as Node)) element.open = false;
    });

    element.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        element.open = false;
        summary?.focus();
    });
}
