import type { ShikiConfig } from "@astrojs/markdown-remark";

/*
 * The Shiki theme for code blocks, drawn from the brand colours in MainLayout.astro.
 * Shiki inlines these at build time, so they are hex values rather than the CSS custom properties.
 */
const color = {
    ebonyClay: "#1b1f41",
    orchid: "#e650db",
    limeYellow: "#c9fd3a",
    citrine: "#ddd200",
    periwinkle: "#bbd1ff",
    northernLights: "#88bed4",
    greyTeal: "#54a190",
    cornflower: "#6a67ff",
    // Cornflower lifted so it reads on the dark background
    cornflowerLight: "#9c9aff",
    fluorescence: "#00ff92",
};

export const codeTheme: NonNullable<ShikiConfig["theme"]> = {
    name: "igem-wiki",
    type: "dark",
    colors: {
        "editor.background": color.ebonyClay,
        "editor.foreground": color.periwinkle,
    },
    settings: [
        { settings: { background: color.ebonyClay, foreground: color.periwinkle } },
        {
            scope: ["comment", "punctuation.definition.comment"],
            settings: { foreground: color.greyTeal, fontStyle: "italic" },
        },
        {
            scope: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.control"],
            settings: { foreground: color.orchid },
        },
        {
            scope: ["keyword.operator", "punctuation", "meta.brace"],
            settings: { foreground: `${color.periwinkle}b3` },
        },
        {
            scope: ["string", "string.quoted", "string.template", "markup.inline.raw", "punctuation.definition.string"],
            settings: { foreground: color.limeYellow },
        },
        {
            scope: ["constant.character.escape", "string.regexp", "constant.other.placeholder"],
            settings: { foreground: color.citrine },
        },
        {
            scope: [
                "constant",
                "constant.numeric",
                "constant.language",
                "support.constant",
                "variable.other.constant",
                "variable.other.enummember",
            ],
            settings: { foreground: color.fluorescence },
        },
        {
            scope: ["entity.name.function", "support.function", "meta.function-call.generic", "variable.function"],
            settings: { foreground: color.cornflowerLight },
        },
        {
            scope: ["entity.name.type", "entity.name.class", "support.type", "support.class", "entity.other.inherited-class"],
            settings: { foreground: color.northernLights },
        },
        {
            scope: ["variable.parameter", "variable.language"],
            settings: { foreground: color.northernLights, fontStyle: "italic" },
        },
        {
            scope: ["entity.name.tag", "meta.tag.sgml"],
            settings: { foreground: color.orchid },
        },
        {
            scope: ["entity.other.attribute-name", "support.type.property-name", "meta.object-literal.key"],
            settings: { foreground: color.northernLights },
        },
        {
            scope: ["markup.heading", "entity.name.section"],
            settings: { foreground: color.limeYellow, fontStyle: "bold" },
        },
        { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
        { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
        {
            scope: ["markup.underline.link", "string.other.link"],
            settings: { foreground: color.cornflower },
        },
        { scope: ["markup.inserted"], settings: { foreground: color.fluorescence } },
        { scope: ["markup.deleted", "invalid"], settings: { foreground: color.orchid } },
    ],
};
