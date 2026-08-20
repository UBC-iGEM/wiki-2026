import { CONFIG } from "./config";
import { DatabaseId, PageId } from "./notion";
import { ExporterError, isExporterErr, saveFile, type ExporterResult } from "./utils";
import type { PageObjectResponse } from "@notionhq/client";

const TEAM_JSON_DIR = "web/src/data";
const TEAM_JSON_FILE = "team.json";
const HEADSHOTS_DIR = "web/src/data/headshots";

// Property names on the team database. Update these if your Notion property names differ.
const SUBTEAM_PROPERTY_NAME = "Subteam";
const HEADSHOT_PROPERTY_NAME = "Headshot";

interface TeamMember {
    name: string;
    role: string;
    // TODO: populate once local img script for headshots is implemented
    image?: string;
}

interface TeamSection {
    title: string;
    members: TeamMember[];
}

interface SectionMeta {
    slug: string;
    title: string;
}

function slugify(text: string): string {
    return text.trim().toLowerCase().replace(/\s+/g, "-");
}

// Formatting
const POSITION_TAG_SECTIONS: Record<string, SectionMeta> = {
    Director: { slug: "directors-leads", title: "Directors & Leads" },
    Lead: { slug: "directors-leads", title: "Directors & Leads" },
    Advisor: { slug: "advisors", title: "Advisors" },
    Instructor: { slug: "instructor", title: "Instructor" },
    "Principal Investigator": { slug: "principal-investigators", title: "Principal Investigators" },
};


// Team tags identify which subteam a regular member belongs to.
const TEAM_TAGS = new Set(["Wet Lab", "Dry Lab", "Human Practices", "Administration", "Design/Wiki"]);

function teamTagSection(tag: string): SectionMeta {
    return { slug: slugify(tag), title: tag };
}

export async function exportTeamPage(): Promise<ExporterResult<void>> {
    const team_page_id = new PageId(CONFIG.team_page_id);

    const database_res = await findTeamDatabase(team_page_id);
    if (isExporterErr(database_res)) return database_res;

    const rows_res = await database_res.getRows();
    if (isExporterErr(rows_res)) return rows_res;

    const sections: Record<string, TeamSection> = {};

    for (const row of rows_res) {
        const member_res = await rowToMember(row);
        if (isExporterErr(member_res)) return member_res;

        const { member, section } = member_res;
        const team_section = (sections[section.slug] ??= { title: section.title, members: [] });
        team_section.members.push(member);
    }

    return await saveFile({
        content: JSON.stringify(sections, null, 2),
        path: TEAM_JSON_FILE,
        base_path: TEAM_JSON_DIR,
    });
}

// Here we use "team_page_id" as the team/attribution database's own ID 
async function findTeamDatabase(team_page_id: PageId): Promise<ExporterResult<DatabaseId>> {
    const database = new DatabaseId(team_page_id.toString());
    const name_res = await database.getName();
    if (isExporterErr(name_res)) return name_res;

    return database;
}

async function rowToMember(
    row: PageObjectResponse,
): Promise<ExporterResult<{ member: TeamMember; section: SectionMeta }>> {
    const name_res = getTitle(row);
    if (isExporterErr(name_res)) return name_res;

    const tags_res = getMultiSelectTags(row, SUBTEAM_PROPERTY_NAME);
    if (isExporterErr(tags_res)) return tags_res;

    const grouping_res = deriveSectionAndRole(row.id, tags_res);
    if (isExporterErr(grouping_res)) return grouping_res;

    const headshot_url_res = getOptionalFileUrl(row, HEADSHOT_PROPERTY_NAME);
    if (isExporterErr(headshot_url_res)) return headshot_url_res;

    const image = headshot_url_res ? await saveHeadshotAvif(headshot_url_res, slugify(name_res)) : undefined;

    return {
        member: { name: name_res, role: grouping_res.role, image },
        section: grouping_res.section,
    };
}

