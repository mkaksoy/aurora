use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};
use tauri::{AppHandle, Emitter, Manager};

const EVENT_MESSAGE: &str = "lsp://message";
const EVENT_STDERR: &str = "lsp://stderr";
const EVENT_STOPPED: &str = "lsp://stopped";

pub type LspState = Arc<Mutex<Option<LspProcess>>>;

pub struct LspProcess {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspStartOptions {
    pub workspace_path: String,
    pub server_path: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspStartResult {
    pub server_path: String,
}

pub fn init_state() -> LspState {
    Arc::new(Mutex::new(None))
}

#[tauri::command]
pub fn lsp_start(
    app: AppHandle,
    state: tauri::State<'_, LspState>,
    options: LspStartOptions,
) -> Result<LspStartResult, String> {
    let mut guard = state.lock().map_err(|error| error.to_string())?;

    if guard.is_some() {
        return Err("Kotlin LSP is already running".to_string());
    }

    let workspace_path = PathBuf::from(&options.workspace_path);
    let server_path = options
        .server_path
        .map(PathBuf::from)
        .unwrap_or_else(|| bundled_server_path(&app));

    let mut args = options.args;
    if args.is_empty() {
        args.push("--stdio".to_string());
    }

    let mut command = Command::new(&server_path);
    command
        .args(&args)
        .current_dir(&workspace_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    for (key, value) in options.env {
        command.env(key, value);
    }

    let mut child = command.spawn().map_err(|error| {
        format!(
            "Kotlin LSP could not be started at '{}': {error}",
            server_path.display()
        )
    })?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Could not open Kotlin LSP stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not open Kotlin LSP stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Could not open Kotlin LSP stderr".to_string())?;

    spawn_stdout_reader(app.clone(), stdout);
    spawn_stderr_reader(app.clone(), stderr);

    *guard = Some(LspProcess { child, stdin });

    Ok(LspStartResult {
        server_path: server_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn lsp_send(message: Value, state: tauri::State<'_, LspState>) -> Result<(), String> {
    let mut guard = state.lock().map_err(|error| error.to_string())?;
    let process = guard
        .as_mut()
        .ok_or_else(|| "Kotlin LSP is not running".to_string())?;

    write_lsp_message(&mut process.stdin, &message)
}

#[tauri::command]
pub fn lsp_stop(state: tauri::State<'_, LspState>) -> Result<(), String> {
    let mut guard = state.lock().map_err(|error| error.to_string())?;
    let Some(mut process) = guard.take() else {
        return Ok(());
    };

    let _ = write_lsp_message(
        &mut process.stdin,
        &json!({ "jsonrpc": "2.0", "id": "__aurora_shutdown__", "method": "shutdown" }),
    );
    let _ = write_lsp_message(
        &mut process.stdin,
        &json!({ "jsonrpc": "2.0", "method": "exit" }),
    );
    let _ = process.stdin.flush();
    let _ = process.child.kill();

    Ok(())
}

#[tauri::command]
pub fn lsp_file_uri(path: String) -> Result<String, String> {
    file_uri(Path::new(&path))
}

fn spawn_stdout_reader(app: AppHandle, stdout: ChildStdout) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);

        loop {
            match read_lsp_message(&mut reader) {
                Ok(Some(message)) => {
                    if let Err(error) = app.emit(EVENT_MESSAGE, message) {
                        log::error!("Could not emit LSP message: {error}");
                    }
                }
                Ok(None) => break,
                Err(error) => {
                    log::error!("Kotlin LSP stdout read error: {error}");
                    break;
                }
            }
        }

        let _ = app.emit(EVENT_STOPPED, ());
    });
}

fn spawn_stderr_reader(app: AppHandle, stderr: impl Read + Send + 'static) {
    thread::spawn(move || {
        let reader = BufReader::new(stderr);

        for line in reader.lines().map_while(Result::ok) {
            log::warn!("[kotlin-lsp] {line}");
            let _ = app.emit(EVENT_STDERR, line);
        }
    });
}

fn write_lsp_message(stdin: &mut ChildStdin, message: &Value) -> Result<(), String> {
    let body = serde_json::to_vec(message).map_err(|error| error.to_string())?;
    let header = format!("Content-Length: {}\r\n\r\n", body.len());

    stdin
        .write_all(header.as_bytes())
        .map_err(|error| format!("Could not write LSP header: {error}"))?;
    stdin
        .write_all(&body)
        .map_err(|error| format!("Could not write LSP body: {error}"))?;
    stdin
        .flush()
        .map_err(|error| format!("Could not flush LSP stdin: {error}"))
}

fn read_lsp_message(reader: &mut BufReader<ChildStdout>) -> Result<Option<Value>, String> {
    let mut content_length = None;

    loop {
        let mut line = String::new();
        let bytes = reader
            .read_line(&mut line)
            .map_err(|error| format!("Could not read LSP header: {error}"))?;

        if bytes == 0 {
            return Ok(None);
        }

        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }

        if let Some(value) = trimmed.strip_prefix("Content-Length:") {
            content_length = Some(
                value
                    .trim()
                    .parse::<usize>()
                    .map_err(|error| format!("Invalid Content-Length header: {error}"))?,
            );
        }
    }

    let content_length =
        content_length.ok_or_else(|| "Missing Content-Length header".to_string())?;
    let mut body = vec![0; content_length];
    reader
        .read_exact(&mut body)
        .map_err(|error| format!("Could not read LSP body: {error}"))?;

    serde_json::from_slice(&body).map(Some).map_err(|error| {
        let raw = String::from_utf8_lossy(&body);
        format!("Could not parse LSP JSON: {error}; raw={raw}")
    })
}

fn bundled_server_path(app: &AppHandle) -> PathBuf {
    if let Ok(path) = app.path().resolve(
        "kotlin-lsp/bin/intellij-server.exe",
        tauri::path::BaseDirectory::Resource,
    ) {
        if path.exists() {
            return path;
        }
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("kotlin-lsp/bin/intellij-server.exe")
}

fn file_uri(path: &Path) -> Result<String, String> {
    let absolute = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string();
    let absolute = strip_windows_extended_prefix(&absolute);
    let mut value = absolute.to_string_lossy().replace('\\', "/");

    if cfg!(windows) && !value.starts_with('/') {
        value = format!("/{value}");
    }

    Ok(format!("file://{}", percent_encode_path(&value)))
}

fn strip_windows_extended_prefix(path: &str) -> PathBuf {
    if let Some(stripped) = path.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{stripped}"));
    }

    if let Some(stripped) = path.strip_prefix(r"\\?\") {
        return PathBuf::from(stripped);
    }

    PathBuf::from(path)
}

fn percent_encode_path(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' | b':' => {
                vec![byte as char]
            }
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}
