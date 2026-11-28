// Stands in for `expo-file-system` under Jest (mapped in `jest.setup.ts`): one in-memory cache directory with the
// `File`, `Directory` and `Paths` surface the app uses. `cacheFiles()` lists what a suite wrote; `resetFiles()` empties it.
const files = new Map<string, string>();

const CACHE_URI = 'file:///cache/';

export class Directory {
  readonly uri: string;

  constructor(uri: string) {
    this.uri = uri;
  }

  list(): (File | Directory)[] {
    return [...files.keys()].filter((uri) => uri.startsWith(this.uri)).map((uri) => new File(this, uri.slice(this.uri.length)));
  }
}

export class File {
  readonly uri: string;
  readonly name: string;

  constructor(parent: Directory, name: string) {
    this.uri = `${parent.uri}${name}`;
    this.name = name;
  }

  get exists(): boolean {
    return files.has(this.uri);
  }

  write(content: string): Promise<void> {
    files.set(this.uri, content);
    return Promise.resolve();
  }

  text(): Promise<string> {
    return Promise.resolve(files.get(this.uri) ?? '');
  }

  delete(): void {
    if (!files.delete(this.uri)) throw new Error('The file does not exist');
  }
}

export const Paths = { cache: new Directory(CACHE_URI) };

/** The names in the cache directory, sorted. */
export function cacheFiles(): string[] {
  return [...files.keys()].map((uri) => uri.slice(CACHE_URI.length)).sort();
}

export function cacheFileText(name: string): string | undefined {
  return files.get(`${CACHE_URI}${name}`);
}

export function resetFiles(): void {
  files.clear();
}
