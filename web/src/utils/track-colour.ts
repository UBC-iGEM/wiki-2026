/**
 * The colour a hero chip line is drawn in at each point along it, for the dot running along it to take on.
 * A line segment is drawn by its own stroke and by every <use> of it, layered in document order, each a linear
 * gradient (in user space, as the design tool exports them) or a flat colour. The colour at a point is those layers'
 * colours there, composited.
 */

// Not premultiplied; channels 0-255, alpha 0-1
type Rgba = { r: number; g: number; b: number; a: number };

type Layer = (x: number, y: number) => Rgba;

export type TrackSegment = { el: SVGGeometryElement; reverse: boolean };

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

// A computed colour, as rgb() or rgba()
function parseColour(value: string, opacity: number): Rgba {
    const [r = 0, g = 0, b = 0, a = 1] = value.match(/[\d.]+/g)?.map(Number) ?? [];
    return { r, g, b, a: a * opacity };
}

// Premultiplied, as browsers draw gradients, so a stop fading to transparent doesn't darken on the way
function mix(from: Rgba, to: Rgba, amount: number): Rgba {
    const a = from.a + (to.a - from.a) * amount;
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const channel = (key: "r" | "g" | "b"): number =>
        (from[key] * from.a + (to[key] * to.a - from[key] * from.a) * amount) / a;
    return { r: channel("r"), g: channel("g"), b: channel("b"), a };
}

function over(top: Rgba, bottom: Rgba): Rgba {
    const a = top.a + bottom.a * (1 - top.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const channel = (key: "r" | "g" | "b"): number => (top[key] * top.a + bottom[key] * bottom.a * (1 - top.a)) / a;
    return { r: channel("r"), g: channel("g"), b: channel("b"), a };
}

function layerOf(element: Element, svg: SVGSVGElement): Layer {
    const opacity = Number(element.getAttribute("stroke-opacity") ?? 1);
    const id = element.getAttribute("stroke")?.match(/^url\(#(.+)\)$/)?.[1];
    const gradient = id ? svg.querySelector(`#${CSS.escape(id)}`) : null;
    if (!(gradient instanceof SVGLinearGradientElement)) {
        const colour = parseColour(getComputedStyle(element).stroke, opacity);
        return () => colour;
    }

    let last_offset = 0;
    const stops = Array.from(gradient.querySelectorAll("stop"), (stop) => {
        const style = getComputedStyle(stop);
        // Offsets out of order count as the one before, as in the browser
        last_offset = Math.max(last_offset, stop.offset.baseVal);
        return { offset: last_offset, colour: parseColour(style.stopColor, Number(style.stopOpacity) * opacity) };
    });
    const [x1, y1, x2, y2] = [gradient.x1, gradient.y1, gradient.x2, gradient.y2].map(
        (length) => length.baseVal.value,
    ) as [number, number, number, number];
    const [dx, dy] = [x2 - x1, y2 - y1];
    const length_squared = dx * dx + dy * dy;
    const first = stops[0];
    const last = stops.at(-1);
    if (!first || !last) return () => ({ r: 0, g: 0, b: 0, a: 0 });

    return (x, y) => {
        // How far along the gradient's vector the point lies, padded at either end
        const t = length_squared ? clamp01(((x - x1) * dx + (y - y1) * dy) / length_squared) : 0;
        if (t <= first.offset) return first.colour;
        if (t >= last.offset) return last.colour;
        const next = stops.findIndex((stop) => stop.offset >= t);
        const from = stops[next - 1]!;
        const to = stops[next]!;
        return mix(from.colour, to.colour, (t - from.offset) / (to.offset - from.offset || 1));
    };
}

/** The colour `path` is drawn in at each length along it, as a CSS colour. */
export function trackColour(path: SVGGeometryElement): (length: number) => string {
    const svg = path.ownerSVGElement!;
    const uses = path.id
        ? Array.from(svg.querySelectorAll("use")).filter((use) => use.href.baseVal === `#${path.id}`)
        : [];
    // Kept in <defs>, it is only drawn through its uses
    const elements = path.closest("defs") ? uses : [path, ...uses];
    const layers = elements.map((element) => layerOf(element, svg));

    return (length) => {
        const { x, y } = path.getPointAtLength(length);
        const { r, g, b } = layers.reduce<Rgba>((below, layer) => over(layer(x, y), below), {
            r: 0,
            g: 0,
            b: 0,
            a: 0,
        });
        return `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`;
    };
}

/**
 * For a dot run along `segments` one after another, by a timeline whose tweens each last as many seconds as their
 * segment is long: a function from the timeline's time to the colour of the line under the dot.
 */
export function colourAlong(segments: TrackSegment[]): (time: number) => string {
    const parts = segments.map(({ el, reverse }) => ({
        reverse,
        length: el.getTotalLength(),
        colourAt: trackColour(el),
    }));

    return (time) => {
        let distance = Math.max(0, time);
        for (const [index, part] of parts.entries()) {
            if (distance > part.length && index < parts.length - 1) {
                distance -= part.length;
                continue;
            }
            const along = Math.min(distance, part.length);
            return part.colourAt(part.reverse ? part.length - along : along);
        }
        return "";
    };
}
