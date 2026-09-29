-- PVRRD: Patient Vitals & Readmission Risk Dashboard
-- PostgreSQL schema for Supabase (run in SQL Editor)

DROP TABLE IF EXISTS vitals;
DROP TABLE IF EXISTS patients;

CREATE TABLE patients (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    ward VARCHAR(40) NOT NULL,
    age INT NOT NULL,
    prior INT NOT NULL DEFAULT 0
);

CREATE TABLE vitals (
    id SERIAL PRIMARY KEY,
    patient_id INT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    hr INT NOT NULL,
    spo2 INT NOT NULL,
    bp INT NOT NULL,
    logged_at DATE NOT NULL DEFAULT CURRENT_DATE
);

-- Seed data (mirrors the original demo dataset)
INSERT INTO patients (name, ward, age, prior) VALUES
 ('Robert Chen',    'ICU',        71, 2),
 ('Maria Lopez',    'ICU',        64, 1),
 ('James Walker',   'Cardiology', 58, 3),
 ('Aiko Tanaka',    'General A',  45, 0),
 ('Samuel Okafor',  'General B',  67, 1),
 ('Lena Kowalski',  'Cardiology', 73, 2),
 ('Dmitri Volkov',  'ICU',        80, 4),
 ('Grace Adeyemi',  'General A',  39, 0),
 ('Noah Becker',    'General B',  55, 1),
 ('Isabel Martins', 'Cardiology', 62, 2);

INSERT INTO vitals (patient_id, hr, spo2, bp, logged_at) VALUES
 (1, 108, 89, 142, '2026-06-20'),
 (1, 112, 87, 148, '2026-06-21'),
 (2, 92,  94, 130, '2026-06-20'),
 (3, 88,  95, 138, '2026-06-20'),
 (3, 95,  91, 145, '2026-06-22'),
 (4, 74,  98, 118, '2026-06-20'),
 (5, 84,  96, 124, '2026-06-21'),
 (6, 101, 90, 150, '2026-06-21'),
 (7, 118, 85, 160, '2026-06-22'),
 (7, 121, 83, 165, '2026-06-23'),
 (8, 70,  99, 115, '2026-06-20'),
 (9, 80,  97, 122, '2026-06-21'),
 (10,96,  92, 136, '2026-06-22');

-- ── Lock down the auto-generated Supabase REST API ──
-- Flask connects as the 'postgres' role, which bypasses RLS, so the app is unaffected.
-- Enabling RLS with no policies blocks anonymous access via Supabase's public API.
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE vitals ENABLE ROW LEVEL SECURITY;
