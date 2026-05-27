import axios, { type AxiosInstance } from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import type { Result } from "./utils";
import mime from "mime-types";
import FormData from "form-data";
import pkg from "../../package.json";

const teamId = pkg.notion_export_config.team_id;

interface UploadResult {
    fileName: string;
    key: string;
    location: string; // public CDN URL to reference in markdown
    contentType: string;
}

let _clientPromise: Promise<Result<ToolsClient>> | null = null;

/**
 * Public interface to a singleton `ToolsClient` interface.
 *
 * TODO: do we want to pull credentials from .env?
 */
export async function getToolsClient(): Promise<Result<ToolsClient>> {
    if (_clientPromise) return _clientPromise;

    _clientPromise = (async (): Promise<Result<ToolsClient>> => {
        const { IGEM_TOOLS_USERNAME: username, IGEM_TOOLS_PASSWORD: password} =
            process.env;

        if (!username || !password) {
            return Error("Missing IGEM_TOOLS_ environment variables.");
        }

        if (!teamId) {
            return Error("teamId variable is unset!");
        }

        return await ToolsClient.withAuthentication({
            username,
            password,
            teamId,
        });
    })();

    return _clientPromise;
}

class ToolsClient {
    private client: AxiosInstance;
    private teamId: string;

    private constructor(teamId: string) {
        // Internally holds a cookie store so we don't need to constantly re-authenticate our session
        const jar = new CookieJar();
        this.client = wrapper(
            axios.create({
                jar,
                withCredentials: true,
                baseURL: "https://api.igem.org/v1",
            }),
        );
        this.teamId = teamId;
    }

    public static async withAuthentication({
        username,
        password,
        teamId
    }: {
        username: string;
        password: string;
        teamId: string;
    }): Promise<Result<ToolsClient>> {
        const instance = new ToolsClient(teamId);

        const params = new URLSearchParams({
            identifier: username,
            password,
        });

        try {
            await instance.client.post("/auth/sign-in", params);
            return instance;
        } catch (e) {
            return e instanceof Error ? e : Error("Authentication failed");
        }
    }

    // Simple upload function to igem CDN. No specific directory specified yet.
    public async upload(uid: string, url: string): Promise<Result<UploadResult>> {
        const folderName = "assets"; // Hardcoded for now

        try {
            // Get image stream from url/notion
            const response = await axios.get(url, { responseType: "stream" });
        
            // Infer extension and content type
            const contentType = (String(response.headers["content-type"])) || "image/jpeg";
            const fileExtension = mime.extension(contentType) || "jpg";

            // build data 
            const formData = new FormData();
            formData.append("file", response.data, `${uid}.${fileExtension}`);

            // Make POST request to igem api endpoint
            // /websites/teams/{teamId}?directory={folderName}
            await this.client.post(
                `/websites/teams/${this.teamId}`,
                formData,
                {
                    params: { directory: folderName },
                    headers: formData.getHeaders?.(),
                }
            )

            // return the upload result
            const publicURL = `https://static.igem.wiki/teams/${this.teamId}/${folderName}/${uid}.${fileExtension}`;
            return {
                fileName: `${uid}.${fileExtension}`,
                key: `${folderName}/${uid}.${fileExtension}`,
                location: publicURL,
                contentType,
            };

        } catch(error) {
            return error instanceof Error ? error : Error("Image upload failed");
        }
    }

    public async alreadyUploaded({
        folderName,
        uid,
    }: {
        folderName: string;
        uid: string;
    }): Promise<Result<boolean>> {
        try {
            const response = await this.client.get(`/websites/teams/${this.teamId}`, {
                params: { directory: folderName },
            });

            // files returned:
            const files: any [] = response.data || [];

            const exists = files.some(file => {
                const fetchedFileName = file.name || file.key || "";
                return fetchedFileName.startsWith(uid);
            });

            return exists;
        } catch (error) {
            return error instanceof Error ? error : Error("Check upload status failed");
        }
    }
}
