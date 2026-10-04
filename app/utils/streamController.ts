/**
 * A simple stream controller like in Dart language.
 */
export class StreamController<T> {
  private _stream: ReadableStream<T>;
  private _controller: ReadableStreamDefaultController<T>;
  private _closed = false;

  constructor() {
    let controller!: ReadableStreamDefaultController<T>;
    this._stream = new ReadableStream<T>({
      start(c) {
        controller = c;
      },
    });
    this._controller = controller;
  }

  public add(data: T) {
    if (this._closed) {
      return;
    }
    this._controller.enqueue(data);
  }

  /**
   * End the stream. Data added before is still read; after that, readNext
   * rejects and iterators finish, instead of waiting for data that will
   * never come.
   */
  public close() {
    if (this._closed) {
      return;
    }
    this._closed = true;
    this._controller.close();
  }

  public async readNext(): Promise<T> {
    const reader = this._stream.getReader();

    try {
      const { value, done } = await reader.read();
      if (done) {
        throw new Error("No more data");
      }
      return value as T;
    } finally {
      reader.releaseLock();
    }
  }

  public createAsyncIterator() {
    let reader: ReadableStreamDefaultReader<T>;
    const asyncIterator = this._createAsyncIterator((r) => (reader = r));
    return {
      asyncIterator: asyncIterator as AsyncGenerator<T>,
      releaseLock: () => reader.releaseLock(),
    };
  }

  private async *_createAsyncIterator(
    onReader: (reader: ReadableStreamDefaultReader<T>) => void,
  ) {
    const reader = this._stream.getReader();
    onReader(reader);
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  }
}
