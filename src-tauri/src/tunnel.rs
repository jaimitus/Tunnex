//! SSH tunnel manager with local port forwarding.
//!
//! For every active rule:
//! 1. An asynchronous SSH session is established with `russh` (password or key).
//! 2. A `TcpListener` is bound on `127.0.0.1:<local_port>`.
//! 3. Every incoming connection opens a `direct-tcpip` channel towards
//!    `remote_host:remote_port` and runs `copy_bidirectional` between the local
//!    socket and the channel while metering the transferred bytes.
//! 4. The lifecycle is driven by `tokio::sync::mpsc` channels (stop/restart) and
//!    every state change is pushed to the frontend via the `tunnel-status` event.
//! 5. Optionally, a native Windows PowerShell console is opened as soon as the
//!    SSH session is up (see `console.rs`).

use std::collections::HashMap;
use std::io;
use std::pin::Pin;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use russh::client;
use russh::keys::{self, PrivateKeyWithHashAlg};
use russh::Disconnect;
use tauri::Emitter;
use thiserror::Error;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;

use crate::console;
use crate::models::{
    AppSettings, AuthMethod, PortForwardRule, SshProfile, TunnelState, TunnelStatus,
};

/// Tauri event name carrying `TunnelStatus` updates to the frontend.
pub const STATUS_EVENT: &str = "tunnel-status";

/// Tauri event name carrying console launch notifications to the frontend.
pub const CONSOLE_EVENT: &str = "console-launched";

/// Cadence of the traffic snapshots pushed to the UI.
const TICK_INTERVAL: Duration = Duration::from_millis(1000);

/// Maximum time allowed for the TCP + SSH handshake.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Error)]
pub enum TunnelError {
    #[error("could not create the async tunnel runtime: {0}")]
    Runtime(String),
    #[error("the tunnel for rule {0} is already running")]
    AlreadyActive(String),
    #[error("tunnel not found: {0}")]
    NotFound(String),
    #[error("{0}")]
    Other(String),
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// SSH client handler. Accepts the server key (trust-on-first-use policy),
/// which is adequate for a tunnel manager driven by the local user.
struct TunnexHandler;

impl client::Handler for TunnexHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

/// Atomic traffic counters shared by every connection of a tunnel.
#[derive(Debug, Default)]
struct Counters {
    bytes_sent: AtomicU64,
    bytes_received: AtomicU64,
    connections: AtomicU32,
}

/// Wraps an SSH channel stream and meters every byte flowing through it.
struct Metered<S> {
    inner: S,
    counters: Arc<Counters>,
}

impl<S: AsyncRead + Unpin> AsyncRead for Metered<S> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let this = &mut *self;
        match Pin::new(&mut this.inner).poll_read(cx, buf) {
            Poll::Ready(Ok(())) => {
                let read = buf.filled().len() as u64;
                if read > 0 {
                    this.counters
                        .bytes_received
                        .fetch_add(read, Ordering::Relaxed);
                }
                Poll::Ready(Ok(()))
            }
            other => other,
        }
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for Metered<S> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        let this = &mut *self;
        match Pin::new(&mut this.inner).poll_write(cx, buf) {
            Poll::Ready(Ok(n)) => {
                if n > 0 {
                    this.counters
                        .bytes_sent
                        .fetch_add(n as u64, Ordering::Relaxed);
                }
                Poll::Ready(Ok(n))
            }
            other => other,
        }
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

/// A running tunnel: how to ask it to stop and how to read its status.
struct RunningTunnel {
    shutdown_tx: mpsc::Sender<()>,
    counters: Arc<Counters>,
    status: Arc<Mutex<TunnelStatus>>,
}

impl RunningTunnel {
    /// Current status with up-to-date traffic counters.
    fn snapshot(&self) -> TunnelStatus {
        let mut status = self
            .status
            .lock()
            .expect("tunnel status mutex is never poisoned")
            .clone();
        status.bytes_sent = self.counters.bytes_sent.load(Ordering::Relaxed);
        status.bytes_received = self.counters.bytes_received.load(Ordering::Relaxed);
        status.connections = self.counters.connections.load(Ordering::Relaxed);
        status
    }
}

/// Global tunnel manager. Cheap to clone (everything lives behind `Arc`).
#[derive(Clone)]
pub struct TunnelManager {
    runtime: Arc<tokio::runtime::Runtime>,
    tunnels: Arc<Mutex<HashMap<String, RunningTunnel>>>,
    app: tauri::AppHandle,
}

impl TunnelManager {
    /// Creates the manager with its own multi-threaded Tokio runtime, isolated
    /// from the UI thread.
    pub fn new(app: tauri::AppHandle) -> Result<Self, TunnelError> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("tunnex-io")
            .enable_all()
            .build()
            .map_err(|e| TunnelError::Runtime(e.to_string()))?;

