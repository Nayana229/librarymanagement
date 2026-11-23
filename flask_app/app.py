import os
from contextlib import contextmanager
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
import psycopg2
from psycopg2 import errors as pg_errors
from psycopg2.extras import RealDictCursor

load_dotenv()

app = Flask(__name__)

JOINED_TRANSACTION_SQL = """
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
"""


def get_database_url() -> str:
    url = (os.environ.get("DATABASE_URL") or "").strip()
    if not url:
        raise RuntimeError("DATABASE_URL environment variable is not set.")
    return url


@contextmanager
def get_db_connection():
    conn = psycopg2.connect(
        get_database_url(),
        sslmode="require",
        cursor_factory=RealDictCursor,
    )
    try:
        yield conn
    finally:
        conn.close()


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/health", methods=["GET"])
def health():
    url = (os.environ.get("DATABASE_URL") or "").strip()
    if not url:
        return jsonify({"ok": False, "configured": False})
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
        return jsonify({"ok": True, "configured": True})
    except Exception:
        return jsonify({"ok": False, "configured": True, "error": "Unable to connect to PostgreSQL."}), 503


@app.route("/api/dashboard", methods=["GET"])
def dashboard():
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
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
                    """
                )
                metrics = cur.fetchone()

                cur.execute(
                    """
                    SELECT
                        COALESCE(NULLIF(TRIM(s.department), ''), 'Unassigned') AS department,
                        COUNT(DISTINCT s.usn)::int AS student_count,
                        COUNT(bt.transaction_id)::int AS total_borrows,
                        COUNT(bt.transaction_id) FILTER (WHERE bt.return_status = false)::int AS active_borrows
                    FROM student s
                    LEFT JOIN borrow_transaction bt ON s.usn = bt.usn
                    GROUP BY COALESCE(NULLIF(TRIM(s.department), ''), 'Unassigned')
                    ORDER BY total_borrows DESC, student_count DESC, department ASC
                    """
                )
                departments = cur.fetchall()

                cur.execute(
                    f"""
                    {JOINED_TRANSACTION_SQL}
                    ORDER BY bt.borrow_date DESC, bt.transaction_id DESC
                    LIMIT 8
                    """
                )
                recent_transactions = cur.fetchall()

        return jsonify({
            "metrics": metrics,
            "departments": departments,
            "recent_transactions": recent_transactions,
        })
    except RuntimeError as exc:
        return jsonify({"error": str(exc), "code": "DB_NOT_CONFIGURED"}), 503
    except Exception:
        return jsonify({"error": "Failed to load dashboard summary."}), 500


@app.route("/api/students", methods=["GET"])
def list_students():
    q = (request.args.get("q") or "").strip()
    department = (request.args.get("department") or "").strip()
    conditions = []
    params = []

    if q:
        params.append(f"%{q}%")
        conditions.append("(s.usn ILIKE %s OR s.name ILIKE %s OR COALESCE(s.department, '') ILIKE %s)")
        params.extend([f"%{q}%", f"%{q}%"])

    if department and department != "all":
        conditions.append("COALESCE(NULLIF(TRIM(s.department), ''), 'Unassigned') = %s")
        params.append(department)

    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT
                        s.usn,
                        s.name,
                        s.department,
                        COUNT(bt.transaction_id) FILTER (WHERE bt.return_status = false)::int AS active_borrows,
                        COUNT(bt.transaction_id) FILTER (WHERE bt.return_status = true)::int AS returned_count,
                        COUNT(bt.transaction_id)::int AS total_borrows
                    FROM student s
                    LEFT JOIN borrow_transaction bt ON s.usn = bt.usn
                    {where_sql}
                    GROUP BY s.usn, s.name, s.department
                    ORDER BY s.usn ASC
                    """,
                    tuple(params),
                )
                return jsonify(cur.fetchall())
    except RuntimeError as exc:
        return jsonify({"error": str(exc), "code": "DB_NOT_CONFIGURED"}), 503
    except Exception:
        return jsonify({"error": "Failed to load students."}), 500


