import type { ContainerDirective } from "mdast-util-directive";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const FILE_ID = "12345678-1234-1234-1234-123456789abc";
const NOTION_FILE_URL = "https://notion.example/model.glb";
const HOSTED_URL = "HOSTED_URL";

test("exports Model3D files through the existing upload callback", async (t) => {
    let retrieved_file_count = 0;
    let upload_count = 0;
    let uploaded_args: { uid: string; url: string; path: string } | undefined;

    class Id {
        constructor(private id: string) {
            this.id = id.replaceAll("-", "");
        }

        toString(): string {
            return this.id;
        }
    }

    class PageId extends Id {}

    class BlockId extends Id {
        async get(): Promise<any> {
            retrieved_file_count++;
            return {
                type: "file",
                file: {
                    type: "file",
                    file: { url: NOTION_FILE_URL },
                },
            };
        }
    }

    t.mock.module(new URL("../src/notion.ts", import.meta.url), {
        exports: { BlockId, Id, PageId },
    });
    t.mock.module(new URL("../src/tools-api.ts", import.meta.url), {
        exports: {
            getToolsClient: async (): Promise<{
                upload: ({
                    uid,
                    url,
                    path,
                }: {
                    uid: string;
                    url: string;
                    path: { toString(): string };
                }) => Promise<{ location: string }>;
            }> => ({
                upload: async ({ uid, url, path }): Promise<{ location: string }> => {
                    upload_count++;
                    uploaded_args = { uid, url, path: path.toString() };
                    return { location: HOSTED_URL };
                },
            }),
        },
    });

    const [
        { CONFIG },
        { ContentMap: content_map, PagePath: page_path },
        { COMPONENT_MAP },
        { IMAGE_PROCESSORS },
        { processMarkdown, remarkProcessingPipeline },
        { processRegex },
        { isExporterErr },
    ] = await Promise.all([
        import("../src/config.ts"),
        import("../src/map.ts"),
        import("../src/markdown/components-block.ts"),
        import("../src/markdown/image.ts"),
        import("../src/markdown/markdown.ts"),
        import("../src/markdown/regex.ts"),
        import("../src/utils.ts"),
    ]);

    const output_dir = await mkdtemp(join(tmpdir(), "model3d-exporter-"));
    const original_content_dir = CONFIG.content_dir_path;
    const original_image_processors = [...IMAGE_PROCESSORS];
    let image_callback_count = 0;

    CONFIG.content_dir_path = output_dir;
    IMAGE_PROCESSORS.splice(0, IMAGE_PROCESSORS.length, ({ ctx }) => {
        ctx.callbacks.push(async () => {
            image_callback_count++;
        });
    });
    t.after(async () => {
        CONFIG.content_dir_path = original_content_dir;
        IMAGE_PROCESSORS.splice(0, IMAGE_PROCESSORS.length, ...original_image_processors);
        await rm(output_dir, { recursive: true, force: true });
    });

    const encoded_file = encodeURIComponent(JSON.stringify({ permissionRecord: { id: FILE_ID } }));
    const path = page_path.fromString("Model Test");
    const routes = new content_map([]);
    const model3d = COMPONENT_MAP.model3d;
    assert.ok(model3d);

    await processMarkdown({
        id: undefined as never,
        md: `![callback](https://example.test/image.png)

%% START Model3D
<file src="file://${encoded_file}"></file>
DESCRIPTION
%% END`,
        path,
        routes,
    });

    const output = await readFile(join(output_dir, "Model Test.mdx"), "utf8");
    assert.match(output, /<Model3D url=\{"HOSTED_URL"\} alt=\{"DESCRIPTION"\} \/>/);
    assert.equal(retrieved_file_count, 1);
    assert.equal(upload_count, 1);
    assert.deepEqual(uploaded_args, {
        uid: FILE_ID.replaceAll("-", ""),
        url: NOTION_FILE_URL,
        path: "Model Test",
    });
    assert.equal(image_callback_count, 1);

    await processMarkdown({
        id: undefined as never,
        md: `%% START Model3D
<file src="file://${encoded_file}"></file>
%% END`,
        path,
        routes,
    });

    const output_without_description = await readFile(join(output_dir, "Model Test.mdx"), "utf8");
    assert.match(output_without_description, /<Model3D url=\{"HOSTED_URL"\} \/>/);
    assert.doesNotMatch(output_without_description, /alt=/);

    for (const malformed_markdown of [
        "%% START Model3D\n%% END",
        '%% START Model3D\n<file src="https://example.test/model.glb"></file>\n%% END',
    ]) {
        const tree = remarkProcessingPipeline().parse(processRegex(malformed_markdown));
        const node = tree.children.find((child) => child.type === "containerDirective") as ContainerDirective;
        const result = model3d({
            node,
            ctx: {
                index: 0,
                parent: tree,
                routes,
                path,
                callbacks: [],
            },
        });

        assert.ok(isExporterErr(result));
        const consoleError = t.mock.method(console, "error", (): void => {});
        result.warn();
        const warning = consoleError.mock.calls.at(-1)?.arguments[0];
        assert.equal(typeof warning, "string");
        assert.match(warning, /Type: recoverable\./);
        assert.match(warning, /Tags: malformed content/);
    }
});
