"""
PVRRD - Patient Vitals & Readmission Risk Dashboard
Flask backend application (app.py) — DEPLOYMENT VERSION (PostgreSQL)

Run with:  python app.py
Requires:  DATABASE_URL environment variable (your Supabase connection string)
"""

from flask import Flask, render_template, jsonify, request
from flask_cors import CORS
import psycopg2
import psycopg2.extras
from psycopg2 import pool
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

WARDS = ['ICU', 'General A', 'General B', 'Cardiology']

# ── Database connection pool ──
# Works with any PostgreSQL host (Supabase, Render, local).
# Set DATABASE_URL in your host's environment variables (see README.md).
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost/pvrrd")


def _with_ssl(url):
    """Supabase requires SSL. Add sslmode=require unless it's local or already set."""
    if "localhost" in url or "127.0.0.1" in url or "sslmode=" in url:
        return url
    return url + ("&" if "?" in url else "?") + "sslmode=require"


try:
    connection_pool = psycopg2.pool.SimpleConnectionPool(
        1, 5, _with_ssl(DATABASE_URL),
        keepalives=1, keepalives_idle=30, keepalives_interval=10, keepalives_count=5,
    )
except Exception as err:
    print(f"⚠️  Could not create connection pool: {err}")
    connection_pool = None


def get_db():
    if connection_pool is None:
        raise RuntimeError("Database connection pool is not available.")
    return connection_pool.getconn()


def put_db(conn):
    if connection_pool is not None:
        connection_pool.putconn(conn)


# ============================================================
#  RISK SCORING (mirrors the original client-side JS logic)
# ============================================================

def get_risk_score(age, prior, latest_vitals):
    vitals_risk = 0
    if latest_vitals:
        spo2, hr, bp = latest_vitals["spo2"], latest_vitals["hr"], latest_vitals["bp"]
        if spo2 < 90:
            vitals_risk += 40
        elif spo2 < 94:
            vitals_risk += 20
        if hr > 110:
            vitals_risk += 25
        elif hr > 100:
            vitals_risk += 10
        if bp > 150:
            vitals_risk += 15
    prior_risk = min(prior * 12, 36)
    age_risk = 15 if age >= 70 else (7 if age >= 55 else 0)
    return min(round(vitals_risk + prior_risk + age_risk), 100)


def is_at_risk(risk_score, latest_vitals):
    spo2_low = latest_vitals and latest_vitals["spo2"] < 92
    return bool(spo2_low) or risk_score >= 70


def get_risk_reasons(risk_score, latest_vitals):
    reasons = []
    if latest_vitals and latest_vitals["spo2"] < 92:
        reasons.append(f"Low SpO2 ({latest_vitals['spo2']}%)")
    if risk_score >= 70:
        reasons.append(f"High Risk Score ({risk_score})")
    return reasons


def fetch_latest_vitals_map(cursor):
    """Return {patient_id: {hr, spo2, bp, logged_at}} using each patient's most recent reading."""
    cursor.execute("""
        SELECT DISTINCT ON (patient_id) patient_id, hr, spo2, bp, logged_at
        FROM vitals
        ORDER BY patient_id, logged_at DESC, id DESC
    """)
    return {r["patient_id"]: r for r in cursor.fetchall()}


# ============================================================
#  PAGE ROUTES
# ============================================================

@app.route("/")
def index():
    return render_template("index.html")


# ============================================================
#  API ROUTES — PATIENTS
# ============================================================

@app.route("/api/patients", methods=["GET"])
def get_patients():
    conn = get_db()
    try:
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cursor.execute("SELECT * FROM patients ORDER BY name ASC")
        patients = cursor.fetchall()
        latest_map = fetch_latest_vitals_map(cursor)
        cursor.close()

        result = []
        for p in patients:
            v = latest_map.get(p["id"])
            risk = get_risk_score(p["age"], p["prior"], v)
            result.append({
                "id": p["id"], "name": p["name"], "ward": p["ward"],
                "age": p["age"], "prior": p["prior"],
                "risk_score": risk,
                "latest_spo2": v["spo2"] if v else None,
                "latest_hr": v["hr"] if v else None,
                "at_risk": is_at_risk(risk, v)
            })
        return jsonify(result)
    finally:
        put_db(conn)


