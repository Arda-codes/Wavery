//! Ingestion, file management (Copy vs Move), metadata extraction, and SQLite database for Wavery.
//!
//! Enforces the rule that all library tracks are managed in the local library directory.

pub mod db;
pub mod manager;
pub mod reader;

pub use db::LibraryDatabase;
pub use manager::SqliteLibraryManager;
pub use reader::LoftyMetadataReader;

#[cfg(test)]
mod tests;
