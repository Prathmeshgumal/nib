// Crepe's default configuration imports every grammar CodeMirror ships - about
// 1.5 MB of parsers for languages nobody writes notes in, and none of it
// tree-shakes, because its feature loader imports all twelve features whether
// they are switched on or not.
//
// The languages actually offered are passed explicitly to the CodeMirror
// feature instead, so this list starts empty on purpose.
export const languages = [];