@app.route("/api/students/<usn>/history", methods=["GET"])
def student_history(usn: str):
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT usn, name, department FROM student WHERE usn = %s", (usn.strip(),))
                student = cur.fetchone()
                if not student:
                    return jsonify({"error": "Student not found."}), 404

                cur.execute(
                    f"""
                    {JOINED_TRANSACTION_SQL}
                    WHERE bt.usn = %s
                    ORDER BY bt.borrow_date DESC, bt.transaction_id DESC
                    """,
                    (usn.strip(),),
                )
                return jsonify({"student": student, "transactions": cur.fetchall()})
    except RuntimeError as exc:
        return jsonify({"error": str(exc), "code": "DB_NOT_CONFIGURED"}), 503
    except Exception:
        return jsonify({"error": "Failed to load student history."}), 500


@app.route("/api/students", methods=["POST"])
def create_student():
    data = request.get_json(silent=True) or {}
    usn = (data.get("usn") or "").strip().upper()
    name = (data.get("name") or "").strip()
    department = (data.get("department") or "").strip() or None

    if not usn or len(usn) > 50:
        return jsonify({"error": "Valid student USN is required."}), 400
    if not name or len(name) > 150:
        return jsonify({"error": "Valid student name is required."}), 400

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO student (usn, name, department) VALUES (%s, %s, %s) RETURNING usn, name, department",
                    (usn, name, department),
                )
                row = cur.fetchone()
                conn.commit()
        return jsonify({**row, "active_borrows": 0, "returned_count": 0, "total_borrows": 0}), 201
    except pg_errors.UniqueViolation:
        return jsonify({"error": "A student with this USN already exists."}), 409
    except RuntimeError as exc:
        return jsonify({"error": str(exc), "code": "DB_NOT_CONFIGURED"}), 503
    except Exception:
        return jsonify({"error": "Failed to register student."}), 500


@app.route("/api/students/<usn>", methods=["PUT"])
def update_student(usn: str):
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    department = (data.get("department") or "").strip() or None

    if not name or len(name) > 150:
        return jsonify({"error": "Valid student name is required."}), 400

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE student SET name = %s, department = %s WHERE usn = %s RETURNING usn, name, department",
                    (name, department, usn.strip()),
                )
                row = cur.fetchone()
                if not row:
                    return jsonify({"error": "Student not found."}), 404
                conn.commit()
        return jsonify(row)
    except RuntimeError as exc:
        return jsonify({"error": str(exc), "code": "DB_NOT_CONFIGURED"}), 503
    except Exception:
        return jsonify({"error": "Failed to update student."}), 500


@app.route("/api/students/<usn>", methods=["DELETE"])
def delete_student(usn: str):
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM student WHERE usn = %s RETURNING usn", (usn.strip(),))
                row = cur.fetchone()
                if not row:
                    return jsonify({"error": "Student not found."}), 404
                conn.commit()
        return jsonify({"deleted": True, "usn": usn.strip()})
    except pg_errors.ForeignKeyViolation:
        return jsonify({"error": "Cannot delete student because they have existing borrow transaction records."}), 409
    except RuntimeError as exc:
        return jsonify({"error": str(exc), "code": "DB_NOT_CONFIGURED"}), 503
    except Exception:
        return jsonify({"error": "Failed to delete student."}), 500


