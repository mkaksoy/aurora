import { invoke } from '@tauri-apps/api/core'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import {
  AbstractMessageReader,
  AbstractMessageWriter,
  DataCallback,
  Disposable,
  Message,
} from 'vscode-jsonrpc/browser'

export class TauriMessageReader extends AbstractMessageReader {
  private dataCallback: DataCallback | null = null
  private unlisten: UnlistenFn | null = null
  private pendingMessages: Message[] = []

  async start(): Promise<void> {
    this.unlisten = await listen<Message>('lsp://message', (event) => {
      const message = event.payload

      if (this.dataCallback) {
        this.dataCallback(message)
      } else {
        this.pendingMessages.push(message)
      }
    })
  }

  listen(callback: DataCallback): Disposable {
    this.dataCallback = callback

    if (this.pendingMessages.length > 0) {
      const queued = this.pendingMessages.splice(0)
      Promise.resolve().then(() => {
        for (const message of queued) {
          callback(message)
        }
      })
    }

    return Disposable.create(() => {
      this.dataCallback = null
    })
  }

  override dispose(): void {
    this.pendingMessages = []
    this.unlisten?.()
    this.unlisten = null
    super.dispose()
  }
}

export class TauriMessageWriter extends AbstractMessageWriter {
  async write(message: Message): Promise<void> {
    try {
      await invoke<void>('lsp_send', { message })
    } catch (error) {
      this.fireError(error instanceof Error ? error : new Error(String(error)))
    }
  }

  end(): void {
    void invoke('lsp_stop').catch((error) => {
      this.fireError(error instanceof Error ? error : new Error(String(error)))
    })
  }
}