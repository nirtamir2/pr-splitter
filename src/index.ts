import * as p from '@clack/prompts';
import color from 'picocolors';
import {$} from "execa";
import {generateObject} from 'ai';
import {z} from 'zod';
import {ollama} from "ollama-ai-provider";
import fsPromises from "node:fs/promises";

function validateBranchNameOrCommitHash(value: string) {
    if (!value) return 'Please enter a branch name/ commit hash';
    if (!/^[\w./-]+$/.test(value)) {
        return 'Please enter a valid branch name/ commit hash';
    }
}


async function applyChanges(branchToApplyChangesTo: string , commits: Array<{diffFileContent: string,
    message: string}>) {
    try {
        
            await $`git checkout -b ${branchToApplyChangesTo}`
            for (const commit of commits) {
                await $`git apply ${commit.diffFileContent}`
                await $`git commit -m ${commit.message} --no-verify`
            }
            await $`git checkout -`
    } catch (error) {
        console.log(error)
        p.cancel("Failed to apply changes")
        // eslint-disable-next-line unicorn/no-process-exit
        process.exit(0);
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
            commitHash: () =>
                p.text({
                    message: 'What branch / git commit hash do you want to create the diff with?',
                    placeholder: "main",
                    defaultValue: gitCurrentBranch,
                    validate: validateBranchNameOrCommitHash,
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

        const diff = await fsPromises.readFile("pr-splitter.diff", "utf8");
        if(diff.length === 0){
            p.cancel("Diff file is empty")
            // eslint-disable-next-line unicorn/no-process-exit
            process.exit(0);
        }

        s.start('Splitting the diff with AI');
        try {

            const { object } = await generateObject({
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


        console.log(object)

        s.stop('AI split the PR to multiple diffs');

        const {commits} = object;
        
        for (const commit of commits) {
            console.log(commit.message)
        }
        
        for (const commit of commits) {
            s.start(`Create diff for ${commit.message}`);
            const diffFileName = `./${commit.message}-diff.diff`;
            await fsPromises.writeFile(diffFileName, commit.diffFileContent)
            // await $`git apply ${diffFileName}`
            // await $`git commit -m ${commit.message}`
            s.stop(`Create commit for "${commit.message}"`);
        }
            p.note(`The PR is split into multiple ${commits.length} commits `, 'Next steps.');

            const branchToApplyChangesTo = await  p.text({
                message: 'What branch do you want to apply the commits to?',
                placeholder: project.commitHash,
                validate: validateBranchNameOrCommitHash,
            })

            if (typeof branchToApplyChangesTo === "string" && branchToApplyChangesTo.length > 0) {
                s.start(`Applying changes`);
                await applyChanges(branchToApplyChangesTo, commits);
                s.stop(`Changes added`);
            }

        }
        catch (error) {
            console.log( error)
            p.cancel("AI failed to split the diff")
            // eslint-disable-next-line unicorn/no-process-exit
            process.exit(0);
        }
    }

    // AA




    // B
    p.outro(`Problems? ${color.underline(color.cyan('https://example.com/issues'))}`);
}

// eslint-disable-next-line unicorn/prefer-top-level-await, github/no-then
main().catch(console.error);