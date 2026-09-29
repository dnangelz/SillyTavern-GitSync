export function splitNul(output) {
    return output.split('\0').filter(Boolean);
}

export async function listConflicted(git) {
    return splitNul(await git.raw(['diff', '--name-only', '--diff-filter=U', '-z']));
}
