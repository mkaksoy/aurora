<img src="public/aurora-logo.svg" width="128">

# Aurora

Aurora is a minimalist desktop IDE for Kotlin, designed to provide a calm, fast, and elegant coding experience.
It combines a modern React interface with a native Tauri shell, Monaco Editor, and a Rust-powered bridge for Kotlin
language-server features.

**Aurora is built for focused development.** It keeps the workspace clean, the interface quiet, and the tools close enough
to stay useful without getting in your way.

---

### Downloads

#### Stable builds

Stable builds will be published through the project's release page once Aurora is ready for distribution.

#### Development builds

Development builds can be created locally from source. These builds are intended for contributors and testers, and may
include unfinished features or rough edges.

### Installation

Aurora is currently distributed as a source project. To run it locally, make sure you have the required tooling installed:

- Node.js 22 or newer
- Rust stable
- npm
- Tauri system dependencies for your operating system

Install the frontend dependencies:

```bash
npm install
```

Run the desktop app in development mode:

```bash
npm run tauri -- dev
```

### Getting Help

If something does not work as expected, start by checking your local Node.js, Rust, and Tauri setup. Aurora also expects
the Kotlin language server resource to be available when packaging the desktop app.

### Reporting Issues

If you find a bug, crash, broken workflow, or missing Kotlin IDE behavior, please open an issue with:

- A short description of the problem
- Steps to reproduce it
- Your operating system
- Relevant terminal output or logs
- Screenshots, if the issue is visual

### Join the Project

Aurora is still young, and contributions are welcome. Good places to help include:

- Kotlin language-server integration
- Editor and diagnostics behavior
- File explorer workflows
- Build and release automation
- UI polish and accessibility

## Features

- Monaco-powered code editor
- Kotlin syntax support
- Kotlin LSP integration through Tauri commands
- Project folder explorer with file watching
- Multi-tab editing workflow
- Diagnostics and status feedback
- Terminal-style bottom panel
- Frameless native desktop window
- GitHub Actions and GitLab CI/CD templates

## Building from Sources

Aurora uses Vite for the frontend and Tauri for the desktop application.

Build the frontend:

```bash
npm run build
```

Build the desktop bundle:

```bash
npm run tauri -- build
```

The generated desktop artifacts are written under:

```text
src-tauri/target/release/bundle/
```

### Build Requirements

- Node.js 22 or newer
- Rust stable toolchain
- npm
- Platform-specific Tauri dependencies
- Kotlin language server resource at `src-tauri/kotlin-lsp/bin/intellij-server.exe`

## Project Structure

```text
aurora/
  public/        static assets and branding
  src/           React and TypeScript frontend
  src-tauri/     Tauri configuration and Rust backend
```

## License

This project is currently private. License information will be added before public distribution.
