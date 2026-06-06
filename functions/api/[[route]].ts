import { Hono } from 'hono';
import { handle } from 'hono/cloudflare-pages';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { sign, verify } from 'hono/jwt';

type Bindings = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>().basePath('/api');

// --- PASSWORD UTILITIES (using Native Web Crypto API) ---

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const exportedKey = await crypto.subtle.exportKey("raw", key);
  const hashBuffer = new Uint8Array(exportedKey as ArrayBuffer);
  
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(hashBuffer).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${saltHex}:${hashHex}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    const parts = storedHash.split(':');
    if (parts.length !== 2) return false;
    const [saltHex, hashHex] = parts;
    
    const encoder = new TextEncoder();
    const salt = new Uint8Array((saltHex.match(/.{1,2}/g) || []).map(byte => parseInt(byte, 16)));
    
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveBits", "deriveKey"]
    );
    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: 100000,
        hash: "SHA-256"
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
    const exportedKey = await crypto.subtle.exportKey("raw", key);
    const hashBuffer = new Uint8Array(exportedKey as ArrayBuffer);
    const derivedHex = Array.from(hashBuffer).map(b => b.toString(16).padStart(2, '0')).join('');
    
    return derivedHex === hashHex;
  } catch (e) {
    console.error("Password verification error:", e);
    return false;
  }
}

// --- JWT SECRET RETRIEVAL ---

async function getJwtSecret(db: D1Database): Promise<string> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'jwt_secret'").first<{ value: string }>();
  if (row) {
    return row.value;
  }
  
  // Secret not found, generate a new random secret and persist it
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const newSecret = Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
  await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('jwt_secret', ?)").bind(newSecret).run();
  return newSecret;
}

// --- SESSION HELPER ---

async function getSessionUser(c: any): Promise<string | null> {
  const token = getCookie(c, 'session');
  if (!token) return null;
  
  try {
    const secret = await getJwtSecret(c.env.DB);
    const payload = await verify(token, secret, 'HS256');
    return payload.username as string;
  } catch (e) {
    return null;
  }
}

// --- API ENDPOINTS ---

// 1. Check if the database has any registered admin users
app.get('/auth/check-init', async (c) => {
  try {
    const row = await c.env.DB.prepare("SELECT COUNT(*) as count FROM users").first<{ count: number }>();
    const count = row?.count || 0;
    return c.json({ initialized: count > 0 });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// 2. Initialize the first admin user
app.post('/auth/init', async (c) => {
  try {
    // Ensure database has no users yet
    const checkRow = await c.env.DB.prepare("SELECT COUNT(*) as count FROM users").first<{ count: number }>();
    const count = checkRow?.count || 0;
    if (count > 0) {
      return c.json({ error: "System is already initialized." }, 400);
    }
    
    const { username, password } = await c.req.json();
    if (!username || !password || password.length < 6) {
      return c.json({ error: "Username and a password of at least 6 characters are required." }, 400);
    }
    
    const passwordHash = await hashPassword(password);
    await c.env.DB.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
      .bind(username, passwordHash)
      .run();
      
    return c.json({ success: true, message: "Administrator account created successfully." });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// 3. User Login
app.post('/auth/login', async (c) => {
  try {
    const { username, password } = await c.req.json();
    if (!username || !password) {
      return c.json({ error: "Username and password are required." }, 400);
    }
    
    const user = await c.env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first<{ username: string, password_hash: string }>();
    if (!user) {
      return c.json({ error: "Invalid username or password." }, 401);
    }
    
    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      return c.json({ error: "Invalid username or password." }, 401);
    }
    
    const secret = await getJwtSecret(c.env.DB);
    const token = await sign({
      username: user.username,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 // 24 hours
    }, secret);
    
    setCookie(c, 'session', token, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      maxAge: 60 * 60 * 24
    });
    
    return c.json({ success: true, username: user.username });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// 4. Check active session
app.get('/auth/session', async (c) => {
  const username = await getSessionUser(c);
  if (!username) {
    return c.json({ loggedIn: false }, 401);
  }
  return c.json({ loggedIn: true, username });
});

// 5. User Logout
app.post('/auth/logout', (c) => {
  deleteCookie(c, 'session', {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Strict'
  });
  return c.json({ success: true });
});

// 6. Get settings (start_month and end_month)
app.get('/settings', async (c) => {
  try {
    const rows = await c.env.DB.prepare("SELECT key, value FROM settings").all<{ key: string, value: string }>();
    const settings: Record<string, string> = {};
    rows.results.forEach(row => {
      settings[row.key] = row.value;
    });
    
    // Fallbacks if not set
    const start_month = settings['start_month'] || '2026-06';
    const end_month = settings['end_month'] || '2026-11';
    
    return c.json({ start_month, end_month });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// 7. Save settings (Admin only)
app.post('/settings', async (c) => {
  const username = await getSessionUser(c);
  if (!username) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  
  try {
    const { start_month, end_month } = await c.req.json();
    if (!start_month || !end_month) {
      return c.json({ error: "start_month and end_month are required." }, 400);
    }
    
    // Validate format YYYY-MM
    const dateRegex = /^\d{4}-\d{2}$/;
    if (!dateRegex.test(start_month) || !dateRegex.test(end_month)) {
      return c.json({ error: "Invalid month format. Expected YYYY-MM." }, 400);
    }
    
    await c.env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('start_month', ?)")
      .bind(start_month)
      .run();
    await c.env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('end_month', ?)")
      .bind(end_month)
      .run();
      
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// 8. Get availabilities
app.get('/availabilities', async (c) => {
  try {
    const rows = await c.env.DB.prepare("SELECT date, status FROM availabilities").all<{ date: string, status: string }>();
    const availabilities: Record<string, string> = {};
    rows.results.forEach(row => {
      availabilities[row.date] = row.status;
    });
    return c.json({ availabilities });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// 9. Update availabilities (Admin only - supports batch update)
app.post('/availabilities', async (c) => {
  const username = await getSessionUser(c);
  if (!username) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  
  try {
    const { updates } = await c.req.json(); // updates: Array of { date: 'YYYY-MM-DD', status: 'available'|'unavailable'|... }
    if (!updates || !Array.isArray(updates)) {
      return c.json({ error: "updates array is required." }, 400);
    }
    
    if (updates.length === 0) {
      return c.json({ success: true, message: "No updates provided." });
    }
    
    const statements = updates.map(u => 
      c.env.DB.prepare("INSERT OR REPLACE INTO availabilities (date, status) VALUES (?, ?)").bind(u.date, u.status)
    );
    
    await c.env.DB.batch(statements);
    
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

export const onRequest = handle(app);
