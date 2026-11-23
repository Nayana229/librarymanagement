import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3000;

let pool: pg.Pool | null = null;

function getPool(): pg.Pool | null {
  if (pool) {
    return pool;
  }
  const rawUrl = process.env.DATABASE_URL?.trim();
  if (!rawUrl) {
    return null;
  }

  let connectionString = rawUrl;
  let useSsl = false;
  try {
    const parsed = new URL(rawUrl);
    const sslMode = parsed.searchParams.get('sslmode');
    if (sslMode || parsed.hostname.includes('aivencloud.com')) {
      useSsl = true;
      parsed.searchParams.delete('sslmode');
      connectionString = parsed.toString();
    }
  } catch {
    useSsl = rawUrl.includes('sslmode=require') || rawUrl.includes('aivencloud.com');
  }

  pool = new Pool({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  return pool;
}

function requirePool(res: Response): pg.Pool | null {
  const db = getPool();
  if (!db) {
    res.status(503).json({
      error: 'Database connection is not configured. Add DATABASE_URL in Settings -> Secrets and restart the server.',
      code: 'DB_NOT_CONFIGURED',
    });
    return null;
  }
  return db;
}

function handleDbError(res: Response, err: unknown, fallbackMessage: string): void {
  const pgErr = err as { code?: string; message?: string };
  if (pgErr?.code === '23505') {
    res.status(409).json({ error: 'A record with this identifier already exists.' });
    return;
  }
  if (pgErr?.code === '23503') {
    res.status(409).json({ error: 'This record is referenced by borrow transactions and cannot be deleted.' });
    return;
  }
  console.error(fallbackMessage, pgErr?.message || err);
  res.status(500).json({ error: fallbackMessage });
}

const JOINED_TRANSACTION_SELECT = `
  SELECT
    bt.transaction_id,
    bt.usn,
    s.name AS student_name,
    s.department,
    bt.book_id,
    b.book_name,
    b.author,
    bt.borrow_date,
    bt.return_status
  FROM borrow_transaction bt
  INNER JOIN student s ON bt.usn = s.usn
  INNER JOIN book b ON bt.book_id = b.book_id
`;

const app = express();
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/api/health', async (_req: Request, res: Response) => {
  const db = getPool();
  if (!db) {
    res.json({ ok: false, configured: false });
    return;
  }
  try {
    await db.query('SELECT 1');
    res.json({ ok: true, configured: true });
  } catch (err) {
    console.error('Database health check failed:', (err as Error).message);
    res.status(503).json({ ok: false, configured: true, error: 'Unable to reach PostgreSQL database.' });
  }
});

// Dashboard KPIs, department breakdown, and recent joined circulation rows
app.get('/api/dashboard', async (_req: Request, res: Response) => {
  const db = requirePool(res);
  if (!db) return;

  try {
    const [metricsResult, deptResult, recentResult] = await Promise.all([
      db.query(`
        SELECT
          (SELECT COUNT(*)::int FROM student) AS total_students,
          (SELECT COUNT(*)::int FROM book) AS total_books,
          (SELECT COUNT(*)::int FROM borrow_transaction WHERE return_status = false) AS borrowed_books,
          (SELECT COUNT(*)::int FROM borrow_transaction WHERE return_status = true) AS returned_books,
          (SELECT COUNT(*)::int FROM borrow_transaction) AS total_transactions,
          (
            SELECT COUNT(*)::int
            FROM book b
            WHERE NOT EXISTS (
              SELECT 1 FROM borrow_transaction bt
              WHERE bt.book_id = b.book_id AND bt.return_status = false
            )
          ) AS available_books
      `),
      db.query(`
        SELECT
          COALESCE(NULLIF(TRIM(s.department), ''), 'Unassigned') AS department,
          COUNT(DISTINCT s.usn)::int AS student_count,
          COUNT(bt.transaction_id)::int AS total_borrows,
          COUNT(bt.transaction_id) FILTER (WHERE bt.return_status = false)::int AS active_borrows
        FROM student s
        LEFT JOIN borrow_transaction bt ON s.usn = bt.usn
        GROUP BY COALESCE(NULLIF(TRIM(s.department), ''), 'Unassigned')
        ORDER BY total_borrows DESC, student_count DESC, department ASC
      `),
      db.query(`
        ${JOINED_TRANSACTION_SELECT}
        ORDER BY bt.borrow_date DESC, bt.transaction_id DESC
        LIMIT 8
      `),
    ]);

    res.json({
      metrics: metricsResult.rows[0],
      departments: deptResult.rows,
      recent_transactions: recentResult.rows,
    });
  } catch (err) {
    handleDbError(res, err, 'Failed to load dashboard summary.');
  }
});

