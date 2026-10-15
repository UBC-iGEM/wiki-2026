/**
 * The site's base path with exactly one trailing slash, ready for a relative path to be
 * appended. Astro reports an empty base as "/", so the slash is stripped before one is added
 * back; otherwise links would start with "//" and resolve as protocol-relative URLs.
 */
export const BASE_URL = `${import.meta.env.BASE_URL.replace(/\/+$/, "")}/`;
