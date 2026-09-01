-- =====================================================================
-- GNOME Widget Center Store — D1 (SQLite) schema
-- Apply with: npm run migrate:local   /  npm run migrate:remote
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- users — email + password auth (PBKDF2-SHA256, salted, see
-- src/utils/password.js). No plaintext or reversible password storage.
-- ---------------------------------------------------------------------
CREATE TABLE users (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    email               TEXT NOT NULL UNIQUE,
    password_hash       TEXT NOT NULL,          -- format: pbkdf2$<iterations>$<saltHex>$<hashHex>
    display_name        TEXT NOT NULL DEFAULT '',
    is_admin            INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
    is_banned           INTEGER NOT NULL DEFAULT 0 CHECK (is_banned IN (0, 1)),
    is_email_verified   INTEGER NOT NULL DEFAULT 0 CHECK (is_email_verified IN (0, 1)),
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX idx_users_email ON users (email);

-- ---------------------------------------------------------------------
-- email_verifications — short-lived tokens emailed at registration.
-- ---------------------------------------------------------------------
CREATE TABLE email_verifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    token       TEXT NOT NULL UNIQUE,
    expires_at  TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_email_verifications_user ON email_verifications (user_id);


-- ---------------------------------------------------------------------
-- widgets — one row per submitted .gwcw package (a zipped widget
-- folder: widget.js, metadata.json, config.json, stylesheet.css, ...).
-- The zip itself lives in R2 (pending bucket while unreviewed, public
-- bucket once approved); this table is metadata only.
-- ---------------------------------------------------------------------
CREATE TABLE widgets (
    id                  TEXT PRIMARY KEY,          -- slug, unique per submission
    submitted_by        INTEGER NOT NULL REFERENCES users(id),
    name                TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    version             TEXT NOT NULL DEFAULT '1.0.0',
    shell_versions      TEXT NOT NULL DEFAULT '[]',   -- JSON array, e.g. ["48","49","50"]

    r2_key              TEXT NOT NULL,              -- key within PENDING_BUCKET or PUBLIC_BUCKET depending on status
    screenshot_r2_key   TEXT,
    file_size_bytes     INTEGER NOT NULL DEFAULT 0,
    sha256              TEXT NOT NULL,

    status              TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by         INTEGER REFERENCES users(id),
    reviewed_at         TEXT,
    rejection_reason    TEXT,

    avg_rating          REAL NOT NULL DEFAULT 0,
    rating_count        INTEGER NOT NULL DEFAULT 0,
    download_count      INTEGER NOT NULL DEFAULT 0,

    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_widgets_status       ON widgets (status);
CREATE INDEX idx_widgets_submitted_by ON widgets (submitted_by);
CREATE INDEX idx_widgets_created_at   ON widgets (created_at);


-- ---------------------------------------------------------------------
-- themepacks — one row per submitted .gwct package (a JSON layout/
-- style document referencing existing widget ids).
-- ---------------------------------------------------------------------
CREATE TABLE themepacks (
    id                  TEXT PRIMARY KEY,
    submitted_by        INTEGER NOT NULL REFERENCES users(id),
    name                TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',

    r2_key              TEXT NOT NULL,
    screenshot_r2_key   TEXT,                       -- extracted from the file's embedded base64 screenshot at submit time
    file_size_bytes     INTEGER NOT NULL DEFAULT 0,
    sha256              TEXT NOT NULL,
    required_widget_ids TEXT NOT NULL DEFAULT '[]',

    status              TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by         INTEGER REFERENCES users(id),
    reviewed_at         TEXT,
    rejection_reason    TEXT,

    avg_rating          REAL NOT NULL DEFAULT 0,
    rating_count        INTEGER NOT NULL DEFAULT 0,
    download_count      INTEGER NOT NULL DEFAULT 0,

    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_themepacks_status       ON themepacks (status);
CREATE INDEX idx_themepacks_submitted_by ON themepacks (submitted_by);
CREATE INDEX idx_themepacks_created_at   ON themepacks (created_at);


-- ---------------------------------------------------------------------
-- reviews — polymorphic on (package_type, package_id): one table/API
-- serves both widgets and themepacks. One review per user per package.
-- ---------------------------------------------------------------------
CREATE TABLE reviews (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    package_type    TEXT NOT NULL CHECK (package_type IN ('widget', 'themepack')),
    package_id      TEXT NOT NULL,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    stars           INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
    comment         TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    UNIQUE (package_type, package_id, user_id)
);

CREATE INDEX idx_reviews_package ON reviews (package_type, package_id);
CREATE INDEX idx_reviews_user    ON reviews (user_id);


-- =====================================================================
-- Triggers: keep avg_rating / rating_count in sync on write so the
-- read path never runs SUM()/AVG()/COUNT() over reviews.
-- =====================================================================

CREATE TRIGGER trg_reviews_ai_widget
AFTER INSERT ON reviews
WHEN NEW.package_type = 'widget'
BEGIN
    UPDATE widgets
    SET rating_count = rating_count + 1,
        avg_rating   = ((avg_rating * rating_count) + NEW.stars) * 1.0 / (rating_count + 1),
        updated_at   = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = NEW.package_id;
END;

CREATE TRIGGER trg_reviews_ai_themepack
AFTER INSERT ON reviews
WHEN NEW.package_type = 'themepack'
BEGIN
    UPDATE themepacks
    SET rating_count = rating_count + 1,
        avg_rating   = ((avg_rating * rating_count) + NEW.stars) * 1.0 / (rating_count + 1),
        updated_at   = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = NEW.package_id;
END;

CREATE TRIGGER trg_reviews_au_widget
AFTER UPDATE OF stars ON reviews
WHEN NEW.package_type = 'widget' AND NEW.stars != OLD.stars
BEGIN
    UPDATE widgets
    SET avg_rating = ((avg_rating * rating_count) - OLD.stars + NEW.stars) * 1.0 / MAX(rating_count, 1),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = NEW.package_id;
END;

CREATE TRIGGER trg_reviews_au_themepack
AFTER UPDATE OF stars ON reviews
WHEN NEW.package_type = 'themepack' AND NEW.stars != OLD.stars
BEGIN
    UPDATE themepacks
    SET avg_rating = ((avg_rating * rating_count) - OLD.stars + NEW.stars) * 1.0 / MAX(rating_count, 1),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = NEW.package_id;
END;

CREATE TRIGGER trg_reviews_ad_widget
AFTER DELETE ON reviews
WHEN OLD.package_type = 'widget'
BEGIN
    UPDATE widgets
    SET rating_count = MAX(rating_count - 1, 0),
        avg_rating   = CASE WHEN rating_count - 1 > 0
                            THEN ((avg_rating * rating_count) - OLD.stars) * 1.0 / (rating_count - 1)
                            ELSE 0
                       END,
        updated_at   = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = OLD.package_id;
END;

CREATE TRIGGER trg_reviews_ad_themepack
AFTER DELETE ON reviews
WHEN OLD.package_type = 'themepack'
BEGIN
    UPDATE themepacks
    SET rating_count = MAX(rating_count - 1, 0),
        avg_rating   = CASE WHEN rating_count - 1 > 0
                            THEN ((avg_rating * rating_count) - OLD.stars) * 1.0 / (rating_count - 1)
                            ELSE 0
                       END,
        updated_at   = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = OLD.package_id;
END;

-- NOTE on download_count: intentionally not maintained by a trigger.
-- Real downloads hit R2's public custom domain directly and never
-- touch the Worker/D1 — see README "Architecture notes" for the
-- recommended Analytics-Engine-plus-daily-cron pattern to fill this
-- column without spending D1's 100K rows-written/day budget on it.
