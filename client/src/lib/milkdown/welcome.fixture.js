// The welcome note, copied verbatim from internal/store/welcome.go. It is the
// one piece of markdown every user is guaranteed to open, so the editor has to
// hand it back unchanged. Keep the two in step.
export const welcome = `This is Markdown, the way GitHub Gists write it.

- **bold**, *italic*, ~~strikethrough~~ and \`inline code\`
- [x] a finished task
- [ ] one still to do
- [the Markdown guide](https://docs.github.com/en/get-started/writing-on-github)

nib saves your writing as you go, and the terminal and the browser show the same notes.

## In the terminal

- \`n\` starts a new note — the first line becomes its title
- \`/\` searches everything you have written
- \`w\` opens the same notes in your browser
- \`d\` moves a note to the trash, and \`u\` brings it back
- \`esc\` and \`ctrl+s\` close the editor and keep it, and \`ctrl+p\` previews it
- \`?\` shows every key

## In the browser

- **New note** in the sidebar starts one — the first line becomes its title
- type \`/\` on an empty line for tables, code blocks and more
- the six dots beside a block move it, or click them for its menu (\`ctrl+/\`)
- \`ctrl+s\` saves straight away, and \`esc\` steps out of the text

Delete this note whenever you like — nothing depends on it.
`;
