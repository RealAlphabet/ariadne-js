import { parse } from 'parse5';
import { liftScript } from './slice.js';

/**
 * Analyze classic scripts in DOM order. `scripts` maps src attributes to supplied
 * JavaScript. No network requests and no execution of the input HTML/scripts.
 * The generated code expects the original document (and other externals) at run time.
 */
export function liftHtml(html, { scripts = {}, ...options } = {}) {
  const document = parse(html);
  const sources = [];
  const missingScripts = [];
  function walk(node) {
    if (node.tagName === 'script') {
      const attributes = new Map(node.attrs.map(attribute => [attribute.name, attribute.value]));
      const type = (attributes.get('type') ?? '').trim().toLowerCase();
      if (type === 'module') throw new Error('Module scripts are not supported; supply classic scripts.');
      if (type && !['text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript'].includes(type)) return;
      const src = attributes.get('src');
      if (src !== undefined) {
        if (Object.hasOwn(scripts, src)) sources.push(scripts[src]);
        else missingScripts.push(src);
      } else {
        sources.push(node.childNodes.map(child => child.value ?? '').join(''));
      }
      return;
    }
    for (const child of node.childNodes ?? []) walk(child);
  }
  walk(document);
  const result = liftScript(sources.join('\n;\n'), options);
  return { ...result, missingScripts };
}
