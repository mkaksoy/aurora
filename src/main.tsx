import React from 'react'
import ReactDOM from 'react-dom/client'
import { errorHandler } from 'monaco-editor/esm/vs/base/common/errors.js'
import App from './App'
import './index.css'

document.addEventListener("contextmenu", function(e){ e.preventDefault(); }, false);
installCancellationFilters()

function isCanceledPromise(reason: unknown) {
  const value = reason as { name?: string; message?: string }
  const text = String(value?.message ?? value ?? '').trim()

  return (
    value?.name === 'Canceled' ||
    text === 'Canceled' ||
    text.includes('Canceled: Canceled') ||
    text.includes('Canceled')
  )
}

function installCancellationFilters() {
  errorHandler.unexpectedErrorHandler = (error) => {
    if (isCanceledPromise(error)) return

    setTimeout(() => {
      throw error instanceof Error ? error : new Error(String(error))
    }, 0)
  }

  const preventCanceled = (event: PromiseRejectionEvent) => {
    if (!isCanceledPromise(event.reason)) return

    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const preventCanceledError = (event: ErrorEvent) => {
    if (!isCanceledPromise(event.error) && !isCanceledPromise(event.message)) return

    event.preventDefault()
    event.stopImmediatePropagation()
  }

  window.addEventListener('unhandledrejection', preventCanceled, true)
  globalThis.addEventListener?.('unhandledrejection', preventCanceled, true)
  window.addEventListener('error', preventCanceledError, true)
  globalThis.addEventListener?.('error', preventCanceledError, true)
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
