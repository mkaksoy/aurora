import React from 'react'
import ReactDOM from 'react-dom/client'
import { errorHandler } from 'monaco-editor/esm/vs/base/common/errors.js'
import App from './App'
import './index.css'

document.addEventListener("contextmenu", function(e){ e.preventDefault(); }, false);
installCancellationFilters()

function isCanceledPromise(reason: unknown) {
  if (reason == null) return false
  
  const value = reason as { name?: string; message?: string; code?: number }
  
  // Monaco'nun CancellationError'ı bazen code ile gelir
  if (value?.name === 'Canceled') return true
  if (value?.name === 'CancellationError') return true
  
  const text = String(value?.message ?? value ?? '').trim()
  
  return (
    text === 'Canceled' ||
    text.startsWith('Canceled:') ||
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
