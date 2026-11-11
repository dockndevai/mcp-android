/**
 * Everything that crosses from this process into the device's shell goes through here.
 *
 * `adb shell a b c` does NOT run `a` with arguments `b` and `c`: adb joins its arguments with spaces
 * into one string and hands that string to `sh -c` on the device, so any shell syntax in an argument
 * (`;`, `|`, `$(…)`, backticks, quotes, newlines) is executed. The only safe way to pass data is to
 * quote every argument ourselves and give adb exactly ONE string.
 */
export class AdbError extends Error {}
/** An argument that cannot be passed to the device safely (refused before adb is run). */
export class ShellArgError extends AdbError {}

/** Characters that mean nothing to a POSIX shell anywhere in a word, so they need no quoting. */
const SAFE_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** Quote one argument for a POSIX shell (single quotes; an embedded `'` becomes `'\''`). */
export function shellQuote(arg: string): string {
  if (arg.includes("\0")) throw new ShellArgError("Argument contains a NUL byte");
  if (arg !== "" && SAFE_WORD.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** Quote and join a command + arguments into the single string to hand to `adb shell`. */
export function shellJoin(args: string[]): string {
  return args.map(shellQuote).join(" ");
}

/**
 * Split text for `adb shell input text`. Android's `input text` rewrites every `%s` to a space, so a
 * literal `%s` cannot be typed in one command; splitting between the `%` and the `s` and typing the
 * halves as separate commands types it faithfully. Spaces are encoded as `%s` (a space itself would
 * end the argument). `%%s` -> `% ` and `%` followed by a space are already correct on the device.
 */
export function inputTextChunks(text: string): string[] {
  if (text === "") return [];
  const parts = text.split("%s");
  return parts.map((part, i) => {
    const chunk = (i > 0 ? "s" : "") + part + (i < parts.length - 1 ? "%" : "");
    return chunk.replace(/ /g, "%s");
  });
}

/** URL schemes `open_url` accepts by default. Anything else (file:, content:, intent:, javascript:, …) is refused. */
export const DEFAULT_URL_SCHEMES = ["http", "https", "tel", "mailto", "geo", "market"] as const;

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*$/;

/** Validate and normalise a list of extra URL schemes from configuration. */
export function parseUrlSchemes(list: string[]): string[] {
  return list.map((s) => {
    if (!SCHEME.test(s)) throw new Error(`Invalid URL scheme '${s}' (expected letters, digits, '+', '-' or '.').`);
    return s.toLowerCase();
  });
}

/** Throw unless `url` is a single-line URL whose scheme is allowed. Returns the URL unchanged. */
export function assertUrl(url: string, extraSchemes: readonly string[] = []): string {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(url)) throw new ShellArgError("Invalid URL: control characters are not allowed.");
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(url);
  const allowed = [...DEFAULT_URL_SCHEMES, ...extraSchemes.map((s) => s.toLowerCase())];
  if (!m || !allowed.includes(m[1].toLowerCase())) {
    throw new ShellArgError(
      `Refused URL scheme ${m ? `'${m[1].toLowerCase()}:'` : "(none)"}: allowed schemes are ${allowed.join(", ")} (add more with ANDROID_EXTRA_URL_SCHEMES).`,
    );
  }
  return url;
}

/** Throw unless `n` is a finite integer (it is about to be put in a command line). */
export function assertInt(n: unknown, what: string): number {
  if (typeof n !== "number" || !Number.isInteger(n)) throw new ShellArgError(`${what} must be an integer`);
  return n;
}

/** `input keyevent` accepts a KEYCODE_* name or a number. */
export function assertKeycode(k: string): string {
  if (!/^(KEYCODE_[A-Z0-9_]+|\d+)$/.test(k)) throw new ShellArgError(`Invalid keycode: ${JSON.stringify(k)}`);
  return k;
}
