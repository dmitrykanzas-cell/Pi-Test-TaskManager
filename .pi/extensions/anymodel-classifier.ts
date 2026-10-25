/** Register AnyModel's System One classifier transport for Pi codemode. */
import { classify } from "C:/Users/ThinkPad/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/typesafe-system-one.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerProvider("anymodel", {
    baseUrl: "https://anymodel.org/v1",
    apiKey: "$HERMES_CUSTOM_ANYMODEL_ORG_API_KEY",
    models: [
      {
        id: "cx/gpt-6-luna",
        name: "Luna (AnyModel)",
        input: ["text", "image"],
        reasoning: true,
        contextWindow: 1050000,
        maxTokens: 128000,
        cost: { input: 4, output: 4, cacheRead: 0, cacheWrite: 0 },
      },
      {
        id: "cc/claude-opus-5-5",
        name: "Opus (AnyModel)",
        input: ["text", "image"],
        reasoning: true,
        contextWindow: 1000000,
        maxTokens: 128000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      {
        type: "classifier",
        id: "jev/jev-latest",
        name: "Jev (AnyModel)",
        api: "typesafe-system-one",
        input: ["text"],
        contextWindow: 32000,
        cost: { input: 0.05, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
    classifiers: {
      "typesafe-system-one": { classify },
    },
  });
}
