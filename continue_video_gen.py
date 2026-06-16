#!/usr/bin/env python3
"""Continue video generation: wait for segment 1, then submit segment 2."""
import subprocess, json, time, sys
from datetime import datetime

LOGFILE = "/Users/bruce/Documents/Codex/AgentDesk/video_gen.log"
DREAMINA = "/Users/bruce/.local/bin/dreamina"

SEG1_ID = "118c4941-8226-41cc-a4dd-f931c09a1059"

SEG2_PROMPT = (
    "The same young East Asian woman in white linen dress opens her eyes on the meadow. "
    "Camera slowly orbits around her in a smooth arc. She gently reaches to touch a small white wildflower. "
    "The breeze strengthens, her long black hair flows, her dress ripples like water. "
    "Golden backlight creates lens flare. She turns toward camera with a warm genuine smile. "
    "Camera slowly pulls back to reveal the full landscape, her small figure in vast green meadow under blue sky. "
    "Cinematic, harmony between human and nature."
)

def log(msg):
    line = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(LOGFILE, "a") as f:
        f.write(line + "\n")
        f.flush()

def query(submit_id):
    try:
        result = subprocess.run(
            [DREAMINA, "query_result", f"--submit_id={submit_id}"],
            capture_output=True, text=True, timeout=30
        )
        data = json.loads(result.stdout)
        return data.get("gen_status", "unknown"), data.get("queue_info", {}).get("queue_idx", "N/A"), data.get("fail_reason", "")
    except Exception as e:
        return "error", "N/A", str(e)

def submit_seg2():
    cmd = [
        DREAMINA, "text2video",
        f"--prompt={SEG2_PROMPT}",
        "--duration=8", "--ratio=16:9",
        "--video_resolution=720p",
        "--model_version=seedance2.0",
        "--poll=0"
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        data = json.loads(result.stdout)
        if data.get("gen_status") == "fail":
            log(f"SEG2 SUBMIT FAILED: {data.get('fail_reason', 'unknown')}")
            return None
        return data.get("submit_id")
    except Exception as e:
        log(f"SEG2 SUBMIT ERROR: {e}")
        return None

def main():
    with open(LOGFILE, "a") as f:
        f.write(f"\n=== Continue Script Started at {datetime.now().isoformat()} ===\n")
    
    log("=== Phase 1: Waiting for Segment 1 (already submitted) ===")
    
    count = 0
    while count < 240:
        count += 1
        status, queue, reason = query(SEG1_ID)
        log(f"[Seg1] Status={status} Queue={queue}" + (f" Reason={reason}" if reason else ""))
        
        if status == "success":
            log("[Seg1] COMPLETED SUCCESSFULLY!")
            break
        elif status == "fail":
            log(f"[Seg1] FAILED: {reason}")
            sys.exit(1)
        
        time.sleep(30)
    else:
        log("[Seg1] TIMEOUT after 2 hours")
        sys.exit(1)
    
    log("=== Phase 2: Submitting Segment 2 ===")
    seg2_id = submit_seg2()
    if not seg2_id:
        log("Failed to submit segment 2. Aborting.")
        sys.exit(1)
    
    log(f"[Seg2] Submitted: submit_id={seg2_id}")
    
    log("=== Phase 3: Waiting for Segment 2 ===")
    count = 0
    while count < 240:
        count += 1
        status, queue, reason = query(seg2_id)
        log(f"[Seg2] Status={status} Queue={queue}" + (f" Reason={reason}" if reason else ""))
        
        if status == "success":
            log("[Seg2] COMPLETED SUCCESSFULLY!")
            break
        elif status == "fail":
            log(f"[Seg2] FAILED: {reason}")
            sys.exit(1)
        
        time.sleep(30)
    else:
        log("[Seg2] TIMEOUT after 2 hours")
        sys.exit(1)
    
    log("=" * 60)
    log("ALL DONE! Both segments completed.")
    log(f"Segment 1: {SEG1_ID}")
    log(f"Segment 2: {seg2_id}")
    log("=" * 60)

if __name__ == "__main__":
    main()
