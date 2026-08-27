"""
Import monthly planner data from SEO Ops Command Center.xlsx → Supabase.

Usage:
    python scripts/import-planner.py

Requirements:
    pip install pandas openpyxl requests python-dotenv

The script reads your .env.local for NEXT_PUBLIC_SUPABASE_URL and
NEXT_PUBLIC_SUPABASE_ANON_KEY, then fetches your client list from Supabase
and upserts monthly plan records.

Note: Run this while logged into the app so the anon key session is valid,
OR set SUPABASE_SERVICE_ROLE_KEY in .env.local to bypass RLS.
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd
import requests

# ── Config ─────────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent.parent
XLSX = ROOT / "Sheet App Scrips" / "SEO Ops Command Center.xlsx"
ENV = ROOT / ".env.local"

PLANNER_SHEETS = [
    "May 2026 Planner", "April 2026 Planner", "March 2026 Planner",
    "February 2026 Planner", "January 2026 Planner", "December 2025 Planner",
    "November 2025 Planner", "October 2025 Planner", "September 2025 Planner",
    "August 2025 Planner", "July 2025 Planner", "June 2025 Planner", "May 2025 Planner",
]

# ── Load env ────────────────────────────────────────────────────────────────
env = {}
if ENV.exists():
    for line in ENV.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip().strip('"')

SUPABASE_URL = env.get("NEXT_PUBLIC_SUPABASE_URL", "")
# Prefer service role key (bypasses RLS) — fall back to anon key
SUPABASE_KEY = env.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    sys.exit("❌  Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local")


def api(method, path, **kwargs):
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    r = requests.request(method, SUPABASE_URL + "/rest/v1" + path, headers=headers, **kwargs)
    if not r.ok:
        print(f"  ⚠  {method} {path} → {r.status_code}: {r.text[:200]}")
    return r


# ── Fetch clients ────────────────────────────────────────────────────────────
print("Fetching clients from Supabase…")
r = api("GET", "/clients?select=id,name,organization_id")
if not r.ok:
    sys.exit("❌  Could not fetch clients — check your Supabase key and RLS policies.")

clients_raw = r.json()
# name → {id, organization_id}
name_to_client = {c["name"].strip(): c for c in clients_raw}
print(f"  Found {len(name_to_client)} clients in Supabase.")

# ── Parse Excel ──────────────────────────────────────────────────────────────
print("\nParsing Excel planner sheets…")
client_overview = pd.read_excel(XLSX, sheet_name="Client Overview")
valid_clients = set(client_overview["Client"].dropna().str.strip().tolist())


def safe_float(v):
    try:
        return float(v)
    except Exception:
        return 0.0


records = []
for sheet in PLANNER_SHEETS:
    df = pd.read_excel(XLSX, sheet_name=sheet, header=None)
    week_labels = []
    for col in [9, 12, 15, 18, 21]:
        lbl = df.iloc[0, col]
        if pd.notna(lbl) and str(lbl).strip():
            week_labels.append(str(lbl).strip())

    for idx in range(2, len(df)):
        row = df.iloc[idx]
        client_name = str(row[1]).strip() if pd.notna(row[1]) else ""
        if client_name not in valid_clients:
            continue
        month_val = row[0]
        if pd.isna(month_val):
            continue
        month_str = (
            month_val.strftime("%Y-%m")
            if isinstance(month_val, datetime)
            else str(month_val)[:7]
        )

        notes = str(row[24]).strip() if pd.notna(row[24]) else ""
        if notes in ("nan", "None"):
            notes = ""

        weeks = []
        for wi, (pc, lc, _) in enumerate([(9,10,11),(12,13,14),(15,16,17),(18,19,20),(21,22,23)]):
            planned = safe_float(row[pc])
            logged  = safe_float(row[lc])
            import math
            planned = 0.0 if math.isnan(planned) or math.isinf(planned) else planned
            logged  = 0.0 if math.isnan(logged)  or math.isinf(logged)  else logged
            lbl = week_labels[wi] if wi < len(week_labels) else f"W{wi+1}"
            if planned > 0 or logged > 0:
                weeks.append({"week": wi + 1, "label": lbl, "planned": planned, "logged": logged})

        records.append({
            "month": month_str,
            "client_name": client_name,
            "weeks": weeks,
            "notes": notes,
        })

print(f"  Parsed {len(records)} planner records across {len(set(r['client_name'] for r in records))} clients.")

# ── Upsert into Supabase ─────────────────────────────────────────────────────
print("\nUpserting monthly plans…")
skipped, inserted = 0, 0

for rec in records:
    client = name_to_client.get(rec["client_name"])
    if not client:
        skipped += 1
        continue

    payload = {
        "organization_id": client["organization_id"],
        "client_id": client["id"],
        "month": rec["month"],
        "weeks": rec["weeks"],
        "notes": rec["notes"] or None,
    }

    base_headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    r = requests.post(SUPABASE_URL + "/rest/v1/monthly_plans", headers=base_headers, json=payload)
    if r.ok:
        inserted += 1
    elif r.status_code == 409:
        # Record exists — patch it
        r2 = requests.patch(
            SUPABASE_URL + f"/rest/v1/monthly_plans?client_id=eq.{client['id']}&month=eq.{rec['month']}",
            headers=base_headers,
            json={"weeks": rec["weeks"], "notes": rec["notes"] or None},
        )
        if r2.ok:
            inserted += 1
        else:
            skipped += 1
            print(f"  ⚠  PATCH failed for {rec['client_name']} {rec['month']}: {r2.text[:100]}")
    else:
        skipped += 1
        print(f"  ⚠  POST failed for {rec['client_name']} {rec['month']}: {r.status_code} {r.text[:100]}")

print(f"\n✅  Done — {inserted} upserted, {skipped} skipped (client not found in Supabase or error).")
print("Open a client workspace in the app to verify the planner data.")
