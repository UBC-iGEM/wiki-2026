import { CONFIG } from "./config";
import type { PagePath } from "./map";
import { $unsafe, $withRetries, ExporterError, isErr, type ExporterResult, type Result } from "./utils";
import axios, { type AxiosInstance } from "axios";
import { wrapper } from "axios-cookiejar-support";
import FormData from "form-data";
import mime from "mime-types";
import { CookieJar } from "tough-cookie";

interface UploadResult {
    file_name: string;
    key: string;
    location: string; // public CDN URL to reference in markdown
    content_type: string;
}

let CLIENT_PROMISE: Promise<ExporterResult<ToolsClient>> | null = null;

/**
 * Public interface to a singleton `ToolsClient` interface.
 */
export async function getToolsClient(): Promise<ExporterResult<ToolsClient>> {
    if (CLIENT_PROMISE) return CLIENT_PROMISE;

    CLIENT_PROMISE = (async (): Promise<ExporterResult<ToolsClient>> => {
        const { IGEM_TOOLS_USERNAME: username, IGEM_TOOLS_PASSWORD: password } = process.env;

        if (!username || !password) {
            new ExporterError(
                "The environment variable IGEM_TOOLS_USERNAME or IGEM_TOOLS_PASSWORD is unset. The exporter has not been configured with the necessary credentials.",
                ["exporter configuration", "igem tools server"],
            ).logAndQuit();
        }

        const tools_client_res = await ToolsClient.withAuthentication({
            username: username!,
            password: password!,
            team_id: CONFIG.team_id,
        });
        if (isErr(tools_client_res))
            return new ExporterError(
                "Failed to authenticate with the iGEM Tools API for uploading media.",
                ["igem tools server"],
                tools_client_res,
            );

        return tools_client_res;
    })();

    return CLIENT_PROMISE;
}

class ToolsClient {
    private client: AxiosInstance;

    private constructor(private team_id: string) {
        // Internally holds a cookie store so we don't need to constantly re-authenticate our session
        const jar = new CookieJar();
        this.client = wrapper(
            axios.create({
                jar,
                withCredentials: true,
                baseURL: "https://api.igem.org/v1",
            }),
        );
        this.team_id = team_id;
    }

    public static async withAuthentication({
        username,
        password,
        team_id,
    }: {
        username: string;
        password: string;
        team_id: string;
    }): Promise<Result<ToolsClient>> {
        const instance = new ToolsClient(team_id);

        const params = new URLSearchParams({
            identifier: username,
            password,
        });

        const post_res = await $withRetries($unsafe, async () => await instance.client.post("/auth/sign-in", params));
        if (isErr(post_res)) return post_res;

        return instance;
    }

    // Simple upload function to igem CDN. No specific directory specified yet.
    public async upload({
        uid,
        url,
        path,
    }: {
        uid: string;
        url: string;
        path: PagePath;
    }): Promise<ExporterResult<UploadResult>> {
        const folder_name = "assets";

        // Get image stream from url/notion
        const response = await $withRetries($unsafe, async () => await axios.get(url, { responseType: "stream" }));
        if (isErr(response))
            return new ExporterError(
                `Failed to retrieve data from url "${url}" while attempting to upload asset on page "${path}" with UID ${uid}.`,
                ["igem tools server", "notion server"],
                response,
            );

        // Infer extension and content type
        const content_type = String(response.headers["content-type"]) || "image/jpeg";
        const file_extension = mime.extension(content_type) || "jpg";

        // build data
        const form_data = new FormData();
        form_data.append("file", response.data, `${uid}.${file_extension}`);

        // Make POST request to igem api endpoint
        // /websites/teams/{teamId}?directory={folderName}
        const post_res = await $withRetries(
            $unsafe,
            async () =>
                await this.client.post(`/websites/teams/${this.team_id}`, form_data, {
                    params: { directory: folder_name },
                    headers: form_data.getHeaders?.(),
                }),
        );
        if (isErr(post_res))
            return new ExporterError(
                `Failed to upload asset on page "${path}" with UID ${uid}.`,
                ["igem tools server"],
                post_res,
            );

        // return the upload result
        const public_url = `https://static.igem.wiki/teams/${this.team_id}/${folder_name}/${uid}.${file_extension}`;
        return {
            file_name: `${uid}.${file_extension}`,
            key: `${folder_name}/${uid}.${file_extension}`,
            location: public_url,
            content_type: content_type,
        };
    }

    public async alreadyUploaded({
        folder_name,
        uid,
        path,
    }: {
        folder_name: string;
        uid: string;
        path: PagePath;
    }): Promise<ExporterResult<boolean>> {
        const response = await $withRetries(
            $unsafe,
            async () =>
                await this.client.get(`/websites/teams/${this.team_id}`, {
                    params: { directory: folder_name },
                }),
        );
        if (isErr(response))
            return new ExporterError(
                `Failed to determine if asset on page "${path}" with UID ${uid} already exists.`,
                ["igem tools server"],
                response,
            );

        // files returned:
        const files = response.data || [];

        const exists = files.some((file: any) => {
            const fetched_file_name = file.name || file.key || "";
            return fetched_file_name.startsWith(uid);
        });

        return exists;
    }
}
