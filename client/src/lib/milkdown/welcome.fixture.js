// The welcome note, copied verbatim from internal/store/welcome.go. It is the
// one piece of markdown every user is guaranteed to open, so the editor has to
// hand it back unchanged. Keep the two in step.
export const welcome = `# Welcome to nib

This is Markdown, the way GitHub Gists write it.

- **bold**, *italic*, ~~strikethrough~~ and \`inline code\`
- [x] a finished task
- [ ] one still to do
- [the Markdown guide](https://docs.github.com/en/get-started/writing-on-github)

> Press ? at any time for every key.

Some things worth trying:

1. \`n\` starts a new note — the first line becomes its title
2. \`/\` searches everything you have written
3. \`w\` opens the same notes in your browser
4. \`d\` moves a note to the trash, and \`u\` brings it back

Your writing saves itself as you go. \`esc\` and
\`ctrl+s\` both just close the editor and keep it, and
\`ctrl+p\` previews what you are writing.

| Key | Does |
| --- | ---- |
| j k | move |
| ↵   | edit |
| q   | quit |

Delete this note whenever you like — nothing depends on it.
`;
