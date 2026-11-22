import { LanguageDescription } from '@codemirror/language';

// The languages a code block offers. Crepe's default is every grammar
// CodeMirror ships (see stubs/languageData.js), so nib passes its own list:
// the ones people actually paste into notes, each loaded only when a block
// first uses it, so none of them costs anything until then.
//
// Names are what goes after the ``` in the note, so they are the lowercase
// words the terminal, GitHub and every other markdown tool already use. The
// picker shows them by `label`.
const lang = (name, label, alias, load) => ({
  label,
  description: LanguageDescription.of({ name, alias, load }),
});

const LANGUAGES = [
  lang('bash', 'Bash', ['sh', 'shell', 'zsh'], async () => {
    const [{ StreamLanguage, LanguageSupport }, { shell }] = await Promise.all([
      import('@codemirror/language'),
      import('@codemirror/legacy-modes/mode/shell'),
    ]);
    return new LanguageSupport(StreamLanguage.define(shell));
  }),
  lang('c', 'C', ['h'], async () => (await import('@codemirror/lang-cpp')).cpp()),
  lang('cpp', 'C++', ['c++', 'cc', 'hpp'], async () => (await import('@codemirror/lang-cpp')).cpp()),
  lang('css', 'CSS', [], async () => (await import('@codemirror/lang-css')).css()),
  lang('go', 'Go', ['golang'], async () => (await import('@codemirror/lang-go')).go()),
  lang('html', 'HTML', ['htm'], async () => (await import('@codemirror/lang-html')).html()),
  lang('java', 'Java', [], async () => (await import('@codemirror/lang-java')).java()),
  lang('javascript', 'JavaScript', ['js', 'jsx', 'mjs'], async () =>
    (await import('@codemirror/lang-javascript')).javascript({ jsx: true })),
  lang('json', 'JSON', [], async () => (await import('@codemirror/lang-json')).json()),
  lang('markdown', 'Markdown', ['md'], async () => (await import('@codemirror/lang-markdown')).markdown()),
  lang('php', 'PHP', [], async () => (await import('@codemirror/lang-php')).php()),
  lang('python', 'Python', ['py'], async () => (await import('@codemirror/lang-python')).python()),
  lang('rust', 'Rust', ['rs'], async () => (await import('@codemirror/lang-rust')).rust()),
  lang('sql', 'SQL', [], async () => (await import('@codemirror/lang-sql')).sql()),
  lang('typescript', 'TypeScript', ['ts', 'tsx'], async () =>
    (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: true })),
  lang('xml', 'XML', ['svg'], async () => (await import('@codemirror/lang-xml')).xml()),
  lang('yaml', 'YAML', ['yml'], async () => (await import('@codemirror/lang-yaml')).yaml()),
];

export const languages = LANGUAGES.map((l) => l.description);

const LABELS = new Map(LANGUAGES.map((l) => [l.description.name, l.label]));

// What the picker shows for a language: its proper name, not the fence word.
export function languageLabel(name) {
  return LABELS.get(name) ?? name;
}