@app.route("/api/books", methods=["GET"])
def list_books():
    q = (request.args.get("q") or "").strip()
    status = (request.args.get("status") or "all").strip()
    conditions = []
    params = []

    if q:
        like_q = f"%{q}%"
        conditions.append("(CAST(b.book_id AS TEXT) ILIKE %s OR b.book_name ILIKE %s OR COALESCE(b.author, '') ILIKE %s)")
        params.extend([like_q, like_q, like_q])
    if status == "available":
        conditions.append("active_bt.transaction_id IS NULL")
    elif status == "borrowed":
        conditions.append("active_bt.transaction_id IS NOT NULL")

    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
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
                    {where_sql}
                    GROUP BY b.book_id, b.book_name, b.author, active_bt.transaction_id, active_bt.usn, s.name, active_bt.borrow_date
                    ORDER BY b.book_id ASC
                    """,
                    tuple(params),
                )
                return jsonify(cur.fetchall())
    except RuntimeError as exc:
        return jsonify({"error": str(exc), "code": "DB_NOT_CONFIGURED"}), 503
    except Exception:
        return jsonify({"error": "Failed to load books."}), 500


@app.route("/api/books", methods=["POST"])
def create_book():
    data = request.get_json(silent=True) or {}
    book_name = (data.get("book_name") or "").strip()
    author = (data.get("author") or "").strip() or None
    raw_id = data.get("book_id")

    if not book_name or len(book_name) > 200:
        return jsonify({"error": "Valid book title is required."}), 400

    explicit_id = None
    if raw_id is not None and str(raw_id).strip() != "":
        try:
            explicit_id = int(raw_id)
            if explicit_id <= 0:
                raise ValueError
        except ValueError:
            return jsonify({"error": "Book ID must be a positive integer."}), 400

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                book_id = explicit_id
                if book_id is None:
                    cur.execute("LOCK TABLE book IN EXCLUSIVE MODE")
                    cur.execute("SELECT COALESCE(MAX(book_id), 100) + 1 AS next_id FROM book")
                    book_id = int(cur.fetchone()["next_id"])

                cur.execute(
                    "INSERT INTO book (book_id, book_name, author) VALUES (%s, %s, %s) RETURNING book_id, book_name, author",
                    (book_id, book_name, author),
                )
                row = cur.fetchone()
                conn.commit()
        return jsonify({
            **row,
            "is_borrowed": False,
            "active_transaction_id": None,
            "borrowed_by_usn": None,
            "borrowed_by_name": None,
            "active_borrow_date": None,
            "total_borrows": 0,
        }), 201
    except pg_errors.UniqueViolation:
        return jsonify({"error": "A book with this Book ID already exists."}), 409
    except RuntimeError as exc:
        return jsonify({"error": str(exc), "code": "DB_NOT_CONFIGURED"}), 503
    except Exception:
        return jsonify({"error": "Failed to add book."}), 500


@app.route("/api/books/<int:book_id>", methods=["PUT"])
def update_book(book_id: int):
    data = request.get_json(silent=True) or {}
    book_name = (data.get("book_name") or "").strip()
    author = (data.get("author") or "").strip() or None

    if not book_name or len(book_name) > 200:
        return jsonify({"error": "Valid book title is required."}), 400

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE book SET book_name = %s, author = %s WHERE book_id = %s RETURNING book_id, book_name, author",
                    (book_name, author, book_id),
                )
                row = cur.fetchone()
                if not row:
                    return jsonify({"error": "Book not found."}), 404
                conn.commit()
        return jsonify(row)
    except RuntimeError as exc:
        return jsonify({"error": str(exc), "code": "DB_NOT_CONFIGURED"}), 503
    except Exception:
        return jsonify({"error": "Failed to update book."}), 500


@app.route("/api/books/<int:book_id>", methods=["DELETE"])
def delete_book(book_id: int):
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM book WHERE book_id = %s RETURNING book_id", (book_id,))
                row = cur.fetchone()
                if not row:
                    return jsonify({"error": "Book not found."}), 404
                conn.commit()
        return jsonify({"deleted": True, "book_id": book_id})
    except pg_errors.ForeignKeyViolation:
        return jsonify({"error": "Cannot delete book because it has existing borrow transaction records."}), 409
    except RuntimeError as exc:
        return jsonify({"error": str(exc), "code": "DB_NOT_CONFIGURED"}), 503
    except Exception:
        return jsonify({"error": "Failed to delete book."}), 500


@app.route("/api/transactions", methods=["GET"])
def list_transactions():
    q = (request.args.get("q") or "").strip()
    status = (request.args.get("status") or "all").strip()
    department = (request.args.get("department") or "").strip()
    conditions = []
    params = []

    if q:
        like_q = f"%{q}%"
        conditions.append(
            """(
                CAST(bt.transaction_id AS TEXT) ILIKE %s
                OR bt.usn ILIKE %s
                OR s.name ILIKE %s
                OR COALESCE(s.department, '') ILIKE %s
                OR CAST(bt.book_id AS TEXT) ILIKE %s
                OR b.book_name ILIKE %s
                OR COALESCE(b.author, '') ILIKE %s
            )"""
        )
        params.extend([like_q] * 7)

    if status == "borrowed":
        conditions.append("bt.return_status = false")
    elif status == "returned":
        conditions.append("bt.return_status = true")

    if department and department != "all":
        conditions.append("COALESCE(NULLIF(TRIM(s.department), ''), 'Unassigned') = %s")
        params.append(department)

    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    {JOINED_TRANSACTION_SQL}
                    {where_sql}
                    ORDER BY bt.borrow_date DESC, bt.transaction_id DESC
                    """,
                    tuple(params),
                )
                return jsonify(cur.fetchall())
    except RuntimeError as exc:
        return jsonify({"error": str(exc), "code": "DB_NOT_CONFIGURED"}), 503
    except Exception:
        return jsonify({"error": "Failed to load borrowing history."}), 500