function deriveSectionAndRole(
    row_id: string,
    tags: string[],
): ExporterResult<{ section: SectionMeta; role: string }> {
    if (tags.length === 0)
        return new ExporterError(
            `Team database row at Notion ID ${row_id} has no "${SUBTEAM_PROPERTY_NAME}" tags.`,
            ["malformed content"],
        );

    const position_tags = tags.filter((tag) => tag in POSITION_TAG_SECTIONS);
    const team_tags = tags.filter((tag) => TEAM_TAGS.has(tag));
    const unrecognized_tags = tags.filter((tag) => !(tag in POSITION_TAG_SECTIONS) && !TEAM_TAGS.has(tag));

    if (unrecognized_tags.length > 0)
        return new ExporterError(
            `Team database row at Notion ID ${row_id} has unrecognized "${SUBTEAM_PROPERTY_NAME}" tag(s): ${JSON.stringify(unrecognized_tags)}.`,
            ["malformed content"],
        );

    if (position_tags.length > 1)
        return new ExporterError(
            `Team database row at Notion ID ${row_id} has more than one position tag: ${JSON.stringify(position_tags)}.`,
            ["malformed content"],
        );

    if (position_tags.length === 1) {
        const position_tag = position_tags[0]!;
        const section = POSITION_TAG_SECTIONS[position_tag]!;
        const role = team_tags.length > 0 ? `${team_tags.join(" + ")} ${position_tag}` : position_tag;
        return { section, role };
    }

    if (team_tags.length !== 1)
        return new ExporterError(
            `Team database row at Notion ID ${row_id} has no position tag and ${team_tags.length} team tags (expected exactly 1): ${JSON.stringify(tags)}.`,
            ["malformed content"],
        );

    const team_tag = team_tags[0]!;
    return { section: teamTagSection(team_tag), role: team_tag };
}

function getTitle(row: PageObjectResponse): ExporterResult<string> {
    const title_property = Object.values(row.properties).find((p) => p.type === "title");
    if (!title_property)
        return new ExporterError(`Team database row at Notion ID ${row.id} has no title property.`, [
            "malformed content",
            "notion server",
        ]);

    const name = title_property.title
        .map((t) => t.plain_text)
        .join("")
        .trim();
    if (!name)
        return new ExporterError(`Team database row at Notion ID ${row.id} has an empty name.`, [
            "malformed content",
        ]);

    return name;
}

function getMultiSelectTags(row: PageObjectResponse, property_name: string): ExporterResult<string[]> {
    const property = row.properties[property_name];
    if (!property)
        return new ExporterError(
            `Team database row at Notion ID ${row.id} is missing the "${property_name}" property.`,
            ["malformed content"],
        );

    if (property.type !== "multi_select")
        return new ExporterError(
            `Team database row at Notion ID ${row.id} has a "${property_name}" property of type "${property.type}" instead of multi-select.`,
            ["malformed content", "notion server"],
        );

    return property.multi_select.map((tag) => tag.name);
}

function getOptionalFileUrl(row: PageObjectResponse, property_name: string): ExporterResult<string | undefined> {
    const property = row.properties[property_name];
    if (!property) return undefined;

    if (property.type !== "files")
        return new ExporterError(
            `Team database row at Notion ID ${row.id} has a "${property_name}" property of unsupported type "${property.type}" (expected files).`,
            ["malformed content", "notion server"],
        );

    const file = property.files[0];
    if (!file) return undefined;

    return file.type === "external" ? file.external.url : file.type === "file" ? file.file.url : undefined;
}

/**
 * Downloads a headshot from `url` and re-encodes it as AVIF into {@link HEADSHOTS_DIR}, returning
 * the path to store on the member's `image` field.
 *
 * Stub: not yet implemented
 */
async function saveHeadshotAvif(_url: string, _slug: string): Promise<string | undefined> {
    return undefined;
}
