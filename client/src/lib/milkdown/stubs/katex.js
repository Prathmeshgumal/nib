// LaTeX is off. KaTeX is 264 KB of JavaScript plus 1.2 MB of fonts across 60
// files, all of which would have to be embedded in the Go binary to render
// maths nobody asked for. Crepe imports it whether or not the feature runs,
// so it is aliased to this.
//
// If LaTeX is ever switched on, delete this file and the two aliases that
// point at it rather than trying to make it do something.
const katex = {
  render() {},
  renderToString: () => '',
};

export default katex;
export const render = katex.render;
export const renderToString = katex.renderToString;
