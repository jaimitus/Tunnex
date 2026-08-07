//! Persistence and security.
//!
//! - Profiles, rules and settings are stored in `%APPDATA%/tunnex/config.json`
//!   (atomic write: a temporary file is written and then renamed).
//! - Passwords and SSH passphrases are stored in the Windows Credential
//!   Manager through the `keyring` crate, under the `"tunnex"` service.
//!   Secrets are never written to the JSON file.

use std::fs;
use std::io::Write;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::models::{AppSettings, PortForwardRule, SshProfile};

/// Service name used to register credentials in the Credential Manager.
pub const KEYRING_SERVICE: &str = "tunnex";

/// Application folder name inside `%APPDATA%`.
pub const APP_DIR_NAME: &str = "tunnex";

/// Keyring username suffix for a private key passphrase.
pub const PASSPHRASE_SUFFIX: &str = ":passphrase";

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("could not resolve the system configuration directory (%APPDATA%)")]
    NoConfigDir,
    #[error("I/O error on `{path}`: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("config.json is corrupted and could not be parsed: {0}")]
    Corrupt(String),
    #[error("could not serialize the configuration: {0}")]
    Serialize(String),
    #[error("Windows credential store error: {0}")]
    Keyring(String),
}

impl StorageError {
    fn io(path: &std::path::Path, source: std::io::Error) -> Self {
        Self::Io {
            path: path.display().to_string(),
            source,
        }
    }
}

/// Full contents of the configuration file.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct StorageData {
    #[serde(default)]
    pub profiles: Vec<SshProfile>,
    #[serde(default)]
    pub rules: Vec<PortForwardRule>,
    #[serde(default)]
    pub settings: AppSettings,
}

/// Access to `%APPDATA%/tunnex/config.json`.
pub struct Storage {
    path: PathBuf,
}

impl Storage {
    /// Opens the Tunnex store, creating the folder when needed.
    pub fn open() -> Result<Self, StorageError> {
        let dir = dirs::config_dir()
            .ok_or(StorageError::NoConfigDir)?
            .join(APP_DIR_NAME);
        fs::create_dir_all(&dir).map_err(|e| StorageError::io(&dir, e))?;
        Ok(Self {
            path: dir.join("config.json"),
        })
    }

    /// Absolute path of the configuration file.
    pub fn config_path(&self) -> &PathBuf {
        &self.path
    }

    /// Loads profiles, rules and settings. Returns defaults when the file is missing.
    pub fn load(&self) -> Result<StorageData, StorageError> {
        if !self.path.exists() {
            return Ok(StorageData::default());
        }
        let raw = fs::read_to_string(&self.path).map_err(|e| StorageError::io(&self.path, e))?;
        if raw.trim().is_empty() {
            return Ok(StorageData::default());
        }
        serde_json::from_str(&raw).map_err(|e| StorageError::Corrupt(e.to_string()))
    }

    /// Atomic save: writes `config.json.tmp` and renames it over `config.json`,
    /// so a crash can never leave a half-written file behind.
    pub fn save(&self, data: &StorageData) -> Result<(), StorageError> {
        let json = serde_json::to_string_pretty(data)
            .map_err(|e| StorageError::Serialize(e.to_string()))?;
        let tmp = self.path.with_extension("json.tmp");
        {
            let mut file = fs::File::create(&tmp).map_err(|e| StorageError::io(&tmp, e))?;
            file.write_all(json.as_bytes())
                .map_err(|e| StorageError::io(&tmp, e))?;
            file.sync_all().map_err(|e| StorageError::io(&tmp, e))?;
        }
        fs::rename(&tmp, &self.path).map_err(|e| StorageError::io(&self.path, e))?;
        Ok(())
    }

    /// Inserts or updates a profile by `id`.
    pub fn upsert_profile(data: &mut StorageData, profile: SshProfile) {
        match data.profiles.iter_mut().find(|p| p.id == profile.id) {
            Some(slot) => *slot = profile,
            None => data.profiles.push(profile),
        }
    }

    /// Inserts or updates a rule by `id`.
    pub fn upsert_rule(data: &mut StorageData, rule: PortForwardRule) {
        match data.rules.iter_mut().find(|r| r.id == rule.id) {
            Some(slot) => *slot = rule,
            None => data.rules.push(rule),
        }
    }
}

/// Keyring username holding a profile password.
pub fn password_user(profile_id: &str) -> String {
    profile_id.to_string()
}

/// Keyring username holding a profile key passphrase.
pub fn passphrase_user(profile_id: &str) -> String {
    format!("{profile_id}{PASSPHRASE_SUFFIX}")
}

/// Stores a secret in the Windows Credential Manager.
pub fn store_secret(user: &str, secret: &str) -> Result<(), StorageError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, user)
        .map_err(|e| StorageError::Keyring(e.to_string()))?;
    entry
        .set_password(secret)
        .map_err(|e| StorageError::Keyring(e.to_string()))
}

/// Reads a secret from the Credential Manager. `Ok(None)` when missing.
pub fn get_secret(user: &str) -> Result<Option<String>, StorageError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, user)
        .map_err(|e| StorageError::Keyring(e.to_string()))?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(StorageError::Keyring(e.to_string())),
    }
}

/// Deletes a secret from the Credential Manager. Never fails when missing.
pub fn delete_secret(user: &str) -> Result<(), StorageError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, user)
        .map_err(|e| StorageError::Keyring(e.to_string()))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(StorageError::Keyring(e.to_string())),
    }
}