        Ok(Self {
            runtime: Arc::new(runtime),
            tunnels: Arc::new(Mutex::new(HashMap::new())),
            app,
        })
    }

    /// Pushes a `TunnelStatus` to the frontend (`tunnel-status` event).
    pub fn emit_status(&self, status: &TunnelStatus) {
        if let Err(e) = self.app.emit(STATUS_EVENT, status) {
            log::error!("could not emit status for tunnel {}: {e}", status.rule_id);
        }
    }

    /// Pushes a console launch notification to the frontend.
    pub fn emit_console(&self, launch: &crate::models::ConsoleLaunch) {
        if let Err(e) = self.app.emit(CONSOLE_EVENT, launch) {
            log::error!("could not emit console launch event: {e}");
        }
    }

    pub fn is_running(&self, rule_id: &str) -> bool {
        self.tunnels.lock().unwrap().contains_key(rule_id)
    }

    pub fn snapshot(&self, rule_id: &str) -> Option<TunnelStatus> {
        self.tunnels
            .lock()
            .unwrap()
            .get(rule_id)
            .map(RunningTunnel::snapshot)
    }

    pub fn active_count(&self) -> usize {
        self.tunnels.lock().unwrap().len()
    }

    /// Runs blocking work (file I/O, keyring, process spawning) on the tunnel
    /// runtime blocking pool so the UI thread is never stalled.
    pub fn spawn_blocking<F, R>(&self, f: F) -> tokio::task::JoinHandle<R>
    where
        F: FnOnce() -> R + Send + 'static,
        R: Send + 'static,
    {
        self.runtime.spawn_blocking(f)
    }

    /// Starts the tunnel of a rule. Returns the initial (`Connecting`) status.
    ///
    /// `secret` is the password (password auth) or the private key passphrase
    /// (key auth), already resolved from the Credential Manager.
    /// `settings` drives the optional PowerShell console opened on connect.
    pub fn start_tunnel(
        &self,
        profile: SshProfile,
        rule: PortForwardRule,
        secret: Option<String>,
        settings: AppSettings,
    ) -> Result<TunnelStatus, TunnelError> {
        let rule_id = rule.id.clone();

        {
            let tunnels = self.tunnels.lock().unwrap();
            if tunnels.contains_key(&rule_id) {
                return Err(TunnelError::AlreadyActive(rule_id));
            }
        }

        let counters = Arc::new(Counters::default());
        let status = Arc::new(Mutex::new(TunnelStatus {
            rule_id: rule_id.clone(),
            state: TunnelState::Connecting,
            bytes_sent: 0,
            bytes_received: 0,
            connections: 0,
            started_at: None,
            error: None,
        }));
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);

        self.tunnels.lock().unwrap().insert(
            rule_id.clone(),
            RunningTunnel {
                shutdown_tx,
                counters: counters.clone(),
                status: status.clone(),
            },
        );

        let manager = self.clone();
        self.runtime.spawn(run_tunnel(
            manager, profile, rule, secret, settings, counters, status, shutdown_rx,
        ));