@app.route("/api/patients", methods=["POST"])
def add_patient():
    data = request.get_json()
    name = (data.get("name") or "").strip()
    ward = data.get("ward")
    age = data.get("age")
    prior = data.get("prior") or 0

    if not name or not ward or age is None:
        return jsonify({"error": "Missing required fields."}), 400
    try:
        age = int(age)
        prior = int(prior)
        if not (0 <= age <= 120):
            raise ValueError
    except ValueError:
        return jsonify({"error": "Enter a valid age (0-120)."}), 400

    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO patients (name, ward, age, prior) VALUES (%s, %s, %s, %s) RETURNING id",
            (name, ward, age, prior)
        )
        new_id = cursor.fetchone()[0]
        conn.commit()
        cursor.close()
        return jsonify({"id": new_id, "message": "Patient admitted successfully."}), 201
    finally:
        put_db(conn)


@app.route("/api/patients/<int:patient_id>", methods=["DELETE"])
def discharge_patient(patient_id):
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM patients WHERE id = %s", (patient_id,))
        deleted = cursor.rowcount
        conn.commit()
        cursor.close()
        if deleted == 0:
            return jsonify({"error": "Patient not found."}), 404
        return jsonify({"message": "Patient discharged."})
    finally:
        put_db(conn)


@app.route("/api/patients/<int:patient_id>/profile", methods=["GET"])
def patient_profile(patient_id):
    conn = get_db()
    try:
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cursor.execute("SELECT * FROM patients WHERE id = %s", (patient_id,))
        p = cursor.fetchone()
        if not p:
            return jsonify({"error": "Patient not found."}), 404

        cursor.execute(
            "SELECT hr, spo2, bp, logged_at FROM vitals WHERE patient_id = %s ORDER BY logged_at ASC, id ASC",
            (patient_id,)
        )
        history = cursor.fetchall()
        cursor.close()

        latest = history[-1] if history else None
        risk = get_risk_score(p["age"], p["prior"], latest)

        return jsonify({
            "id": p["id"], "name": p["name"], "ward": p["ward"],
            "age": p["age"], "prior": p["prior"],
            "risk_score": risk,
            "at_risk": is_at_risk(risk, latest),
            "latest_hr": latest["hr"] if latest else None,
            "latest_spo2": latest["spo2"] if latest else None,
            "history": [
                {"hr": h["hr"], "spo2": h["spo2"], "bp": h["bp"], "date": h["logged_at"].isoformat()}
                for h in history
            ]
        })
    finally:
        put_db(conn)


# ============================================================
#  API ROUTES — VITALS
# ============================================================

@app.route("/api/vitals", methods=["GET"])
def get_vitals():
    conn = get_db()
    try:
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cursor.execute("""
            SELECT v.id, v.hr, v.spo2, v.bp, v.logged_at, p.id AS patient_id, p.name AS patient_name
            FROM vitals v JOIN patients p ON p.id = v.patient_id
            ORDER BY v.logged_at DESC, v.id DESC LIMIT 25
        """)
        rows = cursor.fetchall()
        cursor.close()
        return jsonify([{
            "id": r["id"], "hr": r["hr"], "spo2": r["spo2"], "bp": r["bp"],
            "date": r["logged_at"].isoformat(),
            "patient_id": r["patient_id"], "patient_name": r["patient_name"]
        } for r in rows])
    finally:
        put_db(conn)


