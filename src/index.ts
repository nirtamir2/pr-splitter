import * as p from "@clack/prompts";
import { $ } from "execa";
import * as fs from "node:fs";
import { Cause, Console, Effect } from "effect";
import color from "picocolors";
import fsPromises from "node:fs/promises";
import { generateObject } from "ai";
import { ollama } from "ollama-ai-provider";
import { z } from "zod";

function validateBranchNameOrCommitHash(value: string) {
  if (!value) return "Please enter a branch name/ commit hash";
  if (!/^[\w./-]+$/.test(value)) {
    return "Please enter a valid branch name/ commit hash";
  }
}

async function applyChanges({
  fromCommitHash,
  branchToApplyChangesTo,
  diffFileNames,
}: {
  fromCommitHash: string;
  branchToApplyChangesTo: string;
  diffFileNames: Array<string>;
}) {
  const { message: currentBranch } = await $`git branch --show-current`;
  try {
    await $`git switch ${fromCommitHash}`;
    await $`git switch -c ${branchToApplyChangesTo}`;

    for (const fileName of diffFileNames) {
      console.log("fileName", fileName);
      await $`git apply --staged --patch ${fileName}`;
      await $`git commit -m '${fileName}' --no-verify`;
    }

    console.log("currentBranch", currentBranch);
    await $`git switch ${currentBranch}`;
  } catch (_error) {
    await $`git switch ${currentBranch}`;
    console.log(_error);
    p.cancel("Failed to apply changes");
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(0);
  }
}

const baseDirName = `pr-splitter`;
const aiCommitsDir = `ai-commits`;

function getDiffFileName(message: string) {
  return `./${baseDirName}/${aiCommitsDir}/${message}.patch`;
}

function getAllDiffFileName() {
  return `./${baseDirName}/pr-splitter-all-diff.patch`;
}

// class CancelAndExitError extends Error{
//   readonly _tag = "CancelAndExitError"
// }

function initializeFolderIfNotExists(path: string) {
  return Effect.try({
    try: () => {
      if (!fs.existsSync(path)) {
        fs.mkdirSync(path);
      }
    },
    catch: (_error) => new Error(`Could not create file ${path}`),
  });
}

function getCurrentBranch() {
  return Effect.tryPromise({
    try: async () => {
      const result = await $`git branch --show-current`;
      return z.string().parse(result.stdout)
    },
    catch: (error) => new Error(`Could not get current branch: ${error}`),
  });
}

function promptUserBranch(gitCurrentBranch: string) {
  return Effect.tryPromise({
    try: () =>
      p.group(
        {
          fromCommitHash: () => {
            return p.text({
              message:
                "What branch / git commit hash do you want to create the diff with?",
              placeholder: gitCurrentBranch,
              validate: validateBranchNameOrCommitHash,
            });
          },
        },
        {
          onCancel: () => {
            p.cancel("Operation cancelled.");
            throw new Error("Operation cancelled.");
          },
        },
      ),
    catch: (_error) => {
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(0);
    },
  });
}

function createDiffFile({
  fromCommitHash,
  allDiffFileName,
}: {
  fromCommitHash: string;
  allDiffFileName: string;
}) {
  return Effect.tryPromise({
    try: () => $`git diff ${fromCommitHash} --output=${allDiffFileName}`,
    catch: (_error) => {
      Effect.fail("Failed to generate diff file");
    },
  });
}

function readDiffFile(allDiffFileName: string) {
  return Effect.tryPromise({
    try: () => fsPromises.readFile(allDiffFileName, "utf8"),
    catch: (_error) => {
      Effect.fail("Failed to read diff file");
    },
  });
}

function getAISplitPRs(diffContent: string) {
  return Effect.tryPromise({
    try: () =>
      generateObject({
        model: ollama("llama3.1"),
        schema: z.object({
          commits: z.array(
            z.object({
              message: z.string(),
              diffFileContent: z.string(),
            }),
          ),
        }),
        system: `
You are an AI specialized in Git operations and diff file management. Your task is to process the input diff file representing changes in a pull request. For each commit in the diff, do the following:
1. Separate the changes into distinct commits based on logical groupings of changes.
2. For each commit, generate a diff file (in unified diff format) and a message that succinctly describes the changes or their purpose.
3. Ensure the diff files are valid and can be applied using Git commands like 'git apply'.
4. Output the results in the following structure:
   - An array of objects, where each object has:
     - 'message': A string describing the purpose or changes in the commit.
     - 'diffFileContent': A string containing the diff content for that commit.
5. Do not modify the content of the user code. Only separate and organize the existing diff content.
`,
        prompt: diffContent,
      }),
    catch: (_error) => {
      p.cancel("AI failed to split the diff");
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(0);
    },
  });
}

