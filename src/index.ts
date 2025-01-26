import * as p from '@clack/prompts';
import color from 'picocolors';
import {$} from "execa";
import {generateObject} from 'ai';
import {z} from 'zod';
import {ollama} from "ollama-ai-provider";
import fsPromises from "node:fs/promises";
import * as fs from "node:fs";

function validateBranchNameOrCommitHash(value: string) {
    if (!value) return 'Please enter a branch name/ commit hash';
    if (!/^[\w./-]+$/.test(value)) {
        return 'Please enter a valid branch name/ commit hash';
    }
}


async function applyChanges({fromCommitHash, branchToApplyChangesTo, diffFileNames}: {
    fromCommitHash: string,
    branchToApplyChangesTo: string,
    diffFileNames: Array<string>
}) {
    const {message: currentBranch} = (await $`git branch --show-current`)
    try {
            await $`git checkout ${fromCommitHash}`
            await $`git checkout -b ${branchToApplyChangesTo}`
            for (const fileName of diffFileNames) {
                await $`git apply ${fileName}`
                await $`git commit -am ${fileName} --no-verify`
            }
            await $`git checkout ${currentBranch}`
    } catch (error) {
        await $`git checkout ${currentBranch}`
        console.log(error)
        p.cancel("Failed to apply changes")
        // eslint-disable-next-line unicorn/no-process-exit
        process.exit(0);
    }
}

const baseDirName = `pr-splitter`;
    const aiCommitsDir = `ai-commits`;

function getDiffFileName(message: string) {
    return `./${baseDirName}/${aiCommitsDir}/${message}.diff`;
}

function getAllDiffFileName() {
    return `./${baseDirName}/pr-splitter-all-diff.diff`;
}

function initializeFolderIfNotExists(path: string) {
    if (!fs.existsSync(path)) {
        fs.mkdirSync(path);
    }
}

async function main() {
    console.clear();


    // await setTimeout(1000);
    const {message: gitCurrentBranch} = (await $`git branch --show-current`)

    p.updateSettings({
        aliases: {
            w: 'up',
            s: 'down',
            a: 'left',
            d: 'right',
        },
    });

    p.intro(`${color.bgCyan(color.black(' pr-splitter '))}`);

    const project = await p.group(
        {
            fromCommitHash: () =>
                p.text({
                    message: 'What branch / git commit hash do you want to create the diff with?',
                    placeholder: "main",
                    defaultValue: gitCurrentBranch,
                    validate: validateBranchNameOrCommitHash,
                }),
        },
        {
            onCancel: () => {
                p.cancel('Operation cancelled.');
                // eslint-disable-next-line unicorn/no-process-exit
                process.exit(0);
            },
        }
    );

    const s = p.spinner();

    s.start('Generating the diff file');


    initializeFolderIfNotExists(baseDirName);
    initializeFolderIfNotExists(`${baseDirName}/${aiCommitsDir}`);

    const allDiffFileName = getAllDiffFileName();
    await $ `git diff ${project.fromCommitHash} --output=${allDiffFileName}`
    s.stop('Diff files generated');

    const diff = await fsPromises.readFile(allDiffFileName, "utf8");
    if (diff.length === 0) {
        p.cancel("Diff file is empty")
        // eslint-disable-next-line unicorn/no-process-exit
        process.exit(0);
    }




    s.start('Splitting the diff with AI');
    try {

        const {object} = await generateObject({
            model: ollama("llama3.1"),
            schema: z.object({
                commits: z.array(
                    z.object({
                        message: z.string(),
                        diffFileContent: z.string(),
                    })
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
            prompt: diff,
        });

        s.stop('AI split the PR to multiple diffs');

        const {commits} = object;

        for (const commit of commits) {
            console.log(commit.message)
        }

        for (const commit of commits) {
            s.start(`Create diff for ${commit.message}`);
            const diffFileName = getDiffFileName(commit.message);
            await fsPromises.writeFile(diffFileName, commit.diffFileContent)
            s.stop(`Create commit for "${commit.message}"`);
        }
        p.note(`The PR is split into multiple ${commits.length} commits `, 'Next steps.');

        const branchToApplyChangesTo = await p.text({
            message: 'What branch do you want to apply the commits to?',
            placeholder: project.fromCommitHash,
            validate: validateBranchNameOrCommitHash,
        })

        if (typeof branchToApplyChangesTo === "string" && branchToApplyChangesTo.length > 0) {
            s.start(`Applying changes`);
            const diffFilePaths = fs.readdirSync(`./${baseDirName}/${aiCommitsDir}/`).map(fileName => `./${baseDirName}/${aiCommitsDir}/${fileName}`);
            await applyChanges({fromCommitHash: project.fromCommitHash, branchToApplyChangesTo, diffFileNames: diffFilePaths});
            s.stop(`Changes added`);
        }

    } catch (error) {
        console.log(error)
        p.cancel("AI failed to split the diff")
        // eslint-disable-next-line unicorn/no-process-exit
        process.exit(0);
    }

    p.outro(`Problems? ${color.underline(color.cyan('https://example.com/issues'))}`);
}


// eslint-disable-next-line unicorn/prefer-top-level-await, github/no-then
main().catch(console.error);
