/**
 * The inline style that applies an image's percentage `scale` (`20` → 20% larger, `-78` → 78% smaller).
 *
 * The scale is passed to CSS as the `--img-scale` factor, which the image size constraints multiply by.
 */
export function imageScaleStyle(scale: number): string {
    return `--img-scale: ${Math.max(0, 1 + scale / 100)}`;
}
