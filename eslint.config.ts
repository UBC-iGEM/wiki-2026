import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
    ...tseslint.configs.recommended,
    {
        files: ["**/*.ts"],
        languageOptions: {
            parserOptions: {
                projectService: true,
            },
        },
        rules: {
            // Error
            "@typescript-eslint/explicit-function-return-type": "error",
            "prefer-const": "error",
            eqeqeq: "error",
            "no-implicit-coercion": "error",
            "no-useless-assignment": "error",
            "prefer-arrow-callback": "error",
            "prefer-promise-reject-errors": "error",
            yoda: "error",

            // Lenient
            "@typescript-eslint/no-explicit-any": "off",

            // Naming conventions
            "@typescript-eslint/naming-convention": [
                "error",
                {
                    selector: "typeLike",
                    format: ["PascalCase"],
                },
                {
                    selector: "method",
                    format: ["camelCase"],
                },
                {
                    selector: "property",
                    format: ["snake_case"],
                },
                {
                    selector: "parameterProperty",
                    format: ["snake_case"],
                },
                {
                    selector: "function",
                    format: ["camelCase"],
                },
                {
                    selector: "parameter",
                    format: ["snake_case"],
                },
                {
                    selector: "variable",
                    format: ["snake_case", "UPPER_CASE"],
                },
                {
                    selector: "variable",
                    types: ["function"],
                    format: ["camelCase"],
                },
                {
                    selector: "variable",
                    modifiers: ["global"],
                    format: ["UPPER_CASE"],
                },
                {
                    selector: "variable",
                    modifiers: ["unused"],
                    leadingUnderscore: "require",
                    format: ["snake_case"],
                },
                {
                    selector: "objectLiteralMethod",
                    format: null,
                },
                {
                    selector: "objectLiteralProperty",
                    format: null,
                },
            ],
        },
    },
    // Disable for config files
    {
        files: ["**/eslint.config.ts"],
        languageOptions: {
            parserOptions: {
                projectService: false,
            },
        },
        rules: {
            "@typescript-eslint/naming-convention": "off",
        },
    },
]);
