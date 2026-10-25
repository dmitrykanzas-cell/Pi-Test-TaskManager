import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("jev-probe", {
    description: "Run a typed Jev classifier probe",
    handler: async (_args, ctx) => {
      const jev = ctx.modelRegistry.findOfType(
        "classifier",
        "anymodel",
        "jev/jev-latest",
      );

      if (!jev) {
        ctx.ui.notify("Jev classifier is not available", "error");
        return;
      }

      const result = await ctx.modelRegistry.classify(jev, {
        state: { message: "Pi configuration was verified." },
        questions: {
          approved: {
            type: "bool",
            instructions: "Is the Pi configuration verified?",
            criteria: {
              true: "The configuration is verified",
              false: "The configuration is not verified",
            },
          },
        },
      });

      if (result.stopReason !== "stop") {
        ctx.ui.notify(`Jev failed: ${result.errorMessage ?? result.stopReason}`, "error");
        return;
      }

      ctx.ui.notify(
        `Jev approved=${result.answers.approved?.probability ?? "n/a"}`,
        "info",
      );
    },
  });
}
