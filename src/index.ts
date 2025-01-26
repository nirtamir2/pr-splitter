import * as p from '@clack/prompts';
import color from 'picocolors';
import {$} from "execa";
import { generateObject } from 'ai';
import { z } from 'zod';
import {ollama} from "ollama-ai-provider";
import fsPromises from "node:fs/promises";

function validateBranchName(value: string) {
    if (!value) return 'Please enter a branch name';
    if (!/^[\w./-]+$/.test(value)) {
        return 'Please enter a valid branch name';
    }
}

function validateBranchNameOrCommitHash(value: string) {
    if (!value) return 'Please enter a branch name/ commit hash';
    if (!/^[\w./-]+$/.test(value)) {
        return 'Please enter a valid branch name/ commit hash';
    }
}


async function main() {
    console.clear();


    // await setTimeout(1000);
    const gitCurrentBranch = await $`git branch --show-current`
    console.log(gitCurrentBranch.message)

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
            commitHash: () =>
                p.text({
                    message: 'What branch / git commit hash do you want to create the diff with?',
                    placeholder: "main",
                    defaultValue: gitCurrentBranch.message,
                    validate: validateBranchNameOrCommitHash,
                }),
            aiBranchName: ({results}) =>
                p.text({
                    message: 'What branch do you want to create the PR?',
                    placeholder: `${results.commitHash ?? "pr-splitter"}-ai`,
                    validate: validateBranchName,
                }),
            // type: ({ results }) =>
            //     p.select({
            //         message: `Pick a project type within "${results.path}"`,
            //         initialValue: 'ts',
            //         maxItems: 5,
            //         options: [
            //             { value: 'ts', label: 'TypeScript' },
            //             { value: 'js', label: 'JavaScript' },
            //             { value: 'rust', label: 'Rust' },
            //             { value: 'go', label: 'Go' },
            //             { value: 'python', label: 'Python' },
            //             { value: 'coffee', label: 'CoffeeScript', hint: 'oh no' },
            //         ],
            //     }),
            // tools: () =>
            //     p.multiselect({
            //         message: 'Select additional tools.',
            //         initialValues: ['prettier', 'eslint'],
            //         options: [
            //             { value: 'prettier', label: 'Prettier', hint: 'recommended' },
            //             { value: 'eslint', label: 'ESLint', hint: 'recommended' },
            //             { value: 'stylelint', label: 'Stylelint' },
            //             { value: 'gh-action', label: 'GitHub Action' },
            //         ],
            //     }),
            confirm: () =>
                p.confirm({
                    message: 'This will create a diff file and try to change the stuff with AI',
                    initialValue: true,
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

    if (project.confirm) {
        const s = p.spinner();
        s.start('Generating the diff file');
        await $`git diff ${project.commitHash} --output=pr-splitter.diff`
        s.stop('Diff files generated');

        s.start('Splitting the diff with AI');
        const diff = await fsPromises.readFile("pr-splitter.diff", "utf8");
        const { object } = await generateObject({
            model: ollama("llama3.1"),
            schema: z.object({
                commits: z.array(z.object({
                    message: z.string(),
                    diff: z.string(),
                })),
            }),
            system: `
You are an AI specialized in Git operations and diff file management. Your task is to handle a given Git diff file representing changes in a pull request. Specifically, you will:
\t1.\tSeparate the Diff File: Break down the single large diff file into multiple smaller diff files, each corresponding to a logical commit.
\t2.\tPreserve Commit Order: Ensure that the commits are ordered logically, as the sequence will dictate how the diffs are applied.
\t3.\tMaintain Validity: Each generated diff must be syntactically correct and ready to be applied using Git commands like git apply.
\t4.\tEnsure Completeness: The sum of all the generated diff files must match the input diff file exactly. No changes should be added, removed, or altered during the separation process.
\t5.\tGroup Logically: Changes should be grouped meaningfully to represent cohesive units of work or intent, avoiding mixing unrelated changes in the same commit.
\t6.\tProvide Informative Messages: Ensure that the message field in each commit succinctly describes the changes or their purpose, helping reviewers understand the context.
\t7.\tDo Not Modify User Code: You are not allowed to modify the content of the user code. Only separate and organize the existing diff content as required.
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
            const diffFileName = `./${commit.message}-diff.diff`;
            await fsPromises.writeFile(diffFileName, commit.diff)
            // await $`git apply ${diffFileName}`
            // s.message(`Create commit for ${commit.message}`);
            // await $`git commit -m ${commit.message}`
            s.stop(`Create commit for ${commit.message}`);
        }

        s.stop('Finish generating stuff');
    }

    // AA

    // const nextSteps = `cd ${project.path}        \n${project.install ? '' : 'pnpm install\n'}pnpm dev`;

    // p.note(nextSteps, 'Next steps.');


    // B
    p.outro(`Problems? ${color.underline(color.cyan('https://example.com/issues'))}`);
}

// eslint-disable-next-line unicorn/prefer-top-level-await, github/no-then
main().catch(console.error);