// Students list with SQL LEFT JOIN borrow counts
app.get('/api/students', async (req: Request, res: Response) => {
  const db = requirePool(res);
  if (!db) return;

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const department = typeof req.query.department === 'string' ? req.query.department.trim() : '';

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (q) {
    params.push(`%${q}%`);
    const idx = params.length;
    conditions.push(`(s.usn ILIKE $${idx} OR s.name ILIKE $${idx} OR COALESCE(s.department, '') ILIKE $${idx})`);
  }

  if (department && department !== 'all') {
    params.push(department);
    conditions.push(`COALESCE(NULLIF(TRIM(s.department), ''), 'Unassigned') = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await db.query(
      `
      SELECT
        s.usn,
        s.name,
        s.department,
        COUNT(bt.transaction_id) FILTER (WHERE bt.return_status = false)::int AS active_borrows,
        COUNT(bt.transaction_id) FILTER (WHERE bt.return_status = true)::int AS returned_count,
        COUNT(bt.transaction_id)::int AS total_borrows
      FROM student s
      LEFT JOIN borrow_transaction bt ON s.usn = bt.usn
      ${whereClause}
      GROUP BY s.usn, s.name, s.department
      ORDER BY s.usn ASC
      `,
      params
    );
    res.json(result.rows);
  } catch (err) {
    handleDbError(res, err, 'Failed to load students.');
  }
});

// Single student joined borrowing history
app.get('/api/students/:usn/history', async (req: Request, res: Response) => {
  const db = requirePool(res);
  if (!db) return;

  const usn = String(req.params.usn || '').trim();
  if (!usn) {
    res.status(400).json({ error: 'Student USN is required.' });
    return;
  }

  try {
    const [studentRes, historyRes] = await Promise.all([
      db.query('SELECT usn, name, department FROM student WHERE usn = $1', [usn]),
      db.query(
        `
        ${JOINED_TRANSACTION_SELECT}
        WHERE bt.usn = $1
        ORDER BY bt.borrow_date DESC, bt.transaction_id DESC
        `,
        [usn]
      ),
    ]);

    if (studentRes.rows.length === 0) {
      res.status(404).json({ error: 'Student not found.' });
      return;
    }

    res.json({
      student: studentRes.rows[0],
      transactions: historyRes.rows,
    });
  } catch (err) {
    handleDbError(res, err, 'Failed to load student borrowing history.');
  }
});

// Create student
app.post('/api/students', async (req: Request, res: Response) => {
  const db = requirePool(res);
  if (!db) return;

  const usn = typeof req.body?.usn === 'string' ? req.body.usn.trim().toUpperCase() : '';
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const department = typeof req.body?.department === 'string' ? req.body.department.trim() : '';

  if (!usn || usn.length > 50) {
    res.status(400).json({ error: 'Valid student USN is required (max 50 characters).' });
    return;
  }
  if (!name || name.length > 150) {
    res.status(400).json({ error: 'Valid student name is required.' });
    return;
  }

  try {
    const result = await db.query(
      `INSERT INTO student (usn, name, department)
       VALUES ($1, $2, $3)
       RETURNING usn, name, department`,
      [usn, name, department || null]
    );
    res.status(201).json({
      ...result.rows[0],
      active_borrows: 0,
      returned_count: 0,
      total_borrows: 0,
    });
  } catch (err) {
    handleDbError(res, err, 'Failed to register student.');
  }
});

// Update student
app.put('/api/students/:usn', async (req: Request, res: Response) => {
  const db = requirePool(res);
  if (!db) return;

  const usn = String(req.params.usn || '').trim();
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const department = typeof req.body?.department === 'string' ? req.body.department.trim() : '';

  if (!usn) {
    res.status(400).json({ error: 'Student USN is required.' });
    return;
  }
  if (!name || name.length > 150) {
    res.status(400).json({ error: 'Valid student name is required.' });
    return;
  }

  try {
    const result = await db.query(
      `UPDATE student
       SET name = $1, department = $2
       WHERE usn = $3
       RETURNING usn, name, department`,
      [name, department || null, usn]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Student not found.' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    handleDbError(res, err, 'Failed to update student.');
  }
});

// Delete student
app.delete('/api/students/:usn', async (req: Request, res: Response) => {
  const db = requirePool(res);
  if (!db) return;

  const usn = String(req.params.usn || '').trim();
  if (!usn) {
    res.status(400).json({ error: 'Student USN is required.' });
    return;
  }

  try {
    const result = await db.query('DELETE FROM student WHERE usn = $1 RETURNING usn', [usn]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Student not found.' });
      return;
    }
    res.json({ deleted: true, usn });
  } catch (err) {
    handleDbError(res, err, 'Failed to delete student.');
  }
});

// Books catalog with real-time availability via SQL LEFT JOIN
app.get('/api/books', async (req: Request, res: Response) => {
  const db = requirePool(res);
  if (!db) return;

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const status = typeof req.query.status === 'string' ? req.query.status.trim() : 'all';

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (q) {
    params.push(`%${q}%`);
    const idx = params.length;
    conditions.push(`(CAST(b.book_id AS TEXT) ILIKE $${idx} OR b.book_name ILIKE $${idx} OR COALESCE(b.author, '') ILIKE $${idx})`);
  }

  if (status === 'available') {
    conditions.push('active_bt.transaction_id IS NULL');
  } else if (status === 'borrowed') {
    conditions.push('active_bt.transaction_id IS NOT NULL');
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await db.query(
      `
      SELECT
        b.book_id,
        b.book_name,
        b.author,
        (active_bt.transaction_id IS NOT NULL) AS is_borrowed,
        active_bt.transaction_id AS active_transaction_id,
        active_bt.usn AS borrowed_by_usn,
        s.name AS borrowed_by_name,
        active_bt.borrow_date AS active_borrow_date,
        COUNT(all_bt.transaction_id)::int AS total_borrows
      FROM book b
      LEFT JOIN LATERAL (
        SELECT bt.transaction_id, bt.usn, bt.borrow_date
        FROM borrow_transaction bt
        WHERE bt.book_id = b.book_id AND bt.return_status = false
        ORDER BY bt.borrow_date DESC, bt.transaction_id DESC
        LIMIT 1
      ) active_bt ON true
      LEFT JOIN student s ON active_bt.usn = s.usn
      LEFT JOIN borrow_transaction all_bt ON b.book_id = all_bt.book_id
      ${whereClause}
      GROUP BY
        b.book_id,
        b.book_name,
        b.author,
        active_bt.transaction_id,
        active_bt.usn,
        s.name,
        active_bt.borrow_date
      ORDER BY b.book_id ASC
      `,
      params
    );
    res.json(result.rows);
  } catch (err) {
    handleDbError(res, err, 'Failed to load books.');
  }
});

// Create book (auto-assigns next integer book_id if omitted)
app.post('/api/books', async (req: Request, res: Response) => {
  const db = requirePool(res);
  if (!db) return;

  const bookName = typeof req.body?.book_name === 'string' ? req.body.book_name.trim() : '';
  const author = typeof req.body?.author === 'string' ? req.body.author.trim() : '';
  const rawBookId = req.body?.book_id;

  if (!bookName || bookName.length > 200) {
    res.status(400).json({ error: 'Valid book name is required.' });
    return;
  }

  let explicitId: number | null = null;
  if (rawBookId !== undefined && rawBookId !== null && String(rawBookId).trim() !== '') {
    const parsedId = Number(rawBookId);
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      res.status(400).json({ error: 'Book ID must be a positive integer.' });
      return;
    }
    explicitId = parsedId;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    let bookId = explicitId;
    if (bookId === null) {
      await client.query('LOCK TABLE book IN EXCLUSIVE MODE');
      const maxRes = await client.query('SELECT COALESCE(MAX(book_id), 100) + 1 AS next_id FROM book');
      bookId = Number(maxRes.rows[0].next_id);
    }

    const insertRes = await client.query(
      `INSERT INTO book (book_id, book_name, author)
       VALUES ($1, $2, $3)
       RETURNING book_id, book_name, author`,
      [bookId, bookName, author || null]
    );
    await client.query('COMMIT');

    res.status(201).json({
      ...insertRes.rows[0],
      is_borrowed: false,
      active_transaction_id: null,
      borrowed_by_usn: null,
      borrowed_by_name: null,
      active_borrow_date: null,
      total_borrows: 0,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    handleDbError(res, err, 'Failed to add book.');
  } finally {
    client.release();
  }
});

// Update book
app.put('/api/books/:bookId', async (req: Request, res: Response) => {
  const db = requirePool(res);
  if (!db) return;

  const bookId = Number(req.params.bookId);
  const bookName = typeof req.body?.book_name === 'string' ? req.body.book_name.trim() : '';
  const author = typeof req.body?.author === 'string' ? req.body.author.trim() : '';

  if (!Number.isInteger(bookId) || bookId <= 0) {
    res.status(400).json({ error: 'Valid Book ID is required.' });
    return;
  }
  if (!bookName || bookName.length > 200) {
    res.status(400).json({ error: 'Valid book name is required.' });
    return;
  }

  try {
    const result = await db.query(
      `UPDATE book
       SET book_name = $1, author = $2
       WHERE book_id = $3
       RETURNING book_id, book_name, author`,
      [bookName, author || null, bookId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Book not found.' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    handleDbError(res, err, 'Failed to update book.');
  }
});

// Delete book
app.delete('/api/books/:bookId', async (req: Request, res: Response) => {
  const db = requirePool(res);
  if (!db) return;

  const bookId = Number(req.params.bookId);
  if (!Number.isInteger(bookId) || bookId <= 0) {
    res.status(400).json({ error: 'Valid Book ID is required.' });
    return;
  }

  try {
    const result = await db.query('DELETE FROM book WHERE book_id = $1 RETURNING book_id', [bookId]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Book not found.' });
      return;
    }
    res.json({ deleted: true, book_id: bookId });
  } catch (err) {
    handleDbError(res, err, 'Failed to delete book.');
  }
});

// Joined borrowing history with search & filters
app.get('/api/transactions', async (req: Request, res: Response) => {
  const db = requirePool(res);
  if (!db) return;

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const status = typeof req.query.status === 'string' ? req.query.status.trim() : 'all';
  const department = typeof req.query.department === 'string' ? req.query.department.trim() : '';

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (q) {
    params.push(`%${q}%`);
    const idx = params.length;
    conditions.push(`(
      CAST(bt.transaction_id AS TEXT) ILIKE $${idx}
      OR bt.usn ILIKE $${idx}
      OR s.name ILIKE $${idx}
      OR COALESCE(s.department, '') ILIKE $${idx}
      OR CAST(bt.book_id AS TEXT) ILIKE $${idx}
      OR b.book_name ILIKE $${idx}
      OR COALESCE(b.author, '') ILIKE $${idx}
    )`);
  }

  if (status === 'borrowed') {
    conditions.push('bt.return_status = false');
  } else if (status === 'returned') {
    conditions.push('bt.return_status = true');
  }

  if (department && department !== 'all') {
    params.push(department);
    conditions.push(`COALESCE(NULLIF(TRIM(s.department), ''), 'Unassigned') = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await db.query(
      `
      ${JOINED_TRANSACTION_SELECT}
      ${whereClause}
      ORDER BY bt.borrow_date DESC, bt.transaction_id DESC
      `,
      params
    );
    res.json(result.rows);
  } catch (err) {
    handleDbError(res, err, 'Failed to load borrowing history.');
  }
});

// Issue / borrow a book
app.post('/api/transactions/borrow', async (req: Request, res: Response) => {
  const db = requirePool(res);
  if (!db) return;

  const usn = typeof req.body?.usn === 'string' ? req.body.usn.trim() : '';
  const bookId = Number(req.body?.book_id);

  if (!usn) {
    res.status(400).json({ error: 'Student USN is required.' });
    return;
  }
  if (!Number.isInteger(bookId) || bookId <= 0) {
    res.status(400).json({ error: 'Valid Book ID is required.' });
    return;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const studentCheck = await client.query('SELECT usn FROM student WHERE usn = $1', [usn]);
    if (studentCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: `Student with USN "${usn}" was not found.` });
      return;
    }

    const bookCheck = await client.query('SELECT book_id FROM book WHERE book_id = $1', [bookId]);
    if (bookCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: `Book #${bookId} was not found.` });
      return;
    }

    await client.query('LOCK TABLE borrow_transaction IN EXCLUSIVE MODE');

    const activeCheck = await client.query(
      'SELECT transaction_id FROM borrow_transaction WHERE book_id = $1 AND return_status = false LIMIT 1',
      [bookId]
    );
    if (activeCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'This book is currently checked out and must be returned before borrowing again.' });
      return;
    }

    const insertTxRes = await client.query(
      `INSERT INTO borrow_transaction (usn, book_id, borrow_date, return_status)
       VALUES ($1, $2, CURRENT_TIMESTAMP, false)
       RETURNING transaction_id`,
      [usn, bookId]
    );
    const transactionId = Number(insertTxRes.rows[0].transaction_id);

    const joinedRes = await client.query(
      `
      ${JOINED_TRANSACTION_SELECT}
      WHERE bt.transaction_id = $1
      `,
      [transactionId]
    );

    await client.query('COMMIT');
    res.status(201).json(joinedRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    handleDbError(res, err, 'Failed to issue book.');
  } finally {
    client.release();
  }
});