        let initial = TunnelStatus {
            rule_id,
            state: TunnelState::Connecting,
            bytes_sent: 0,
            bytes_received: 0,
            connections: 0,
            started_at: None,
            error: None,
        };
        self.emit_status(&initial);
        Ok(initial)
    }

    /// Stops the tunnel of a rule and notifies the UI immediately.
    pub fn stop_tunnel(&self, rule_id: &str) -> Result<TunnelStatus, TunnelError> {
        let running = self
            .tunnels
            .lock()
            .unwrap()
            .remove(rule_id)
            .ok_or_else(|| TunnelError::NotFound(rule_id.to_string()))?;

        {
            let mut status = running.status.lock().unwrap();
            status.state = TunnelState::Inactive;
            status.error = None;
            status.started_at = None;
            status.connections = 0;
            status.bytes_sent = 0;
            status.bytes_received = 0;
        }
        // Signal the accept loop to terminate
        let _ = running.shutdown_tx.try_send(());

        let snapshot = running.snapshot();
        self.emit_status(&snapshot);
        Ok(snapshot)
    }

    /// Stops every tunnel (used when the application exits).
    pub fn stop_all(&self) {
        let ids: Vec<String> = self.tunnels.lock().unwrap().keys().cloned().collect();
        for id in ids {
            if let Err(e) = self.stop_tunnel(&id) {
                log::warn!("could not stop tunnel {id}: {e}");
            }
        }
    }

    /// Starts every configured tunnel that is not currently running.
    pub fn start_all(&self) {
        let data = match crate::storage::Storage::open().and_then(|s| s.load()) {
            Ok(data) => data,
            Err(e) => {
                log::error!("could not read configuration for start_all: {e}");
                return;
            }
        };

        for rule in data.rules {
            if self.is_running(&rule.id) {
                continue;
            }
            let Some(profile) = data
                .profiles
                .iter()
                .find(|p| p.id == rule.profile_id)
                .cloned()
            else {
                log::warn!("rule '{}' references missing profile; skipping", rule.name);
                continue;
            };

            let secret = match &profile.auth_method {
                AuthMethod::Password => {
                    crate::storage::get_secret(&crate::storage::password_user(&profile.id)).unwrap_or(None)
                }
                AuthMethod::KeyFile { has_passphrase, .. } => {
                    if *has_passphrase {
                        crate::storage::get_secret(&crate::storage::passphrase_user(&profile.id)).unwrap_or(None)
                    } else {
                        None
                    }
                }
            };

            if let Err(e) = self.start_tunnel(profile, rule.clone(), secret, data.settings.clone()) {
                log::warn!("start_all failed for rule '{}': {e}", rule.name);
            }
        }
    }

    /// Flags a rule as failed, notifies the UI and releases its slot.
    fn mark_error(&self, rule_id: &str, status: &Arc<Mutex<TunnelStatus>>, message: String) {
        let snapshot = {
            let mut guard = status.lock().unwrap();
            guard.state = TunnelState::Error;
            guard.error = Some(message);
            guard.started_at = None;
            guard.connections = 0;
            guard.bytes_sent = 0;
            guard.bytes_received = 0;
            guard.clone()
        };
        log::error!(
            "[tunnel {rule_id}] {}",
            snapshot.error.clone().unwrap_or_default()
        );
        self.emit_status(&snapshot);
        self.tunnels.lock().unwrap().remove(rule_id);
    }

    /// Flags a rule as inactive after a clean shutdown and notifies the UI.
    fn mark_inactive(&self, _rule_id: &str, status: &Arc<Mutex<TunnelStatus>>) {
        let snapshot = {
            let mut guard = status.lock().unwrap();
            guard.state = TunnelState::Inactive;
            guard.error = None;
            guard.started_at = None;
            guard.connections = 0;
            guard.bytes_sent = 0;
            guard.bytes_received = 0;
            guard.clone()
        };
        self.emit_status(&snapshot);
    }
}

/// Asynchronous bidirectional copy between the local TCP socket and the SSH channel.
async fn forward<R>(mut socket: TcpStream, mut remote: Metered<R>) -> io::Result<()>
where
    R: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    tokio::io::copy_bidirectional(&mut socket, &mut remote).await?;
    Ok(())
}