@app.route("/api/vitals", methods=["POST"])
def add_vitals():
    data = request.get_json()
    patient_id = data.get("patient_id")
    hr, spo2, bp = data.get("hr"), data.get("spo2"), data.get("bp")

    if not patient_id or hr is None or spo2 is None or bp is None:
        return jsonify({"error": "Missing required fields."}), 400
    try:
        hr, spo2, bp = int(hr), int(spo2), int(bp)
        if not (30 <= hr <= 220):
            return jsonify({"error": "Enter a valid heart rate (30-220)."}), 400
        if not (50 <= spo2 <= 100):
            return jsonify({"error": "Enter a valid SpO2 (50-100)."}), 400
        if not (50 <= bp <= 250):
            return jsonify({"error": "Enter a valid systolic BP (50-250)."}), 400
    except ValueError:
        return jsonify({"error": "Vitals must be numbers."}), 400

    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO vitals (patient_id, hr, spo2, bp) VALUES (%s, %s, %s, %s) RETURNING id",
            (patient_id, hr, spo2, bp)
        )
        new_id = cursor.fetchone()[0]
        conn.commit()
        cursor.close()
        return jsonify({"id": new_id, "message": "Vitals saved.", "critical": spo2 < 92}), 201
    finally:
        put_db(conn)


# ============================================================
#  API ROUTES — DASHBOARD / ANALYTICS
# ============================================================

@app.route("/api/dashboard/summary", methods=["GET"])
def dashboard_summary():
    conn = get_db()
    try:
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cursor.execute("SELECT * FROM patients")
        patients = cursor.fetchall()
        latest_map = fetch_latest_vitals_map(cursor)
        cursor.close()

        all_latest = [latest_map[p["id"]] for p in patients if p["id"] in latest_map]
        avg_hr = round(sum(v["hr"] for v in all_latest) / len(all_latest)) if all_latest else 0
        o2_alert_rate = round(len([v for v in all_latest if v["spo2"] < 92]) / len(all_latest) * 100) if all_latest else 0

        risk_by_patient = {}
        for p in patients:
            v = latest_map.get(p["id"])
            risk_by_patient[p["id"]] = get_risk_score(p["age"], p["prior"], v)

        high_risk_count = sum(1 for p in patients if is_at_risk(risk_by_patient[p["id"]], latest_map.get(p["id"])))

        ward_bars, heat_map, ward_dist, spo2_by_ward = [], [], [], []
        for w in WARDS:
            wp = [p for p in patients if p["ward"] == w]
            avg_risk = round(sum(risk_by_patient[p["id"]] for p in wp) / len(wp)) if wp else 0
            ward_bars.append({"ward": w, "avg_risk": avg_risk})
            heat_map.append({"ward": w, "avg_risk": avg_risk})
            ward_dist.append({"ward": w, "count": len(wp)})
            wv = [latest_map[p["id"]] for p in wp if p["id"] in latest_map]
            avg_spo2 = round(sum(v["spo2"] for v in wv) / len(wv)) if wv else 0
            spo2_by_ward.append({"ward": w, "avg_spo2": avg_spo2})

        return jsonify({
            "avg_hr": avg_hr,
            "o2_alert_rate": o2_alert_rate,
            "readmit_rate": 15,
            "high_risk_count": high_risk_count,
            "ward_bars": ward_bars,
            "heat_map": heat_map,
            "ward_dist": ward_dist,
            "spo2_by_ward": spo2_by_ward
        })
    finally:
        put_db(conn)


@app.route("/api/alerts", methods=["GET"])
def get_alerts():
    conn = get_db()
    try:
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cursor.execute("SELECT * FROM patients")
        patients = cursor.fetchall()
        latest_map = fetch_latest_vitals_map(cursor)
        cursor.close()

        result = []
        for p in patients:
            v = latest_map.get(p["id"])
            risk = get_risk_score(p["age"], p["prior"], v)
            if is_at_risk(risk, v):
                result.append({
                    "id": p["id"], "name": p["name"], "ward": p["ward"],
                    "risk_score": risk,
                    "latest_spo2": v["spo2"] if v else None,
                    "reasons": get_risk_reasons(risk, v)
                })
        return jsonify(result)
    finally:
        put_db(conn)


@app.route("/api/health", methods=["GET"])
def health_check():
    try:
        conn = get_db()
        put_db(conn)
        return jsonify({"status": "ok", "database": "connected"})
    except Exception as e:
        return jsonify({"status": "error", "database": str(e)}), 500


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(debug=False, host="0.0.0.0", port=port)