// Return a borrowed book
app.patch('/api/transactions/:transactionId/return', async (req: Request, res: Response) => {
  const db = requirePool(res);
  if (!db) return;

  const transactionId = Number(req.params.transactionId);
  if (!Number.isInteger(transactionId) || transactionId <= 0) {
    res.status(400).json({ error: 'Valid Transaction ID is required.' });
    return;
  }

  try {
    const existing = await db.query(
      'SELECT transaction_id, return_status FROM borrow_transaction WHERE transaction_id = $1',
      [transactionId]
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Borrow transaction not found.' });
      return;
    }
    if (existing.rows[0].return_status === true) {
      res.status(409).json({ error: 'This book has already been marked as returned.' });
      return;
    }

    await db.query(
      'UPDATE borrow_transaction SET return_status = true WHERE transaction_id = $1',
      [transactionId]
    );

    const joinedRes = await db.query(
      `
      ${JOINED_TRANSACTION_SELECT}
      WHERE bt.transaction_id = $1
      `,
      [transactionId]
    );
    res.json(joinedRes.rows[0]);
  } catch (err) {
    handleDbError(res, err, 'Failed to process book return.');
  }
});

// Delete a transaction record
app.delete('/api/transactions/:transactionId', async (req: Request, res: Response) => {
  const db = requirePool(res);
  if (!db) return;

  const transactionId = Number(req.params.transactionId);
  if (!Number.isInteger(transactionId) || transactionId <= 0) {
    res.status(400).json({ error: 'Valid Transaction ID is required.' });
    return;
  }

  try {
    const result = await db.query(
      'DELETE FROM borrow_transaction WHERE transaction_id = $1 RETURNING transaction_id',
      [transactionId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Borrow transaction not found.' });
      return;
    }
    res.json({ deleted: true, transaction_id: transactionId });
  } catch (err) {
    handleDbError(res, err, 'Failed to delete transaction record.');
  }
});

async function startServer(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Campus Library server listening on http://0.0.0.0:${PORT}`);
  });
}

export default app;

if (!process.env.VERCEL) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