@app.route("/api/transactions/borrow", methods=["POST"])
def borrow_book():
    data = request.get_json(silent=True) or {}
    usn = (data.get("usn") or "").strip()
    try:
        book_id = int(data.get("book_id"))
        if book_id <= 0:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({"error": "Valid Book ID is required."}), 400

    if not usn:
        return jsonify({"error": "Student USN is required."}), 400

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT usn FROM student WHERE usn = %s", (usn,))
                if not cur.fetchone():
                    return jsonify({"error": f'Student "{usn}" was not found.'}), 404

                cur.execute("SELECT book_id FROM book WHERE book_id = %s", (book_id,))
                if not cur.fetchone():
                    return jsonify({"error": f"Book #{book_id} was not found."}), 404

                cur.execute("LOCK TABLE borrow_transaction IN EXCLUSIVE MODE")
                cur.execute(
                    "SELECT transaction_id FROM borrow_transaction WHERE book_id = %s AND return_status = false LIMIT 1",
                    (book_id,),
                )
                if cur.fetchone():
                    return jsonify({"error": "This book is currently checked out and must be returned first."}), 409

                cur.execute(
                    "INSERT INTO borrow_transaction (usn, book_id, borrow_date, return_status) VALUES (%s, %s, CURRENT_TIMESTAMP, false) RETURNING transaction_id",
                    (usn, book_id),
                )
                tx_id = cur.fetchone()["transaction_id"]
                cur.execute(f"{JOINED_TRANSACTION_SQL} WHERE bt.transaction_id = %s", (tx_id,))
                joined_row = cur.fetchone()
                conn.commit()
        return jsonify(joined_row), 201
    except RuntimeError as exc:
        return jsonify({"error": str(exc), "code": "DB_NOT_CONFIGURED"}), 503
    except Exception:
        return jsonify({"error": "Failed to issue book."}), 500


@app.route("/api/transactions/<int:transaction_id>/return", methods=["PATCH"])
def return_book(transaction_id: int):
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT transaction_id, return_status FROM borrow_transaction WHERE transaction_id = %s",
                    (transaction_id,),
                )
                existing = cur.fetchone()
                if not existing:
                    return jsonify({"error": "Borrow transaction not found."}), 404
                if existing["return_status"]:
                    return jsonify({"error": "This book has already been returned."}), 409

                cur.execute(
                    "UPDATE borrow_transaction SET return_status = true WHERE transaction_id = %s",
                    (transaction_id,),
                )
                cur.execute(f"{JOINED_TRANSACTION_SQL} WHERE bt.transaction_id = %s", (transaction_id,))
                joined_row = cur.fetchone()
                conn.commit()
        return jsonify(joined_row)
    except RuntimeError as exc:
        return jsonify({"error": str(exc), "code": "DB_NOT_CONFIGURED"}), 503
    except Exception:
        return jsonify({"error": "Failed to return book."}), 500


@app.route("/api/transactions/<int:transaction_id>", methods=["DELETE"])
def delete_transaction(transaction_id: int):
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM borrow_transaction WHERE transaction_id = %s RETURNING transaction_id",
                    (transaction_id,),
                )
                if not cur.fetchone():
                    return jsonify({"error": "Borrow transaction not found."}), 404
                conn.commit()
        return jsonify({"deleted": True, "transaction_id": transaction_id})
    except RuntimeError as exc:
        return jsonify({"error": str(exc), "code": "DB_NOT_CONFIGURED"}), 503
    except Exception:
        return jsonify({"error": "Failed to delete transaction."}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
