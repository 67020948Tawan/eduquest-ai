import asyncio
import warnings

warnings.filterwarnings("ignore")
import httpx

BASE = "http://127.0.0.1:8000"


async def main():
    async with httpx.AsyncClient(timeout=120) as c:
        r = await c.post(f"{BASE}/api/login", data={"username": "demo-teacher@eduquest.com", "password": "demo12345"})
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}

        cid = None
        for co in (await c.get(f"{BASE}/api/courses", headers=h)).json():
            st = (await c.get(f"{BASE}/api/courses/{co['id']}/structure")).json()
            if "base_building" in (st.get("game_modes") or []):
                cid, struct = co["id"], st
                break
        assert cid
        print(f"[course] id={cid}")
        qs = [q for ch in struct["chapters"] for q in ch["quiz_questions"]]

        # ---- Brute force: ลองตอบ index เดียวกันทุกข้อไล่จาก 0..3 (มีอันดับ correct แน่นอน) ----
        sid = res = gs = a_last = None
        earned = False
        for attempt in range(4):
            s = (await c.post(f"{BASE}/api/courses/{cid}/sessions?fresh=true", headers=h)).json()
            sid, gs = s["session_id"], s["game_state"]
            assert s["game_state"].get("last_collected", 0) > 0
            for q in qs:
                a_last = (
                    await c.post(
                        f"{BASE}/api/sessions/{sid}/answer",
                        json={"question_id": q["id"], "answer_index": attempt},
                        headers=h,
                    )
                ).json()
                if a_last.get("correct"):
                    earned = True
            if earned:
                print(f"[PASS] attempt={attempt} earned resources")
                break
        assert earned
        # refetch state ล่าสุดจาก server (gs ตั้งต้นเป็นค่าก่อนตอบ)
        st0 = (await c.get(f"{BASE}/api/sessions/{sid}/status", headers=h)).json()
        gs = st0["game_state"]
        res = gs["resources"]
        print(f"[resources] {res}")

        # ---- Build ----
        built_id = None
        for bid, cost in (("farm", {"gold": 30}), ("house", {"wood": 20, "stone": 10})):
            if all(res.get(k, 0) >= v for k, v in cost.items()):
                bb = await c.post(f"{BASE}/api/sessions/{sid}/build", json={"building_id": bid}, headers=h)
                if bb.status_code == 200:
                    built_id = bid
                    gs = bb.json()["game_state"]
                    res = gs["resources"]
                    print(f"[PASS] built {bid} -> {res}")
                    break
        assert built_id

        # ---- Passive pending after ~13s ----
        await asyncio.sleep(13)
        st = (await c.get(f"{BASE}/api/sessions/{sid}/status", headers=h)).json()
        pend = st["pending"]
        assert sum(pend.values()) >= 1, f"pending empty: {pend}"
        print(f"[PASS] passive pending 13s: {pend} | per_bld={st['pending_per_building']}")

        col = (await c.post(f"{BASE}/api/sessions/{sid}/collect", headers=h)).json()
        assert col["collected"]
        print(f"[PASS] collected {col['collected']}")

        col2 = (await c.post(f"{BASE}/api/sessions/{sid}/collect", headers=h)).json()
        assert not col2["collected"]
        print("[PASS] immediate re-collect empty (cap ok)")

        # ---- Raid trigger loop ----
        raid = None
        for _ in range(16):
            st = (await c.get(f"{BASE}/api/sessions/{sid}/status", headers=h)).json()
            if st.get("raid"):
                raid = st["raid"]
                break
            await asyncio.sleep(0.25)
        assert raid, "raid never triggered"
        print(f"[PASS] raid triggered: {raid['name']}")

        rq = (await c.post(f"{BASE}/api/sessions/{sid}/raid/question", headers=h)).json()
        repelled = False
        d = {}
        for i in range(len(rq["options"])):
            d = (
                await c.post(
                    f"{BASE}/api/sessions/{sid}/raid/defend",
                    json={"question_id": rq["question_id"], "answer_index": i},
                    headers=h,
                )
            ).json()
            if d.get("repelled"):
                repelled = True
                break
            if d.get("expired"):
                break
        assert repelled, d
        print(f"[PASS] raid repelled | loot={d['loot']} +{d['xp_bonus']}xp")
        assert d["game_state"].get("raids_repelled", 0) >= 1
        st2 = (await c.get(f"{BASE}/api/sessions/{sid}/status", headers=h)).json()
        assert st2["raid"] is None
        print("[PASS] raid cleared")

        print("\nALL BASE ECONOMY v2 TESTS PASSED")


asyncio.run(main())