/// Main body of a tunnel: connect, authenticate, bind the local port and pump
/// connections until a shutdown request arrives.
#[allow(clippy::too_many_arguments)]
async fn run_tunnel(
    manager: TunnelManager,
    profile: SshProfile,
    rule: PortForwardRule,
    secret: Option<String>,
    settings: AppSettings,
    counters: Arc<Counters>,
    status: Arc<Mutex<TunnelStatus>>,
    mut shutdown_rx: mpsc::Receiver<()>,
) {
    let rule_id = rule.id.clone();

    // 1) SSH handshake with timeout
    let config = Arc::new(client::Config::default());
    let mut session = match tokio::time::timeout(
        CONNECT_TIMEOUT,
        client::connect(config, (profile.host.as_str(), profile.port), TunnexHandler),
    )
    .await
    {
        Ok(Ok(session)) => session,
        Ok(Err(e)) => {
            return manager.mark_error(
                &rule_id,
                &status,
                format!(
                    "could not connect to {}:{} — {}",
                    profile.host, profile.port, e
                ),
            );
        }
        Err(_) => {
            return manager.mark_error(
                &rule_id,
                &status,
                format!(
                    "connection attempt to {}:{} timed out after {}s",
                    profile.host,
                    profile.port,
                    CONNECT_TIMEOUT.as_secs()
                ),
            );
        }
    };

    // 2) Authentication
    let auth_result = match &profile.auth_method {
        AuthMethod::Password => {
            let Some(password) = secret.as_deref() else {
                return manager.mark_error(
                    &rule_id,
                    &status,
                    "no password stored for this profile; edit it and enter the password again"
                        .to_string(),
                );
            };
            session
                .authenticate_password(profile.username.clone(), password.to_string())
                .await
        }
        AuthMethod::KeyFile { path, .. } => {
            let key = match keys::load_secret_key(path, secret.as_deref()) {
                Ok(key) => key,
                Err(e) => {
                    return manager.mark_error(
                        &rule_id,
                        &status,
                        format!("could not load private key `{path}`: {e}"),
                    );
                }
            };
            let key = PrivateKeyWithHashAlg::new(Arc::new(key), None);
            session
                .authenticate_publickey(profile.username.clone(), key)
                .await
        }
    };

    match auth_result {
        Ok(result) if result.success() => {}
        Ok(_) => {
            return manager.mark_error(
                &rule_id,
                &status,
                format!("SSH authentication rejected for user `{}`", profile.username),
            );
        }
        Err(e) => {
            return manager.mark_error(
                &rule_id,
                &status,
                format!("SSH authentication error: {e}"),
            );
        }
    }

    // 3) Bind the local port
    let listener = match TcpListener::bind(("127.0.0.1", rule.local_port)).await {
        Ok(listener) => listener,
        Err(e) => {
            return manager.mark_error(
                &rule_id,
                &status,
                format!("could not bind 127.0.0.1:{} — {}", rule.local_port, e),
            );
        }
    };

    // 4) Tunnel is live
    {
        let mut guard = status.lock().unwrap();
        guard.state = TunnelState::Active;
        guard.error = None;
        guard.started_at = Some(now_epoch_ms());
    }
    manager.emit_status(&status.lock().unwrap().clone());
    log::info!(
        "[tunnel {}] active: 127.0.0.1:{} -> {}:{} via {}@{}:{}",
        rule.name,
        rule.local_port,
        rule.remote_host,
        rule.remote_port,
        profile.username,
        profile.host,
        profile.port
    );

    // 5) Optional native PowerShell console for the SSH host.
    if settings.open_console_on_connect {
        let console_profile = profile.clone();
        let console_settings = settings.clone();
        let console_manager = manager.clone();
        let rule_name = rule.name.clone();
        tokio::task::spawn_blocking(move || {
            match console::open_ssh_console(&console_profile, &console_settings) {
                Ok(launch) => {
                    log::info!(
                        "[tunnel {rule_name}] console launched: {} -> {}",
                        launch.terminal,
                        launch.command
                    );
                    console_manager.emit_console(&launch);
                }
                Err(e) => log::warn!("[tunnel {rule_name}] could not open console: {e}"),
            }
        });
    }

    // 6) Accept loop + periodic telemetry
    let mut ticker = tokio::time::interval(TICK_INTERVAL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            biased;

            // Shutdown requested from the UI (stop / restart / app exit).
            _ = shutdown_rx.recv() => break,

            // Traffic snapshot every second for the UI.
            _ = ticker.tick() => {
                let snapshot = {
                    let mut guard = status.lock().unwrap();
                    guard.bytes_sent = counters.bytes_sent.load(Ordering::Relaxed);
                    guard.bytes_received = counters.bytes_received.load(Ordering::Relaxed);
                    guard.connections = counters.connections.load(Ordering::Relaxed);
                    guard.clone()
                };
                manager.emit_status(&snapshot);
            }

            // New local TCP connection -> direct-tcpip channel.
            accepted = listener.accept() => {
                let (socket, peer) = match accepted {
                    Ok(value) => value,
                    Err(e) => {
                        log::warn!("[tunnel {}] error accepting local connections: {e}", rule.name);
                        continue;
                    }
                };

                let originator_port = peer.port() as u32;
                match session
                    .channel_open_direct_tcpip(
                        rule.remote_host.as_str(),
                        rule.remote_port as u32,
                        "127.0.0.1",
                        originator_port,
                    )
                    .await
                {
                    Ok(channel) => {
                        counters.connections.fetch_add(1, Ordering::Relaxed);
                        let remote = Metered {
                            inner: channel.into_stream(),
                            counters: counters.clone(),
                        };
                        let job_counters = counters.clone();
                        let target = format!("{}:{}", rule.remote_host, rule.remote_port);
                        tokio::spawn(async move {
                            if let Err(e) = forward(socket, remote).await {
                                log::debug!("connection to {target} finished: {e}");
                            }
                            job_counters.connections.fetch_sub(1, Ordering::Relaxed);
                        });
                    }
                    Err(e) => {
                        log::warn!(
                            "[tunnel {}] server refused direct-tcpip channel to {}:{} — {e}",
                            rule.name,
                            rule.remote_host,
                            rule.remote_port
                        );
                    }
                }
            }
        }
    }

    // 7) Cleanup: notify the UI and close the SSH session asynchronously.
    log::info!("[tunnel {}] stopped", rule.name);
    manager.mark_inactive(&rule_id, &status);
    let rule_name = rule.name.clone();
    tokio::spawn(async move {
        if let Err(e) = session
            .disconnect(Disconnect::ByApplication, "tunnel stopped by Tunnex", "")
            .await
        {
            log::debug!("notice while closing SSH session for {rule_name}: {e}");
        }
    });
}
