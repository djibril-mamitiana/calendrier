-- Table for admin users
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
);

-- Table for storing date availability statuses
-- statuses: 'available', 'unavailable', 'validated', 'pending'
CREATE TABLE IF NOT EXISTS availabilities (
    date TEXT PRIMARY KEY, -- Format 'YYYY-MM-DD'
    status TEXT NOT NULL DEFAULT 'unavailable'
);

-- Table for system settings (key-value pair)
-- key: 'start_month' (e.g. '2026-06') or 'end_month' (e.g. '2026-11')
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Set default settings: June to November of the current year (2026)
INSERT OR IGNORE INTO settings (key, value) VALUES ('start_month', '2026-06');
INSERT OR IGNORE INTO settings (key, value) VALUES ('end_month', '2026-11');
