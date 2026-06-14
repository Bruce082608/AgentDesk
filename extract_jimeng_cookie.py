import sqlite3
import os
import sys

cookie_path = os.path.expandvars(r'%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\Network\Cookies')

try:
    # Try direct read-only connection using URI mode
    conn = sqlite3.connect(f'file:{cookie_path}?mode=ro', uri=True)
    cursor = conn.cursor()
    
    # Find cookies for jimeng or jianying
    cursor.execute("SELECT name, value, host_key FROM cookies WHERE host_key LIKE '%jimeng%' OR host_key LIKE '%jianying%'")
    rows = cursor.fetchall()
    print(f"Found {len(rows)} matching cookies:")
    for row in rows:
        val_preview = row[1][:80] if row[1] else '(empty)'
        print(f"  Name: {row[0]}, Host: {row[2]}")
        print(f"  Value: {val_preview}")
        print()
    
    if len(rows) == 0:
        # Try broader search
        cursor.execute("SELECT name, value, host_key FROM cookies WHERE host_key LIKE '%.jianying.com' OR host_key LIKE '%.jimeng.com'")
        rows = cursor.fetchall()
        print(f"Broader search found {len(rows)} cookies:")
        for row in rows:
            print(f"  Name: {row[0]}, Host: {row[2]}")
    
    conn.close()
    
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
