import { webcrack } from 'webcrack';
import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten';

// Fresh interpreter per evaluation. No host functions, DOM or module loader are
// exposed. Webcrack supplies the selected string-array initialization/decoder,
// not the page itself. Mutations remain in the interpreter's disposable heap.
export async function evaluateDecoder(code, { timeoutMs = 2000 } = {}) {
  const engine = await getQuickJS();
  return engine.evalCode(code, {
    shouldInterrupt: shouldInterruptAfterDeadline(Date.now() + timeoutMs),
    memoryLimitBytes: 32 * 1024 * 1024,
    maxStackSizeBytes: 512 * 1024,
  });
}

export async function deobfuscate(source) {
  const result = await webcrack(source, {
    unpack: false,
    jsx: false,
    sandbox: evaluateDecoder,
  });
  return result.code;
}
