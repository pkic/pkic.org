import type { R2BucketLike, R2ObjectLike } from "../../functions/_lib/types";

class R2ObjectShim implements R2ObjectLike {
  private readonly value: string;

  constructor(value: string) {
    this.value = value;
  }

  get body(): ReadableStream {
    const bytes = new TextEncoder().encode(this.value);
    return new ReadableStream({ start(ctrl) { ctrl.enqueue(bytes); ctrl.close(); } });
  }

  async text(): Promise<string> {
    return this.value;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return new TextEncoder().encode(this.value).buffer as ArrayBuffer;
  }
}

export class R2BucketShim implements R2BucketLike {
  private readonly map = new Map<string, string>();

  async get(key: string): Promise<R2ObjectLike | null> {
    if (!this.map.has(key)) {
      return null;
    }

    return new R2ObjectShim(this.map.get(key) as string);
  }

  async put(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  delete(key: string): void {
    this.map.delete(key);
  }
}
