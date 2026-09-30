export {}

declare global {
  interface Window {
    nkw: {
      invoke(channel: string, arg?: unknown): Promise<unknown>
      on(channel: string, cb: (payload: unknown) => void): () => void
      pathForFile(file: File): string
    }
  }
}
