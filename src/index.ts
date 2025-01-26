import {setTimeout} from 'node:timers/promises';
import * as p from '@clack/prompts';
import color from 'picocolors';
import {$} from "execa";

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
    const gitCurrentBranch = await $`git rev-parse --abbrev-ref HEAD`

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
                    placeholder: gitCurrentBranch.message,
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
                    initialValue: false,
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
        s.message('Diff file created');
        await setTimeout(2500);
        s.stop('Installed via pnpm');
    }

    // const nextSteps = `cd ${project.path}        \n${project.install ? '' : 'pnpm install\n'}pnpm dev`;

    // p.note(nextSteps, 'Next steps.');

    p.outro(`Problems? ${color.underline(color.cyan('https://example.com/issues'))}`);
}

// eslint-disable-next-line unicorn/prefer-top-level-await, github/no-then
main().catch(console.error);