function createDiffCommitFile(
  diffFileName: string,
  commit: { diffFileContent: string; message: string },
) {
  return Effect.tryPromise({
    try: () => fsPromises.writeFile(diffFileName, commit.diffFileContent),
    catch: (_error) => {
      p.cancel(`Failed to create diff file for "${commit.message}"`);
      Effect.fail("Failed to create diff file");
    },
  });
}

function promptBranchToApplyChangesTo(placeholder: string) {
  return Effect.tryPromise({
    try: () =>
      p.text({
        message: "What branch do you want to apply the commits to?",
        placeholder,
        validate: validateBranchNameOrCommitHash,
      }),
    catch: (_error) => {
      return Effect.fail("Failed to get branch name to apply changes to");
    },
  });
}

const program = Effect.gen(function* (_) {
  console.clear();

  p.intro(`${color.bgCyan(color.black(" pr-splitter "))}`);

  const gitCurrentBranch = yield* _(getCurrentBranch());

  const project = yield* _(promptUserBranch(gitCurrentBranch));

  const s = p.spinner();

  s.start("Generating the diff file");

  yield* _(initializeFolderIfNotExists(baseDirName));
  yield* _(initializeFolderIfNotExists(`${baseDirName}/${aiCommitsDir}`));

  const allDiffFileName = getAllDiffFileName();

  yield* _(
    createDiffFile({
      fromCommitHash: project.fromCommitHash,
      allDiffFileName,
    }),
  );

  s.stop("Diff files generated");

  const diffContent = yield* _(readDiffFile(allDiffFileName));

  if (diffContent.length === 0) {
    p.cancel("Diff file is empty");
    yield* _(Effect.fail("Diff file is empty"));
  }

  s.start("Splitting the diff with AI");

  const { object } = yield* _(getAISplitPRs(diffContent));

  s.stop("AI split the PR to multiple diffs");

  const { commits } = object;

  for (const commit of commits) {
    console.log(commit.message);
  }

  for (const commit of commits) {
    s.start(`Create diff for ${commit.message}`);
    const diffFileName = getDiffFileName(commit.message);
    yield* _(createDiffCommitFile(diffFileName, commit));

    s.stop(`Create commit for "${commit.message}"`);
  }
  p.note(
    `The PR is split into multiple ${commits.length} commits `,
    "Next steps.",
  );

  const branchToApplyChangesTo = yield* _(
    promptBranchToApplyChangesTo(project.fromCommitHash),
  );

  if (
    typeof branchToApplyChangesTo === "string" &&
    branchToApplyChangesTo.length > 0
  ) {
    s.start(`Applying changes`);

    // TODO: fail if cannot readDirSync
    const diffFilePaths = fs
      .readdirSync(`./${baseDirName}/${aiCommitsDir}/`)
      .map((fileName) => `./${baseDirName}/${aiCommitsDir}/${fileName}`);

    yield* _(
      // TODO: change to effect
      Effect.tryPromise({
        try: () =>
          applyChanges({
            fromCommitHash: project.fromCommitHash,
            branchToApplyChangesTo,
            diffFileNames: diffFilePaths,
          }),
        catch: (_error) => {
          throw new Error("Failed to apply changes");
        },
      }),
    );
    s.stop(`Changes added`);
  }

  p.outro(
    `Problems? ${color.underline(color.cyan("https://example.com/issues"))}`,
  );
});

Effect.runPromiseExit(
  Effect.catchAllDefect(program, (defect) => {
    console.log("index#()", defect);
    if (Cause.isRuntimeException(defect)) {
      return Console.log(`RuntimeException defect caught: ${defect.message}`);
    }
    return Console.log("Unknown defect caught.", defect);
  }),
);
